// @effect-diagnostics globalFetch:off
import * as Predicate from "effect/Predicate";

/** Only session-local hook definitions are installed; trust is scoped to their exact hash. */
export function codexJevHookLaunchArgs(command: string): ReadonlyArray<string> {
  return [
    "-c",
    `hooks.PreToolUse=[{matcher="^(spawn_agent|collaborationspawn_agent)$",hooks=[{type="command",command=${JSON.stringify(command)},timeout=10}]}]`,
  ];
}

/** Feed the result of hooks/list back through config/value/write only after explicit opt-in. */
export function codexJevHookTrustWrite(
  hooksList: unknown,
  command: string,
  includeTrusted = false,
) {
  if (!Predicate.isObject(hooksList) || !Array.isArray(hooksList.data)) return null;
  for (const entry of hooksList.data) {
    if (!Predicate.isObject(entry) || !Array.isArray(entry.hooks)) continue;
    for (const hook of entry.hooks) {
      if (
        !Predicate.isObject(hook) ||
        hook.source !== "sessionFlags" ||
        hook.eventName !== "preToolUse" ||
        hook.handlerType !== "command" ||
        hook.command !== command ||
        hook.matcher !== "^(spawn_agent|collaborationspawn_agent)$" ||
        hook.async !== false ||
        hook.timeoutSec !== 10 ||
        hook.enabled !== true ||
        hook.isManaged !== false ||
        hook.sourcePath !== "/<session-flags>/config.toml" ||
        typeof hook.key !== "string" ||
        !/^\/<session-flags>\/config\.toml:pre_tool_use:\d+:\d+$/.test(hook.key) ||
        typeof hook.currentHash !== "string" ||
        !/^sha256:[a-f0-9]{64}$/.test(hook.currentHash)
      )
        continue;
      if (hook.trustStatus === "trusted" && !includeTrusted) return null;
      return {
        keyPath: `hooks.state.${JSON.stringify(hook.key)}.trusted_hash`,
        value: hook.currentHash,
        mergeStrategy: "replace" as const,
      };
    }
  }
  return null;
}

export interface CodexJevHookContext {
  endpoint: string;
  token: string;
  threadId: string;
  providerInstanceId: string;
  candidates: ReadonlyArray<{
    key: string;
    description: string;
    model?: string;
    effort?: "low" | "medium" | "high" | "xhigh";
  }>;
}

