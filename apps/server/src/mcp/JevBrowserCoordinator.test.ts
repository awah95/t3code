import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  BrowserArtifactActionId,
  BrowserDialogId,
  CodexLedgerError,
  EnvironmentId,
  JevBrowserRunConflictError,
  PreviewAutomationDialogPendingError,
  type BrowserRunSummary,
  type OrchestrationCommand,
  PreviewTabId,
  ProviderInstanceId,
  ThreadId,
  type PreviewAutomationOperation,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import * as CodexLedgerService from "../usage/CodexLedgerService.ts";
import { runJevBrowserTask } from "./JevBrowserCoordinator.ts";
import * as JevBrowserRunRegistry from "./JevBrowserRunRegistry.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as PreviewAutomationBroker from "./PreviewAutomationBroker.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";

const environmentId = EnvironmentId.make("environment-1");
const tabId = PreviewTabId.make("tab-1");
const otherTabId = PreviewTabId.make("tab-2");

const scope = (providerSessionId: string) => ({
  environmentId,
  threadId: ThreadId.make(`thread-${providerSessionId}`),
  providerSessionId,
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(["preview"] as const),
  issuedAt: 1,
});

const completedObservation = (location = "https://example.test/done") => ({
  observation: {
    revision: "revision-1",
    surface: "browser" as const,
    location,
    controls: [],
    candidates: [],
  },
});

const passedVerification = (input: unknown) => ({
  results: (input as { assertions: ReadonlyArray<unknown> }).assertions.map((assertion) => ({
    assertion,
    verdict: "passed" as const,
    passed: true,
    actual: "https://example.test/done",
    matchCount: 1,
    coverage: {
      status: "complete" as const,
      searchedScopes: 1,
      omittedScopes: 0,
      omissions: [],
    },
    document: { documentId: "document-1", revision: "revision-1", status: "current" as const },
  })),
});

const readyStatus = (resolvedTabId: PreviewTabId) => ({
  available: true,
  visible: true,
  tabId: resolvedTabId,
  url: "https://example.test/start",
  title: "Example",
  loading: false,
  viewport: { mode: "fill" as const },
  size: { width: 1024, height: 768 },
  jevBrowser: { available: true, mode: "idle" as const },
});

const task = (resolvedTabId: PreviewTabId) => ({
  task: "Reach the done page",
  tabId: resolvedTabId,
  assertions: [
    {
      kind: "location" as const,
      property: "location" as const,
      operator: "equals" as const,
      expected: "https://example.test/done",
    },
  ],
});

const makeBroker = (invoke: PreviewAutomationBroker.PreviewAutomationBroker["Service"]["invoke"]) =>
  PreviewAutomationBroker.PreviewAutomationBroker.of({
    connect: () => Effect.die("unused"),
    focusHost: () => Effect.void,
    respond: () => Effect.void,
    invoke,
  });

const runWith = (
  broker: PreviewAutomationBroker.PreviewAutomationBroker["Service"],
  registry: JevBrowserRunRegistry.JevBrowserRunRegistry["Service"],
  providerSessionId: string,
  input: Parameters<typeof runJevBrowserTask>[0],
  activityCommands: Array<Extract<OrchestrationCommand, { type: "thread.activity.append" }>> = [],
) =>
  runJevBrowserTask(input).pipe(
    Effect.provideService(PreviewAutomationBroker.PreviewAutomationBroker, broker),
    Effect.provideService(JevBrowserRunRegistry.JevBrowserRunRegistry, registry),
    Effect.provideService(McpInvocationContext.McpInvocationContext, scope(providerSessionId)),
    Effect.provideService(
      OrchestrationEngine.OrchestrationEngineService,
      OrchestrationEngine.OrchestrationEngineService.of({
        dispatch: (command: OrchestrationCommand) =>
          Effect.sync(() => {
            if (command.type === "thread.activity.append") activityCommands.push(command);
            return { sequence: activityCommands.length };
          }),
      } as unknown as OrchestrationEngine.OrchestrationEngineService["Service"]),
    ),
  );

const TestDependencies = Layer.mergeAll(CodexLedgerService.layerTest, NodeServices.layer);

