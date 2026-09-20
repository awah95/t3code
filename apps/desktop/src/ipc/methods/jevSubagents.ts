import { JevSubagentDecision, JevSubagentPolicy } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as DesktopJevSubagent from "../../jev/DesktopJevSubagent.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as IpcChannels from "../channels.ts";

export const setJevSubagentPolicy = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_JEV_SUBAGENT_POLICY_CHANNEL,
  payload: JevSubagentPolicy,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.jevSubagents.setPolicy")(function* (policy) {
    const service = yield* DesktopJevSubagent.DesktopJevSubagent;
    yield* service.setPolicy(policy);
  }),
});

export const clearJevSubagentPolicies = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CLEAR_JEV_SUBAGENT_POLICIES_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.jevSubagents.clearPolicies")(function* () {
    const service = yield* DesktopJevSubagent.DesktopJevSubagent;
    yield* service.clearPolicies;
  }),
});

export const listJevSubagentReceipts = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.LIST_JEV_SUBAGENT_RECEIPTS_CHANNEL,
  payload: Schema.Void,
  result: Schema.Array(JevSubagentDecision),
  handler: Effect.fn("desktop.ipc.jevSubagents.listReceipts")(function* () {
    const service = yield* DesktopJevSubagent.DesktopJevSubagent;
    return yield* service.listReceipts;
  }),
});

export const ackJevSubagentReceipt = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.ACK_JEV_SUBAGENT_RECEIPT_CHANNEL,
  payload: Schema.Struct({ requestId: Schema.String, attemptId: Schema.String }),
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.jevSubagents.ackReceipt")(function* (identity) {
    const service = yield* DesktopJevSubagent.DesktopJevSubagent;
    yield* service.acknowledgeReceipt(identity);
  }),
});

export const installJevSubagentEvents = Effect.fn("desktop.ipc.jevSubagents.subscribe")(
  function* () {
    const service = yield* DesktopJevSubagent.DesktopJevSubagent;
    const windows = yield* ElectronWindow.ElectronWindow;
    yield* service.subscribeDecisions((event) =>
      windows.sendAll(IpcChannels.JEV_SUBAGENT_DECISION_CHANNEL, event),
    );
  },
);
