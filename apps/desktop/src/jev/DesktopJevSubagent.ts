import type { JevSubagentDecision, JevSubagentPolicy } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { createJevSubagentBroker } from "./JevSubagentBroker.ts";
import { createJevSubagentReceiptOutbox } from "./JevSubagentReceiptOutbox.ts";
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
    readonly listReceipts: Effect.Effect<ReadonlyArray<JevSubagentDecision>>;
    readonly recordReceipt: (event: JevSubagentDecision) => Effect.Effect<boolean>;
    readonly acknowledgeReceipt: (identity: {
      requestId: string;
      attemptId: string;
    }) => Effect.Effect<void>;
    readonly subscribeDecisions: (
      listener: (event: JevSubagentDecision) => Effect.Effect<void>,
    ) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("@t3tools/desktop/jev/DesktopJevSubagent") {}

export const layer = Layer.effect(
  DesktopJevSubagent,
  Effect.gen(function* () {
    const jev = yield* DesktopJev;
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const receipts = createJevSubagentReceiptOutbox(
      environment.path.join(environment.stateDir, "jev-subagent-receipts.json"),
    );
    const recordReceipt = (event: JevSubagentDecision): boolean => {
      try {
        return receipts.record(event);
      } catch {
        try {
          receipts.markGap(event.threadId, event.ledgerContext);
        } catch {
          // The live caller still reports that storage failed.
        }
        return false;
      }
    };
    const listeners = new Set<(event: JevSubagentDecision) => Effect.Effect<void>>();
    const broker = yield* Effect.acquireRelease(
      Effect.tryPromise(() =>
        createJevSubagentBroker({
          decide: (request) => Effect.runPromise(jev.decide(request)),
          cancel: (id) => Effect.runSync(jev.cancel(id)),
          onDecision: (event) => {
            const receiptStorageError = event.result !== null && !recordReceipt(event);
            const delivered = receiptStorageError ? { ...event, receiptStorageError: true } : event;
            for (const listener of listeners) Effect.runFork(listener(delivered));
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
      listReceipts: Effect.sync(() => receipts.list()),
      recordReceipt: (event) => Effect.sync(() => recordReceipt(event)),
      acknowledgeReceipt: (identity) => Effect.sync(() => receipts.acknowledge(identity)),
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
