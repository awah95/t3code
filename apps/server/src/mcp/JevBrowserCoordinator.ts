import {
  JEV_BROWSER_AUTOMATION_OPERATIONS,
  JevBrowserRunConflictError,
  JevBrowserRunError,
  type BrowserRunAssertionCounts,
  type BrowserRunStatus,
  type BrowserRunSummary,
  type JevBrowserCancelResult,
  type JevBrowserDecideResult,
  type JevBrowserExecuteResult,
  type JevBrowserHandoff,
  type JevBrowserObserveResult,
  type JevBrowserRunTaskInput,
  type JevBrowserRunTaskResult,
  type JevBrowserVerifyResult,
  type PreviewAutomationStatus,
  type PreviewAutomationError,
  type PreviewTabId,
} from "@t3tools/contracts";
import {
  runJevAutomation,
  type JevAutomationAdapter,
  type JevAutomationAssertionResult,
  type JevAutomationDecisionClient,
} from "@t3tools/shared/jevAutomation";
import * as Effect from "effect/Effect";
import * as Crypto from "effect/Crypto";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";

import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as PreviewAutomationBroker from "./PreviewAutomationBroker.ts";
import * as JevBrowserRunRegistry from "./JevBrowserRunRegistry.ts";
import * as CodexLedgerService from "../usage/CodexLedgerService.ts";
import { publishBrowserRunSummary } from "../orchestration/BrowserRunActivity.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";

const REQUIRED_OPERATIONS = new Set(JEV_BROWSER_AUTOMATION_OPERATIONS);
const DEFAULT_DURATION_MS = 45_000;

