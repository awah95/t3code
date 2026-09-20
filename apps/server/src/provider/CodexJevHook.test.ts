import * as NodeVM from "node:vm";
import { describe, expect, it, vi } from "@effect/vitest";
import {
  codexJevHookLaunchArgs,
  codexJevHookTrustWrite,
  codexJevRunnerSource,
  runCodexJevHook,
} from "./CodexJevHook.ts";

const context = {
  endpoint: "http://127.0.0.1:1234/subagent-route",
  token: "ephemeral",
  threadId: "thread",
  providerInstanceId: "codex",
  candidates: [{ key: "model-a", description: "Available model" }],
};
const input = {
  hook_event_name: "PreToolUse",
  tool_name: "spawn_agent",
  tool_use_id: "tool",
  tool_input: {
    message: "Review parser",
    task_name: "review",
    fork_turns: "none",
  },
};
const metadata = {
  key: "/<session-flags>/config.toml:pre_tool_use:0:0",
  sourcePath: "/<session-flags>/config.toml",
  source: "sessionFlags",
  eventName: "preToolUse",
  handlerType: "command",
  command: "node /hook.mjs",
  matcher: "^(spawn_agent|collaborationspawn_agent)$",
  async: false,
  timeoutSec: 10,
  enabled: true,
  isManaged: false,
  currentHash: `sha256:${"a".repeat(64)}`,
};

