import type {
  JevBrowserDecideInput,
  JevBrowserDecideResult,
  JevBrowserStatus,
} from "@t3tools/contracts";
import { createOpenRouterJevAutomationDecision } from "@t3tools/shared/jevAutomationDecision";
import type {
  JevAutomationAssertionResult,
  JevAutomationDecisionResult,
  JevAutomationObservation,
  JevAutomationReceipt,
} from "@t3tools/shared/jevAutomation";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { DesktopJevCredential } from "../jev/DesktopJevCredential.ts";
import { createJevBrowserBillingOutbox } from "./JevBrowserBillingOutbox.ts";
import { makeJevBrowserRunCancellation } from "./JevBrowserRunCancellation.ts";

const JEV_BROWSER_TIMEOUT_MS = 15_000;
const JEV_BROWSER_MAX_PENDING = 8;

export class JevBrowserDecisionError extends Schema.TaggedError<JevBrowserDecisionError>()(
  "JevBrowserDecisionError",
  { message: Schema.String },
) {}

const unavailable = (reason: string): JevBrowserDecideResult => ({
  decision: { outcome: "unavailable", reason },
  accounting: { inputTokens: null, outputTokens: null, costUsd: null },
});

const automationObservation = (
  source: JevBrowserDecideInput["observation"],
): JevAutomationObservation => ({
  revision: source.revision,
  surface: source.surface,
  ...(source.location === undefined ? {} : { location: source.location }),
  ...(source.title === undefined ? {} : { title: source.title }),
  ...(source.visibleText === undefined ? {} : { visibleText: source.visibleText }),
  ...(source.omissions === undefined ? {} : { omissions: source.omissions }),
  ...(source.inputs === undefined ? {} : { inputs: source.inputs }),
  controls: source.controls.map((control) => ({
    id: control.id,
    role: control.role,
    ...(control.name === undefined ? {} : { name: control.name }),
    ...(control.text === undefined ? {} : { text: control.text }),
    ...(control.description === undefined ? {} : { description: control.description }),
    ...(control.value === undefined ? {} : { value: control.value }),
    ...(control.checked === undefined ? {} : { checked: control.checked }),
    ...(control.disabled === undefined ? {} : { disabled: control.disabled }),
    ...(control.options === undefined
      ? {}
      : {
          options: control.options.map((option) => ({
            value: option.value,
            label: option.label,
            ...(option.disabled === undefined ? {} : { disabled: option.disabled }),
            ...(option.selected === undefined ? {} : { selected: option.selected }),
          })),
        }),
  })),
  candidates: source.candidates.map((candidate) => ({
    id: candidate.id,
    operation: candidate.operation,
    ...(candidate.targetId === undefined ? {} : { targetId: candidate.targetId }),
    ...(candidate.inputId === undefined ? {} : { inputId: candidate.inputId }),
    description: candidate.description,
  })),
});

const automationAssertions = (
  values: JevBrowserDecideInput["unmetConditions"],
): readonly JevAutomationAssertionResult[] =>
  values.map((value) => ({
    assertion: value.assertion,
    passed: value.passed,
    ...(value.actual === undefined ? {} : { actual: value.actual }),
  }));

const automationReceipts = (
  values: JevBrowserDecideInput["priorReceipts"],
): readonly JevAutomationReceipt[] =>
  values.map((value) => ({
    iteration: value.iteration,
    revision: value.revision,
    decision: value.decision,
    accounting: {
      inputTokens: value.accounting.inputTokens,
      outputTokens: value.accounting.outputTokens,
      costUsd: value.accounting.costUsd,
      ...(value.accounting.responseModel === undefined
        ? {}
        : { responseModel: value.accounting.responseModel }),
      ...(value.accounting.provider === undefined ? {} : { provider: value.accounting.provider }),
    },
    ...(value.candidateId === undefined ? {} : { candidateId: value.candidateId }),
    status: value.status,
    ...(value.detail === undefined ? {} : { detail: value.detail }),
  }));

