import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { runAttachmentUploadCycle } from "@t3tools/client-runtime/state/attachments";
import {
  BROWSER_ARTIFACT_MAX_BYTES,
  PreviewAutomationArtifactTransferError,
  type BrowserArtifactAcknowledgeHostInput,
  type BrowserDownloadArtifact,
  type BrowserDownloadHostInput,
  type BrowserDownloadHostResult,
  type BrowserUploadHostInput,
  type BrowserUploadSelection,
  type DesktopBrowserArtifactBridge,
  type ScopedThreadRef,
} from "@t3tools/contracts";

const transferError = (
  threadRef: ScopedThreadRef,
  operation: "uploadFile" | "downloadFile",
  reason: ConstructorParameters<typeof PreviewAutomationArtifactTransferError>[0]["reason"],
  cause?: unknown,
) =>
  new PreviewAutomationArtifactTransferError({
    operation,
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
    reason,
    ...(cause === undefined ? {} : { cause }),
  });

const responseBytes = async (response: Response, expectedSize: number): Promise<Uint8Array> => {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) !== expectedSize) {
    throw new Error("The signed artifact response did not match its authoritative size.");
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== expectedSize) {
      throw new Error("The signed artifact response did not match its authoritative size.");
    }
    return bytes;
  }

  const bytes = new Uint8Array(expectedSize);
  const reader = response.body.getReader();
  let offset = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (offset + chunk.value.byteLength > expectedSize) {
        throw new Error("The signed artifact response exceeded its authoritative size.");
      }
      bytes.set(chunk.value, offset);
      offset += chunk.value.byteLength;
    }
  } catch (cause) {
    await reader.cancel(cause).catch(() => undefined);
    throw cause;
  }
  if (offset !== expectedSize) {
    throw new Error("The signed artifact response did not match its authoritative size.");
  }
  return bytes;
};

const fetchUploadBytes = async (
  threadRef: ScopedThreadRef,
  input: BrowserUploadHostInput,
  deadlineMs: number,
): Promise<Uint8Array> => {
  if (input.transfer.sizeBytes <= 0 || input.transfer.sizeBytes > BROWSER_ARTIFACT_MAX_BYTES) {
    throw transferError(threadRef, "uploadFile", "size-limit");
  }
  const { readPreparedConnection } = await import("~/state/session");
  const connection = readPreparedConnection(threadRef.environmentId);
  const sourceUrl = connection ? resolveAssetUrl(connection.httpBaseUrl, input.sourceUrl) : null;
  if (!connection || !sourceUrl) {
    throw transferError(threadRef, "uploadFile", "source-not-found");
  }
  if (new URL(sourceUrl).origin !== new URL(connection.httpBaseUrl).origin) {
    throw transferError(threadRef, "uploadFile", "source-invalid");
  }
  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0) throw transferError(threadRef, "uploadFile", "transfer-failed");
  try {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(remainingMs) });
    if (!response.ok) {
      throw new Error(`Signed artifact download rejected (${response.status}).`);
    }
    return await responseBytes(response, input.transfer.sizeBytes);
  } catch (cause) {
    throw transferError(threadRef, "uploadFile", "transfer-failed", cause);
  }
};

const uploadDownloadedBytes = async (
  threadRef: ScopedThreadRef,
  artifact: BrowserDownloadArtifact,
  data: Uint8Array,
  deadlineMs: number,
): Promise<string> => {
  if (data.byteLength === 0 || data.byteLength !== artifact.sizeBytes) {
    throw transferError(threadRef, "downloadFile", "source-invalid");
  }
  const mimeType =
    artifact.mimeType && artifact.mimeType.length <= 100
      ? artifact.mimeType
      : "application/octet-stream";
  const [{ appAtomRegistry }, { attachmentEnvironment }, { readPreparedConnection }] =
    await Promise.all([
      import("~/rpc/atomRegistry"),
      import("~/state/attachments"),
      import("~/state/session"),
    ]);
  const result = await runAttachmentUploadCycle({
    registry: appAtomRegistry,
    createUploadUrl: attachmentEnvironment.createUploadUrl,
    remove: attachmentEnvironment.remove,
    environmentId: threadRef.environmentId,
    upload: {
      type: "file",
      name: artifact.fileName,
      mimeType,
      sizeBytes: data.byteLength,
    },
    resolveUploadUrl: (relativeUrl) => {
      const connection = readPreparedConnection(threadRef.environmentId);
      return connection ? resolveAssetUrl(connection.httpBaseUrl, relativeUrl) : null;
    },
    transport: (url) => {
      const controller = new AbortController();
      const remainingMs = deadlineMs - Date.now();
      const body = new Uint8Array(data.byteLength);
      body.set(data);
      return {
        abort: () => controller.abort(),
        done:
          remainingMs <= 0
            ? Promise.reject(new Error("Browser download transfer deadline expired."))
            : fetch(url, {
                method: "POST",
                headers: { "Content-Type": mimeType },
                body: body.buffer,
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(remainingMs)]),
              }).then((response) => {
                if (!response.ok) {
                  throw new Error(`Browser download upload rejected (${response.status}).`);
                }
              }),
      };
    },
  });
  if (result.status !== "uploaded") {
    throw transferError(
      threadRef,
      "downloadFile",
      "transfer-failed",
      result.status === "failed" ? result.error : undefined,
    );
  }
  return result.attachmentId;
};

