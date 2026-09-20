import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { JevRouteRequest, JevRouteResult } from "@t3tools/contracts";
vi.mock("../env", () => ({ isElectron: true }));
import {
  decideWithJev,
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
  it("bounds logs while retaining session totals", async () => {
    useJevStore.getState().setEnabled(true);
    for (let i = 0; i < 55; i++) await decideWithJev({ ...request, requestId: String(i) });
    expect(useJevStore.getState().calls).toHaveLength(50);
    expect(useJevStore.getState().estimatedUsd).toBeCloseTo(55 * result.costUsd!);
    useJevStore.getState().clearCalls();
    expect(useJevStore.getState().calls).toHaveLength(0);
    expect(useJevStore.getState().estimatedUsd).toBeCloseTo(55 * result.costUsd!);
  });
  it("can cancel a request even after its row is pruned from the log", async () => {
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
    expect(useJevStore.getState().calls.some((call) => call.id === request.requestId)).toBe(false);
    useJevStore.getState().setEnabled(false);
    expect(window.desktopBridge?.cancelJevRoute).toHaveBeenCalledWith(request.requestId);
    resolve(result);
    expect(await pending).toBeNull();
  });
  it("sanitizes common credentials and caps prompt size", () => {
    const raw =
      "Authorization: Bearer abcdef123 api_key=secret123 sk-or-abcdefghijk -----BEGIN RSA PRIVATE KEY-----private-----END RSA PRIVATE KEY-----";
    const sanitized = sanitizeJevPrompt(raw);
    for (const secret of ["abcdef123", "secret123", "sk-or-abcdefghijk", "-----BEGIN"])
      expect(sanitized).not.toContain(secret);
    expect(sanitizeJevPrompt("a".repeat(20_000))).toHaveLength(12_000);
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
});
