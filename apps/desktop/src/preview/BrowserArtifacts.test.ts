// @effect-diagnostics nodeBuiltinImport:off -- Real temporary files prove ownership and receipt cleanup.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type {
  BrowserArtifactActionId,
  BrowserArtifactId,
  BrowserDownloadExpectation,
  BrowserUploadTransfer,
} from "@t3tools/contracts";
import { BrowserDownloadArtifact } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  BrowserArtifactError,
  type BrowserDownloadFrame,
  type BrowserDownloadSession,
  makeBrowserArtifactStore,
} from "./BrowserArtifacts.ts";

type DownloadListener = Parameters<BrowserDownloadSession["on"]>[1];
class FakeSession implements BrowserDownloadSession {
  readonly listeners = new Set<DownloadListener>();
  on(_event: "will-download", listener: DownloadListener): void {
    this.listeners.add(listener);
  }
  off(_event: "will-download", listener: DownloadListener): void {
    this.listeners.delete(listener);
  }
  emit(item: FakeDownloadItem, webContentsId: number, frame: BrowserDownloadFrame | null): void {
    for (const listener of this.listeners)
      listener({ preventDefault() {} }, item, { id: webContentsId }, frame);
  }
}

type ItemListener = (_event: unknown, state: string) => void;
class FakeDownloadItem {
  readonly updated = new Set<ItemListener>();
  readonly done = new Set<ItemListener>();
  readonly fileName: string;
  readonly totalBytes: number;
  readonly mimeType: string;
  readonly url: string;
  readonly initiatorOrigin: string;
  savePath: string | null = null;
  cancelled = false;
  receivedBytes = 0;

  constructor(input: {
    fileName: string;
    totalBytes: number;
    mimeType?: string;
    url?: string;
    initiatorOrigin?: string;
  }) {
    this.fileName = input.fileName;
    this.totalBytes = input.totalBytes;
    this.mimeType = input.mimeType ?? "application/octet-stream";
    this.url = input.url ?? "https://example.test/export";
    this.initiatorOrigin = input.initiatorOrigin ?? "https://example.test";
  }
  getFilename(): string {
    return this.fileName;
  }
  getMimeType(): string {
    return this.mimeType;
  }
  getReceivedBytes(): number {
    return this.receivedBytes;
  }
  getTotalBytes(): number {
    return this.totalBytes;
  }
  getInitiatorOrigin(): string {
    return this.initiatorOrigin;
  }
  getURL(): string {
    return this.url;
  }
  getURLChain(): ReadonlyArray<string> {
    return [this.url];
  }
  setSavePath(path: string): void {
    this.savePath = path;
  }
  cancel(): void {
    this.cancelled = true;
  }
  on(event: "updated" | "done", listener: ItemListener): this {
    (event === "updated" ? this.updated : this.done).add(listener);
    return this;
  }
  off(event: "updated" | "done", listener: ItemListener): this {
    (event === "updated" ? this.updated : this.done).delete(listener);
    return this;
  }
  emitDone(state: "completed" | "cancelled" | "interrupted"): void {
    for (const listener of this.done) listener({}, state);
  }
}

const frame = { processId: 1, routingId: 2 } satisfies BrowserDownloadFrame;
const otherFrame = { processId: 1, routingId: 3 } satisfies BrowserDownloadFrame;
const actionId = (value: string) => value as BrowserArtifactActionId;
const artifactId = (value: string) => value as BrowserArtifactId;
const isDownloadArtifact = Schema.is(BrowserDownloadArtifact);
const upload = (overrides: Partial<BrowserUploadTransfer> = {}): BrowserUploadTransfer => ({
  environmentId: "environment-1" as BrowserUploadTransfer["environmentId"],
  tabId: "tab-1",
  runId: "run-1",
  actionId: actionId("action-upload"),
  artifactId: artifactId("artifact-upload"),
  fileName: "report.txt",
  mimeType: "text/plain",
  sizeBytes: 5,
  data: new Uint8Array(Buffer.from("hello")),
  ...overrides,
});
const expectation = (
  action: string,
  overrides: Partial<BrowserDownloadExpectation> = {},
): BrowserDownloadExpectation => ({
  environmentId: "environment-1" as BrowserDownloadExpectation["environmentId"],
  tabId: "tab-1",
  runId: "run-1",
  actionId: actionId(action),
  ...overrides,
});
let root: string;
beforeEach(async () => {
  root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-browser-artifacts-test-"));
});
afterEach(async () => {
  await NodeFSP.rm(root, { force: true, recursive: true });
});

