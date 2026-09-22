// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalTimers:off -- Native browser events own bounded temporary files, deadlines, and wall-clock receipts.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import {
  BROWSER_ARTIFACT_MAX_BYTES,
  type BrowserArtifactActionId,
  type BrowserArtifactId,
  type BrowserArtifactOwnership,
  type BrowserDownloadArtifact,
  type BrowserDownloadExpectation,
  type BrowserUploadSelection,
  type BrowserUploadTransfer,
} from "@t3tools/contracts";

export class BrowserArtifactError extends Error {
  override readonly name = "BrowserArtifactError";
  readonly code:
    | "aborted"
    | "download-failed"
    | "download-mismatch"
    | "duplicate-identity"
    | "not-found"
    | "size-limit"
    | "staging-failed"
    | "timeout";

  constructor(code: BrowserArtifactError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

interface DownloadEvent {
  preventDefault(): void;
}
export interface BrowserDownloadFrame {
  readonly processId: number;
  readonly routingId: number;
}
interface DownloadItemLike {
  getFilename(): string;
  getMimeType(): string;
  getReceivedBytes(): number;
  getTotalBytes(): number;
  getInitiatorOrigin(): string;
  getURL(): string;
  getURLChain(): ReadonlyArray<string>;
  setSavePath(path: string): void;
  cancel(): void;
  on(event: "updated", listener: (_event: unknown, state: string) => void): this;
  on(event: "done", listener: (_event: unknown, state: string) => void): this;
  off(event: "updated", listener: (_event: unknown, state: string) => void): this;
  off(event: "done", listener: (_event: unknown, state: string) => void): this;
}
type WillDownloadListener = (
  event: DownloadEvent,
  item: DownloadItemLike,
  webContents: { readonly id: number },
  frame: BrowserDownloadFrame | null,
) => void;
export interface BrowserDownloadSession {
  on(event: "will-download", listener: WillDownloadListener): unknown;
  off(event: "will-download", listener: WillDownloadListener): unknown;
}
interface OwnedArtifact {
  readonly directory: string;
  readonly path: string;
  readonly sizeBytes: number;
  readonly readable: boolean;
  readonly ownership: BrowserArtifactOwnership;
}
interface CachedOperation<A> {
  readonly fingerprint: string;
  readonly promise: Promise<A>;
}
export interface BrowserArtifactStoreOptions {
  readonly stagingDirectory: string;
  readonly maximumBytes?: number;
  readonly maximumOwnedBytes?: number;
  readonly nowIso?: () => string;
  readonly randomId?: () => string;
}
export interface ArmBrowserDownloadInput {
  readonly expectation: BrowserDownloadExpectation;
  readonly session: BrowserDownloadSession;
  readonly webContentsId: number;
  readonly expectedFrame: BrowserDownloadFrame;
  readonly trigger: () => Promise<unknown>;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
export interface BrowserArtifactStore {
  readonly selectUpload: (
    transfer: BrowserUploadTransfer,
    selectFile: (ownedPath: string) => Promise<void>,
  ) => Promise<BrowserUploadSelection>;
  readonly armDownload: (input: ArmBrowserDownloadInput) => Promise<BrowserDownloadArtifact>;
  readonly readDownload: (ownership: BrowserArtifactOwnership) => Promise<Uint8Array>;
  readonly acknowledge: (ownership: BrowserArtifactOwnership) => Promise<void>;
  readonly releaseTab: (
    scope: Pick<BrowserArtifactOwnership, "environmentId" | "tabId">,
  ) => Promise<void>;
  readonly dispose: () => Promise<void>;
}

const safeDisplayName = (rawName: string): string => {
  const leaf = NodePath.basename(rawName.replaceAll("\\", "/"));
  const printable = [...leaf]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f ? "_" : character;
    })
    .join("")
    .trim();
  if (printable.length === 0 || printable === "." || printable === "..") return "download";
  let byteLength = 0;
  let bounded = "";
  for (const character of printable) {
    const characterBytes = Buffer.byteLength(character);
    if (byteLength + characterBytes > 255) break;
    bounded += character;
    byteLength += characterBytes;
  }
  return bounded.length === 0 ? "download" : bounded;
};
const sameFrame = (left: BrowserDownloadFrame | null, right: BrowserDownloadFrame): boolean =>
  left !== null &&
  (left === right || (left.processId === right.processId && left.routingId === right.routingId));
const errorCause = (cause: unknown): ErrorOptions => ({ cause });
const ownershipFingerprint = (ownership: BrowserArtifactOwnership): string =>
  JSON.stringify([
    ownership.environmentId,
    ownership.tabId,
    ownership.runId ?? null,
    ownership.actionId,
    ownership.artifactId,
  ]);
const matchesOwnership = (artifact: OwnedArtifact, ownership: BrowserArtifactOwnership): boolean =>
  ownershipFingerprint(artifact.ownership) === ownershipFingerprint(ownership);

export function makeBrowserArtifactStore(
  options: BrowserArtifactStoreOptions,
): BrowserArtifactStore {
  const maximumBytes = Math.max(
    1,
    Math.min(options.maximumBytes ?? BROWSER_ARTIFACT_MAX_BYTES, BROWSER_ARTIFACT_MAX_BYTES),
  );
  const maximumOwnedBytes = Math.min(
    BROWSER_ARTIFACT_MAX_BYTES * 2,
    Math.max(maximumBytes, options.maximumOwnedBytes ?? BROWSER_ARTIFACT_MAX_BYTES * 2),
  );
  const nowIso = options.nowIso ?? (() => new Date().toISOString());
  const randomId = options.randomId ?? NodeCrypto.randomUUID;
  const owned = new Map<BrowserArtifactId, OwnedArtifact>();
  const uploads = new Map<BrowserArtifactActionId, CachedOperation<BrowserUploadSelection>>();
  const downloads = new Map<BrowserArtifactActionId, CachedOperation<BrowserDownloadArtifact>>();
  const actionKinds = new Map<BrowserArtifactActionId, "upload" | "download">();
  const actionScopes = new Map<
    BrowserArtifactActionId,
    Pick<BrowserArtifactOwnership, "environmentId" | "tabId">
  >();
  const actionArtifactIds = new Map<BrowserArtifactActionId, BrowserArtifactId>();
  const actionControllers = new Map<BrowserArtifactActionId, AbortController>();
  const reservedArtifactIds = new Set<BrowserArtifactId>();
  const reservedSizes = new Map<BrowserArtifactId, number>();
  const inFlightCancels = new Set<() => void>();
  const cleanupPromises = new Set<Promise<void>>();
  const operationPromises = new Set<Promise<unknown>>();
  const disposeController = new AbortController();
  let disposed = false;

  const trackCleanup = (promise: Promise<void>): Promise<void> => {
    cleanupPromises.add(promise);
    void promise.finally(() => cleanupPromises.delete(promise));
    return promise;
  };
  const trackOperation = <A>(promise: Promise<A>): Promise<A> => {
    operationPromises.add(promise);
    void promise.then(
      () => operationPromises.delete(promise),
      () => operationPromises.delete(promise),
    );
    return promise;
  };
  const removeOwnedDirectory = (directory: string): Promise<void> =>
    trackCleanup(NodeFSP.rm(directory, { force: true, recursive: true }).catch(() => undefined));
  const reserveArtifact = (artifactId: BrowserArtifactId, sizeBytes: number): void => {
    const total = [...reservedSizes.values()].reduce((sum, size) => sum + size, 0);
    if (reservedArtifactIds.has(artifactId))
      throw new BrowserArtifactError(
        "duplicate-identity",
        `Browser artifact ${artifactId} is already reserved.`,
      );
    if (total + sizeBytes > maximumOwnedBytes)
      throw new BrowserArtifactError(
        "size-limit",
        `Browser artifact storage would exceed its ${maximumOwnedBytes} byte ownership limit.`,
      );
    reservedArtifactIds.add(artifactId);
    reservedSizes.set(artifactId, sizeBytes);
  };
  const releaseReservation = (artifactId: BrowserArtifactId): void => {
    reservedArtifactIds.delete(artifactId);
    reservedSizes.delete(artifactId);
  };
  const prepareDirectory = async (prefix: string): Promise<string> => {
    if (disposed) throw new BrowserArtifactError("aborted", "Browser artifact storage is closed.");
    try {
      await NodeFSP.mkdir(options.stagingDirectory, { recursive: true, mode: 0o700 });
      const directory = await NodeFSP.mkdtemp(NodePath.join(options.stagingDirectory, prefix));
      if (disposed) {
        await removeOwnedDirectory(directory);
        throw new BrowserArtifactError("aborted", "Browser artifact storage is closed.");
      }
      return directory;
    } catch (cause) {
      if (cause instanceof BrowserArtifactError) throw cause;
      throw new BrowserArtifactError(
        "staging-failed",
        "Could not create a private browser artifact staging directory.",
        errorCause(cause),
      );
    }
  };
  const raceAbort = async <A>(operation: Promise<A>, signal: AbortSignal): Promise<A> => {
    if (disposeController.signal.aborted || signal.aborted) {
      throw new BrowserArtifactError("aborted", "Browser artifact storage is closed.");
    }
    let abort!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      abort = () =>
        reject(new BrowserArtifactError("aborted", "Browser artifact storage is closed."));
      disposeController.signal.addEventListener("abort", abort, { once: true });
      signal.addEventListener("abort", abort, { once: true });
    });
    try {
      return await Promise.race([operation, aborted]);
    } finally {
      disposeController.signal.removeEventListener("abort", abort);
      signal.removeEventListener("abort", abort);
    }
  };

  const selectUpload: BrowserArtifactStore["selectUpload"] = (transfer, selectFile) => {
    const fingerprint = JSON.stringify([
      transfer.environmentId,
      transfer.tabId,
      transfer.runId ?? null,
      transfer.actionId,
      transfer.artifactId,
      transfer.fileName,
      transfer.mimeType ?? null,
      transfer.sizeBytes,
    ]);
    const cached = uploads.get(transfer.actionId);
    if (cached)
      return cached.fingerprint === fingerprint
        ? cached.promise
        : Promise.reject(
            new BrowserArtifactError(
              "duplicate-identity",
              `Browser action ${transfer.actionId} was reused with different upload metadata.`,
            ),
          );
    if (actionKinds.has(transfer.actionId) || reservedArtifactIds.has(transfer.artifactId)) {
      return Promise.reject(
        new BrowserArtifactError(
          "duplicate-identity",
          `Browser upload identity ${transfer.actionId}/${transfer.artifactId} is already reserved.`,
        ),
      );
    }
    try {
      reserveArtifact(transfer.artifactId, transfer.sizeBytes);
    } catch (cause) {
      return Promise.reject(cause);
    }
    actionKinds.set(transfer.actionId, "upload");
    actionScopes.set(transfer.actionId, {
      environmentId: transfer.environmentId,
      tabId: transfer.tabId,
    });
    actionArtifactIds.set(transfer.actionId, transfer.artifactId);
    const actionController = new AbortController();
    actionControllers.set(transfer.actionId, actionController);
    const promise = trackOperation(
      (async (): Promise<BrowserUploadSelection> => {
        if (
          transfer.sizeBytes <= 0 ||
          transfer.sizeBytes > maximumBytes ||
          transfer.data.byteLength !== transfer.sizeBytes
        )
          throw new BrowserArtifactError(
            "size-limit",
            `Browser upload ${transfer.artifactId} exceeds its declared or allowed size.`,
          );
        const directory = await prepareDirectory("upload-");
        const stagedPath = NodePath.join(directory, transfer.fileName);
        const ownership: BrowserArtifactOwnership = {
          environmentId: transfer.environmentId,
          tabId: transfer.tabId,
          ...(transfer.runId === undefined ? {} : { runId: transfer.runId }),
          actionId: transfer.actionId,
          artifactId: transfer.artifactId,
        };
        try {
          await NodeFSP.writeFile(stagedPath, transfer.data, { flag: "wx", mode: 0o600 });
          owned.set(transfer.artifactId, {
            directory,
            path: stagedPath,
            sizeBytes: transfer.sizeBytes,
            readable: false,
            ownership,
          });
          if (disposed)
            throw new BrowserArtifactError("aborted", "Browser artifact storage is closed.");
          await raceAbort(
            Promise.resolve().then(() => selectFile(stagedPath)),
            actionController.signal,
          );
          if (disposed)
            throw new BrowserArtifactError(
              "aborted",
              "Browser artifact storage closed while selecting the upload.",
            );
          return {
            ...ownership,
            fileName: transfer.fileName,
            sizeBytes: transfer.sizeBytes,
            status: "selected",
          };
        } catch (cause) {
          owned.delete(transfer.artifactId);
          await removeOwnedDirectory(directory);
          throw cause instanceof BrowserArtifactError
            ? cause
            : new BrowserArtifactError(
                "staging-failed",
                `Browser upload ${transfer.artifactId} could not be selected. Its effect is not replayed.`,
                errorCause(cause),
              );
        }
      })(),
    );
    uploads.set(transfer.actionId, { fingerprint, promise });
    return promise;
  };

  const armDownload: BrowserArtifactStore["armDownload"] = (input) => {
    const { expectation } = input;
    const limit = Math.min(expectation.maximumBytes ?? maximumBytes, maximumBytes);
    const fingerprint = JSON.stringify([
      expectation.environmentId,
      expectation.tabId,
      expectation.runId ?? null,
      expectation.actionId,
      expectation.expectedFileName ?? null,
      expectation.expectedUrl ?? null,
      expectation.expectedInitiatorOrigin ?? null,
      limit,
      input.webContentsId,
      input.expectedFrame.processId,
      input.expectedFrame.routingId,
    ]);
    const cached = downloads.get(expectation.actionId);
    if (cached)
      return cached.fingerprint === fingerprint
        ? cached.promise
        : Promise.reject(
            new BrowserArtifactError(
              "duplicate-identity",
              `Browser action ${expectation.actionId} was reused with a different download expectation.`,
            ),
          );
    if (actionKinds.has(expectation.actionId)) {
      return Promise.reject(
        new BrowserArtifactError(
          "duplicate-identity",
          `Browser action ${expectation.actionId} is already reserved for another mutation.`,
        ),
      );
    }
    actionKinds.set(expectation.actionId, "download");
    actionScopes.set(expectation.actionId, {
      environmentId: expectation.environmentId,
      tabId: expectation.tabId,
    });
    const actionController = new AbortController();
    actionControllers.set(expectation.actionId, actionController);
    const promise = trackOperation(
      (async (): Promise<BrowserDownloadArtifact> => {
        const directory = await prepareDirectory("download-");
        let artifactId: BrowserArtifactId | undefined;
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const candidate = `browser-download-${randomId()}` as BrowserArtifactId;
          if (reservedArtifactIds.has(candidate)) continue;
          try {
            reserveArtifact(candidate, limit);
            artifactId = candidate;
            actionArtifactIds.set(expectation.actionId, candidate);
            break;
          } catch (cause) {
            if (cause instanceof BrowserArtifactError && cause.code === "duplicate-identity")
              continue;
            throw cause;
          }
        }
        if (artifactId === undefined) {
          await removeOwnedDirectory(directory);
          throw new BrowserArtifactError(
            "duplicate-identity",
            "Could not allocate a unique browser download artifact identity.",
          );
        }
        return await new Promise<BrowserDownloadArtifact>((resolve, reject) => {
          type State = "waiting" | "downloading" | "finalizing" | "terminal";
          let state: State = "waiting";
          let acceptedItem: DownloadItemLike | undefined;
          let downloadPath: string | undefined;
          const timeoutMs = Math.max(1, Math.min(input.timeoutMs ?? 60_000, 60_000));
          const timer = setTimeout(
            () =>
              fail(
                new BrowserArtifactError(
                  "timeout",
                  `Browser download action ${expectation.actionId} did not produce a completed correlated download within ${timeoutMs}ms.`,
                ),
                true,
              ),
            timeoutMs,
          );
          const detachItem = (): void => {
            acceptedItem?.off("updated", onUpdated);
            acceptedItem?.off("done", onDone);
          };
          const detachAll = (): void => {
            clearTimeout(timer);
            input.session.off("will-download", onWillDownload);
            input.signal?.removeEventListener("abort", onAbort);
            actionController.signal.removeEventListener("abort", onAbort);
            inFlightCancels.delete(onAbort);
            detachItem();
          };
          const fail = (error: BrowserArtifactError, cancel = false): void => {
            if (state === "terminal") return;
            state = "terminal";
            detachAll();
            if (cancel) acceptedItem?.cancel();
            releaseReservation(artifactId);
            void removeOwnedDirectory(directory).finally(() => reject(error));
          };
          const onAbort = (): void =>
            fail(
              new BrowserArtifactError(
                "aborted",
                `Browser download action ${expectation.actionId} was aborted.`,
              ),
              true,
            );
          const onUpdated = (_event: unknown, updateState: string): void => {
            if (state !== "downloading") return;
            if (updateState === "interrupted")
              fail(
                new BrowserArtifactError(
                  "download-failed",
                  `Browser download action ${expectation.actionId} was interrupted.`,
                ),
              );
            else if ((acceptedItem?.getReceivedBytes() ?? 0) > limit)
              fail(
                new BrowserArtifactError(
                  "size-limit",
                  `Browser download action ${expectation.actionId} exceeded ${limit} bytes.`,
                ),
                true,
              );
          };
          const onDone = (_event: unknown, doneState: string): void => {
            if (state !== "downloading") return;
            if (doneState !== "completed" || !acceptedItem || !downloadPath) {
              fail(
                new BrowserArtifactError(
                  "download-failed",
                  `Browser download action ${expectation.actionId} ended with state ${doneState}.`,
                ),
              );
              return;
            }
            state = "finalizing";
            clearTimeout(timer);
            input.session.off("will-download", onWillDownload);
            detachItem();
            const item = acceptedItem;
            const path = downloadPath;
            void (async () => {
              try {
                const info = await NodeFSP.lstat(path);
                const receivedBytes = item.getReceivedBytes();
                if (
                  !info.isFile() ||
                  info.isSymbolicLink() ||
                  info.size <= 0 ||
                  info.size !== receivedBytes ||
                  info.size > limit
                )
                  throw new BrowserArtifactError(
                    info.size > limit ? "size-limit" : "download-mismatch",
                    `Browser download action ${expectation.actionId} did not match its completed file receipt.`,
                  );
                if (state !== "finalizing") return;
                state = "terminal";
                detachAll();
                const ownership: BrowserArtifactOwnership = {
                  environmentId: expectation.environmentId,
                  tabId: expectation.tabId,
                  ...(expectation.runId === undefined ? {} : { runId: expectation.runId }),
                  actionId: expectation.actionId,
                  artifactId,
                };
                owned.set(artifactId, {
                  directory,
                  path,
                  sizeBytes: info.size,
                  readable: true,
                  ownership,
                });
                const mimeType = item.getMimeType().trim();
                resolve({
                  ...ownership,
                  fileName: safeDisplayName(item.getFilename()),
                  ...(mimeType.length === 0 ? {} : { mimeType }),
                  sizeBytes: info.size,
                  status: "completed",
                  completedAt: nowIso(),
                });
              } catch (cause) {
                fail(
                  cause instanceof BrowserArtifactError
                    ? cause
                    : new BrowserArtifactError(
                        "download-failed",
                        `Browser download action ${expectation.actionId} could not verify its saved file.`,
                        errorCause(cause),
                      ),
                );
              }
            })();
          };
          const onWillDownload: WillDownloadListener = (_event, item, webContents, frame) => {
            if (
              state !== "waiting" ||
              webContents.id !== input.webContentsId ||
              !sameFrame(frame, input.expectedFrame)
            )
              return;
            const displayName = safeDisplayName(item.getFilename());
            const urlMatches =
              expectation.expectedUrl === undefined ||
              item.getURL() === expectation.expectedUrl ||
              item.getURLChain().includes(expectation.expectedUrl);
            if (
              (expectation.expectedFileName !== undefined &&
                displayName !== expectation.expectedFileName) ||
              (expectation.expectedInitiatorOrigin !== undefined &&
                item.getInitiatorOrigin() !== expectation.expectedInitiatorOrigin) ||
              !urlMatches
            )
              return;
            const totalBytes = item.getTotalBytes();
            acceptedItem = item;
            input.session.off("will-download", onWillDownload);
            if (totalBytes > limit) {
              fail(
                new BrowserArtifactError(
                  "size-limit",
                  `Browser download action ${expectation.actionId} declared ${totalBytes} bytes.`,
                ),
                true,
              );
              return;
            }
            state = "downloading";
            downloadPath = NodePath.join(directory, "download.bin");
            item.setSavePath(downloadPath);
            item.on("updated", onUpdated);
            item.on("done", onDone);
          };
          input.session.on("will-download", onWillDownload);
          input.signal?.addEventListener("abort", onAbort, { once: true });
          actionController.signal.addEventListener("abort", onAbort, { once: true });
          inFlightCancels.add(onAbort);
          if (input.signal?.aborted || actionController.signal.aborted) {
            onAbort();
            return;
          }
          void Promise.resolve()
            .then(input.trigger)
            .catch((cause) =>
              fail(
                new BrowserArtifactError(
                  "download-failed",
                  `Browser download trigger ${expectation.actionId} failed. Its effect is not replayed.`,
                  errorCause(cause),
                ),
                true,
              ),
            );
        });
      })(),
    );
    downloads.set(expectation.actionId, { fingerprint, promise });
    return promise;
  };

  const requireOwned = (ownership: BrowserArtifactOwnership): OwnedArtifact => {
    const artifact = owned.get(ownership.artifactId);
    if (!artifact || !matchesOwnership(artifact, ownership))
      throw new BrowserArtifactError(
        "not-found",
        `Browser artifact ${ownership.artifactId} is not owned by this exact action.`,
      );
    return artifact;
  };
  const readDownload: BrowserArtifactStore["readDownload"] = async (ownership) => {
    const artifact = requireOwned(ownership);
    if (!artifact.readable)
      throw new BrowserArtifactError(
        "not-found",
        `Browser download ${ownership.artifactId} is not available.`,
      );
    let handle: NodeFSP.FileHandle | undefined;
    try {
      handle = await NodeFSP.open(
        artifact.path,
        NodeFS.constants.O_RDONLY | (NodeFS.constants.O_NOFOLLOW ?? 0),
      );
      const info = await handle.stat();
      if (!info.isFile() || info.size !== artifact.sizeBytes || info.size > maximumBytes)
        throw new BrowserArtifactError(
          "download-mismatch",
          `Browser download ${ownership.artifactId} changed before transfer.`,
        );
      const capacity = Math.min(maximumBytes + 1, info.size + 1);
      const data = Buffer.alloc(capacity);
      let offset = 0;
      while (offset < capacity) {
        const result = await handle.read(data, offset, capacity - offset, offset);
        if (result.bytesRead === 0) break;
        offset += result.bytesRead;
      }
      if (offset !== info.size)
        throw new BrowserArtifactError(
          "download-mismatch",
          `Browser download ${ownership.artifactId} changed during transfer.`,
        );
      return data.subarray(0, offset);
    } catch (cause) {
      if (cause instanceof BrowserArtifactError) throw cause;
      throw new BrowserArtifactError(
        "not-found",
        `Browser download ${ownership.artifactId} is no longer available.`,
        errorCause(cause),
      );
    } finally {
      await handle?.close().catch(() => undefined);
    }
  };
  const acknowledge: BrowserArtifactStore["acknowledge"] = async (ownership) => {
    const artifact = requireOwned(ownership);
    owned.delete(ownership.artifactId);
    releaseReservation(ownership.artifactId);
    await removeOwnedDirectory(artifact.directory);
  };
  const releaseTab: BrowserArtifactStore["releaseTab"] = async (scope) => {
    const actionIds = [...actionScopes.entries()]
      .filter(
        ([, candidate]) =>
          candidate.environmentId === scope.environmentId && candidate.tabId === scope.tabId,
      )
      .map(([actionId]) => actionId);
    for (const actionId of actionIds) actionControllers.get(actionId)?.abort();
    await Promise.allSettled(
      actionIds.flatMap((actionId) => {
        const uploadPromise = uploads.get(actionId)?.promise;
        const downloadPromise = downloads.get(actionId)?.promise;
        const pending: Array<Promise<unknown>> = [];
        if (uploadPromise !== undefined) pending.push(uploadPromise);
        if (downloadPromise !== undefined) pending.push(downloadPromise);
        return pending;
      }),
    );
    const artifacts = [...owned.values()].filter(
      (artifact) =>
        artifact.ownership.environmentId === scope.environmentId &&
        artifact.ownership.tabId === scope.tabId,
    );
    for (const artifact of artifacts) {
      owned.delete(artifact.ownership.artifactId);
      releaseReservation(artifact.ownership.artifactId);
      await removeOwnedDirectory(artifact.directory);
    }
    for (const actionId of actionIds) {
      const artifactId = actionArtifactIds.get(actionId);
      if (artifactId !== undefined && !owned.has(artifactId)) releaseReservation(artifactId);
      uploads.delete(actionId);
      downloads.delete(actionId);
      actionKinds.delete(actionId);
      actionScopes.delete(actionId);
      actionArtifactIds.delete(actionId);
      actionControllers.delete(actionId);
    }
  };
  const dispose: BrowserArtifactStore["dispose"] = async () => {
    if (disposed) return;
    disposed = true;
    disposeController.abort();
    for (const controller of actionControllers.values()) controller.abort();
    for (const cancel of inFlightCancels) cancel();
    await Promise.allSettled(operationPromises);
    const pendingCleanup = Array.from(owned.values(), (artifact) =>
      removeOwnedDirectory(artifact.directory),
    );
    pendingCleanup.push(...cleanupPromises);
    await Promise.all(pendingCleanup);
    owned.clear();
    reservedArtifactIds.clear();
    reservedSizes.clear();
  };
  return { selectUpload, armDownload, readDownload, acknowledge, releaseTab, dispose };
}

export const __testing = { safeDisplayName, sameFrame };
