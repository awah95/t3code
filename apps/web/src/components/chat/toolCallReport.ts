import type { OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";

export interface ToolCallReportRow {
  id: string;
  label: string;
  durationMs: number | null;
}

export interface ToolCallReportGroup {
  label: string;
  calls: ToolCallReportRow[];
  durationMs: number;
  timedCount: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function commandFrom(payload: Record<string, unknown>): string | null {
  const data = record(payload.data);
  const item = record(data?.item);
  const command = item?.command ?? data?.command;
  if (typeof command === "string") return command;
  if (Array.isArray(command) && command.every((part) => typeof part === "string")) {
    return command.join(" ");
  }
  return null;
}

function labelFor(activity: OrchestrationThreadActivity): { group: string; call: string } {
  const payload = record(activity.payload) ?? {};
  const command = commandFrom(payload)?.trim();
  if (command) {
    const git = /^(?:git|(?:\S*\/)?git)\s+/u.test(command);
    return {
      group: git ? "Git" : "Shell",
      call: command.length > 120 ? `${command.slice(0, 119)}…` : command,
    };
  }
  const title = typeof payload.title === "string" ? payload.title : activity.summary;
  return { group: title, call: title };
}

/** Pair only observed lifecycle boundaries; missing starts have unknown duration. */
export function toolCallReportByTurn(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): Map<TurnId, ToolCallReportGroup[]> {
  const starts = new Map<string, OrchestrationThreadActivity>();
  const calls = new Map<TurnId, Map<string, ToolCallReportRow & { group: string }>>();
  for (const activity of activities) {
    if (!activity.turnId || !["tool.started", "tool.completed"].includes(activity.kind)) continue;
    const payload = record(activity.payload);
    const directId = payload?.toolCallId;
    const nestedId = record(payload?.data)?.toolCallId;
    const callId =
      typeof directId === "string" && directId.trim()
        ? directId.trim()
        : typeof nestedId === "string"
          ? nestedId.trim()
          : "";
    if (!callId) continue;
    const key = `${activity.turnId}\u0000${callId}`;
    if (activity.kind === "tool.started") {
      starts.set(key, activity);
      continue;
    }
    const start = starts.get(key);
    const from = start ? Date.parse(start.createdAt) : NaN;
    const to = Date.parse(activity.createdAt);
    const durationMs =
      Number.isFinite(from) && Number.isFinite(to) && to >= from ? to - from : null;
    const labels = labelFor(activity);
    let turnCalls = calls.get(activity.turnId);
    if (!turnCalls) {
      turnCalls = new Map();
      calls.set(activity.turnId, turnCalls);
    }
    turnCalls.set(key, { id: key, group: labels.group, label: labels.call, durationMs });
    starts.delete(key);
  }
  const result = new Map<TurnId, ToolCallReportGroup[]>();
  for (const [turnId, turnCalls] of calls) {
    const groups = new Map<string, ToolCallReportGroup>();
    for (const call of turnCalls.values()) {
      let group = groups.get(call.group);
      if (!group) {
        group = { label: call.group, calls: [], durationMs: 0, timedCount: 0 };
        groups.set(call.group, group);
      }
      group.calls.push(call);
      if (call.durationMs !== null) {
        group.durationMs += call.durationMs;
        group.timedCount += 1;
      }
    }
    result.set(
      turnId,
      [...groups.values()].sort((a, b) => b.durationMs - a.durationMs),
    );
  }
  return result;
}