it.effect("returns disabled without observing, deciding, executing, or cancelling", () =>
  Effect.gen(function* () {
    const operations: PreviewAutomationOperation[] = [];
    const registry = yield* JevBrowserRunRegistry.make;
    const broker = makeBroker(<A>(request: PreviewAutomationBroker.PreviewAutomationInvokeInput) =>
      Effect.sync(() => {
        operations.push(request.operation);
        request.onHostLease?.({ clientId: "host-1", connectionId: "connection-1" });
        request.onTargetTab?.(tabId);
        return {
          ...readyStatus(tabId),
          jevBrowser: { available: true, mode: "disabled" as const },
        } as A;
      }),
    );

    const result = yield* runWith(broker, registry, "one", task(tabId));

    expect(result.status).toBe("disabled");
    expect(operations).toEqual(["status"]);
  }).pipe(Effect.provide(TestDependencies)),
);

it.effect("pins every operation, cancels in cleanup, and releases after failure", () =>
  Effect.gen(function* () {
    const operations: PreviewAutomationOperation[] = [];
    const leases: Array<PreviewAutomationBroker.PreviewAutomationHostLease | undefined> = [];
    const observedAllowedOrigins: Array<readonly string[]> = [];
    const activityCommands: Array<
      Extract<OrchestrationCommand, { type: "thread.activity.append" }>
    > = [];
    let observeCalls = 0;
    const registry = yield* JevBrowserRunRegistry.make;
    const broker = makeBroker(<A>(request: PreviewAutomationBroker.PreviewAutomationInvokeInput) =>
      Effect.sync(() => {
        operations.push(request.operation);
        leases.push(request.hostLease);
        if (request.operation === "status") {
          request.onHostLease?.({ clientId: "host-1", connectionId: "connection-1" });
          request.onTargetTab?.(tabId);
          return readyStatus(tabId) as A;
        }
        if (request.operation === "jevBrowserObserve") {
          observedAllowedOrigins.push(
            (request.input as { allowedOrigins: readonly string[] }).allowedOrigins,
          );
          observeCalls += 1;
          if (observeCalls === 1) throw new Error("observation failed");
          return completedObservation() as A;
        }
        if (request.operation === "jevBrowserVerify") return passedVerification(request.input) as A;
        if (request.operation === "jevBrowserCancel") return { cancelled: true } as A;
        throw new Error(`Unexpected operation ${request.operation}`);
      }),
    );

    const first = yield* runWith(broker, registry, "one", task(tabId), activityCommands);
    const second = yield* runWith(
      broker,
      registry,
      "two",
      {
        ...task(tabId),
        inputs: [
          {
            id: "destination",
            kind: "url",
            value: "https://destination.test/path",
            description: "Caller-authorized destination",
          },
        ],
      },
      activityCommands,
    );

    expect(first.status).toBe("failed");
    expect(second.status).toBe("completed");
    expect(operations).toEqual([
      "status",
      "jevBrowserObserve",
      "jevBrowserCancel",
      "status",
      "jevBrowserObserve",
      "jevBrowserVerify",
      "jevBrowserCancel",
    ]);
    expect(
      operations.every(
        (operation, index) =>
          operation === "status" || leases[index]?.connectionId === "connection-1",
      ),
    ).toBe(true);
    expect(observedAllowedOrigins[1]).toEqual(["https://example.test", "https://destination.test"]);
    const secondSummaries = activityCommands
      .map((command) => command.activity.payload as BrowserRunSummary)
      .filter(({ runId }) => runId === second.runId);
    expect(secondSummaries.map(({ sequence }) => sequence)).toEqual([1, 2, 3]);
    expect(secondSummaries.map(({ status }) => status)).toEqual([
      "observing",
      "verifying",
      "completed",
    ]);
    expect(new Set(activityCommands.map((command) => command.activity.id)).size).toBe(2);
  }).pipe(Effect.provide(TestDependencies)),
);