const originOf = (location: string | null | undefined): string | undefined => {
  if (!location) return undefined;
  try {
    const url = new URL(location);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
};

const defaultAllowedOrigins = (
  currentLocation: string | null | undefined,
  inputs: JevBrowserRunTaskInput["inputs"],
): readonly string[] => {
  const origins = new Set<string>();
  const currentOrigin = originOf(currentLocation);
  if (currentOrigin) origins.add(currentOrigin);
  for (const input of inputs ?? []) {
    if (input.kind !== "url") continue;
    const suppliedOrigin = originOf(input.value);
    if (suppliedOrigin) origins.add(suppliedOrigin);
  }
  return [...origins];
};

const disabledResult = (
  runId: string,
  reason: string,
  continuedFromRunId?: string,
): JevBrowserRunTaskResult => ({
  runId,
  ...(continuedFromRunId ? { continuedFromRunId } : {}),
  status: "disabled",
  reason,
  observation: null,
  assertions: [],
  receipts: [],
  decisionCalls: 0,
  executedSteps: 0,
  billedCostUsd: 0,
});

const assertionCounts = (
  total: number,
  results: ReadonlyArray<Pick<JevAutomationAssertionResult, "passed" | "verdict">>,
): BrowserRunAssertionCounts => {
  let passed = 0;
  let failed = 0;
  let indeterminate = 0;
  for (const result of results) {
    const verdict = result.verdict ?? (result.passed ? "passed" : "failed");
    if (verdict === "passed") passed += 1;
    else if (verdict === "failed") failed += 1;
    else indeterminate += 1;
  }
  return {
    total,
    passed,
    failed,
    indeterminate,
    outstanding: Math.max(0, total - results.length),
  };
};

const projectAssertionResults = (
  assertions: NonNullable<JevBrowserRunTaskInput["assertions"]>,
  results: readonly JevAutomationAssertionResult[],
): JevBrowserRunTaskResult["assertions"] =>
  results.flatMap((result, index) => {
    const assertion = assertions[index];
    if (!assertion) return [];
    return [
      {
        assertion,
        passed: result.passed,
        ...(result.verdict === undefined ? {} : { verdict: result.verdict }),
        ...(result.actual === undefined ? {} : { actual: result.actual }),
        ...(result.reason === undefined ? {} : { reason: result.reason }),
        ...(result.matchCount === undefined ? {} : { matchCount: result.matchCount }),
        ...(result.coverage === undefined ? {} : { coverage: result.coverage }),
        ...(result.document === undefined ? {} : { document: result.document }),
      },
    ];
  });

const terminalRunStatus = (
  resultStatus: JevBrowserRunTaskResult["status"],
  aborted: boolean,
): BrowserRunStatus => {
  if (aborted || resultStatus === "cancelled") return "cancelled";
  if (resultStatus === "completed") return "completed";
  if (resultStatus === "needs-agent" || resultStatus === "budget-exhausted") return "needs-agent";
  return "failed";
};

const terminalActivityDetail = (status: BrowserRunStatus, hasUncertainEffects: boolean): string => {
  if (hasUncertainEffects) {
    return "A dispatched browser action has an uncertain outcome; inspect fresh state before continuing.";
  }
  switch (status) {
    case "completed":
      return "All requested assertions passed independent verification.";
    case "needs-agent":
      return "The browser run requires agent intervention before it can continue.";
    case "cancelled":
      return "The browser run was cancelled before completion.";
    case "failed":
      return "The browser run failed before completion.";
    case "interrupted":
      return "The server restarted before this browser run finished.";
    case "observing":
    case "acting":
    case "verifying":
      return "The browser run is still active.";
  }
};

const outstandingAssertionIndexes = (
  total: number,
  results: JevBrowserRunTaskResult["assertions"],
): readonly number[] =>
  Array.from({ length: total }, (_, index) => index).filter((index) => {
    const result = results[index];
    return (
      result === undefined || (result.verdict ?? (result.passed ? "passed" : "failed")) !== "passed"
    );
  });

const isPreviewAutomationError = (cause: unknown): cause is PreviewAutomationError =>
  typeof cause === "object" &&
  cause !== null &&
  "_tag" in cause &&
  typeof cause._tag === "string" &&
  (cause._tag.startsWith("PreviewAutomation") || cause._tag.startsWith("JevBrowser"));

/** Runs one complete bounded Jev task without yielding action control back to the provider. */
export const runJevBrowserTask = Effect.fn("JevBrowserCoordinator.run")(function* (
  input: JevBrowserRunTaskInput,
) {
  const scope = yield* McpInvocationContext.requireMcpCapability("preview");
  const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
  const registry = yield* JevBrowserRunRegistry.JevBrowserRunRegistry;
  const ledger = yield* CodexLedgerService.CodexLedgerService;
  const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;
  const clock = yield* Clock.Clock;
  const nowIso = () => DateTime.formatIso(DateTime.makeUnsafe(clock.currentTimeMillisUnsafe()));
  const runId = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
  const runtimeContext = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(runtimeContext);
  let lease: PreviewAutomationBroker.PreviewAutomationHostLease | undefined;
  let tabId: PreviewTabId | undefined = input.tabId;

  return yield* Effect.tryPromise({
    try: async (effectSignal) => {
      const durationSignal = AbortSignal.timeout(input.maxDurationMs ?? DEFAULT_DURATION_MS);
      const abortController = new AbortController();
      const signal = AbortSignal.any([effectSignal, durationSignal, abortController.signal]);
      let acquired = false;
      let terminalStatus: JevBrowserRunTaskResult["status"] = "failed";
      const startedAt = nowIso();
      const totalAssertions = input.assertions?.length ?? 0;
      const requestedAssertions = input.assertions ?? [];
      let sequence = 0;
      let latestAssertionCounts = assertionCounts(totalAssertions, []);
      let decisionCalls = 0;
      let executedSteps = 0;
      let reportedCostUsd = 0;
      let hasUnknownCost = false;
      let lastAction: string | undefined;
      let latestObservation: JevBrowserObserveResult["observation"] | undefined;
      let lastConfirmedAction: JevBrowserHandoff["lastConfirmedAction"];
      const proposedActions = new Map<
        number,
        NonNullable<JevBrowserHandoff["lastConfirmedAction"]>
      >();
      const uncertainEffects: Array<NonNullable<JevBrowserHandoff["lastConfirmedAction"]>> = [];
      const accountedIterations = new Set<number>();
      const addUncertainEffect = (
        action: NonNullable<JevBrowserHandoff["lastConfirmedAction"]>,
      ) => {
        if (
          !uncertainEffects.some(
            ({ iteration, operation }) =>
              iteration === action.iteration && operation === action.operation,
          )
        ) {
          uncertainEffects.push(action);
        }
      };

      const publish = async (
        status: BrowserRunStatus,
        fields: Partial<Pick<BrowserRunSummary, "detail" | "handoffReason" | "lastAction">> = {},
      ) => {
        sequence += 1;
        const summary: BrowserRunSummary = {
          runId,
          ...(input.resumeFromRunId ? { continuedFromRunId: input.resumeFromRunId } : {}),
          sequence,
          environmentId: scope.environmentId,
          threadId: scope.threadId,
          ...(tabId ? { tabId } : {}),
          ...(lease ? { hostClientId: lease.clientId } : {}),
          browserBackend: "embedded",
          status,
          startedAt,
          updatedAt: nowIso(),
          ...(lastAction ? { lastAction } : {}),
          assertionCounts: latestAssertionCounts,
          decisionCalls,
          executedSteps,
          reportedCostUsd,
          hasUnknownCost,
          ...fields,
        };
        await runPromise(
          publishBrowserRunSummary(summary).pipe(
            Effect.provideService(
              OrchestrationEngine.OrchestrationEngineService,
              orchestrationEngine,
            ),
            Effect.provideService(Crypto.Crypto, crypto),
          ),
        );
      };
      const invoke = async <A>(
        operation: Parameters<typeof broker.invoke>[0]["operation"],
        operationInput: unknown,
        timeoutMs = 15_000,
      ): Promise<A> => {
        const result = await runPromise(
          broker.invoke<A>({
            scope,
            operation,
            input: operationInput,
            timeoutMs,
            requiredOperations: REQUIRED_OPERATIONS,
            ...(lease ? { hostLease: lease } : {}),
            ...(tabId ? { tabId } : {}),
            onHostLease: (selected) => {
              lease ??= selected;
            },
            onTargetTab: (selected) => {
              tabId ??= selected;
            },
          }),
          { signal },
        );
        if (
          typeof result === "object" &&
          result !== null &&
          "tabId" in result &&
          typeof result.tabId === "string"
        ) {
          tabId = result.tabId as PreviewTabId;
        }
        return result;
      };

      try {
        const status = await invoke<PreviewAutomationStatus>("status", {}, 2_000);
        if (!status.jevBrowser?.available || status.jevBrowser.mode === "disabled") {
          return disabledResult(
            runId,
            "Jev browser automation is disabled for this environment and thread.",
            input.resumeFromRunId,
          );
        }
        if (!tabId) {
          throw new JevBrowserRunError({
            environmentId: scope.environmentId,
            stage: "status",
            cause: new Error("The enabled Jev host did not resolve a preview tab."),
          });
        }
        const activeRunId = await runPromise(
          registry.acquire({
            environmentId: scope.environmentId,
            threadId: scope.threadId,
            tabId,
            runId,
            abortController,
          }),
        );
        if (activeRunId !== undefined) {
          throw new JevBrowserRunConflictError({
            environmentId: scope.environmentId,
            tabId,
            activeRunId,
          });
        }
        acquired = true;
        await publish("observing");
        const allowedOrigins =
          input.allowedOrigins ?? defaultAllowedOrigins(status.url, input.inputs);
        const inputs = input.inputs ?? [];

        const adapter: JevAutomationAdapter = {
          observe: async ({ signal: operationSignal }) => {
            const result = await invoke<JevBrowserObserveResult>("jevBrowserObserve", {
              runId,
              ...(tabId ? { tabId } : {}),
              task: input.task,
              inputs,
              allowedOrigins,
            });
            if (operationSignal.aborted) throw operationSignal.reason;
            latestObservation = result.observation;
            return result.observation;
          },
          verify: async ({ assertions, expectedDocumentId, signal: operationSignal }) => {
            await publish("verifying");
            const result = await invoke<JevBrowserVerifyResult>("jevBrowserVerify", {
              runId,
              ...(tabId ? { tabId } : {}),
              assertions,
              ...(expectedDocumentId === undefined ? {} : { expectedDocumentId }),
            });
            if (operationSignal.aborted) throw operationSignal.reason;
            latestAssertionCounts = assertionCounts(totalAssertions, result.results);
            return result;
          },
          execute: async ({ revision, action, signal: operationSignal }) => {
            const result = await invoke<JevBrowserExecuteResult>("jevBrowserExecute", {
              runId,
              ...(tabId ? { tabId } : {}),
              revision,
              action,
            });
            if (operationSignal.aborted) throw operationSignal.reason;
            return result;
          },
        };
        const decisionClient: JevAutomationDecisionClient = {
          decide: async ({ signal: operationSignal, ...request }) => {
            const iteration =
              request.priorReceipts.reduce(
                (maximum, receipt) => Math.max(maximum, receipt.iteration),
                0,
              ) + 1;
            const result = await invoke<JevBrowserDecideResult>("jevBrowserDecide", {
              runId,
              ...(tabId ? { tabId } : {}),
              iteration,
              ...request,
            });
            if (operationSignal.aborted) throw operationSignal.reason;
            return result;
          },
        };

        const result = await runJevAutomation(
          {
            task: input.task,
            inputs,
            ...(input.assertions === undefined ? {} : { assertions: input.assertions }),
            limits: {
              ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
              ...(input.maxDecisionCalls === undefined
                ? {}
                : { maxDecisionCalls: input.maxDecisionCalls }),
              ...(input.maxCostUsd === undefined ? {} : { maxCostUsd: input.maxCostUsd }),
            },
            signal,
            onReceipt: async (receipt) => {
              await runPromise(
                ledger
                  .recordJevReceipt({
                    requestId: runId,
                    attemptId: String(receipt.iteration),
                    rootTurnId: null,
                    toolUseId: null,
                    environmentId: scope.environmentId,
                    projectId: null,
                    threadId: scope.threadId,
                    messageId: null,
                    turnId: null,
                    providerThreadId: null,
                    providerTurnId: null,
                    childProviderThreadId: null,
                    parentProviderTurnId: null,
                    dispatchId: null,
                    observedModel: receipt.accounting.responseModel ?? null,
                    sourceScope: "turn",
                    decisionJson: JSON.stringify({ kind: "jev-browser", receipt }),
                    dispatchJson: null,
                    reportedCostUsd:
                      receipt.accounting.costUsd === null
                        ? null
                        : String(receipt.accounting.costUsd),
                    estimatedCostUsd: null,
                    status:
                      receipt.status === "proposed"
                        ? "proposed"
                        : receipt.status === "rejected" ||
                            receipt.status === "stale" ||
                            receipt.status === "unavailable"
                          ? "failed"
                          : "completed",
                  })
                  .pipe(Effect.timeout("2 seconds")),
              );
              decisionCalls = Math.max(decisionCalls, receipt.iteration);
              if (!accountedIterations.has(receipt.iteration)) {
                accountedIterations.add(receipt.iteration);
                if (
                  receipt.accounting.costUsd === null ||
                  !Number.isFinite(receipt.accounting.costUsd) ||
                  receipt.accounting.costUsd < 0
                ) {
                  hasUnknownCost = true;
                } else {
                  const nextReportedCostUsd = reportedCostUsd + receipt.accounting.costUsd;
                  if (Number.isFinite(nextReportedCostUsd)) reportedCostUsd = nextReportedCostUsd;
                  else hasUnknownCost = true;
                }
              }
              if (receipt.status === "executed") executedSteps += 1;
              if (receipt.candidateId) {
                const candidate = latestObservation?.candidates.find(
                  ({ id }) => id === receipt.candidateId,
                );
                if (candidate) {
                  lastAction = candidate.operation;
                  const action = { iteration: receipt.iteration, operation: candidate.operation };
                  if (receipt.status === "proposed") proposedActions.set(receipt.iteration, action);
                  if (receipt.status === "executed") {
                    lastConfirmedAction = action;
                    proposedActions.delete(receipt.iteration);
                  }
                }
                if (receipt.status === "rejected" || receipt.status === "stale") {
                  const proposed = proposedActions.get(receipt.iteration);
                  if (
                    proposed &&
                    receipt.status === "rejected" &&
                    /during execution|outcome is unknown/iu.test(receipt.detail ?? "")
                  ) {
                    addUncertainEffect(proposed);
                  }
                  proposedActions.delete(receipt.iteration);
                }
              }
              await publish(
                receipt.status === "proposed"
                  ? "acting"
                  : receipt.status === "needs-agent"
                    ? "needs-agent"
                    : receipt.status === "unavailable"
                      ? "failed"
                      : "verifying",
              );
            },
          },
          adapter,
          decisionClient,
        );
        const projectedAssertions = projectAssertionResults(requestedAssertions, result.assertions);
        latestAssertionCounts = assertionCounts(totalAssertions, projectedAssertions);
        decisionCalls = result.decisionCalls;
        executedSteps = result.executedSteps;
        if (result.billedCostUsd === null) {
          hasUnknownCost = true;
        } else if (Number.isFinite(result.billedCostUsd) && result.billedCostUsd >= 0) {
          reportedCostUsd = result.billedCostUsd;
        } else {
          hasUnknownCost = true;
        }
        if (result.reason === "The execution receipt could not be persisted.") {
          for (const action of proposedActions.values()) addUncertainEffect(action);
          proposedActions.clear();
        }
        terminalStatus = result.status;
        const finalStatus = terminalRunStatus(result.status, signal.aborted);
        if (finalStatus === "cancelled") hasUnknownCost = true;
        const handoff =
          finalStatus === "needs-agent" || uncertainEffects.length > 0
            ? {
                reason: terminalActivityDetail(finalStatus, uncertainEffects.length > 0),
                ...(lastConfirmedAction ? { lastConfirmedAction } : {}),
                uncertainEffects: uncertainEffects.slice(0, 16),
                outstandingAssertionIndexes: outstandingAssertionIndexes(
                  totalAssertions,
                  projectedAssertions,
                ),
              }
            : undefined;
        await publish(finalStatus, {
          detail: terminalActivityDetail(finalStatus, uncertainEffects.length > 0),
          ...(finalStatus === "needs-agent" || uncertainEffects.length > 0
            ? {
                handoffReason: terminalActivityDetail(finalStatus, uncertainEffects.length > 0),
              }
            : {}),
        });
        return {
          runId,
          ...(input.resumeFromRunId ? { continuedFromRunId: input.resumeFromRunId } : {}),
          ...result,
          assertions: projectedAssertions,
          ...(handoff ? { handoff } : {}),
        } satisfies JevBrowserRunTaskResult;
      } catch (cause) {
        if (acquired) {
          if (signal.aborted) hasUnknownCost = true;
          await publish(signal.aborted ? "cancelled" : "failed", {
            detail: signal.aborted
              ? "The browser run was cancelled."
              : "The browser run failed before it produced a result.",
          }).catch(() => undefined);
        }
        throw cause;
      } finally {
        if (acquired && lease) {
          const reason = signal.aborted
            ? durationSignal.aborted
              ? "timeout"
              : "caller-cancelled"
            : terminalStatus === "completed"
              ? "completed"
              : "failed";
          await runPromise(
            broker
              .invoke<JevBrowserCancelResult>({
                scope,
                operation: "jevBrowserCancel",
                input: { runId, ...(tabId ? { tabId } : {}), reason },
                timeoutMs: 2_000,
                requiredOperations: REQUIRED_OPERATIONS,
                hostLease: lease,
                ...(tabId ? { tabId } : {}),
              })
              .pipe(Effect.ignore),
          );
        }
        if (acquired && tabId) {
          await runPromise(
            registry.release({
              environmentId: scope.environmentId,
              threadId: scope.threadId,
              tabId,
              runId,
            }),
          );
        }
      }
    },
    catch: (cause) =>
      isPreviewAutomationError(cause)
        ? cause
        : new JevBrowserRunError({ environmentId: scope.environmentId, stage: "run", cause }),
  });
});
