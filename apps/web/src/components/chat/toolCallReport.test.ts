import type { OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { toolCallReportByTurn } from "./toolCallReport";

function activity(kind: string, id: string, at: number, command: string, turnId = "turn") {
  return {
    id: `${kind}-${id}-${at}`,
    kind,
    createdAt: new Date(at).toISOString(),
    turnId: turnId as TurnId,
    tone: "tool",
    summary: "Tool",
    payload: { toolCallId: id, title: "Ran command", data: { command } },
  } as OrchestrationThreadActivity;
}

describe("toolCallReportByTurn", () => {
  it("groups concurrent calls by command and sums their individual durations", () => {
    const report = toolCallReportByTurn([
      activity("tool.started", "a", 1000, "git status"),
      activity("tool.started", "b", 1100, "git diff"),
      activity("tool.completed", "a", 2000, "git status"),
      activity("tool.completed", "b", 2600, "git diff"),
    ]).get("turn" as TurnId);
    expect(report).toMatchObject([{ label: "Git", durationMs: 2500, timedCount: 2 }]);
    expect(report?.[0]?.calls.map((call) => call.durationMs)).toEqual([1000, 1500]);
  });

  it("marks missing starts unknown and keeps reused IDs separate by turn", () => {
    const report = toolCallReportByTurn([
      activity("tool.started", "same", 1000, "git status", "first"),
      activity("tool.completed", "same", 1800, "git status", "second"),
    ]);
    expect(report.get("first" as TurnId)).toBeUndefined();
    expect(report.get("second" as TurnId)?.[0]).toMatchObject({
      durationMs: 0,
      timedCount: 0,
      calls: [{ durationMs: null }],
    });
  });

  it("pairs legacy lifecycle rows whose IDs live in data", () => {
    const started = activity("tool.started", "legacy", 1000, "git status");
    const completed = activity("tool.completed", "legacy", 2500, "git status");
    const nested = (entry: OrchestrationThreadActivity) => ({
      ...entry,
      payload: { title: "Ran command", data: { toolCallId: "legacy", command: "git status" } },
    });
    const report = toolCallReportByTurn([nested(started), nested(completed)]).get("turn" as TurnId);
    expect(report?.[0]).toMatchObject({ label: "Git", durationMs: 1500, timedCount: 1 });
  });
});
