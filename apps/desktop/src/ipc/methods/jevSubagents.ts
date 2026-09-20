import { JevSubagentPolicy } from "@t3tools/contracts";
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

export const installJevSubagentEvents = Effect.fn("desktop.ipc.jevSubagents.subscribe")(
  function* () {
    const service = yield* DesktopJevSubagent.DesktopJevSubagent;
    const windows = yield* ElectronWindow.ElectronWindow;
    yield* service.subscribeDecisions((event) =>
      windows.sendAll(IpcChannels.JEV_SUBAGENT_DECISION_CHANNEL, event),
    );
  },
);