it.effect("rejects a second session on the same tab while allowing another tab", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let releaseFirst!: () => void;
      let firstStarted!: () => void;
      const firstStartedPromise = new Promise<void>((resolve) => {
        firstStarted = resolve;
      });
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const registry = yield* JevBrowserRunRegistry.make;
      const broker = makeBroker(
        <A>(request: PreviewAutomationBroker.PreviewAutomationInvokeInput) =>
          Effect.promise(async () => {
            const requestedTab = request.tabId ?? tabId;
            if (request.operation === "status") {
              request.onHostLease?.({ clientId: "host-1", connectionId: "connection-1" });
              request.onTargetTab?.(requestedTab);
              return readyStatus(requestedTab) as A;
            }
            if (request.operation === "jevBrowserObserve") {
              const input = request.input as { runId: string };
              if (requestedTab === tabId && input.runId) {
                firstStarted();
                await firstGate;
              }
              return completedObservation() as A;
            }
            if (request.operation === "jevBrowserVerify")
              return passedVerification(request.input) as A;
            if (request.operation === "jevBrowserCancel") return { cancelled: true } as A;
            throw new Error(`Unexpected operation ${request.operation}`);
          }),
      );

      const first = yield* runWith(broker, registry, "one", task(tabId)).pipe(Effect.forkScoped);
      yield* Effect.promise(() => firstStartedPromise);

      const conflict = yield* runWith(broker, registry, "two", task(tabId)).pipe(Effect.flip);
      expect(conflict).toBeInstanceOf(JevBrowserRunConflictError);

      const other = yield* runWith(broker, registry, "three", task(otherTabId));
      expect(other.status).toBe("completed");

      releaseFirst();
      expect((yield* Fiber.join(first)).status).toBe("completed");
    }).pipe(Effect.provide(TestDependencies)),
  ),
);

it.effect("scoped cancellation stops the active run without executing or disabling Jev", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const registry = yield* JevBrowserRunRegistry.make;
      const observedRunId = yield* Deferred.make<string>();
      const operations: PreviewAutomationOperation[] = [];
      const activityCommands: Array<
        Extract<OrchestrationCommand, { type: "thread.activity.append" }>
      > = [];
      const broker = makeBroker(
        <A>(request: PreviewAutomationBroker.PreviewAutomationInvokeInput) =>
          Effect.gen(function* () {
            operations.push(request.operation);
            if (request.operation === "status") {
              request.onHostLease?.({ clientId: "host-1", connectionId: "connection-1" });
              request.onTargetTab?.(tabId);
              return readyStatus(tabId) as A;
            }
            if (request.operation === "jevBrowserObserve") {
              yield* Deferred.succeed(observedRunId, (request.input as { runId: string }).runId);
              return yield* Effect.never;
            }
            if (request.operation === "jevBrowserCancel") return { cancelled: true } as A;
            throw new Error(`Unexpected operation ${request.operation}`);
          }),
      );

      const fiber = yield* runWith(
        broker,
        registry,
        "cancelled",
        task(tabId),
        activityCommands,
      ).pipe(Effect.forkScoped);
      const runId = yield* Deferred.await(observedRunId);
      expect(
        yield* registry.cancel({
          environmentId,
          threadId: scope("cancelled").threadId,
          runId,
        }),
      ).toEqual({ runId, cancelled: true });

      const result = yield* Fiber.join(fiber);
      expect(result.status).toBe("cancelled");
      expect(operations).toEqual(["status", "jevBrowserObserve", "jevBrowserCancel"]);
      const summaries = activityCommands.map(
        (command) => command.activity.payload as BrowserRunSummary,
      );
      expect(summaries.at(-1)).toMatchObject({
        runId,
        status: "cancelled",
        hasUnknownCost: true,
      });
    }).pipe(Effect.provide(TestDependencies)),
  ),
);

