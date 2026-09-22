import { expect, it } from "@effect/vitest";
import { EnvironmentId, EventId, ThreadId } from "@t3tools/contracts";

import { interruptBrowserRunForSnapshot } from "./BrowserRunActivity.ts";

const activity = (status: "observing" | "completed") => ({
  id: EventId.make("browser-run:run-1"),
  tone: "tool" as const,
  kind: "browser.run.updated",
  summary: "Browser run",
  payload: {
    runId: "run-1",
    sequence: 1,
    environmentId: EnvironmentId.make("environment-1"),
    threadId: ThreadId.make("thread-1"),
    browserBackend: "embedded" as const,
    status,
    startedAt: "2026-09-22T08:00:00.000Z",
    updatedAt: "2026-09-22T08:00:01.000Z",
    assertionCounts: { total: 1, passed: 0, failed: 0, indeterminate: 0, outstanding: 1 },
    decisionCalls: 0,
    executedSteps: 0,
    reportedCostUsd: 0,
    hasUnknownCost: false,
  },
  turnId: null,
  createdAt: "2026-09-22T08:00:00.000Z",
});

it("projects a pre-restart nonterminal run as the next interrupted sequence", () => {
  const projected = interruptBrowserRunForSnapshot(
    activity("observing"),
    Date.parse("2026-09-22T08:00:02.000Z"),
  );
  expect(projected.payload).toMatchObject({
    runId: "run-1",
    sequence: 2,
    status: "interrupted",
    detail: "No browser action was replayed.",
  });
});

it("leaves current-process and terminal summaries unchanged", () => {
  const running = activity("observing");
  const completed = activity("completed");
  expect(interruptBrowserRunForSnapshot(running, Date.parse("2026-09-22T08:00:00.500Z"))).toBe(
    running,
  );
  expect(interruptBrowserRunForSnapshot(completed, Date.parse("2026-09-22T08:00:02.000Z"))).toBe(
    completed,
  );
});
