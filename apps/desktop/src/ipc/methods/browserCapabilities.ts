import {
  PreviewAutomationExtractInput,
  PreviewAutomationExtractResult,
  PreviewAutomationWaitForAssertionInput,
  PreviewAutomationWaitForAssertionResult,
  PreviewAutomationCheckInput,
  PreviewAutomationHoverInput,
  PreviewAutomationSelectInput,
  PreviewAutomationVerifyInput,
  PreviewAutomationVerifyResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { PreviewManager } from "../../preview/Manager.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as Channels from "../browserCapabilityChannels.ts";

const tabId = Schema.String.check(Schema.isNonEmpty());

export const extract = DesktopIpc.makeIpcMethod({
  channel: Channels.BROWSER_EXTRACT_CHANNEL,
  payload: Schema.Struct({ tabId, input: PreviewAutomationExtractInput }),
  result: PreviewAutomationExtractResult,
  handler: Effect.fn("desktop.ipc.browser.extract")(function* ({ tabId, input }) {
    return yield* (yield* PreviewManager).automationExtract(tabId, input);
  }),
});

export const waitForAssertion = DesktopIpc.makeIpcMethod({
  channel: Channels.BROWSER_WAIT_FOR_ASSERTION_CHANNEL,
  payload: Schema.Struct({ tabId, input: PreviewAutomationWaitForAssertionInput }),
  result: PreviewAutomationWaitForAssertionResult,
  handler: Effect.fn("desktop.ipc.browser.waitForAssertion")(function* ({ tabId, input }) {
    return yield* (yield* PreviewManager).automationWaitForAssertion(tabId, input);
  }),
});

export const verify = DesktopIpc.makeIpcMethod({
  channel: Channels.BROWSER_VERIFY_CHANNEL,
  payload: Schema.Struct({ tabId, input: PreviewAutomationVerifyInput }),
  result: PreviewAutomationVerifyResult,
  handler: Effect.fn("desktop.ipc.browser.verify")(function* ({ tabId, input }) {
    return yield* (yield* PreviewManager).automationVerify(tabId, input);
  }),
});

export const select = DesktopIpc.makeIpcMethod({
  channel: Channels.BROWSER_SELECT_CHANNEL,
  payload: Schema.Struct({ tabId, input: PreviewAutomationSelectInput }),
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.browser.select")(function* ({ tabId, input }) {
    yield* (yield* PreviewManager).automationSelect(tabId, input);
  }),
});

export const check = DesktopIpc.makeIpcMethod({
  channel: Channels.BROWSER_CHECK_CHANNEL,
  payload: Schema.Struct({ tabId, input: PreviewAutomationCheckInput }),
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.browser.check")(function* ({ tabId, input }) {
    yield* (yield* PreviewManager).automationCheck(tabId, input);
  }),
});

export const hover = DesktopIpc.makeIpcMethod({
  channel: Channels.BROWSER_HOVER_CHANNEL,
  payload: Schema.Struct({ tabId, input: PreviewAutomationHoverInput }),
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.browser.hover")(function* ({ tabId, input }) {
    yield* (yield* PreviewManager).automationHover(tabId, input);
  }),
});

export const methods = [verify, extract, waitForAssertion, select, check, hover] as const;