it.effect("persists post-dispatch cancellation as one-cost uncertain handoff", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const registry = yield* JevBrowserRunRegistry.make;
      const executeStarted = yield* Deferred.make<string>();
      const activityCommands: Array<
        Extract<OrchestrationCommand, { type: "thread.activity.append" }>
      > = [];
      const broker = makeBroker(
        <A>(request: PreviewAutomationBroker.PreviewAutomationInvokeInput) =>
          Effect.gen(function* () {
            if (request.operation === "status") {
              request.onHostLease?.({ clientId: "host-1", connectionId: "connection-1" });
              request.onTargetTab?.(tabId);
              return readyStatus(tabId) as A;
            }
            if (request.operation === "jevBrowserObserve") {
              return {
                observation: {
                  revision: "revision-1",
                  surface: "browser",
                  location: "https://example.test/start",
                  controls: [{ id: "save", role: "button", name: "Save" }],
                  candidates: [
                    {
                      id: "activate-save",
                      operation: "activate",
                      targetId: "save",
                      description: "Private candidate text",
                    },
                  ],
                },
              } as A;
            }
            if (request.operation === "jevBrowserVerify") {
              const assertion = (request.input as { assertions: ReadonlyArray<unknown> })
                .assertions[0];
              return {
                results: [
                  {
                    assertion,
                    verdict: "failed",
                    passed: false,
                    matchCount: 0,
                    coverage: {
                      status: "complete",
                      searchedScopes: 1,
                      omittedScopes: 0,
                      omissions: [],
                    },
                    document: {
                      documentId: "document-1",
                      revision: "revision-1",
                      status: "current",
                    },
                  },
                ],
              } as A;
            }
            if (request.operation === "jevBrowserDecide") {
              return {
                decision: { outcome: "act", candidateId: "activate-save" },
                accounting: {
                  inputTokens: 1,
                  outputTokens: 1,
                  costUsd: 0.004,
                  responseModel: "test",
                  provider: "test",
                },
              } as A;
            }
            if (request.operation === "jevBrowserExecute") {
              yield* Deferred.succeed(executeStarted, (request.input as { runId: string }).runId);
              return yield* Effect.never;
            }
            if (request.operation === "jevBrowserCancel") return { cancelled: true } as A;
            throw new Error(`Unexpected operation ${request.operation}`);
          }),
      );

      const fiber = yield* runWith(
        broker,
        registry,
        "cancelled-execute",
        task(tabId),
        activityCommands,
      ).pipe(Effect.forkScoped);
      const runId = yield* Deferred.await(executeStarted);
      expect(
        yield* registry.cancel({
          environmentId,
          threadId: scope("cancelled-execute").threadId,
          runId,
        }),
      ).toEqual({ runId, cancelled: true });

      const result = yield* Fiber.join(fiber);
      expect(result).toMatchObject({
        status: "cancelled",
        handoff: {
          reason:
            "A dispatched browser action has an uncertain outcome; inspect fresh state before continuing.",
          uncertainEffects: [{ iteration: 1, operation: "activate" }],
          outstandingAssertionIndexes: [0],
        },
      });
      expect(result.receipts.map(({ status }) => status)).toEqual(["proposed", "rejected"]);
      const summaries = activityCommands.map(
        (command) => command.activity.payload as BrowserRunSummary,
      );
      expect(summaries.at(-1)).toMatchObject({
        status: "cancelled",
        reportedCostUsd: 0.004,
        hasUnknownCost: true,
        lastAction: "activate",
        handoffReason:
          "A dispatched browser action has an uncertain outcome; inspect fresh state before continuing.",
      });
      expect(
        summaries.some(({ detail, handoffReason, lastAction }) =>
          [detail, handoffReason, lastAction].includes("Private candidate text"),
        ),
      ).toBe(false);
    }).pipe(Effect.provide(TestDependencies)),
  ),
);

