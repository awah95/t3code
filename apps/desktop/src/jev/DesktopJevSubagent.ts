import type { JevSubagentDecision, JevSubagentPolicy } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import { createJevSubagentBroker } from "./JevSubagentBroker.ts";
import { DesktopJev } from "./DesktopJev.ts";

export class JevSubagentUnavailableError extends Schema.TaggedError<JevSubagentUnavailableError>()(
  "JevSubagentUnavailableError",
  { message: Schema.String },
) {}

export class DesktopJevSubagent extends Context.Service<
  DesktopJevSubagent,
  {
    readonly brokerEnv: Readonly<Record<string, string>>;
    readonly setPolicy: (
      policy: JevSubagentPolicy,
    ) => Effect.Effect<void, JevSubagentUnavailableError>;
    readonly clearPolicies: Effect.Effect<void>;
    readonly subscribeDecisions: (
      listener: (event: JevSubagentDecision) => Effect.Effect<void>,
    ) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("@t3tools/desktop/jev/DesktopJevSubagent") {}

export const layer = Layer.effect(
  DesktopJevSubagent,
  Effect.gen(function* () {
    const jev = yield* DesktopJev;
    const listeners = new Set<(event: JevSubagentDecision) => Effect.Effect<void>>();
    const broker = yield* Effect.acquireRelease(
      Effect.tryPromise(() =>
        createJevSubagentBroker({
          decide: (request) => Effect.runPromise(jev.decide(request)),
          cancel: (id) => Effect.runSync(jev.cancel(id)),
          onDecision: (event) => {
            for (const listener of listeners) Effect.runFork(listener(event));
          },
        }),
      ).pipe(Effect.orElseSucceed(() => null)),
      (value) => (value ? Effect.promise(() => value.close()) : Effect.void),
    );
    return DesktopJevSubagent.of({
      brokerEnv: broker
        ? { T3CODE_JEV_BROKER_URL: broker.url, T3CODE_JEV_BROKER_TOKEN: broker.token }
        : {},
      setPolicy: (policy) =>
        broker
          ? Effect.sync(() => broker.setPolicy(policy))
          : Effect.fail(
              new JevSubagentUnavailableError({
                message: "The local Jev subagent service is unavailable. Restart the desktop app.",
              }),
            ),
      clearPolicies: Effect.sync(() => broker?.clearPolicies()),
      subscribeDecisions: (listener) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            listeners.add(listener);
          }),
          () =>
            Effect.sync(() => {
              listeners.delete(listener);
            }),
        ),
    });
  }),
);
