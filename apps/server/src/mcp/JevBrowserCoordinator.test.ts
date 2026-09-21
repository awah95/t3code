import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  JevBrowserRunConflictError,
  PreviewTabId,
  ProviderInstanceId,
  ThreadId,
  type PreviewAutomationOperation,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import * as CodexLedgerService from "../usage/CodexLedgerService.ts";
import { runJevBrowserTask } from "./JevBrowserCoordinator.ts";
import * as JevBrowserRunRegistry from "./JevBrowserRunRegistry.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as PreviewAutomationBroker from "./PreviewAutomationBroker.ts";

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
) =>
  runJevBrowserTask(input).pipe(
    Effect.provideService(PreviewAutomationBroker.PreviewAutomationBroker, broker),
    Effect.provideService(JevBrowserRunRegistry.JevBrowserRunRegistry, registry),
    Effect.provideService(McpInvocationContext.McpInvocationContext, scope(providerSessionId)),
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
        if (request.operation === "jevBrowserCancel") return { cancelled: true } as A;
        throw new Error(`Unexpected operation ${request.operation}`);
      }),
    );

    const first = yield* runWith(broker, registry, "one", task(tabId));
    const second = yield* runWith(broker, registry, "two", {
      ...task(tabId),
      inputs: [
        {
          id: "destination",
          kind: "url",
          value: "https://destination.test/path",
          description: "Caller-authorized destination",
        },
      ],
    });

    expect(first.status).toBe("failed");
    expect(second.status).toBe("completed");
    expect(operations).toEqual([
      "status",
      "jevBrowserObserve",
      "jevBrowserCancel",
      "status",
      "jevBrowserObserve",
      "jevBrowserCancel",
    ]);
    expect(
      operations.every(
        (operation, index) =>
          operation === "status" || leases[index]?.connectionId === "connection-1",
      ),
    ).toBe(true);
    expect(observedAllowedOrigins[1]).toEqual(["https://example.test", "https://destination.test"]);
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