it.effect("treats an executed action as uncertain when its final receipt cannot persist", () =>
  Effect.gen(function* () {
    const registry = yield* JevBrowserRunRegistry.make;
    const activityCommands: Array<
      Extract<OrchestrationCommand, { type: "thread.activity.append" }>
    > = [];
    const baseLedger = yield* CodexLedgerService.CodexLedgerService;
    let receiptWrites = 0;
    const failingLedger = CodexLedgerService.CodexLedgerService.of({
      ...baseLedger,
      recordJevReceipt: (input) =>
        Effect.suspend(() => {
          receiptWrites += 1;
          return receiptWrites === 2
            ? Effect.fail(
                new CodexLedgerError({ message: "execution receipt storage unavailable" }),
              )
            : baseLedger.recordJevReceipt(input);
        }),
    });
    const broker = makeBroker(<A>(request: PreviewAutomationBroker.PreviewAutomationInvokeInput) =>
      Effect.sync(() => {
        if (request.operation === "status") {
          request.onHostLease?.({ clientId: "host-1", connectionId: "connection-1" });
          request.onTargetTab?.(tabId);
          return readyStatus(tabId) as A;
        }
        if (request.operation === "jevBrowserObserve") {
          return {
            observation: {
              revision: "revision-1",
              surface: "browser",
              location: "https://example.test/start",
              controls: [{ id: "save", role: "button", name: "Save" }],
              candidates: [
                {
                  id: "activate-save",
                  operation: "activate",
                  targetId: "save",
                  description: "Private executed candidate",
                },
              ],
            },
          } as A;
        }
        if (request.operation === "jevBrowserVerify") {
          const assertion = (request.input as { assertions: ReadonlyArray<unknown> }).assertions[0];
          return {
            results: [
              {
                assertion,
                verdict: "failed",
                passed: false,
                matchCount: 0,
                coverage: {
                  status: "complete",
                  searchedScopes: 1,
                  omittedScopes: 0,
                  omissions: [],
                },
                document: {
                  documentId: "document-1",
                  revision: "revision-1",
                  status: "current",
                },
              },
            ],
          } as A;
        }
        if (request.operation === "jevBrowserDecide") {
          return {
            decision: { outcome: "act", candidateId: "activate-save" },
            accounting: {
              inputTokens: 1,
              outputTokens: 1,
              costUsd: 0.006,
              responseModel: "test",
              provider: "test",
            },
          } as A;
        }
        if (request.operation === "jevBrowserExecute") return { status: "executed" } as A;
        if (request.operation === "jevBrowserCancel") return { cancelled: true } as A;
        throw new Error(`Unexpected operation ${request.operation}`);
      }),
    );

    const result = yield* runWith(
      broker,
      registry,
      "receipt-failure",
      task(tabId),
      activityCommands,
    ).pipe(Effect.provideService(CodexLedgerService.CodexLedgerService, failingLedger));

    expect(receiptWrites).toBe(2);
    expect(result).toMatchObject({
      status: "failed",
      reason: "The execution receipt could not be persisted.",
      billedCostUsd: 0.006,
      handoff: {
        reason:
          "A dispatched browser action has an uncertain outcome; inspect fresh state before continuing.",
        uncertainEffects: [{ iteration: 1, operation: "activate" }],
        outstandingAssertionIndexes: [0],
      },
    });
    const summaries = activityCommands.map(
      (command) => command.activity.payload as BrowserRunSummary,
    );
    expect(summaries.at(-1)).toMatchObject({
      status: "failed",
      reportedCostUsd: 0.006,
      hasUnknownCost: false,
      lastAction: "activate",
      handoffReason:
        "A dispatched browser action has an uncertain outcome; inspect fresh state before continuing.",
    });
    expect(
      summaries.some(({ detail, handoffReason, lastAction }) =>
        [detail, handoffReason, lastAction].includes("Private executed candidate"),
      ),
    ).toBe(false);

    let proposalWrites = 0;
    const proposalFailureActivities: Array<
      Extract<OrchestrationCommand, { type: "thread.activity.append" }>
    > = [];
    const proposalFailingLedger = CodexLedgerService.CodexLedgerService.of({
      ...baseLedger,
      recordJevReceipt: () => {
        proposalWrites += 1;
        return Effect.fail(new CodexLedgerError({ message: "proposal receipt unavailable" }));
      },
    });
    const proposalFailure = yield* runWith(
      broker,
      registry,
      "proposal-receipt-failure",
      task(tabId),
      proposalFailureActivities,
    ).pipe(Effect.provideService(CodexLedgerService.CodexLedgerService, proposalFailingLedger));

    expect(proposalWrites).toBe(1);
    expect(proposalFailure).toMatchObject({
      status: "failed",
      reason: "The action proposal receipt could not be persisted.",
      billedCostUsd: 0.006,
    });
    expect(proposalFailure.handoff).toBeUndefined();
    expect(proposalFailureActivities.at(-1)?.activity.payload as BrowserRunSummary).toMatchObject({
      status: "failed",
      reportedCostUsd: 0.006,
      hasUnknownCost: false,
    });
  }).pipe(Effect.provide(TestDependencies)),
);

