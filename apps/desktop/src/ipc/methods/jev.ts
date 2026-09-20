import { JevRouteRequest, JevRouteResult, JevStatus } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { DesktopJev } from "../../jev/DesktopJev.ts";
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
  payload: JevRouteRequest,
  result: JevRouteResult,
  handler: (request) => Effect.flatMap(DesktopJev, (jev) => jev.decide(request)),
});
export const cancelJevRoute = DesktopIpc.makeIpcMethod({
  channel: Channels.CANCEL_JEV_ROUTE_CHANNEL,
  payload: Schema.String,
  result: Schema.Void,
  handler: (id) => Effect.flatMap(DesktopJev, (jev) => jev.cancel(id)),
});