describe("Codex Jev hook", () => {
  it("trusts only exact generated session hook metadata", () => {
    const list = (hook: unknown) => ({ data: [{ hooks: [hook] }] });
    expect(codexJevHookTrustWrite(list(metadata), metadata.command)?.value).toBe(
      metadata.currentHash,
    );
    for (const change of [
      { command: "other" },
      { source: "user" },
      { matcher: ".*" },
      { async: true },
      { currentHash: "bad" },
      { sourcePath: "/user/config.toml" },
    ]) {
      expect(codexJevHookTrustWrite(list({ ...metadata, ...change }), metadata.command)).toBeNull();
    }
    expect(codexJevHookLaunchArgs('node "a b"')[1]).toContain('command="node \\"a b\\""');
  });
  it("rewrites only model and preserves the delegated task and context mode", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ model: "model-a" }));
    expect(await runCodexJevHook(input, context, fetcher)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: { ...input.tool_input, model: "model-a" },
      },
    });
  });
  it("does not route full-history forks, resumes, invalid inputs or remote brokers", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const args of [
      { ...input.tool_input, fork_turns: "all" },
      { message: "hello" },
      { ...input.tool_input, resume: "agent" },
      { ...input.tool_input, fork_turns: "garbage" },
      { ...input.tool_input, task_name: null },
    ]) {
      expect(await runCodexJevHook({ ...input, tool_input: args }, context, fetcher)).toEqual({});
    }
    expect(
      await runCodexJevHook(
        input,
        { ...context, endpoint: "https://example.com/subagent-route" },
        fetcher,
      ),
    ).toEqual({});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("executes the emitted standalone runner and preserves task arguments", async () => {
    const outputs: string[] = [];
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ enabled: true, candidates: context.candidates }))
      .mockResolvedValueOnce(Response.json({ model: "model-a" }));
    const process = {
      env: {
        T3CODE_JEV_BROKER_URL: context.endpoint,
        T3CODE_JEV_BROKER_TOKEN: context.token,
        T3CODE_JEV_THREAD_ID: context.threadId,
        T3CODE_JEV_PROVIDER_INSTANCE_ID: context.providerInstanceId,
      },
      stdin: (async function* () {
        yield JSON.stringify(input);
      })(),
      stdout: { write: (value: string) => outputs.push(value) },
    };
    await NodeVM.runInNewContext(`(async () => { ${codexJevRunnerSource()} })()`, {
      process,
      fetch: fetcher,
      URL,
      AbortSignal,
    });
    expect(JSON.parse(outputs.join(""))).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: { ...input.tool_input, model: "model-a" },
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("routes exact model and effort pairs", async () => {
    const paired = {
      ...context,
      candidates: [
        { key: "a", description: "Low", model: "model-b", effort: "low" as const },
        { key: "b", description: "High", model: "model-b", effort: "high" as const },
      ],
    };
    const routed = await runCodexJevHook(
      input,
      paired,
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ model: "model-b", effort: "high" })),
    );
    expect(routed).toMatchObject({
      hookSpecificOutput: {
        updatedInput: {
          ...input.tool_input,
          model: "model-b",
          reasoning_effort: "high",
        },
      },
    });
    for (const result of [
      { model: "model-b", effort: "xhigh" },
      { model: "model-b" },
      { model: "model-a", effort: "high" },
    ]) {
      expect(
        await runCodexJevHook(
          input,
          paired,
          vi.fn<typeof fetch>().mockResolvedValue(Response.json(result)),
        ),
      ).toEqual({});
    }
  });
  it("serializes paired routing without runtime imports and retains long prompts", async () => {
    const paired = [{ key: "opaque", description: "High", model: "model-b", effort: "high" }];
    for (const effort of ["high", "xhigh"]) {
      const outputs: string[] = [];
      const longInput = {
        ...input,
        tool_input: {
          ...input.tool_input,
          message: "x".repeat(50000),
        },
      };
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ enabled: true, candidates: paired }))
        .mockResolvedValueOnce(Response.json({ model: "model-b", effort }));
      await NodeVM.runInNewContext(`(async () => { ${codexJevRunnerSource()} })()`, {
        process: {
          env: {
            T3CODE_JEV_BROKER_URL: context.endpoint,
            T3CODE_JEV_BROKER_TOKEN: context.token,
            T3CODE_JEV_THREAD_ID: context.threadId,
            T3CODE_JEV_PROVIDER_INSTANCE_ID: context.providerInstanceId,
          },
          stdin: (async function* () {
            yield JSON.stringify(longInput);
          })(),
          stdout: { write: (value: string) => outputs.push(value) },
        },
        fetch: fetcher,
        URL,
        AbortSignal,
      });
      const result = JSON.parse(outputs.join(""));
      if (effort === "high")
        expect(result.hookSpecificOutput.updatedInput).toEqual({
          ...longInput.tool_input,
          model: "model-b",
          reasoning_effort: "high",
        });
      else expect(result).toEqual({});
      expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).taskPrompt).toHaveLength(50000);
    }
  });
  it("preserves every explicit model or effort without a routing call", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const pair of [
      { model: "gpt-6-astra", reasoning_effort: "xhigh" },
      { model: "gpt-5.6-luna" },
      { reasoning_effort: "high" },
    ]) {
      const original = { ...input, tool_input: { ...input.tool_input, ...pair } };
      const before = JSON.stringify(original);
      expect(await runCodexJevHook(original, context, fetcher)).toEqual({});
      expect(JSON.stringify(original)).toBe(before);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sends inherited context scope and refuses non-route or low confidence results", async () => {
    for (const result of [
      { model: "model-a", policyOutcome: "review" },
      { model: "model-a", policyOutcome: "needs_context" },
      { model: "model-a", policyOutcome: "unavailable" },
      { model: "model-a", confidence: 0.49 },
    ]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(result));
      expect(
        await runCodexJevHook(
          { ...input, tool_input: { ...input.tool_input, fork_turns: "3" } },
          context,
          fetcher,
        ),
      ).toEqual({});
      expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
        forkTurns: "3",
        taskPrompt: input.tool_input.message,
      });
    }
  });
  it("falls back on unavailable, invalid or failed decisions", async () => {
    for (const response of [
      Response.json({ model: "not-available" }),
      Response.json({ model: null }),
      new Response("", { status: 500 }),
    ]) {
      expect(
        await runCodexJevHook(input, context, vi.fn<typeof fetch>().mockResolvedValue(response)),
      ).toEqual({});
    }
    expect(
      await runCodexJevHook(
        input,
        context,
        vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
      ),
    ).toEqual({});
  });
});
