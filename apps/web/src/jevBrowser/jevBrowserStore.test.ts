import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  JEV_BROWSER_HISTORY_LIMIT,
  getJevBrowserExecutionMode,
  resetJevBrowserStoreForTests,
  subscribeJevBrowserExecutionMode,
  useJevBrowserStore,
} from "./jevBrowserStore";

const first: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment-one"),
  threadId: ThreadId.make("thread-one"),
};
const secondThread: ScopedThreadRef = {
  environmentId: first.environmentId,
  threadId: ThreadId.make("thread-two"),
};
const secondEnvironment: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment-two"),
  threadId: first.threadId,
};

describe("Jev browser scoped execution mode", () => {
  beforeEach(resetJevBrowserStoreForTests);

  it("defaults off and scopes the mode by both environment and thread", () => {
    expect(getJevBrowserExecutionMode(first)).toBe("disabled");
    useJevBrowserStore.getState().enable(first);

    expect(getJevBrowserExecutionMode(first)).toBe("idle");
    expect(getJevBrowserExecutionMode(secondThread)).toBe("disabled");
    expect(getJevBrowserExecutionMode(secondEnvironment)).toBe("disabled");
  });

  it("notifies mode subscribers only when their scope changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeJevBrowserExecutionMode(first, listener);

    useJevBrowserStore.getState().enable(secondThread);
    useJevBrowserStore.getState().enable(first);
    useJevBrowserStore.getState().setNotice(first, "No mode change");
    useJevBrowserStore.getState().disable(first);
    unsubscribe();

    expect(listener.mock.calls).toEqual([["idle"], ["disabled"]]);
  });
});

describe("Jev browser cancellation and history", () => {
  beforeEach(resetJevBrowserStoreForTests);

  it("refuses work while off and aborts pending work when turned off", () => {
    expect(
      useJevBrowserStore.getState().begin(first, {
        id: "ignored",
        runId: "run-ignored",
        label: "Ignored",
        startedAt: "2026-09-21T10:00:00Z",
      }),
    ).toBeNull();

    useJevBrowserStore.getState().enable(first);
    const signal = useJevBrowserStore.getState().begin(first, {
      id: "pending",
      runId: "run-pending",
      label: "Click submit",
      startedAt: "2026-09-21T10:00:00Z",
    });
    expect(signal?.aborted).toBe(false);

    useJevBrowserStore.getState().disable(first);

    expect(signal?.aborted).toBe(true);
    expect(
      useJevBrowserStore.getState().byScope["environment-one:thread-one"]?.history[0],
    ).toMatchObject({ id: "pending", status: "cancelled", cost: { kind: "none" } });
  });

  it("stops only disconnected environment runs without disabling its opt-in", () => {
    const store = useJevBrowserStore.getState();
    store.enable(first);
    store.enable(secondThread);
    store.enable(secondEnvironment);
    const firstSignal = store.begin(first, {
      id: "first-pending",
      runId: "first-run",
      label: "First environment",
      startedAt: "2026-09-21T10:00:00Z",
    });
    const secondThreadSignal = store.begin(secondThread, {
      id: "second-thread-pending",
      runId: "second-thread-run",
      label: "Second thread",
      startedAt: "2026-09-21T10:00:00Z",
    });
    const otherEnvironmentSignal = store.begin(secondEnvironment, {
      id: "other-environment-pending",
      runId: "other-environment-run",
      label: "Other environment",
      startedAt: "2026-09-21T10:00:00Z",
    });

    expect(store.cancelEnvironmentRuns(first.environmentId)).toEqual([
      "first-run",
      "second-thread-run",
    ]);

    expect(firstSignal?.aborted).toBe(true);
    expect(secondThreadSignal?.aborted).toBe(true);
    expect(otherEnvironmentSignal?.aborted).toBe(false);
    expect(getJevBrowserExecutionMode(first)).toBe("idle");
    expect(getJevBrowserExecutionMode(secondThread)).toBe("idle");
    expect(getJevBrowserExecutionMode(secondEnvironment)).toBe("running");
    expect(useJevBrowserStore.getState().byScope["environment-one:thread-one"]).toMatchObject({
      enabled: true,
      activeRunIds: [],
      notice: "Stopped because the environment host disconnected.",
      history: [{ id: "first-pending", status: "cancelled" }],
    });
    expect(useJevBrowserStore.getState().byScope["environment-two:thread-one"]).toMatchObject({
      enabled: true,
      activeRunIds: ["other-environment-run"],
      history: [{ id: "other-environment-pending", status: "pending" }],
    });
  });

  it("keeps receipt history bounded and separates reported from unknown cost", () => {
    const store = useJevBrowserStore.getState();
    for (let index = 0; index < JEV_BROWSER_HISTORY_LIMIT + 5; index += 1) {
      store.record(first, {
        id: `receipt-${index}`,
        runId: `run-${index}`,
        label: `Action ${index}`,
        startedAt: `2026-09-21T10:00:${String(index).padStart(2, "0")}Z`,
        completedAt: `2026-09-21T10:01:${String(index).padStart(2, "0")}Z`,
        status: "succeeded",
        cost: index % 2 === 0 ? { kind: "reported", usd: 0.001 } : { kind: "unknown" },
      });
    }

    const history = useJevBrowserStore.getState().byScope["environment-one:thread-one"]?.history;
    expect(history).toHaveLength(JEV_BROWSER_HISTORY_LIMIT);
    expect(history?.at(0)?.id).toBe(`receipt-${JEV_BROWSER_HISTORY_LIMIT + 4}`);
    expect(history?.at(-1)?.id).toBe("receipt-5");
    expect(history?.some((entry) => entry.cost.kind === "reported")).toBe(true);
    expect(history?.some((entry) => entry.cost.kind === "unknown")).toBe(true);
  });
});