/** Standalone hook logic: no key access and no mutation except the selected spawn model. */
export async function runCodexJevHook(
  input: unknown,
  context: CodexJevHookContext,
  fetcher: typeof fetch = fetch,
) {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    !("hook_event_name" in input) ||
    input.hook_event_name !== "PreToolUse" ||
    !("tool_name" in input) ||
    !["spawn_agent", "collaborationspawn_agent"].includes(String(input.tool_name)) ||
    !("tool_input" in input) ||
    typeof input.tool_input !== "object" ||
    input.tool_input === null ||
    Array.isArray(input.tool_input)
  )
    return {};
  const args = input.tool_input as Record<string, unknown>;
  // A full history fork must keep its parent's model. Do not silently change context sharing.
  if (
    typeof args.fork_turns !== "string" ||
    (args.fork_turns !== "none" && !/^[1-9][0-9]*$/.test(args.fork_turns)) ||
    typeof args.task_name !== "string" ||
    !/^[a-z0-9_]+$/.test(args.task_name) ||
    args.fork_context === true ||
    typeof args.message !== "string" ||
    !args.message.trim() ||
    args.message.length > 120_000 ||
    "resume" in args ||
    // The hook cannot distinguish a user choice from an agent default. Preserve either.
    "model" in args ||
    "reasoning_effort" in args ||
    context.candidates.length === 0
  )
    return {};
  try {
    const endpoint = new URL(context.endpoint);
    if (
      endpoint.protocol !== "http:" ||
      endpoint.hostname !== "127.0.0.1" ||
      endpoint.pathname !== "/subagent-route" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      !context.token
    )
      return {};
    const response = await fetcher(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
      headers: { Authorization: `Bearer ${context.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: context.threadId,
        providerInstanceId: context.providerInstanceId,
        toolUseId:
          "tool_use_id" in input && typeof input.tool_use_id === "string"
            ? input.tool_use_id
            : undefined,
        parentProviderTurnId:
          "turn_id" in input && typeof input.turn_id === "string" ? input.turn_id : undefined,
        taskPrompt: args.message,
        proposedModel: args.model,
        proposedEffort: args.reasoning_effort,
        forkTurns: args.fork_turns,
        candidates: context.candidates,
      }),
    });
    if (!response.ok) return {};
    const result: unknown = await response.json();
    if (
      typeof result !== "object" ||
      result === null ||
      ("policyOutcome" in result && result.policyOutcome !== "route") ||
      ("confidence" in result &&
        (typeof result.confidence !== "number" ||
          !Number.isFinite(result.confidence) ||
          result.confidence < 0.5)) ||
      !("model" in result) ||
      typeof result.model !== "string" ||
      !context.candidates.some((candidate) =>
        candidate.model === undefined && candidate.effort === undefined
          ? candidate.key === result.model && !("effort" in result)
          : candidate.model === result.model &&
            "effort" in result &&
            candidate.effort === result.effort &&
            ["low", "medium", "high", "xhigh"].includes(String(result.effort)),
      )
    )
      return {};
    const updatedInput: Record<string, unknown> = { ...args, model: result.model };
    if ("effort" in result) updatedInput.reasoning_effort = result.effort;
    else if (result.model !== args.model) delete updatedInput.reasoning_effort;
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput,
      },
    };
  } catch {
    return {};
  }
}

export const JEV_BROKER_URL = "T3CODE_JEV_BROKER_URL";
export const JEV_BROKER_TOKEN = "T3CODE_JEV_BROKER_TOKEN";

export async function readCodexJevPolicy(
  context: Pick<CodexJevHookContext, "endpoint" | "token" | "threadId" | "providerInstanceId">,
) {
  try {
    const url = new URL(context.endpoint);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.pathname !== "/subagent-route" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    url.pathname = "/subagent-policy";
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(2_000),
      headers: { Authorization: `Bearer ${context.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: context.threadId,
        providerInstanceId: context.providerInstanceId,
      }),
    });
    const policy: unknown = response.ok ? await response.json() : null;
    if (
      typeof policy !== "object" ||
      policy === null ||
      !("enabled" in policy) ||
      policy.enabled !== true ||
      !("candidates" in policy) ||
      !Array.isArray(policy.candidates)
    )
      return null;
    const candidates: Array<CodexJevHookContext["candidates"][number]> = [];
    for (const candidate of policy.candidates) {
      if (
        typeof candidate !== "object" ||
        candidate === null ||
        typeof candidate.key !== "string" ||
        typeof candidate.description !== "string" ||
        ((candidate.model !== undefined || candidate.effort !== undefined) &&
          (typeof candidate.model !== "string" ||
            !["low", "medium", "high", "xhigh"].includes(candidate.effort)))
      )
        return null;
      candidates.push({
        key: candidate.key,
        description: candidate.description,
        ...(candidate.model !== undefined
          ? { model: candidate.model, effort: candidate.effort }
          : {}),
      });
    }
    return candidates.length > 0 ? candidates : null;
  } catch {
    return null;
  }
}

/** The emitted script is dependency-free and runs under the bundled Node executable. */
export function codexJevRunnerSource(): string {
  return `const route = ${runCodexJevHook.toString()};
const policy = ${readCodexJevPolicy.toString()};
try {
  const context = {
    endpoint: process.env.T3CODE_JEV_BROKER_URL,
    token: process.env.T3CODE_JEV_BROKER_TOKEN,
    threadId: process.env.T3CODE_JEV_THREAD_ID,
    providerInstanceId: process.env.T3CODE_JEV_PROVIDER_INSTANCE_ID,
  };
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 240000) throw new Error("Input too large");
  }
  const candidates = await policy(context);
  const output = candidates ? await route(JSON.parse(input), { ...context, candidates }) : {};
  process.stdout.write(JSON.stringify(output));
} catch { process.stdout.write("{}"); }
`;
}

export async function reportCodexJevStatus(
  context: Pick<CodexJevHookContext, "endpoint" | "token" | "threadId" | "providerInstanceId">,
  error: string,
) {
  try {
    const url = new URL(context.endpoint);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.pathname !== "/subagent-route" ||
      url.username ||
      url.password
    )
      return;
    url.pathname = "/subagent-status";
    await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(2_000),
      headers: { Authorization: `Bearer ${context.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: context.threadId,
        providerInstanceId: context.providerInstanceId,
        error,
      }),
    });
  } catch {
    /* Diagnostics cannot hold up a turn. */
  }
}