type CachedDownload = {
  readonly fingerprint: string;
  readonly artifact: Promise<BrowserDownloadArtifact>;
  result?: Promise<BrowserDownloadHostResult>;
};

const MAX_CACHED_DOWNLOADS = 512;

export const createBrowserArtifactAutomationHost = (
  bridge: DesktopBrowserArtifactBridge,
  dependencies: {
    readonly fetchUploadBytes: typeof fetchUploadBytes;
    readonly uploadDownloadedBytes: typeof uploadDownloadedBytes;
  } = { fetchUploadBytes, uploadDownloadedBytes },
) => {
  const downloads = new Map<string, CachedDownload>();

  const selectUpload = async (
    threadRef: ScopedThreadRef,
    collaborativeTabId: string,
    runtimeTabId: string,
    input: BrowserUploadHostInput,
    deadlineMs: number,
    beforeNative?: () => Promise<void>,
  ): Promise<BrowserUploadSelection> => {
    if (
      input.transfer.environmentId !== threadRef.environmentId ||
      input.transfer.tabId !== collaborativeTabId
    ) {
      throw transferError(threadRef, "uploadFile", "scope-mismatch");
    }
    const data = await dependencies.fetchUploadBytes(threadRef, input, deadlineMs);
    await beforeNative?.();
    return await bridge.selectUpload(runtimeTabId, {
      target: input.target,
      transfer: { ...input.transfer, data },
    });
  };

  const download = async (
    threadRef: ScopedThreadRef,
    collaborativeTabId: string,
    runtimeTabId: string,
    input: BrowserDownloadHostInput,
    deadlineMs: number,
    beforeNative?: () => Promise<void>,
  ): Promise<BrowserDownloadHostResult> => {
    if (
      input.expectation.environmentId !== threadRef.environmentId ||
      input.expectation.tabId !== collaborativeTabId
    ) {
      throw transferError(threadRef, "downloadFile", "scope-mismatch");
    }
    const fingerprint = JSON.stringify(input);
    const cached = downloads.get(input.expectation.actionId);
    if (cached && cached.fingerprint !== fingerprint) {
      throw transferError(threadRef, "downloadFile", "scope-mismatch");
    }
    if (!cached && downloads.size >= MAX_CACHED_DOWNLOADS) {
      throw transferError(threadRef, "downloadFile", "transfer-failed");
    }
    const entry =
      cached ??
      (() => {
        const artifact = (async () => {
          await beforeNative?.();
          const completed = await bridge.startDownload(runtimeTabId, input);
          if (
            completed.environmentId !== input.expectation.environmentId ||
            completed.tabId !== input.expectation.tabId ||
            completed.runId !== input.expectation.runId ||
            completed.actionId !== input.expectation.actionId
          ) {
            throw transferError(threadRef, "downloadFile", "scope-mismatch");
          }
          return completed;
        })();
        const created: CachedDownload = { fingerprint, artifact };
        downloads.set(input.expectation.actionId, created);
        void artifact.catch(() => {
          if (downloads.get(input.expectation.actionId) === created) {
            downloads.delete(input.expectation.actionId);
          }
        });
        return created;
      })();
    if (entry.result) return await entry.result;
    const result = (async () => {
      const artifact = await entry.artifact;
      const downloaded = await bridge.readDownload({
        environmentId: artifact.environmentId,
        tabId: artifact.tabId,
        ...(artifact.runId === undefined ? {} : { runId: artifact.runId }),
        actionId: artifact.actionId,
        artifactId: artifact.artifactId,
      });
      if (
        downloaded.artifactId !== artifact.artifactId ||
        downloaded.data.byteLength !== artifact.sizeBytes
      ) {
        throw transferError(threadRef, "downloadFile", "source-invalid");
      }
      const uploadedAttachmentId = await dependencies.uploadDownloadedBytes(
        threadRef,
        artifact,
        downloaded.data,
        deadlineMs,
      );
      return { ...artifact, uploadedAttachmentId };
    })();
    entry.result = result;
    try {
      return await result;
    } catch (cause) {
      if (downloads.get(input.expectation.actionId)?.result === result) {
        delete entry.result;
      }
      throw cause;
    }
  };

  const acknowledge = async (
    threadRef: ScopedThreadRef,
    collaborativeTabId: string,
    input: BrowserArtifactAcknowledgeHostInput,
  ): Promise<void> => {
    if (input.environmentId !== threadRef.environmentId || input.tabId !== collaborativeTabId) {
      throw transferError(threadRef, "downloadFile", "scope-mismatch");
    }
    await bridge.acknowledgeArtifact(input);
    downloads.delete(input.actionId);
  };

  return { selectUpload, download, acknowledge };
};

export const __testing = { responseBytes };