describe("BrowserArtifactStore uploads", () => {
  it("selects an owned staged file once and requires exact ownership to acknowledge", async () => {
    const store = makeBrowserArtifactStore({ stagingDirectory: root });
    let selectedPath = "";
    const selectFile = vi.fn(async (path: string) => {
      selectedPath = path;
      expect(await NodeFSP.readFile(path, "utf8")).toBe("hello");
    });
    const first = await store.selectUpload(upload(), selectFile);
    expect(await store.selectUpload(upload(), selectFile)).toEqual(first);
    expect(selectFile).toHaveBeenCalledTimes(1);
    await expect(
      store.acknowledge({ ...first, actionId: actionId("wrong") }),
    ).rejects.toMatchObject({ code: "not-found" });
    await store.acknowledge(first);
    await expect(NodeFSP.stat(selectedPath)).rejects.toMatchObject({ code: "ENOENT" });
    await store.dispose();
  });

  it("deduplicates the consequential action even if a retry changes artifact id", async () => {
    const store = makeBrowserArtifactStore({ stagingDirectory: root });
    const selectFile = vi.fn(async () => {
      throw new Error("disconnect after dispatch");
    });
    await expect(store.selectUpload(upload(), selectFile)).rejects.toBeInstanceOf(
      BrowserArtifactError,
    );
    await expect(
      store.selectUpload(upload({ artifactId: artifactId("artifact-2") }), selectFile),
    ).rejects.toMatchObject({ code: "duplicate-identity" });
    expect(selectFile).toHaveBeenCalledTimes(1);
    await store.dispose();
  });

  it("aborts a pending selection and removes its staging directory before dispose resolves", async () => {
    const store = makeBrowserArtifactStore({ stagingDirectory: root });
    let reportStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      reportStarted = resolve;
    });
    const pending = store.selectUpload(upload(), async () => {
      reportStarted();
      return await new Promise<void>(() => undefined);
    });
    await started;
    await store.dispose();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(await NodeFSP.readdir(root)).toEqual([]);
  });
});

