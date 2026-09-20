import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { JevRouteRequest, JevRouteResult } from "@t3tools/contracts";
vi.mock("../env", () => ({ isElectron: true }));
import {
  decideWithJev,
  jevPriorAttempts,
  registerJevSubagentPolicy,
  sanitizeJevPrompt,
  useJevStore,
} from "./jevStore";

const request: JevRouteRequest = {
  requestId: "test",
  prompt: "Fix a bug",
  candidates: [{ key: "one", description: "Codex" }],
  context: { existingSession: false, hasAttachments: false, interactionMode: "default" },
};
const result: JevRouteResult = {
  choice: "one",
  confidence: 0.9,
  probabilities: { one: 1 },
  latencyMs: 20,
  error: null,
  inputTokens: 10,
  outputTokens: 1,
  costUsd: 0.000001,
  costKind: "estimated",
};

describe("Jev desktop routing lifecycle", () => {
  beforeEach(() => {
    useJevStore.setState({
      enabled: false,
      mode: "auto",
      calls: [],
      revision: 0,
      notice: null,
      billedUsd: 0,
      estimatedUsd: 0,
      unknownCostCalls: 0,
    });
    vi.stubGlobal("window", {
      desktopBridge: {
        decideJevRoute: vi.fn().mockResolvedValue(result),
        cancelJevRoute: vi.fn().mockResolvedValue(undefined),
      },
    });
  });
  it("makes no routing call while off", async () => {
    expect(await decideWithJev(request)).toBeNull();
    expect(window.desktopBridge?.decideJevRoute).not.toHaveBeenCalled();
    expect(useJevStore.getState().calls).toHaveLength(0);
  });
  it("pins manual selection until Auto is explicitly enabled", async () => {
    useJevStore.getState().setEnabled(true);
    useJevStore.getState().pinManual();
    await decideWithJev(request);
    expect(window.desktopBridge?.decideJevRoute).not.toHaveBeenCalled();
    useJevStore.getState().setEnabled(true);
    expect((await decideWithJev(request))?.choice).toBe("one");
  });
  it("discards an in-flight decision after Auto is disabled and still accounts its cost", async () => {
    let resolve!: (value: JevRouteResult) => void;
    vi.mocked(window.desktopBridge!.decideJevRoute!).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    useJevStore.getState().setEnabled(true);
    const pending = decideWithJev(request);
    useJevStore.getState().clearCalls();
    useJevStore.getState().setEnabled(false);
    expect(window.desktopBridge?.cancelJevRoute).toHaveBeenCalledWith("test");
    resolve(result);
    expect(await pending).toBeNull();
    expect(useJevStore.getState().calls[0]?.status).toBe("cancelled");
    expect(useJevStore.getState().estimatedUsd).toBe(result.costUsd);
  });
  it("persists a billed route once without prompt text", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      get length() {
        return storage.size;
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    useJevStore.getState().setEnabled(true);
    vi.mocked(window.desktopBridge!.decideJevRoute!).mockResolvedValue({
      ...result,
      costKind: "billed",
      evaluationPayload: "private evaluation",
    });
    await decideWithJev(
      { ...request, prompt: "secret task" },
      { environmentId: "env", projectId: "project", threadId: "thread" },
    );
    expect(window.desktopBridge?.decideJevRoute).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "test" }),
      { environmentId: "env", projectId: "project", threadId: "thread", sourceScope: "turn" },
    );
    useJevStore.getState().finishCall(request.requestId, { ...result, costKind: "billed" });
    expect(useJevStore.getState().billedUsd).toBe(result.costUsd);
    const persisted = [...storage.values()].join("");
    expect(persisted).toContain('"reportedCostUsd":"0.000001"');
    expect(persisted).not.toContain("secret task");
    expect(persisted).not.toContain("private evaluation");
  });
  it("retains the exact message identity before sending and records the later dispatch outcome", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      get length() {
        return storage.size;
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    useJevStore.getState().setEnabled(true);
    await decideWithJev(
      { ...request, prompt: "private message" },
      { environmentId: "env", projectId: "project", threadId: "thread" },
    );
    expect(
      useJevStore.getState().recordPreparedDispatch(request.requestId, {
        model: "gpt-5.6-sol",
        threadId: "thread",
        messageId: "message-before-send",
        environmentId: "env",
        projectId: "project",
        succeeded: null,
      }),
    ).toBe(true);
    const prepared = JSON.parse([...storage.values()][0]!) as {
      input: { messageId: string; status: string; dispatchJson: string };
    };
    expect(prepared.input).toMatchObject({ messageId: "message-before-send", status: "completed" });
    expect(JSON.parse(prepared.input.dispatchJson)).toMatchObject({ accepted: null });
    expect(JSON.stringify(prepared)).not.toContain("private message");

    useJevStore.getState().recordDispatch(request.requestId, {
      model: "gpt-5.6-sol",
      threadId: "thread",
      messageId: "message-before-send",
      environmentId: "env",
      projectId: "project",
      succeeded: true,
    });
    const dispatched = JSON.parse([...storage.values()][0]!) as {
      input: { messageId: string; status: string; dispatchJson: string };
    };
    expect(dispatched.input).toMatchObject({
      messageId: "message-before-send",
      status: "dispatched",
    });
    expect(JSON.parse(dispatched.input.dispatchJson)).toMatchObject({ accepted: true });
  });
  it("bounds logs while retaining session totals", async () => {
    useJevStore.getState().setEnabled(true);
    for (let i = 0; i < 55; i++) await decideWithJev({ ...request, requestId: String(i) });
    expect(useJevStore.getState().calls).toHaveLength(50);
    expect(useJevStore.getState().estimatedUsd).toBeCloseTo(55 * result.costUsd!);
    useJevStore.getState().clearCalls();
    expect(useJevStore.getState().calls).toHaveLength(0);
    expect(useJevStore.getState().estimatedUsd).toBeCloseTo(55 * result.costUsd!);
  });
  it("retains a pending request when completed history exceeds the log limit", async () => {
    let resolve!: (value: JevRouteResult) => void;
    vi.mocked(window.desktopBridge!.decideJevRoute!).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    useJevStore.getState().setEnabled(true);
    const pending = decideWithJev(request);
    for (let i = 0; i < 55; i++)
      useJevStore.getState().addCall({
        id: `other-${i}`,
        createdAt: "2026-09-20T00:00:00.000Z",
        request: { ...request, requestId: `other-${i}` },
        result,
        status: "routed",
        notice: null,
      });
    expect(useJevStore.getState().calls.some((call) => call.id === request.requestId)).toBe(true);
    useJevStore.getState().setEnabled(false);
    expect(window.desktopBridge?.cancelJevRoute).toHaveBeenCalledWith(request.requestId);
    resolve(result);
    expect(await pending).toBeNull();
  });
  it("pauses automatic sending for every nonroute policy outcome even if a choice exists", async () => {
    useJevStore.getState().setEnabled(true);
    for (const policyOutcome of ["review", "needs_context", "unavailable"] as const) {
      vi.mocked(window.desktopBridge!.decideJevRoute!).mockResolvedValue({
        ...result,
        policyOutcome,
      });
      const awaitingReview = new Promise<void>((resolve) => {
        const unsubscribe = useJevStore.subscribe((state) => {
          if (
            state.calls.some(
              (call) => call.id === policyOutcome && call.status === "awaiting-review",
            )
          ) {
            unsubscribe();
            resolve();
          }
        });
      });
      const pending = decideWithJev({ ...request, requestId: policyOutcome });
      await awaitingReview;
      expect(useJevStore.getState().panelOpen).toBe(true);
      expect(useJevStore.getState().calls[0]?.dispatch).toBeUndefined();
      useJevStore.getState().resolveReview(policyOutcome, "current");
      expect((await pending)?.choice).toBeNull();
      expect(useJevStore.getState().calls[0]?.decision).toBe("current");
    }
  });
  it("records routing as a proposal until executor dispatch is acknowledged", async () => {
    useJevStore.getState().setEnabled(true);
    await decideWithJev(request);
    expect(useJevStore.getState().calls[0]?.status).toBe("approved");
    useJevStore.getState().recordDispatch(request.requestId, {
      model: "gpt-5.6-sol",
      effort: "high",
      threadId: "thread",
      succeeded: false,
    });
    expect(useJevStore.getState().calls[0]?.status).toBe("dispatch-failed");
    useJevStore.getState().recordDispatch(request.requestId, {
      model: "gpt-5.6-sol",
      effort: "high",
      threadId: "thread",
      succeeded: true,
    });
    expect(useJevStore.getState().calls[0]?.status).toBe("routed");
  });
  it("recovers an actual pair only from the same thread and acknowledged message turn", async () => {
    useJevStore.getState().setEnabled(true);
    await decideWithJev(request);
    const dispatch = {
      model: "gpt-5.6-terra",
      effort: "medium",
      threadId: "thread",
      messageId: "sent-message",
      succeeded: true,
    };
    useJevStore.getState().recordDispatch(request.requestId, dispatch);
    expect(jevPriorAttempts("other-thread", [{ id: "sent-message", turnId: "turn" }])).toEqual([]);
    expect(jevPriorAttempts("thread", [{ id: "other-message", turnId: "turn" }])).toEqual([]);
    expect(jevPriorAttempts("thread", [{ id: "sent-message", turnId: null }])).toEqual([]);
    expect(jevPriorAttempts("thread", [{ id: "sent-message", turnId: "turn" }])).toEqual([
      { turnId: "turn", model: "gpt-5.6-terra", effort: "medium", outcome: "dispatch_accepted" },
    ]);
    useJevStore.getState().recordDispatch(request.requestId, { ...dispatch, succeeded: false });
    expect(jevPriorAttempts("thread", [{ id: "sent-message", turnId: "turn" }])).toEqual([]);
  });
  it("sanitizes common credentials without truncating current prompts", () => {
    const raw =
      "Authorization: Bearer abcdef123 api_key=secret123 sk-or-abcdefghijk -----BEGIN RSA PRIVATE KEY-----private-----END RSA PRIVATE KEY-----";
    const sanitized = sanitizeJevPrompt(raw);
    for (const secret of ["abcdef123", "secret123", "sk-or-abcdefghijk", "-----BEGIN"])
      expect(sanitized).not.toContain(secret);
    expect(sanitizeJevPrompt("a".repeat(20_000))).toHaveLength(20_000);
  });
  it("disables every registered thread policy when Auto is turned off", async () => {
    let resolveDisabled!: () => void;
    const disabled = new Promise<void>((resolve) => {
      resolveDisabled = resolve;
    });
    const setPolicy = vi.fn().mockImplementation(async (policy) => {
      if (policy.threadId === "thread-two" && !policy.enabled) resolveDisabled();
    });
    window.desktopBridge!.setJevSubagentPolicy = setPolicy;
    useJevStore.getState().setEnabled(true);
    useJevStore.getState().setSubagentsEnabled(true);
    for (const threadId of ["thread-one", "thread-two"])
      await registerJevSubagentPolicy({
        threadId,
        providerInstanceId: "codex",
        enabled: true,
        candidates: [{ key: "gpt-5.4", description: "Codex GPT-5.4" }],
      });
    useJevStore.getState().setEnabled(false);
    await disabled;
    expect(
      setPolicy.mock.calls
        .slice(-2)
        .map(([policy]) => ({ threadId: policy.threadId, enabled: policy.enabled })),
    ).toEqual([
      { threadId: "thread-one", enabled: false },
      { threadId: "thread-two", enabled: false },
    ]);
  });
  it("finishes startup clearing before registering newly enabled policies", async () => {
    vi.resetModules();
    const isolated = await import("./jevStore");
    let resolveStartup!: () => void;
    const startup = new Promise<void>((resolve) => {
      resolveStartup = resolve;
    });
    const calls: string[] = [];
    window.desktopBridge!.clearJevSubagentPolicies = vi.fn(() => {
      calls.push("clear");
      return startup;
    });
    window.desktopBridge!.setJevSubagentPolicy = vi.fn(async () => {
      calls.push("set");
    });
    isolated.listenForJevSubagents();
    isolated.useJevStore.getState().setEnabled(true);
    isolated.useJevStore.getState().setSubagentsEnabled(true);
    const registration = isolated.registerJevSubagentPolicy({
      threadId: "startup-thread",
      providerInstanceId: "codex",
      enabled: true,
      candidates: [{ key: "gpt-5.4", description: "Codex GPT-5.4" }],
    });
    await Promise.resolve();
    expect(calls).toEqual(["clear"]);
    resolveStartup();
    await registration;
    expect(calls).toEqual(["clear", "set"]);
  });
  it("replays a desktop subagent receipt after restart without a live thread policy", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      get length() {
        return storage.size;
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.resetModules();
    const isolated = await import("./jevStore");
    window.desktopBridge!.clearJevSubagentPolicies = vi.fn().mockResolvedValue(undefined);
    window.desktopBridge!.onJevSubagentDecision = vi.fn();
    window.desktopBridge!.listJevSubagentReceipts = vi.fn().mockResolvedValue([
      {
        threadId: "closed-thread",
        providerInstanceId: "codex",
        toolUseId: "tool-42",
        attemptId: "tool-42",
        ledgerContext: {
          environmentId: "env",
          projectId: "project",
          threadId: "closed-thread",
          sourceScope: "subagent",
        },
        request: { ...request, requestId: "replayed", prompt: "" },
        result: { ...result, costKind: "billed" },
      },
    ]);
    isolated.listenForJevSubagents();
    await vi.waitFor(() => expect(storage.size).toBe(1));
    const persisted = JSON.parse([...storage.values()][0]!) as {
      input: { threadId: string; toolUseId: string; reportedCostUsd: string };
    };
    expect(persisted.input).toMatchObject({
      threadId: "closed-thread",
      toolUseId: "tool-42",
      reportedCostUsd: "0.000001",
    });
    expect(isolated.useJevStore.getState().enabled).toBe(false);
  });
  it("queues a closed thread storage gap with unknown cost and no invented route", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      get length() {
        return storage.size;
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.resetModules();
    const isolated = await import("./jevStore");
    window.desktopBridge!.clearJevSubagentPolicies = vi.fn().mockResolvedValue(undefined);
    window.desktopBridge!.onJevSubagentDecision = vi.fn();
    window.desktopBridge!.listJevSubagentReceipts = vi.fn().mockResolvedValue([
      {
        threadId: "closed-thread",
        providerInstanceId: "codex",
        receiptStorageError: true,
        ledgerContext: {
          environmentId: "env",
          projectId: "project",
          threadId: "closed-thread",
          sourceScope: "subagent",
        },
        request: { ...request, requestId: "jev-storage-gap:unique", prompt: "" },
        result: null,
      },
    ]);
    isolated.listenForJevSubagents();
    await vi.waitFor(() => expect(storage.size).toBe(1));
    const queued = JSON.parse([...storage.values()][0]!) as {
      input: {
        requestId: string;
        attemptId: string;
        environmentId: string;
        projectId: string;
        threadId: string;
        status: string;
        receiptStorageError: boolean;
        decisionJson: string;
        reportedCostUsd: string | null;
        estimatedCostUsd: string | null;
      };
    };
    expect(queued.input).toMatchObject({
      requestId: "jev-storage-gap:unique",
      attemptId: "jev-storage-gap:unique",
      environmentId: "env",
      projectId: "project",
      threadId: "closed-thread",
      status: "proposed",
      receiptStorageError: true,
      reportedCostUsd: null,
      estimatedCostUsd: null,
    });
    expect(JSON.parse(queued.input.decisionJson)).toMatchObject({
      appliedChoice: null,
      costKind: "unknown",
    });
    expect(isolated.useJevStore.getState().calls).toEqual([]);
    isolated.listenForJevSubagents();
    expect(storage.size).toBe(1);
  });
});

