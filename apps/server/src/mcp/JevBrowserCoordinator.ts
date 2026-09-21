import {
  JEV_BROWSER_AUTOMATION_OPERATIONS,
  JevBrowserRunConflictError,
  JevBrowserRunError,
  type JevBrowserCancelResult,
  type JevBrowserDecideResult,
  type JevBrowserExecuteResult,
  type JevBrowserObserveResult,
  type JevBrowserRunTaskInput,
  type JevBrowserRunTaskResult,
  type PreviewAutomationStatus,
  type PreviewAutomationError,
  type PreviewTabId,
} from "@t3tools/contracts";
import {
  runJevAutomation,
  type JevAutomationAdapter,
  type JevAutomationDecisionClient,
} from "@t3tools/shared/jevAutomation";
import * as Effect from "effect/Effect";
import * as Crypto from "effect/Crypto";

import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as PreviewAutomationBroker from "./PreviewAutomationBroker.ts";
import * as JevBrowserRunRegistry from "./JevBrowserRunRegistry.ts";
import * as CodexLedgerService from "../usage/CodexLedgerService.ts";

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

const disabledResult = (runId: string, reason: string): JevBrowserRunTaskResult => ({
  runId,
  status: "disabled",
  reason,
  observation: null,
  assertions: [],
  receipts: [],
  decisionCalls: 0,
  executedSteps: 0,
  billedCostUsd: 0,
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
  const crypto = yield* Crypto.Crypto;
  const runId = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
  let lease: PreviewAutomationBroker.PreviewAutomationHostLease | undefined;
  let tabId: PreviewTabId | undefined = input.tabId;

  return yield* Effect.tryPromise({
    try: async (effectSignal) => {
      const durationSignal = AbortSignal.timeout(input.maxDurationMs ?? DEFAULT_DURATION_MS);
      const signal = AbortSignal.any([effectSignal, durationSignal]);
      let acquired = false;
      let terminalStatus: JevBrowserRunTaskResult["status"] = "failed";
      const invoke = async <A>(
        operation: Parameters<typeof broker.invoke>[0]["operation"],
        operationInput: unknown,
        timeoutMs = 15_000,
      ): Promise<A> => {
        const result = await Effect.runPromise(
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
          );
        }
        if (!tabId) {
          throw new JevBrowserRunError({
            environmentId: scope.environmentId,
            stage: "status",
            cause: new Error("The enabled Jev host did not resolve a preview tab."),
          });
        }
        const activeRunId = await Effect.runPromise(
          registry.acquire(scope.environmentId, tabId, runId),
        );
        if (activeRunId !== undefined) {
          throw new JevBrowserRunConflictError({
            environmentId: scope.environmentId,
            tabId,
            activeRunId,
          });
        }
        acquired = true;
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
            return result.observation;
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
              await Effect.runPromise(
                ledger.recordJevReceipt({
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
                    receipt.accounting.costUsd === null ? null : String(receipt.accounting.costUsd),
                  estimatedCostUsd: null,
                  status:
                    receipt.status === "proposed"
                      ? "proposed"
                      : receipt.status === "rejected" ||
                          receipt.status === "stale" ||
                          receipt.status === "unavailable"
                        ? "failed"
                        : "completed",
                }),
                { signal },
              );
            },
          },
          adapter,
          decisionClient,
        );
        terminalStatus = result.status;
        return { runId, ...result } satisfies JevBrowserRunTaskResult;
      } finally {
        if (acquired && lease) {
          const reason = signal.aborted
            ? durationSignal.aborted
              ? "timeout"
              : "caller-cancelled"
            : terminalStatus === "completed"
              ? "completed"
              : "failed";
          await Effect.runPromise(
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
          await Effect.runPromise(registry.release(scope.environmentId, tabId, runId));
        }
      }
    },
    catch: (cause) =>
      isPreviewAutomationError(cause)
        ? cause
        : new JevBrowserRunError({ environmentId: scope.environmentId, stage: "run", cause }),
  });
});
