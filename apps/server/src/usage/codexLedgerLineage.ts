export type CodexLedgerLineageHint =
  | {
      readonly kind: "spawn";
      readonly toolUseId: string;
      readonly parentThreadId: string | null;
      readonly parentTurnId: string | null;
      readonly taskName: string;
    }
  | {
      readonly kind: "child";
      readonly childThreadId: string;
      readonly parentThreadId: string | null;
      readonly agentPath: string;
      readonly rootTurnId: string | null;
    };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonempty(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Extract only explicit IDs and canonical paths; matching and ambiguity checks happen in storage. */
export function extractCodexLedgerLineageHints(record: unknown): readonly CodexLedgerLineageHint[] {
  const row = object(record);
  const payload = object(row?.["payload"]);
  if (!row || !payload) return [];
  if (row["type"] === "session_meta") {
    const source = object(payload["source"]);
    const subagent = object(source?.["subagent"]);
    const spawn = object(subagent?.["thread_spawn"]);
    const childThreadId = nonempty(payload["id"]);
    const agentPath = nonempty(spawn?.["agent_path"]);
    return childThreadId && agentPath
      ? [
          {
            kind: "child",
            childThreadId,
            parentThreadId: nonempty(spawn?.["parent_thread_id"]),
            agentPath,
            rootTurnId: nonempty(payload["root_turn_id"]),
          },
        ]
      : [];
  }
  if (
    row["type"] !== "response_item" ||
    (payload["type"] !== "function_call_output" && payload["type"] !== "custom_tool_call_output")
  )
    return [];
  const toolUseId = nonempty(payload["call_id"]);
  const output = payload["output"];
  if (!toolUseId || typeof output !== "string" || output.length > 4096) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return [];
  }
  const result = object(parsed);
  // Current Codex spawn output is exactly { task_name: "/root/name" }. The tool name is
  // on its matching call record; the storage join must verify it was spawn_agent.
  if (!result || Object.keys(result).length !== 1) return [];
  const taskName = nonempty(result["task_name"]);
  if (!taskName || !/^\/root(?:\/[a-z0-9_]+)+$/.test(taskName)) return [];
  return [
    {
      kind: "spawn",
      toolUseId,
      parentThreadId: nonempty(payload["thread_id"]),
      parentTurnId: nonempty(payload["turn_id"]),
      taskName,
    },
  ];
}
