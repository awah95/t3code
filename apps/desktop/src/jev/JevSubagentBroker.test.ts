// @effect-diagnostics globalFetch:off
// Exercise the real loopback HTTP boundary without an external network service.
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { JevRouteResult, JevSubagentPolicy } from "@t3tools/contracts";
import { createJevSubagentBroker } from "./JevSubagentBroker.ts";

const success: JevRouteResult = {
  choice: "c1",
  confidence: 0.9,
  probabilities: { c0: 0.1, c1: 0.9 },
  latencyMs: 15,
  error: null,
  inputTokens: 100,
  outputTokens: 10,
  costUsd: 0.0000042,
  costKind: "estimated",
};
const policy: JevSubagentPolicy = {
  threadId: "thread",
  providerInstanceId: "codex-local",
  enabled: true,
  candidates: [
    { key: "gpt-fast", description: "Fast" },
    { key: "gpt-strong", description: "Strong" },
  ],
};
const brokers: Array<Awaited<ReturnType<typeof createJevSubagentBroker>>> = [];
afterEach(async () => {
  await Promise.all(brokers.splice(0).map((broker) => broker.close()));
});
async function setup(decide = vi.fn().mockResolvedValue(success)) {
  const onDecision = vi.fn();
  const cancel = vi.fn();
  const broker = await createJevSubagentBroker({ decide, cancel, onDecision });
  brokers.push(broker);
  const post = (body: unknown, path = "/subagent-route", authenticated = true) =>
    fetch(new URL(path, broker.url), {
      method: "POST",
      headers: {
        Authorization: authenticated ? `Bearer ${broker.token}` : "Bearer wrong",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  return { broker, decide, cancel, onDecision, post };
}

describe("desktop Codex subagent routing broker", () => {
  it("requires broker authentication and a matching opt-in thread", async () => {
    const { post, decide, broker } = await setup();
    const body = {
      threadId: "thread",
      providerInstanceId: "codex-local",
      taskPrompt: "Review code",
    };
    expect((await post(body, "/subagent-route", false)).status).toBe(401);
    expect(await (await post(body)).json()).toEqual({ model: null });
    broker.setPolicy(policy);
    expect(await (await post({ ...body, providerInstanceId: "other" })).json()).toEqual({
      model: null,
    });
    expect(decide).not.toHaveBeenCalled();
  });
  it("uses only the registered model pool and records request plus cost result", async () => {
    const { broker, post, decide, onDecision } = await setup();
    broker.setPolicy(policy);
    expect(
      await (
        await post({
          threadId: "thread",
          providerInstanceId: "codex-local",
          taskPrompt: "Review code",
          candidates: [{ key: "unconfigured", description: "Injected" }],
        })
      ).json(),
    ).toEqual({ model: "gpt-strong" });
    expect(decide.mock.calls[0]?.[0].candidates).toEqual([
      { key: "c0", description: "gpt-fast: Fast" },
      { key: "c1", description: "gpt-strong: Strong" },
    ]);
    expect(onDecision).toHaveBeenCalledTimes(2);
    expect(onDecision.mock.calls[1]?.[0].result.costUsd).toBe(success.costUsd);
  });
  it("disabling during a call cancels the selection but retains charged usage", async () => {
    let finish!: (result: JevRouteResult) => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const decide = vi.fn(
      () =>
        new Promise<JevRouteResult>((resolve) => {
          finish = resolve;
          started();
        }),
    );
    const { broker, post, cancel, onDecision } = await setup(decide);
    broker.setPolicy(policy);
    const response = post({
      threadId: "thread",
      providerInstanceId: "codex-local",
      taskPrompt: "Review code",
    });
    await startedPromise;
    broker.setPolicy({ ...policy, enabled: false });
    finish(success);
    expect(await (await response).json()).toEqual({ model: null });
    expect(cancel).toHaveBeenCalled();
    expect(onDecision.mock.calls.at(-1)?.[0].result).toMatchObject({
      choice: null,
      costUsd: success.costUsd,
      costKind: "estimated",
    });
  });
  it("returns an authoritative pair and preserves long redacted subtask context", async () => {
    const { broker, post, decide } = await setup();
    broker.setPolicy({
      ...policy,
      candidates: [
        { key: "pair-low", model: "gpt-5.6-sol", effort: "low", description: "Low" },
        { key: "pair-high", model: "gpt-5.6-sol", effort: "high", description: "High" },
      ],
      context: {
        existingSession: true,
        hasAttachments: false,
        interactionMode: "default",
        originalTask: "token=secret-value Parent task",
        history: [{ role: "user", text: "Parent context" }],
        failure: { unresolved: true, signals: ["failed"], model: "gpt-5.6-sol", effort: "xhigh" },
      },
    });
    expect(
      await (
        await post({
          threadId: "thread",
          providerInstanceId: "codex-local",
          taskPrompt: "a".repeat(20000) + " password=hidden",
        })
      ).json(),
    ).toEqual({ model: "gpt-5.6-sol", effort: "high" });
    const request = decide.mock.calls[0]?.[0];
    expect(request.prompt).toBe("a".repeat(20000) + " password=[redacted]");
    expect(request.context.originalTask).toBe(request.prompt);
    expect(request.context.history).toBeUndefined();
    expect(request.context.currentModel).toBeUndefined();
    expect(request.context.target).toEqual({
      kind: "independent_child",
      inheritedContext: "bounded",
    });
    expect(request.context.missingContext).toHaveLength(1);
    expect(request.context.failure).toBeUndefined();
  });
  it("context-only updates preserve pending selections and accounting", async () => {
    let finish!: (result: JevRouteResult) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const { broker, post, cancel, onDecision } = await setup(
      vi.fn(
        () =>
          new Promise<JevRouteResult>((resolve) => {
            finish = resolve;
            started();
          }),
      ),
    );
    broker.setPolicy(policy);
    const response = post({
      threadId: "thread",
      providerInstanceId: "codex-local",
      taskPrompt: "Review",
    });
    await ready;
    broker.setPolicy({
      ...policy,
      context: {
        existingSession: true,
        hasAttachments: false,
        interactionMode: "default",
        originalTask: "Updated parent context",
      },
    });
    finish(success);
    expect(await (await response).json()).toEqual({ model: "gpt-strong" });
    expect(cancel).not.toHaveBeenCalled();
    expect(onDecision.mock.calls.at(-1)?.[0].result.costUsd).toBe(success.costUsd);
  });
  it("pool changes cancel in-flight selections and keep their usage", async () => {
    let finish!: (result: JevRouteResult) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const { broker, post, cancel, onDecision } = await setup(
      vi.fn(
        () =>
          new Promise<JevRouteResult>((resolve) => {
            finish = resolve;
            started();
          }),
      ),
    );
    broker.setPolicy(policy);
    const response = post({
      threadId: "thread",
      providerInstanceId: "codex-local",
      taskPrompt: "Review",
    });
    await ready;
    broker.setPolicy({ ...policy, candidates: [policy.candidates[0]!] });
    finish(success);
    expect(await (await response).json()).toEqual({ model: null });
    expect(cancel).toHaveBeenCalled();
    expect(onDecision.mock.calls.at(-1)?.[0].result).toMatchObject({
      choice: null,
      costUsd: success.costUsd,
    });
  });
  it("does not mix an oversized parent snapshot into a standalone child", async () => {
    const { broker, post, decide } = await setup();
    broker.setPolicy({
      ...policy,
      context: {
        existingSession: true,
        hasAttachments: true,
        interactionMode: "default",
        originalTask: "x".repeat(240000),
        currentModel: "gpt-6-astra",
        failure: { unresolved: true, signals: ["failed"], model: "gpt-6-astra", effort: "xhigh" },
      },
    });
    expect(
      await (
        await post({
          threadId: "thread",
          providerInstanceId: "codex-local",
          taskPrompt: "Review parser",
          forkTurns: "none",
        })
      ).json(),
    ).toEqual({ model: "gpt-strong" });
    expect(decide.mock.calls[0]?.[0].context).toMatchObject({
      originalTask: "Review parser",
      target: { kind: "independent_child", inheritedContext: "none" },
      historyCompleteness: "complete",
      selectionSource: "agent_default",
      hasAttachments: false,
    });
    expect(decide.mock.calls[0]?.[0].context.missingContext).toBeUndefined();
    expect(decide.mock.calls[0]?.[0].context.failure).toBeUndefined();
    expect(decide.mock.calls[0]?.[0].context.currentModel).toBeUndefined();
  });
  it("preserves explicit proposed selections and rejects full forks at the broker boundary", async () => {
    const { broker, post, decide } = await setup();
    broker.setPolicy(policy);
    for (const proposal of [
      { proposedModel: "gpt-6-astra", proposedEffort: "xhigh" },
      { proposedModel: "gpt-5.6-luna" },
      { proposedEffort: "high" },
      { forkTurns: "all" },
    ]) {
      expect(
        await (
          await post({
            threadId: "thread",
            providerInstanceId: "codex-local",
            taskPrompt: "Review",
            ...proposal,
          })
        ).json(),
      ).toEqual({ model: null });
    }
    expect(decide).not.toHaveBeenCalled();
  });
  it("does not apply non-route, low-confidence or errored choices and preserves accounting", async () => {
    for (const change of [
      { policyOutcome: "review" },
      { policyOutcome: "needs_context" },
      { policyOutcome: "unavailable" },
      { confidence: 0.49 },
      { confidence: 0.9, decisionStable: false },
      { confidence: 0.01, decisionStable: true, policyOutcome: undefined },
      { admissibleCandidateKeys: ["c0"] },
      { error: "Incomplete response" },
    ]) {
      const { broker, post, onDecision } = await setup(
        vi.fn().mockResolvedValue({ ...success, ...change }),
      );
      broker.setPolicy(policy);
      expect(
        await (
          await post({
            threadId: "thread",
            providerInstanceId: "codex-local",
            taskPrompt: "Review",
          })
        ).json(),
      ).toEqual({ model: null });
      expect(onDecision.mock.calls.at(-1)?.[0].result).toMatchObject({
        choice: null,
        costUsd: success.costUsd,
      });
    }
  });
  it("uses a stable route despite low nonbinding classifier confidence", async () => {
    const { broker, post } = await setup(
      vi.fn().mockResolvedValue({
        ...success,
        policyOutcome: "route",
        confidence: 0.31,
        decisionStable: true,
      }),
    );
    broker.setPolicy(policy);
    expect(
      await (
        await post({
          threadId: "thread",
          providerInstanceId: "codex-local",
          taskPrompt: "Known edit",
        })
      ).json(),
    ).toMatchObject({
      model: "gpt-strong",
    });
  });
  it("reports opt-in state without making Jev calls", async () => {
    const { broker, post, decide } = await setup();
    broker.setPolicy(policy);
    expect(
      await (
        await post({ threadId: "thread", providerInstanceId: "codex-local" }, "/subagent-policy")
      ).json(),
    ).toEqual({ enabled: true, candidates: policy.candidates });
    expect(decide).not.toHaveBeenCalled();
  });
  it("shows local hook setup failures without charging or making Jev calls", async () => {
    const { broker, post, decide, onDecision } = await setup();
    const status = {
      threadId: "thread",
      providerInstanceId: "codex-local",
      error: "Hook activation deferred while a child is running.",
    };
    await post(status, "/subagent-status");
    expect(onDecision).not.toHaveBeenCalled();
    broker.setPolicy(policy);
    expect((await post(status, "/subagent-status")).status).toBe(200);
    expect(onDecision.mock.calls[0]?.[0]).toMatchObject({
      request: { context: { interactionMode: "subagent-status" } },
      result: { choice: null, error: status.error, costUsd: 0 },
    });
    expect(decide).not.toHaveBeenCalled();
  });
});