describe("guided review", () => {
  beforeEach(() => {
    useJevStore.getState().cancelPending();
    useJevStore.setState({
      enabled: true,
      mode: "guided",
      calls: [],
      revision: 0,
      billedUsd: 0,
      estimatedUsd: 0,
      unknownCostCalls: 0,
    });
    vi.stubGlobal("window", {
      desktopBridge: {
        decideJevRoute: vi.fn().mockResolvedValue({
          ...result,
          choice: null,
          recommendedChoice: "one",
          confidence: 0.37,
        }),
        cancelJevRoute: vi.fn(),
      },
    });
  });
  const reviewed = () =>
    new Promise<void>((resolve) => {
      const unsubscribe = useJevStore.subscribe((state) => {
        if (state.calls.some((call) => call.status === "awaiting-review")) {
          unsubscribe();
          resolve();
        }
      });
    });
  it("waits for explicit approval, retains recommendation and bills once", async () => {
    const waiting = reviewed();
    let completed = false;
    const pending = decideWithJev(request).then((value) => {
      completed = true;
      return value;
    });
    await waiting;
    expect(completed).toBe(false);
    useJevStore.getState().clearCalls();
    expect(useJevStore.getState().calls).toHaveLength(1);
    useJevStore.getState().resolveReview("test", "suggestion");
    expect(await pending).toMatchObject({ choice: "one", confidence: 0.37 });
    expect(useJevStore.getState().calls[0]).toMatchObject({
      decision: "suggestion",
      result: { recommendedChoice: "one", choice: null },
    });
    expect(useJevStore.getState().estimatedUsd).toBe(result.costUsd);
  });
  it("keeps guided approval reachable after fifty newer log entries", async () => {
    let finish!: (value: JevRouteResult) => void;
    vi.mocked(window.desktopBridge!.decideJevRoute!).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const waiting = reviewed();
    const pending = decideWithJev(request);
    for (let index = 0; index < 55; index++)
      useJevStore.getState().addCall({
        id: `newer-${index}`,
        createdAt: "2026-09-20T00:00:00Z",
        request,
        result,
        status: "routed",
        notice: null,
      });
    finish({ ...result, recommendedChoice: "one" });
    await waiting;
    useJevStore.getState().resolveReview("test", "suggestion");
    expect((await pending)?.choice).toBe("one");
  });
  it("lets the user retain the original selection", async () => {
    const waiting = reviewed();
    const pending = decideWithJev(request);
    await waiting;
    useJevStore.getState().resolveReview("test", "current");
    expect((await pending)?.choice).toBeNull();
    expect(useJevStore.getState().calls[0]?.decision).toBe("current");
  });
  it("rejects inadmissible suggestions but accepts an explicit alternative override", async () => {
    vi.mocked(window.desktopBridge!.decideJevRoute!).mockResolvedValue({
      ...result,
      recommendedChoice: "one",
      admissibleCandidateKeys: [],
      policyOutcome: "review",
    });
    const waiting = reviewed();
    const pending = decideWithJev(request);
    await waiting;
    useJevStore.getState().resolveReview("test", "suggestion");
    expect(useJevStore.getState().calls[0]?.status).toBe("awaiting-review");
    useJevStore.getState().resolveReview("test", "alternative", "one");
    expect((await pending)?.choice).toBe("one");
    expect(useJevStore.getState().calls[0]?.notice).toContain("user bypasses routing policy");
  });
  it("cancels a waiting review on mode change without dispatching", async () => {
    const waiting = reviewed();
    const pending = decideWithJev(request);
    await waiting;
    useJevStore.getState().setMode("auto");
    expect(await pending).toBeNull();
    expect(useJevStore.getState().calls[0]?.status).toBe("cancelled");
  });
  it("ignores out-of-pool approvals and accepts an explicit compatible alternative", async () => {
    const waiting = reviewed();
    const pending = decideWithJev({
      ...request,
      candidates: [...request.candidates, { key: "two", description: "Alternative" }],
    });
    await waiting;
    useJevStore.getState().resolveReview("test", "alternative", "injected");
    expect(useJevStore.getState().calls[0]?.status).toBe("awaiting-review");
    useJevStore.getState().resolveReview("test", "alternative", "two");
    expect((await pending)?.choice).toBe("two");
  });
});