const browserDecisionResult = (source: JevAutomationDecisionResult): JevBrowserDecideResult => ({
  decision: source.decision,
  accounting: {
    inputTokens: source.accounting.inputTokens,
    outputTokens: source.accounting.outputTokens,
    costUsd: source.accounting.costUsd,
    ...(source.accounting.responseModel === undefined
      ? {}
      : { responseModel: source.accounting.responseModel }),
    ...(source.accounting.provider === undefined ? {} : { provider: source.accounting.provider }),
  },
});

export class DesktopJevBrowser extends Context.Service<
  DesktopJevBrowser,
  {
    readonly status: Effect.Effect<JevBrowserStatus>;
    readonly decide: (
      input: JevBrowserDecideInput,
    ) => Effect.Effect<JevBrowserDecideResult, JevBrowserDecisionError>;
    readonly withRunCancellation: <A, E, R>(
      runId: string,
      operation: (signal: AbortSignal) => Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E, R>;
    readonly cancel: (runId: string) => Effect.Effect<boolean>;
  }
>()("@t3tools/desktop/jevBrowser/DesktopJevBrowser") {}

export const layer = Layer.effect(
  DesktopJevBrowser,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const credential = yield* DesktopJevCredential;
    const billing = createJevBrowserBillingOutbox(
      environment.path.join(environment.stateDir, "jev-browser-billing-receipts.json"),
    );
    const billingLock = Semaphore.makeUnsafe(1);
    const pendingDecisions = new Set<string>();
    const runCancellation = makeJevBrowserRunCancellation();
    const persist = <A>(operation: () => A) =>
      billingLock.withPermit(
        Effect.try({
          try: operation,
          catch: () =>
            new JevBrowserDecisionError({
              message: "Could not durably store the Jev browser billing receipt.",
            }),
        }),
      );

    return DesktopJevBrowser.of({
      status: Effect.map(credential.status, ({ hasKey, secureStorageAvailable }) => ({
        available: hasKey && secureStorageAvailable,
        mode: "idle" as const,
      })),
      cancel: runCancellation.cancel,
      withRunCancellation: runCancellation.run,
      decide: (input) =>
        runCancellation.run(input.runId, (runSignal) =>
          Effect.suspend(() => {
            if (
              pendingDecisions.size >= JEV_BROWSER_MAX_PENDING ||
              pendingDecisions.has(input.runId)
            ) {
              return new JevBrowserDecisionError({
                message: "A Jev browser decision with this run ID is already active.",
              });
            }
            pendingDecisions.add(input.runId);
            return Effect.acquireUseRelease(
              persist(() => billing.reserve(input.runId, input.iteration)),
              () =>
                Effect.gen(function* () {
                  const result = yield* credential
                    .useKey((key, credentialSignal) =>
                      Effect.tryPromise(() =>
                        createOpenRouterJevAutomationDecision({ apiKey: key })
                          .decide({
                            task: input.task,
                            observation: automationObservation(input.observation),
                            inputs: input.inputs,
                            unmetConditions: automationAssertions(input.unmetConditions),
                            priorReceipts: automationReceipts(input.priorReceipts),
                            signal: AbortSignal.any([
                              runSignal,
                              credentialSignal,
                              AbortSignal.timeout(JEV_BROWSER_TIMEOUT_MS),
                            ]),
                          })
                          .then(browserDecisionResult),
                      ),
                    )
                    .pipe(
                      Effect.catch(() =>
                        Effect.succeed(
                          Option.some(
                            unavailable(
                              runSignal.aborted
                                ? "The Jev browser decision was cancelled."
                                : "The Jev browser decision could not be completed.",
                            ),
                          ),
                        ),
                      ),
                    );
                  const decision = Option.getOrElse(result, () =>
                    unavailable("Add an OpenRouter key in Settings to use Jev browser automation."),
                  );
                  return decision;
                }),
              (reservation, exit) =>
                persist(() =>
                  billing.complete(
                    reservation,
                    Exit.isSuccess(exit)
                      ? exit.value
                      : unavailable(
                          "The Jev browser decision was interrupted; billing is unknown.",
                        ),
                  ),
                ),
            ).pipe(Effect.ensuring(Effect.sync(() => pendingDecisions.delete(input.runId))));
          }),
        ),
    });
  }),
);
