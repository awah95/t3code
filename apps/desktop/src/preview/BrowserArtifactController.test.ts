// @effect-diagnostics nodeBuiltinImport:off globalError:off -- Real temporary files and CDP failures prove artifact cleanup.
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";

import { it as effectIt } from "@effect/vitest";
import type { Debugger, WebContents } from "electron";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import { describe, expect, vi } from "vite-plus/test";

import { makeBrowserArtifactController } from "./BrowserArtifactController.ts";
import { PreviewAutomationDialogPendingError } from "./BrowserArtifactController.ts";

const downloadInput = (actionId: string) =>
  ({
    expectation: {
      environmentId: "environment-1",
      tabId: "preview-1",
      actionId,
    },
    target: { selector: "#download" },
  }) as never;

const makeHost = (resolved: unknown, frames: readonly unknown[] = []) => {
  const evaluated: string[] = [];
  const mainFrame = {
    processId: 1,
    routingId: 2,
    detached: false,
    frames,
  };
  const wc = Object.assign(new NodeEvents.EventEmitter(), {
    id: 7,
    mainFrame,
    session: {},
    getURL: () => "https://app.example/tools",
  }) as unknown as WebContents;
  const host = {
    requireWebContents: () => Effect.succeed(wc),
    withControlSession: (
      _tabId: string,
      _wc: WebContents,
      _operation: string,
      use: (
        send: never,
        cleanup: never,
        check: Effect.Effect<void>,
      ) => Effect.Effect<unknown, string>,
    ) => use((() => Effect.void) as never, (() => Effect.void) as never, Effect.void),
    evaluate: (_tabId: string, _send: never, expression: string) => {
      evaluated.push(expression);
      return Effect.succeed(expression.includes('"operation":"resolve"') ? resolved : undefined);
    },
    operationError: ({ operation, cause }: { operation: string; cause: unknown }) =>
      `${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
    prepareAutomationInput: () => Effect.void,
    emitPointerEvent: () => Effect.void,
    nextPointerSequence: () => Effect.succeed(1),
    currentIso: () => Effect.succeed("2026-09-22T00:00:00.000Z"),
    expectAgentPointer: () => Effect.void,
    ensurePlaywrightInjected: () => Effect.void,
    semanticWorld: () => Effect.succeed(11),
    getDebugger: () => Effect.succeed({} as Debugger),
    controlGeneration: () => Effect.succeed(1),
  };
  return { host, evaluated, wc };
};

describe("BrowserArtifactController", () => {
  effectIt.effect(
    "fails closed when a retained descendant frame is no longer available and caches the result",
    () =>
      Effect.gen(function* () {
        const { host, evaluated } = makeHost({
          ok: true,
          targetId: "download-link",
          revision: "document-1:3",
          point: { x: 20, y: 30 },
          framePath: [0],
          href: "https://app.example/export.csv",
        });
        const controller = makeBrowserArtifactController<string>(
          host as never,
          "/tmp/t3-artifact-controller-test",
        );
        const input = downloadInput("download-action-frame");

        expect(yield* Effect.flip(controller.startDownload("runtime-1", input))).toContain(
          "resolved download frame detached or changed",
        );
        expect(yield* Effect.flip(controller.startDownload("runtime-1", input))).toContain(
          "resolved download frame detached or changed",
        );

        expect(
          evaluated.filter((expression) => expression.includes('"operation":"resolve"')),
        ).toHaveLength(1);
        yield* controller.dispose;
      }),
  );

  effectIt.effect("does not click an unidentifiable custom download trigger", () =>
    Effect.gen(function* () {
      const { host, evaluated } = makeHost({
        ok: true,
        targetId: "custom-download",
        revision: "document-1:4",
        point: { x: 20, y: 30 },
        framePath: [],
      });
      const controller = makeBrowserArtifactController<string>(
        host as never,
        "/tmp/t3-artifact-controller-test",
      );

      expect(
        yield* Effect.flip(
          controller.startDownload("runtime-1", downloadInput("download-action-no-expectation")),
        ),
      ).toContain("needs an expected filename or URL");
      expect(
        evaluated.filter((expression) => expression.includes('"operation":"resolve"')),
      ).toHaveLength(1);
      yield* controller.dispose;
    }),
  );

  effectIt.effect(
    "correlates a descendant-frame download and preserves an explicit initiator origin",
    () =>
      Effect.gen(function* () {
        const stagingDirectory = yield* Effect.promise(() =>
          NodeFSP.mkdtemp("/tmp/t3-artifact-controller-success-"),
        );
        const session = new NodeEvents.EventEmitter();
        const childFrame = { processId: 3, routingId: 4, detached: false, frames: [] };
        const mainFrame = { processId: 1, routingId: 2, detached: false, frames: [childFrame] };
        const wcEvents = new NodeEvents.EventEmitter();
        const wc = Object.assign(wcEvents, {
          id: 7,
          mainFrame,
          session,
          getURL: () => "https://app.example/tools",
        }) as unknown as WebContents;
        const savePaths: { main?: string; child?: string } = {};
        const makeItem = (which: "main" | "child") => {
          const events = new NodeEvents.EventEmitter();
          return Object.assign(events, {
            getFilename: () => "report.csv",
            getMimeType: () => "text/csv",
            getReceivedBytes: () => 4,
            getTotalBytes: () => 4,
            getInitiatorOrigin: () => "https://frame.example",
            getURL: () => "blob:https://frame.example/report",
            getURLChain: () => ["blob:https://frame.example/report"],
            setSavePath: (path: string) => {
              savePaths[which] = path;
            },
            cancel: () => undefined,
          });
        };
        const mainItem = makeItem("main");
        const childItem = makeItem("child");
        const send = (method: string) => {
          if (method !== "Input.dispatchMouseEvent") return Effect.void;
          return Effect.promise(async () => {
            session.emit("will-download", { preventDefault() {} }, mainItem, { id: 7 }, mainFrame);
            session.emit(
              "will-download",
              { preventDefault() {} },
              childItem,
              { id: 7 },
              childFrame,
            );
            if (!savePaths.child) throw new Error("The descendant download was not accepted.");
            await NodeFSP.writeFile(savePaths.child, "data");
            childItem.emit("done", undefined, "completed");
          });
        };
        const host = {
          requireWebContents: () => Effect.succeed(wc),
          withControlSession: (
            _tabId: string,
            _wc: WebContents,
            _operation: string,
            use: (
              send: never,
              cleanup: never,
              check: Effect.Effect<void>,
            ) => Effect.Effect<unknown, string>,
          ) => use(send as never, (() => Effect.void) as never, Effect.void),
          evaluate: (_tabId: string, _send: never, expression: string) =>
            Effect.succeed(
              expression.includes('"operation":"resolve"')
                ? {
                    ok: true,
                    targetId: "frame-download",
                    revision: "document-1:5",
                    point: { x: 20, y: 30 },
                    framePath: [0],
                  }
                : expression.startsWith("globalThis.__t3JevBrowser?.guard(")
                  ? { ok: true, x: 20, y: 30 }
                  : undefined,
            ),
          operationError: ({ operation, cause }: { operation: string; cause: unknown }) =>
            `${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
          prepareAutomationInput: () => Effect.void,
          emitPointerEvent: () => Effect.void,
          nextPointerSequence: () => Effect.succeed(1),
          currentIso: () => Effect.succeed("2026-09-22T00:00:00.000Z"),
          expectAgentPointer: () => Effect.void,
          ensurePlaywrightInjected: () => Effect.void,
          semanticWorld: () => Effect.succeed(11),
          getDebugger: () => Effect.succeed({} as Debugger),
          controlGeneration: () => Effect.succeed(1),
        };
        const controller = makeBrowserArtifactController<string>(host as never, stagingDirectory);
        const input = {
          expectation: {
            environmentId: "environment-1",
            tabId: "preview-1",
            actionId: "download-action-child-frame",
            expectedFileName: "report.csv",
            expectedInitiatorOrigin: "https://frame.example",
          },
          target: { selector: "#download" },
        } as never;

        const result = yield* controller.startDownload("runtime-1", input);
        expect(result).toMatchObject({ fileName: "report.csv", sizeBytes: 4, status: "completed" });
        expect(savePaths.main).toBeUndefined();
        expect(savePaths.child).toBeDefined();
        expect(Object.values(result)).not.toContain(savePaths.child);
        yield* controller.dispose;
        yield* Effect.promise(() => NodeFSP.rm(stagingDirectory, { recursive: true, force: true }));
      }),
  );

  effectIt.effect.each(["success", "set-file-failure"] as const)(
    "releases the transient upload object once after %s",
    (scenario) =>
      Effect.gen(function* () {
        const stagingDirectory = yield* Effect.promise(() =>
          NodeFSP.mkdtemp("/tmp/t3-artifact-controller-upload-"),
        );
        const wc = Object.assign(new NodeEvents.EventEmitter(), {
          id: 9,
          mainFrame: { processId: 1, routingId: 2, detached: false, frames: [] },
          session: {},
          getURL: () => "https://app.example/upload",
        }) as unknown as WebContents;
        const released: Array<{ method: string; params: unknown }> = [];
        const send = (method: string) => {
          if (method === "Runtime.evaluate")
            return Effect.succeed({ result: { objectId: "upload-object-1" } });
          if (method === "DOM.setFileInputFiles" && scenario === "set-file-failure")
            return Effect.fail("set files failed");
          if (method === "Runtime.callFunctionOn")
            return Effect.succeed({ result: { value: true } });
          return Effect.void;
        };
        const cleanup = (method: string, params?: Record<string, unknown>) =>
          Effect.sync(() => {
            released.push({ method, params });
          });
        const host = {
          requireWebContents: () => Effect.succeed(wc),
          withControlSession: (
            _tabId: string,
            _wc: WebContents,
            _operation: string,
            use: (
              send: never,
              cleanup: never,
              check: Effect.Effect<void>,
            ) => Effect.Effect<unknown, string>,
          ) => use(send as never, cleanup as never, Effect.void),
          evaluate: () => Effect.void,
          operationError: ({ operation, cause }: { operation: string; cause: unknown }) =>
            `${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
          prepareAutomationInput: () => Effect.void,
          emitPointerEvent: () => Effect.void,
          nextPointerSequence: () => Effect.succeed(1),
          currentIso: () => Effect.succeed("2026-09-22T00:00:00.000Z"),
          expectAgentPointer: () => Effect.void,
          ensurePlaywrightInjected: () => Effect.void,
          semanticWorld: () => Effect.succeed(11),
          getDebugger: () => Effect.succeed({} as Debugger),
          controlGeneration: () => Effect.succeed(1),
        };
        const controller = makeBrowserArtifactController<string>(host as never, stagingDirectory);
        const input = {
          transfer: {
            environmentId: "environment-1",
            tabId: "preview-1",
            actionId: `upload-action-${scenario}`,
            artifactId: `upload-artifact-${scenario}`,
            fileName: "upload.txt",
            sizeBytes: 2,
            data: new Uint8Array([1, 2]),
          },
          target: { selector: "input[type=file]" },
        } as never;

        if (scenario === "success") {
          const result = yield* controller.selectUpload("runtime-1", input);
          expect(result).toMatchObject({
            fileName: "upload.txt",
            sizeBytes: 2,
            status: "selected",
          });
          expect(Object.values(result)).not.toContain(stagingDirectory);
        } else {
          expect(yield* Effect.flip(controller.selectUpload("runtime-1", input))).toContain(
            "could not be selected",
          );
        }
        expect(released).toEqual([
          { method: "Runtime.releaseObject", params: { objectId: "upload-object-1" } },
        ]);
        yield* controller.dispose;
        yield* Effect.promise(() => NodeFSP.rm(stagingDirectory, { recursive: true, force: true }));
      }),
  );

  effectIt.effect("interrupts a prepared action when its exact dialog is observed", () =>
    Effect.gen(function* () {
      const { host, wc } = makeHost(undefined);
      const cancelNativeDialog = vi.fn();
      (wc as unknown as NodeEvents.EventEmitter).on("-cancel-dialogs", cancelNativeDialog);
      const browserDebugger = Object.assign(new NodeEvents.EventEmitter(), {
        sendCommand: () => Promise.resolve(undefined),
      }) as unknown as Debugger;
      host.getDebugger = () => Effect.succeed(browserDebugger);
      const controller = makeBrowserArtifactController<string>(
        host as never,
        "/tmp/t3-artifact-controller-dialog",
      );
      const prepared = {
        environmentId: "environment-1",
        tabId: "preview-1",
        actionId: "dialog-action-1",
        operation: "click",
      } as never;
      yield* controller.prepareAction("runtime-1", prepared);
      expect(yield* Effect.flip(controller.prepareAction("runtime-1", prepared))).toContain(
        "still pending or active",
      );

      let interrupted = false;
      const action = Effect.never.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            interrupted = true;
          }),
        ),
      );
      const fiber = yield* Effect.forkChild(
        controller.racePreparedAction("runtime-1", "click", action),
      );
      yield* Effect.yieldNow;
      yield* controller.cancelPreparedAction("runtime-1", prepared);
      browserDebugger.emit("message", {}, "Page.javascriptDialogOpening", {
        type: "confirm",
        message: "Continue?",
      });
      const pending = yield* Effect.flip(Fiber.join(fiber));
      const isPending = Schema.is(PreviewAutomationDialogPendingError);
      expect(isPending(pending)).toBe(true);
      if (!isPending(pending)) return;
      expect(pending.dialog).toMatchObject({
        environmentId: "environment-1",
        tabId: "preview-1",
        actionId: "dialog-action-1",
        kind: "confirm",
        message: "Continue?",
      });
      expect(interrupted).toBe(true);
      yield* controller.cancelPreparedAction("runtime-1", prepared);
      expect(
        yield* controller.dialogStatus("runtime-1", {
          environmentId: "environment-1",
          tabId: "preview-1",
        } as never),
      ).toEqual({ dialog: pending.dialog });
      expect(
        yield* Effect.flip(
          controller.handleDialog("runtime-1", {
            ...pending.dialog,
            actionId: "different-action",
            action: "accept",
          } as never),
        ),
      ).toContain("does not match");
      expect(cancelNativeDialog).not.toHaveBeenCalled();
      expect(
        yield* controller.handleDialog("runtime-1", {
          ...pending.dialog,
          action: "accept",
        }),
      ).toMatchObject({ status: "handled", action: "accept" });
      expect(cancelNativeDialog).toHaveBeenCalledTimes(1);
      yield* controller.dispose;
    }),
  );

  effectIt.effect(
    "disarms a completed prepared action and treats its exact preparation as consumed",
    () =>
      Effect.gen(function* () {
        const { host, wc } = makeHost(undefined);
        const browserDebugger = Object.assign(new NodeEvents.EventEmitter(), {
          sendCommand: () => Promise.resolve(undefined),
        }) as unknown as Debugger;
        host.getDebugger = () => Effect.succeed(browserDebugger);
        const controller = makeBrowserArtifactController<string>(
          host as never,
          "/tmp/t3-artifact-controller-dialog",
        );
        const prepared = {
          environmentId: "environment-1",
          tabId: "preview-1",
          actionId: "dialog-action-complete",
          operation: "check",
        } as never;
        yield* controller.prepareAction("runtime-1", prepared);
        expect(yield* controller.racePreparedAction("runtime-1", "check", Effect.succeed(42))).toBe(
          42,
        );
        browserDebugger.emit("message", {}, "Page.javascriptDialogOpening", {
          type: "alert",
          message: "Too late",
        });
        expect(
          yield* controller.dialogStatus("runtime-1", {
            environmentId: "environment-1",
            tabId: "preview-1",
          } as never),
        ).toEqual({ dialog: null });
        yield* controller.prepareAction("runtime-1", prepared);
        expect(yield* controller.racePreparedAction("runtime-1", "check", Effect.succeed(7))).toBe(
          7,
        );
        const rejected = {
          environmentId: "environment-1",
          tabId: "preview-1",
          actionId: "dialog-action-rejected",
          operation: "check",
        } as never;
        yield* controller.prepareAction("runtime-1", rejected);
        expect(
          yield* Effect.flip(
            controller.racePreparedAction("runtime-1", "check", Effect.fail("stale action")),
          ),
        ).toBe("stale action");
        yield* controller.prepareAction("runtime-1", rejected);
        yield* controller.cancelPreparedAction("runtime-1", rejected);
        yield* controller.prepareAction("runtime-1", rejected);
        expect(yield* controller.racePreparedAction("runtime-1", "check", Effect.succeed(8))).toBe(
          8,
        );
        const cancellable = {
          environmentId: "environment-1",
          tabId: "preview-1",
          actionId: "dialog-action-cancel",
          operation: "check",
        } as never;
        yield* controller.prepareAction("runtime-1", cancellable);
        yield* controller.cancelPreparedAction("runtime-1", {
          environmentId: "environment-1",
          tabId: "preview-1",
          actionId: "dialog-action-cancel",
          operation: "click",
        } as never);
        expect(yield* Effect.flip(controller.prepareAction("runtime-1", cancellable))).toContain(
          "still pending or active",
        );
        yield* controller.cancelPreparedAction("runtime-1", cancellable);
        yield* controller.prepareAction("runtime-1", cancellable);
        expect(yield* controller.racePreparedAction("runtime-1", "check", Effect.succeed(9))).toBe(
          9,
        );

        wc.emit("destroyed");
        yield* Effect.promise(() => new Promise<void>((resolve) => queueMicrotask(resolve)));
        yield* controller.prepareAction("runtime-1", prepared);
        expect(yield* Effect.flip(controller.prepareAction("runtime-1", prepared))).toContain(
          "still pending or active",
        );
        yield* controller.dispose;
      }),
  );
});
