import type { BrowserArtifactActionId, EnvironmentId, PreviewTabId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  BrowserDialogError,
  type BrowserDialogDebugger,
  makeBrowserDialogObserver,
} from "./BrowserDialogs.ts";

type Listener = (event: unknown, method: string, params: unknown, sessionId?: string) => void;
class FakeDebugger implements BrowserDialogDebugger {
  readonly listeners = new Set<Listener>();
  readonly calls: Array<{
    method: string;
    params: unknown;
    sessionId: string | undefined;
    listenerCount: number;
  }> = [];
  readonly sendCommand = vi.fn(async (method: string, params?: unknown, sessionId?: string) => {
    this.calls.push({ method, params, sessionId, listenerCount: this.listeners.size });
    return {};
  });
  on(_event: "message", listener: Listener): void {
    this.listeners.add(listener);
  }
  off(_event: "message", listener: Listener): void {
    this.listeners.delete(listener);
  }
  emit(method: string, params: unknown, sessionId?: string): void {
    for (const listener of this.listeners) listener({}, method, params, sessionId);
  }
}

const environmentId = "environment-1" as EnvironmentId;
const tabId = "tab-1" as PreviewTabId;
const actionId = "action-1" as BrowserArtifactActionId;
const scope = { environmentId, tabId, runId: "run-1", actionId } as const;