describe("BrowserArtifactStore downloads", () => {
  it("arms before triggering and ignores unrelated tab, frame, null-frame, and filename events", async () => {
    const store = makeBrowserArtifactStore({
      stagingDirectory: root,
      randomId: () => "one",
      nowIso: () => "2026-09-22T12:00:00.000Z",
    });
    const session = new FakeSession();
    const unrelated = new FakeDownloadItem({ fileName: "other.txt", totalBytes: 5 });
    const item = new FakeDownloadItem({
      fileName: "report.txt",
      totalBytes: 5,
      mimeType: "text/plain",
    });
    const result = await store.armDownload({
      expectation: expectation("download-action", { expectedFileName: "report.txt" }),
      session,
      webContentsId: 7,
      expectedFrame: frame,
      trigger: async () => {
        expect(session.listeners.size).toBe(1);
        session.emit(unrelated, 8, frame);
        session.emit(unrelated, 7, otherFrame);
        session.emit(unrelated, 7, null);
        session.emit(unrelated, 7, frame);
        expect(unrelated.savePath).toBeNull();
        expect(unrelated.cancelled).toBe(false);
        session.emit(item, 7, frame);
        await NodeFSP.writeFile(item.savePath!, "hello");
        item.receivedBytes = 5;
        item.emitDone("completed");
      },
    });
    expect(result).toMatchObject({
      artifactId: "browser-download-one",
      fileName: "report.txt",
      sizeBytes: 5,
      status: "completed",
    });
    expect(Buffer.from(await store.readDownload(result)).toString()).toBe("hello");
    await store.acknowledge(result);
    await store.dispose();
  });

  it("uses an opaque ASCII host filename for a multibyte display name", async () => {
    const store = makeBrowserArtifactStore({ stagingDirectory: root, randomId: () => "emoji" });
    const session = new FakeSession();
    const item = new FakeDownloadItem({ fileName: `${"😀".repeat(255)}.txt`, totalBytes: 1 });
    const result = await store.armDownload({
      expectation: expectation("emoji-action"),
      session,
      webContentsId: 7,
      expectedFrame: frame,
      trigger: async () => {
        session.emit(item, 7, frame);
        expect(NodePath.basename(item.savePath!)).toBe("download.bin");
        await NodeFSP.writeFile(item.savePath!, "x");
        item.receivedBytes = 1;
        item.emitDone("completed");
      },
    });
    expect(Buffer.byteLength(NodePath.basename(item.savePath!))).toBeLessThanOrEqual(255);
    expect(Buffer.byteLength(result.fileName)).toBeLessThanOrEqual(255);
    expect(isDownloadArtifact(result)).toBe(true);
    await store.acknowledge(result);
    await store.dispose();
  });

  it("reserves colliding artifact identities before concurrent downloads complete", async () => {
    const generatedIds = ["same", "same", "second"];
    const store = makeBrowserArtifactStore({
      stagingDirectory: root,
      maximumBytes: 5,
      maximumOwnedBytes: 10,
      randomId: () => generatedIds.shift() ?? "unexpected",
    });
    const session = new FakeSession();
    const firstItem = new FakeDownloadItem({ fileName: "first.txt", totalBytes: 5 });
    const secondItem = new FakeDownloadItem({ fileName: "second.txt", totalBytes: 5 });
    const complete = async (item: FakeDownloadItem): Promise<void> => {
      session.emit(item, 7, frame);
      await NodeFSP.writeFile(item.savePath!, "hello");
      item.receivedBytes = 5;
      item.emitDone("completed");
    };
    const [first, second] = await Promise.all([
      store.armDownload({
        expectation: expectation("collision-first", { expectedFileName: "first.txt" }),
        session,
        webContentsId: 7,
        expectedFrame: frame,
        trigger: () => complete(firstItem),
      }),
      store.armDownload({
        expectation: expectation("collision-second", { expectedFileName: "second.txt" }),
        session,
        webContentsId: 7,
        expectedFrame: frame,
        trigger: () => complete(secondItem),
      }),
    ]);
    expect(new Set([first.artifactId, second.artifactId])).toEqual(
      new Set(["browser-download-same", "browser-download-second"]),
    );
    await store.acknowledge(first);
    await store.acknowledge(second);
    await store.dispose();
  });

  it("releases retained tab artifacts and their replay identities together", async () => {
    const store = makeBrowserArtifactStore({
      stagingDirectory: root,
      maximumBytes: 5,
      maximumOwnedBytes: 5,
    });
    let firstPath = "";
    const first = await store.selectUpload(upload(), async (path) => {
      firstPath = path;
    });
    await expect(
      store.selectUpload(
        upload({
          actionId: actionId("action-upload-2"),
          artifactId: artifactId("artifact-upload-2"),
          sizeBytes: 1,
          data: new Uint8Array([1]),
        }),
        async () => undefined,
      ),
    ).rejects.toMatchObject({ code: "size-limit" });
    await store.releaseTab({ environmentId: first.environmentId, tabId: first.tabId });
    await expect(NodeFSP.stat(firstPath)).rejects.toMatchObject({ code: "ENOENT" });
    const selectedAgain = await store.selectUpload(upload(), async () => undefined);
    expect(selectedAgain).toEqual(first);
    await store.dispose();
  });

  it("cancels an oversized item and never repeats a synchronous throwing trigger", async () => {
    const store = makeBrowserArtifactStore({ stagingDirectory: root, maximumBytes: 4 });
    const session = new FakeSession();
    const item = new FakeDownloadItem({ fileName: "large.bin", totalBytes: 5 });
    const trigger = vi.fn(() => {
      session.emit(item, 7, frame);
      throw new Error("after dispatch");
    });
    const input = {
      expectation: expectation("oversized", { maximumBytes: 4 }),
      session,
      webContentsId: 7,
      expectedFrame: frame,
      trigger,
    };
    await expect(store.armDownload(input)).rejects.toMatchObject({ code: "size-limit" });
    await expect(store.armDownload(input)).rejects.toMatchObject({ code: "size-limit" });
    expect(item.cancelled).toBe(true);
    expect(trigger).toHaveBeenCalledTimes(1);
    await store.dispose();
  });

  it("aborts an accepted late download and cleans it before dispose resolves", async () => {
    const store = makeBrowserArtifactStore({ stagingDirectory: root, randomId: () => "late" });
    const controller = new AbortController();
    const session = new FakeSession();
    const item = new FakeDownloadItem({ fileName: "late.txt", totalBytes: 1 });
    let started!: () => void;
    const accepted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = store.armDownload({
      expectation: expectation("late-action"),
      session,
      webContentsId: 7,
      expectedFrame: frame,
      signal: controller.signal,
      trigger: async () => {
        session.emit(item, 7, frame);
        started();
      },
    });
    await accepted;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    await store.dispose();
    expect(item.cancelled).toBe(true);
    expect(await NodeFSP.readdir(root)).toEqual([]);
  });

  it("times out an uncorrelated download and releases its listener and staging directory", async () => {
    const store = makeBrowserArtifactStore({ stagingDirectory: root, randomId: () => "timeout" });
    const session = new FakeSession();
    await expect(
      store.armDownload({
        expectation: expectation("timeout-action"),
        session,
        webContentsId: 7,
        expectedFrame: frame,
        timeoutMs: 1,
        trigger: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(session.listeners.size).toBe(0);
    expect(await NodeFSP.readdir(root)).toEqual([]);
    await store.dispose();
  });
});
