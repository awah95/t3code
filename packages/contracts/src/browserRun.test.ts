import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { EnvironmentId, ThreadId } from "./baseSchemas.ts";
import { BrowserRunSummary, CancelBrowserRunInput, CancelBrowserRunResult } from "./browserRun.ts";

const decodeSummary = Schema.decodeUnknownSync(BrowserRunSummary);
const decodeCancelInput = Schema.decodeUnknownSync(CancelBrowserRunInput);
const decodeCancelResult = Schema.decodeUnknownSync(CancelBrowserRunResult);

describe("browser run contracts", () => {
  it("decodes a bounded durable summary without task or observation data", () => {
    const summary = decodeSummary({
      runId: "run-1",
      continuedFromRunId: "run-0",
      sequence: 3,
      environmentId: EnvironmentId.make("environment-1"),
      threadId: ThreadId.make("thread-1"),
      tabId: "tab-1",
      hostClientId: "host-1",
      browserBackend: "embedded",
      status: "verifying",
      startedAt: "2026-09-22T08:00:00.000Z",
      updatedAt: "2026-09-22T08:00:01.000Z",
      lastAction: "Select the requested account",
      assertionCounts: {
        total: 2,
        passed: 1,
        failed: 0,
        indeterminate: 0,
        outstanding: 1,
      },
      decisionCalls: 2,
      executedSteps: 1,
      reportedCostUsd: 0.002,
      hasUnknownCost: false,
    });

    expect(summary).toMatchObject({
      runId: "run-1",
      continuedFromRunId: "run-0",
      sequence: 3,
      status: "verifying",
    });
    expect("task" in summary).toBe(false);
    expect("observation" in summary).toBe(false);
  });

  it("rejects invalid sequence, negative accounting, and oversized labels", () => {
    const base = {
      runId: "run-1",
      sequence: 1,
      environmentId: "environment-1",
      threadId: "thread-1",
      browserBackend: "embedded",
      status: "observing",
      startedAt: "2026-09-22T08:00:00.000Z",
      updatedAt: "2026-09-22T08:00:00.000Z",
      assertionCounts: { total: 0, passed: 0, failed: 0, indeterminate: 0, outstanding: 0 },
      decisionCalls: 0,
      executedSteps: 0,
      reportedCostUsd: null,
      hasUnknownCost: true,
    };

    expect(() => decodeSummary({ ...base, sequence: 0 })).toThrow();
    expect(() => decodeSummary({ ...base, reportedCostUsd: -1 })).toThrow();
    expect(() => decodeSummary({ ...base, detail: "x".repeat(1_001) })).toThrow();
  });

  it("keeps cancellation scoped to environment, thread, and run", () => {
    expect(
      decodeCancelInput({
        environmentId: "environment-1",
        threadId: "thread-1",
        runId: "run-1",
      }),
    ).toEqual({ environmentId: "environment-1", threadId: "thread-1", runId: "run-1" });
    expect(decodeCancelResult({ runId: "run-1", cancelled: true })).toEqual({
      runId: "run-1",
      cancelled: true,
    });
  });
});
