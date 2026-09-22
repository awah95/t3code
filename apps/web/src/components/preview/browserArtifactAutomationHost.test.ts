import {
  EnvironmentId,
  ThreadId,
  type BrowserArtifactActionId,
  type BrowserArtifactId,
  type BrowserDownloadHostInput,
  type BrowserUploadHostInput,
  type DesktopBrowserArtifactReadInput,
  type DesktopBrowserArtifactBridge,
  type PreviewTabId,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { __testing, createBrowserArtifactAutomationHost } from "./browserArtifactAutomationHost";

const environmentId = EnvironmentId.make("environment-1");
const threadRef = { environmentId, threadId: ThreadId.make("thread-1") };
const tabId = "tab-1" as PreviewTabId;
const actionId = "action-1" as BrowserArtifactActionId;
const artifactId = "artifact-1" as BrowserArtifactId;
const downloadInput: BrowserDownloadHostInput = {
  expectation: { environmentId, tabId, actionId, maximumBytes: 1_024 },
  target: { locator: "role=button[name='Download']" },
};
const uploadInput: BrowserUploadHostInput = {
  transfer: {
    environmentId,
    tabId,
    actionId,
    artifactId,
    fileName: "upload.txt",
    mimeType: "text/plain",
    sizeBytes: 5,
  },
  target: { locator: "input[type=file]" },
  sourceUrl: "/api/assets/upload",
};

const makeBridge = () => {
  const artifact = {
    environmentId,
    tabId,
    actionId,
    artifactId,
    fileName: "report.txt",
    mimeType: "text/plain",
    sizeBytes: 5,
    status: "completed" as const,
    completedAt: "2026-09-22T00:00:00.000Z",
  };
  return {
    prepareAction: vi.fn(async () => undefined),
    selectUpload: vi.fn(),
    startDownload: vi.fn(
      async (_runtimeTabId: string, _input: BrowserDownloadHostInput) => artifact,
    ),
    readDownload: vi.fn(async (_input: DesktopBrowserArtifactReadInput) => ({
      artifactId,
      data: new TextEncoder().encode("hello"),
    })),
    acknowledgeArtifact: vi.fn(async () => undefined),
    dialogStatus: vi.fn(),
    handleDialog: vi.fn(),
  } satisfies DesktopBrowserArtifactBridge;
};

describe("browser artifact automation host", () => {
  it("bounds a streamed response to the authoritative artifact size", async () => {
    const response = new Response(new Uint8Array([1, 2, 3]), {
      headers: { "Content-Length": "3" },
    });
    await expect(__testing.responseBytes(response, 3)).resolves.toEqual(new Uint8Array([1, 2, 3]));

    const oversized = new Response(new Uint8Array([1, 2, 3, 4]));
    await expect(__testing.responseBytes(oversized, 3)).rejects.toThrow(/exceeded/);
  });

  it("prepares upload dialogs only after the signed bytes are available", async () => {
    const bridge = makeBridge();
    const beforeNative = vi.fn(async () => undefined);
    const host = createBrowserArtifactAutomationHost(bridge, {
      fetchUploadBytes: vi.fn(async () => {
        throw new Error("signed fetch failed");
      }),
      uploadDownloadedBytes: vi.fn(),
    });

    await expect(
      host.selectUpload(
        threadRef,
        tabId,
        "runtime-tab-1",
        uploadInput,
        Date.now() + 15_000,
        beforeNative,
      ),
    ).rejects.toThrow("signed fetch failed");

    expect(beforeNative).not.toHaveBeenCalled();
    expect(bridge.selectUpload).not.toHaveBeenCalled();
  });

  it("retries only the HTTP attachment transfer without replaying the native download", async () => {
    const bridge = makeBridge();
    const uploadDownloadedBytes = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient upload failure"))
      .mockResolvedValueOnce("pending-attachment-1");
    const host = createBrowserArtifactAutomationHost(bridge, {
      fetchUploadBytes: vi.fn(),
      uploadDownloadedBytes,
    });
    const beforeNative = vi.fn(async () => undefined);

    await expect(
      host.download(
        threadRef,
        tabId,
        "runtime-tab-1",
        downloadInput,
        Date.now() + 15_000,
        beforeNative,
      ),
    ).rejects.toThrow("transient upload failure");
    await expect(
      host.download(
        threadRef,
        tabId,
        "runtime-tab-1",
        downloadInput,
        Date.now() + 15_000,
        beforeNative,
      ),
    ).resolves.toMatchObject({ uploadedAttachmentId: "pending-attachment-1" });

    expect(beforeNative).toHaveBeenCalledOnce();
    expect(bridge.startDownload).toHaveBeenCalledOnce();
    expect(bridge.readDownload).toHaveBeenCalledTimes(2);
    expect(uploadDownloadedBytes).toHaveBeenCalledTimes(2);

    await host.acknowledge(threadRef, tabId, {
      environmentId,
      tabId,
      actionId,
      artifactId,
    });
    expect(bridge.acknowledgeArtifact).toHaveBeenCalledOnce();
  });

  it("reuses a completed transfer response without creating another pending attachment", async () => {
    const bridge = makeBridge();
    const uploadDownloadedBytes = vi.fn(async () => "pending-attachment-1");
    const host = createBrowserArtifactAutomationHost(bridge, {
      fetchUploadBytes: vi.fn(),
      uploadDownloadedBytes,
    });

    const first = await host.download(
      threadRef,
      tabId,
      "runtime-tab-1",
      downloadInput,
      Date.now() + 15_000,
    );
    const replay = await host.download(
      threadRef,
      tabId,
      "runtime-tab-1",
      downloadInput,
      Date.now() + 15_000,
    );

    expect(replay).toEqual(first);
    expect(bridge.startDownload).toHaveBeenCalledOnce();
    expect(bridge.readDownload).toHaveBeenCalledOnce();
    expect(uploadDownloadedBytes).toHaveBeenCalledOnce();
  });

  it("fails closed when unacknowledged download metadata reaches its bound", async () => {
    const bridge = makeBridge();
    bridge.startDownload.mockImplementation(async (_runtimeTabId, input) => ({
      ...input.expectation,
      artifactId: `artifact-${input.expectation.actionId}` as BrowserArtifactId,
      fileName: "report.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      status: "completed",
      completedAt: "2026-09-22T00:00:00.000Z",
    }));
    bridge.readDownload.mockImplementation(async (input) => ({
      artifactId: input.artifactId,
      data: new Uint8Array([1]),
    }));
    const host = createBrowserArtifactAutomationHost(bridge, {
      fetchUploadBytes: vi.fn(),
      uploadDownloadedBytes: vi.fn(async () => "pending-attachment"),
    });

    for (let index = 0; index < 512; index += 1) {
      const nextActionId = `action-${index}` as BrowserArtifactActionId;
      await host.download(
        threadRef,
        tabId,
        "runtime-tab-1",
        {
          ...downloadInput,
          expectation: { ...downloadInput.expectation, actionId: nextActionId },
        },
        Date.now() + 15_000,
      );
    }

    await expect(
      host.download(
        threadRef,
        tabId,
        "runtime-tab-1",
        {
          ...downloadInput,
          expectation: {
            ...downloadInput.expectation,
            actionId: "action-overflow" as BrowserArtifactActionId,
          },
        },
        Date.now() + 15_000,
      ),
    ).rejects.toThrow("transfer-failed");
    expect(bridge.startDownload).toHaveBeenCalledTimes(512);
  });
});
