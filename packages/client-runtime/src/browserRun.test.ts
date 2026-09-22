import {
  BROWSER_RUN_ACTIVITY_KIND,
  EnvironmentId,
  EventId,
  ThreadId,
  type BrowserRunStatus,
  type BrowserRunSummary,
  type OrchestrationThreadActivity,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { BROWSER_RUN_COMPLETED_HISTORY_LIMIT, deriveBrowserRunProjection } from "./browserRun.js";

const scope: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment-one"),
  threadId: ThreadId.make("thread-one"),
};

function summary(overrides: {
  runId: string;
  sequence: number;
  status: BrowserRunStatus;
  updatedAt?: string;
  environmentId?: string;
  threadId?: string;
  reportedCostUsd?: number | null;
  hasUnknownCost?: boolean;
}): BrowserRunSummary {
  return {
    runId: overrides.runId,
    sequence: overrides.sequence,
    environmentId: EnvironmentId.make(overrides.environmentId ?? scope.environmentId),
    threadId: ThreadId.make(overrides.threadId ?? scope.threadId),
    browserBackend: "embedded",
    status: overrides.status,
    startedAt: "2026-09-22T08:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-09-22T08:00:01.000Z",
    assertionCounts: { total: 2, passed: 1, failed: 0, indeterminate: 0, outstanding: 1 },
    decisionCalls: 1,
    executedSteps: 1,
    reportedCostUsd: overrides.reportedCostUsd ?? null,
    hasUnknownCost: overrides.hasUnknownCost ?? false,
  };
}

let activityIndex = 0;
function activity(payload: BrowserRunSummary): OrchestrationThreadActivity {
  return {
    id: EventId.make(`browser-run-${activityIndex++}`),
    createdAt: payload.updatedAt,
    kind: BROWSER_RUN_ACTIVITY_KIND,
    summary: "Browser task updated",
    tone: "tool",
    payload,
    turnId: null,
  };
}

describe("deriveBrowserRunProjection", () => {
  it("keeps the highest per-run sequence when live updates arrive out of order", () => {
    const projection = deriveBrowserRunProjection(
      [
        activity(summary({ runId: "run-one", sequence: 3, status: "completed" })),
        activity(summary({ runId: "run-one", sequence: 1, status: "observing" })),
        activity(summary({ runId: "run-one", sequence: 2, status: "acting" })),
      ],
      scope,
    );

    expect(projection.runs).toHaveLength(1);
    expect(projection.runs[0]).toMatchObject({
      runId: "run-one",
      sequence: 3,
      status: "completed",
    });
  });

  it("restores a run directly from the latest reconnect snapshot", () => {
    const projection = deriveBrowserRunProjection(
      [
        activity(
          summary({
            runId: "restored-run",
            sequence: 8,
            status: "verifying",
            reportedCostUsd: 0.004,
            hasUnknownCost: true,
          }),
        ),
      ],
      scope,
    );

    expect(projection.activeRuns).toMatchObject([
      { runId: "restored-run", sequence: 8, status: "verifying" },
    ]);
    expect(projection.reportedCostUsd).toBe(0.004);
    expect(projection.hasUnknownCost).toBe(true);
  });

  it("keeps cancellation final when a stale acting update is redelivered", () => {
    const projection = deriveBrowserRunProjection(
      [
        activity(summary({ runId: "cancelled-run", sequence: 4, status: "acting" })),
        activity(summary({ runId: "cancelled-run", sequence: 5, status: "cancelled" })),
        activity(summary({ runId: "cancelled-run", sequence: 4, status: "acting" })),
      ],
      scope,
    );

    expect(projection.activeRuns).toEqual([]);
    expect(projection.finishedRuns[0]).toMatchObject({
      runId: "cancelled-run",
      sequence: 5,
      status: "cancelled",
    });
  });

  it("keeps active tasks while bounding finished history and excluding other scopes", () => {
    const completed = Array.from({ length: BROWSER_RUN_COMPLETED_HISTORY_LIMIT + 3 }, (_, index) =>
      activity(
        summary({
          runId: `completed-${index}`,
          sequence: 1,
          status: "completed",
          updatedAt: `2026-09-22T08:${String(index).padStart(2, "0")}:00.000Z`,
        }),
      ),
    );
    const projection = deriveBrowserRunProjection(
      [
        ...completed,
        activity(summary({ runId: "active", sequence: 2, status: "verifying" })),
        activity(
          summary({
            runId: "other-thread",
            sequence: 1,
            status: "acting",
            threadId: "thread-two",
          }),
        ),
      ],
      scope,
    );

    expect(projection.activeRuns.map((run) => run.runId)).toEqual(["active"]);
    expect(projection.finishedRuns).toHaveLength(BROWSER_RUN_COMPLETED_HISTORY_LIMIT);
    expect(projection.runs).toHaveLength(BROWSER_RUN_COMPLETED_HISTORY_LIMIT + 1);
    expect(projection.runs.some((run) => run.runId === "other-thread")).toBe(false);
  });
});