it.effect("hands off a typed pending dialog without retrying the dispatched action", () =>
  Effect.gen(function* () {
    const registry = yield* JevBrowserRunRegistry.make;
    const activityCommands: Array<
      Extract<OrchestrationCommand, { type: "thread.activity.append" }>
    > = [];
    let observeCalls = 0;
    let decisionCalls = 0;
    let executeCalls = 0;
    const broker = makeBroker(<A>(request: PreviewAutomationBroker.PreviewAutomationInvokeInput) =>
      Effect.sync(() => {
        if (request.operation === "status") {
          request.onHostLease?.({ clientId: "host-1", connectionId: "connection-1" });
          request.onTargetTab?.(tabId);
          return readyStatus(tabId) as A;
        }
        if (request.operation === "jevBrowserObserve") {
          observeCalls += 1;
          return {
            observation: {
              revision: "revision-1",
              surface: "browser",
              location: "https://example.test/start",
              controls: [{ id: "save", role: "button", name: "Save" }],
              candidates: [
                {
                  id: "activate-save",
                  operation: "activate",
                  targetId: "save",
                  description: "Secret page label must not enter the handoff",
                },
              ],
            },
          } as A;
        }
        if (request.operation === "jevBrowserVerify") {
          const assertion = (request.input as { assertions: ReadonlyArray<unknown> }).assertions[0];
          return {
            results: [
              {
                assertion,
                verdict: "failed",
                passed: false,
                actual: "https://example.test/start",
                matchCount: 1,
                coverage: {
                  status: "complete",
                  searchedScopes: 1,
                  omittedScopes: 0,
                  omissions: [],
                },
                document: {
                  documentId: "document-1",
                  revision: "revision-1",
                  status: "current",
                },
              },
            ],
          } as A;
        }
        if (request.operation === "jevBrowserDecide") {
          decisionCalls += 1;
          return {
            decision: { outcome: "act", candidateId: "activate-save" },
            accounting: {
              inputTokens: 1,
              outputTokens: 1,
              costUsd: 0.007,
              responseModel: "test",
              provider: "test",
            },
          } as A;
        }
        if (request.operation === "jevBrowserExecute") {
          executeCalls += 1;
          const runId = (request.input as { runId: string }).runId;
          throw new PreviewAutomationDialogPendingError({
            operation: "jevBrowserExecute",
            environmentId,
            threadId: scope("continued").threadId,
            providerSessionId: "continued",
            providerInstanceId: ProviderInstanceId.make("codex"),
            clientId: "host-1",
            connectionId: "connection-1",
            requestId: "dialog-request",
            tabId,
            timeoutMs: 15_000,
            remoteTag: "PreviewAutomationDialogPendingError",
            remoteMessageLength: 80,
            remoteDetailKind: "object",
            cause: {},
            dialog: {
              environmentId,
              tabId,
              runId,
              actionId: BrowserArtifactActionId.make("action-1"),
              dialogId: BrowserDialogId.make("dialog-1"),
              kind: "confirm",
              message: "Private dialog message must not enter run activity",
              openedAt: "2026-09-22T00:00:00.000Z",
            },
          });
        }
        if (request.operation === "jevBrowserCancel") return { cancelled: true } as A;
        throw new Error(`Unexpected operation ${request.operation}`);
      }),
    );

    const result = yield* runWith(
      broker,
      registry,
      "continued",
      { ...task(tabId), resumeFromRunId: "run-before-handoff" },
      activityCommands,
    );

    expect(observeCalls).toBe(1);
    expect(decisionCalls).toBe(1);
    expect(executeCalls).toBe(1);
    expect(result).toMatchObject({
      status: "needs-agent",
      continuedFromRunId: "run-before-handoff",
      billedCostUsd: 0.007,
      handoff: {
        uncertainEffects: [{ iteration: 1, operation: "activate" }],
        outstandingAssertionIndexes: [0],
      },
    });
    expect(result.handoff?.lastConfirmedAction).toBeUndefined();
    const summaries = activityCommands.map(
      (command) => command.activity.payload as BrowserRunSummary,
    );
    expect(summaries.at(-1)).toMatchObject({
      continuedFromRunId: "run-before-handoff",
      status: "needs-agent",
      lastAction: "activate",
      reportedCostUsd: 0.007,
      hasUnknownCost: false,
    });
    expect(summaries.some(({ lastAction }) => lastAction?.includes("Secret page label"))).toBe(
      false,
    );
    expect(
      summaries.some(({ detail, handoffReason }) =>
        [detail, handoffReason].includes("Private dialog message must not enter run activity"),
      ),
    ).toBe(false);
  }).pipe(Effect.provide(TestDependencies)),
);
