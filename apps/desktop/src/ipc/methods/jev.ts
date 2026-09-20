import { JevRouteRequest, JevRouteResult, JevStatus } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { DesktopJev } from "../../jev/DesktopJev.ts";
import { DesktopJevSubagent } from "../../jev/DesktopJevSubagent.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as Channels from "../channels.ts";

export const getJevStatus = DesktopIpc.makeIpcMethod({
  channel: Channels.GET_JEV_STATUS_CHANNEL,
  payload: Schema.Void,
  result: JevStatus,
  handler: () => Effect.flatMap(DesktopJev, (jev) => jev.status),
});
export const setJevApiKey = DesktopIpc.makeIpcMethod({
  channel: Channels.SET_JEV_API_KEY_CHANNEL,
  payload: Schema.NullOr(Schema.String),
  result: Schema.Void,
  handler: (key) => Effect.flatMap(DesktopJev, (jev) => jev.setKey(key)),
});
export const decideJevRoute = DesktopIpc.makeIpcMethod({
  channel: Channels.DECIDE_JEV_ROUTE_CHANNEL,
  payload: Schema.Struct({
    request: JevRouteRequest,
    receiptContext: Schema.optional(
      Schema.Struct({
        environmentId: Schema.String,
        projectId: Schema.NullOr(Schema.String),
        threadId: Schema.String,
      }),
    ),
  }),
  result: JevRouteResult,
  handler: Effect.fn("desktop.ipc.jev.decide")(function* ({ request, receiptContext }) {
    const jev = yield* DesktopJev;
    const result = yield* jev.decide(request);
    if (!receiptContext) return result;
    const receipts = yield* DesktopJevSubagent;
    const retained = yield* receipts.recordReceipt({
      threadId: receiptContext.threadId,
      providerInstanceId: "",
      ledgerContext: { ...receiptContext, sourceScope: "turn" },
      request,
      result,
    });
    return retained ? result : { ...result, receiptStorageError: true };
  }),
});
export const cancelJevRoute = DesktopIpc.makeIpcMethod({
  channel: Channels.CANCEL_JEV_ROUTE_CHANNEL,
  payload: Schema.String,
  result: Schema.Void,
  handler: (id) => Effect.flatMap(DesktopJev, (jev) => jev.cancel(id)),
});
