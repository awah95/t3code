import {
  JevBrowserCancelInput,
  JevBrowserCancelResult,
  JevBrowserDecideInput,
  JevBrowserDecideResult,
  JevBrowserExecuteInput,
  JevBrowserExecuteResult,
  JevBrowserObserveInput,
  JevBrowserObserveResult,
  JevBrowserVerifyInput,
  JevBrowserVerifyResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { DesktopJevBrowser } from "../../jevBrowser/DesktopJevBrowser.ts";
import { PreviewManager } from "../../preview/Manager.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as JevChannels from "../jevChannels.ts";

class JevBrowserDesktopTargetError extends Schema.TaggedError<JevBrowserDesktopTargetError>()(
  "JevBrowserDesktopTargetError",
  { message: Schema.String },
) {}

const requireTabId = (tabId: string | undefined) =>
  tabId === undefined
    ? Effect.fail(
        new JevBrowserDesktopTargetError({
          message: "Desktop Jev browser operations require a preview tab ID.",
        }),
      )
    : Effect.succeed(tabId);

export const observeJevBrowser = DesktopIpc.makeIpcMethod({
  channel: JevChannels.OBSERVE_JEV_BROWSER_CHANNEL,
  payload: JevBrowserObserveInput,
  result: JevBrowserObserveResult,
  handler: Effect.fn("desktop.ipc.jevBrowser.observe")(function* (input) {
    const tabId = yield* requireTabId(input.tabId);
    const manager = yield* PreviewManager;
    const service = yield* DesktopJevBrowser;
    const observation = yield* service.withRunCancellation(input.runId, () =>
      manager.jevBrowserObserve(
        input.runId,
        tabId,
        input.inputs,
        input.allowedOrigins,
        input.resolvedNavigations,
      ),
    );
    return { observation };
  }),
});

export const decideJevBrowser = DesktopIpc.makeIpcMethod({
  channel: JevChannels.DECIDE_JEV_BROWSER_CHANNEL,
  payload: JevBrowserDecideInput,
  result: JevBrowserDecideResult,
  handler: Effect.fn("desktop.ipc.jevBrowser.decide")(function* (input) {
    const service = yield* DesktopJevBrowser;
    return yield* service.decide(input);
  }),
});

export const executeJevBrowser = DesktopIpc.makeIpcMethod({
  channel: JevChannels.EXECUTE_JEV_BROWSER_CHANNEL,
  payload: JevBrowserExecuteInput,
  result: JevBrowserExecuteResult,
  handler: Effect.fn("desktop.ipc.jevBrowser.execute")(function* (input) {
    const tabId = yield* requireTabId(input.tabId);
    const manager = yield* PreviewManager;
    const service = yield* DesktopJevBrowser;
    return yield* service.withRunCancellation(input.runId, () =>
      manager.jevBrowserExecute(input.runId, tabId, input.revision, {
        candidateId: input.action.candidateId,
        operation: input.action.operation,
        ...(input.action.targetId === undefined ? {} : { targetId: input.action.targetId }),
        ...(input.action.inputId === undefined ? {} : { inputId: input.action.inputId }),
        ...(input.action.value === undefined ? {} : { value: input.action.value }),
        ...(input.action.checked === undefined ? {} : { checked: input.action.checked }),
        ...(input.action.navigationTarget === undefined
          ? {}
          : { navigationTarget: input.action.navigationTarget }),
      }),
    );
  }),
});

export const cancelJevBrowser = DesktopIpc.makeIpcMethod({
  channel: JevChannels.CANCEL_JEV_BROWSER_CHANNEL,
  payload: JevBrowserCancelInput,
  result: JevBrowserCancelResult,
  handler: Effect.fn("desktop.ipc.jevBrowser.cancel")(function* (input) {
    const service = yield* DesktopJevBrowser;
    const manager = yield* PreviewManager;
    const [activeOperation, retainedRun] = yield* Effect.all([
      service.cancel(input.runId),
      manager.jevBrowserCancel(input.runId),
    ]);
    return { cancelled: activeOperation || retainedRun };
  }),
});

export const verifyJevBrowser = DesktopIpc.makeIpcMethod({
  channel: JevChannels.VERIFY_JEV_BROWSER_CHANNEL,
  payload: JevBrowserVerifyInput,
  result: JevBrowserVerifyResult,
  handler: Effect.fn("desktop.ipc.jevBrowser.verify")(function* (input) {
    const tabId = yield* requireTabId(input.tabId);
    const manager = yield* PreviewManager;
    const service = yield* DesktopJevBrowser;
    return yield* service.withRunCancellation(input.runId, () =>
      manager.jevBrowserVerify(input.runId, tabId, input),
    );
  }),
});