describe("BrowserDialogObserver", () => {
  it("registers before Page.enable and attributes only the armed CDP session", async () => {
    const browserDebugger = new FakeDebugger();
    const observer = makeBrowserDialogObserver({
      debugger: browserDebugger,
      randomId: () => "one",
      nowIso: () => "2026-09-22T12:00:00.000Z",
    });
    const disarm = await observer.arm(scope, "session-1");
    expect(browserDebugger.calls[0]).toMatchObject({
      method: "Page.enable",
      sessionId: "session-1",
      listenerCount: 1,
    });
    browserDebugger.emit(
      "Page.javascriptDialogOpening",
      { type: "alert", message: "wrong" },
      "session-2",
    );
    expect(observer.current()).toBeNull();
    browserDebugger.emit(
      "Page.javascriptDialogOpening",
      { type: "prompt", message: "Name?", defaultPrompt: "T3" },
      "session-1",
    );
    expect(observer.current()).toMatchObject({
      dialogId: "browser-dialog-one",
      actionId,
      kind: "prompt",
      message: "Name?",
    });
    disarm();
    browserDebugger.emit("Page.javascriptDialogClosed", {}, "session-2");
    expect(observer.current()).not.toBeNull();
    browserDebugger.emit("Page.javascriptDialogClosed", {}, "session-1");
    expect(observer.current()).toBeNull();
    await observer.dispose();
  });

  it("normalizes Electron's empty root event session without sending an empty session", async () => {
    const browserDebugger = new FakeDebugger();
    const observer = makeBrowserDialogObserver({
      debugger: browserDebugger,
      randomId: () => "root",
    });
    await observer.arm(scope);
    expect(browserDebugger.sendCommand.mock.calls[0]).toHaveLength(2);
    browserDebugger.emit(
      "Page.javascriptDialogOpening",
      { type: "confirm", message: "Continue?" },
      "session-1",
    );
    expect(observer.current()).toBeNull();
    browserDebugger.emit(
      "Page.javascriptDialogOpening",
      { type: "confirm", message: "Continue?" },
      "",
    );
    expect(observer.current()).toMatchObject({
      dialogId: "browser-dialog-root",
      actionId,
      kind: "confirm",
    });
    await observer.handle({ ...observer.current()!, action: "dismiss" });
    const handleCall = browserDebugger.sendCommand.mock.calls.find(
      ([method]) => method === "Page.handleJavaScriptDialog",
    );
    expect(handleCall).toHaveLength(2);
    browserDebugger.emit("Page.javascriptDialogClosed", {}, "session-1");
    expect(observer.current()).not.toBeNull();
    browserDebugger.emit("Page.javascriptDialogClosed", {}, "");
    expect(observer.current()).toBeNull();
    await observer.dispose();
  });

  it("rejects a second arm and bounds metadata", async () => {
    const browserDebugger = new FakeDebugger();
    const observer = makeBrowserDialogObserver({
      debugger: browserDebugger,
      randomId: () => "bounded",
    });
    await observer.arm(scope);
    await expect(
      observer.arm({ ...scope, actionId: "action-2" as BrowserArtifactActionId }),
    ).rejects.toMatchObject({ code: "active-action" });
    browserDebugger.emit("Page.javascriptDialogOpening", {
      type: "alert",
      message: "x".repeat(20_001),
    });
    expect(observer.current()).toMatchObject({
      message: "x".repeat(20_000),
      messageTruncated: true,
    });
    await observer.dispose();
  });

  it("retries a transient Page.enable failure without retaining a poisoned cache entry", async () => {
    const browserDebugger = new FakeDebugger();
    browserDebugger.sendCommand.mockRejectedValueOnce(new Error("transient detach"));
    const observer = makeBrowserDialogObserver({ debugger: browserDebugger });
    await expect(observer.arm(scope, "session-1")).rejects.toThrow("transient detach");
    const disarm = await observer.arm(scope, "session-1");
    expect(
      browserDebugger.sendCommand.mock.calls.filter(([method]) => method === "Page.enable"),
    ).toHaveLength(2);
    disarm();
    await observer.dispose();
  });

  it("deduplicates identical handling and rejects conflicting or invalid prompt handling", async () => {
    const browserDebugger = new FakeDebugger();
    const beforeHandle = vi.fn();
    const observer = makeBrowserDialogObserver({
      debugger: browserDebugger,
      randomId: () => "handle",
      beforeHandle,
    });
    await observer.arm(scope, "session-1");
    browserDebugger.emit(
      "Page.javascriptDialogOpening",
      { type: "prompt", message: "Name?" },
      "session-1",
    );
    const dialog = observer.current()!;
    const request = { ...dialog, action: "accept", promptText: "Codex" } as const;
    const [first, second] = await Promise.all([observer.handle(request), observer.handle(request)]);
    expect(second).toEqual(first);
    expect(
      browserDebugger.sendCommand.mock.calls.filter(
        ([method]) => method === "Page.handleJavaScriptDialog",
      ),
    ).toHaveLength(1);
    await expect(observer.handle({ ...dialog, action: "dismiss" })).rejects.toMatchObject({
      code: "identity-mismatch",
    });
    expect(beforeHandle).toHaveBeenCalledTimes(1);
    await observer.dispose();

    const alerts = new FakeDebugger();
    const alertObserver = makeBrowserDialogObserver({ debugger: alerts, randomId: () => "alert" });
    await alertObserver.arm(scope);
    alerts.emit("Page.javascriptDialogOpening", { type: "alert", message: "Stop" });
    await expect(
      alertObserver.handle({
        ...alertObserver.current()!,
        action: "accept",
        promptText: "invalid",
      }),
    ).rejects.toMatchObject({ code: "identity-mismatch" });
    await alertObserver.dispose();
  });

  it("uses bounded event waits and dismisses an active dialog on dispose", async () => {
    const browserDebugger = new FakeDebugger();
    const observer = makeBrowserDialogObserver({
      debugger: browserDebugger,
      randomId: () => "dispose",
    });
    await expect(observer.waitForObserved(undefined, 1)).rejects.toMatchObject({ code: "timeout" });
    await observer.arm(scope, "session-1");
    browserDebugger.emit(
      "Page.javascriptDialogOpening",
      { type: "confirm", message: "Leave?" },
      "session-1",
    );
    await observer.dispose();
    expect(browserDebugger.listeners.size).toBe(0);
    expect(browserDebugger.sendCommand).toHaveBeenLastCalledWith(
      "Page.handleJavaScriptDialog",
      { accept: false },
      "session-1",
    );
  });

  it("rejects an aborted waiter without polling", async () => {
    const browserDebugger = new FakeDebugger();
    const observer = makeBrowserDialogObserver({ debugger: browserDebugger });
    const controller = new AbortController();
    const waiting = observer.waitForObserved(controller.signal, null);
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(BrowserDialogError);
    await observer.dispose();
  });
});
