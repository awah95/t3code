import {
  BROWSER_RUN_ACTIVITY_KIND,
  BrowserRunSummary,
  CommandId,
  EventId,
  type OrchestrationThreadActivity,
  type BrowserRunStatus,
  type BrowserRunSummary as BrowserRunSummaryType,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as OrchestrationEngine from "./Services/OrchestrationEngine.ts";

const decodeSummary = Schema.decodeUnknownEffect(BrowserRunSummary);
const decodeSummaryOption = Schema.decodeUnknownOption(BrowserRunSummary);
const PROCESS_STARTED_AT_MS = DateTime.toEpochMillis(DateTime.nowUnsafe());

const activitySummary = (status: BrowserRunStatus): string => {
  switch (status) {
    case "observing":
      return "Browser run is observing the page";
    case "acting":
      return "Browser run is applying an action";
    case "verifying":
      return "Browser run is verifying the result";
    case "needs-agent":
      return "Browser run needs the agent";
    case "completed":
      return "Browser run completed";
    case "cancelled":
      return "Browser run cancelled";
    case "failed":
      return "Browser run failed";
    case "interrupted":
      return "Browser run was interrupted by a server restart";
  }
};

/** Append a bounded run summary through the existing durable orchestration activity path. */
export const publishBrowserRunSummary = Effect.fn("BrowserRunActivity.publish")(function* (
  unsafeSummary: BrowserRunSummaryType,
) {
  const summary = yield* decodeSummary(unsafeSummary);
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;
  const commandId = CommandId.make(yield* crypto.randomUUIDv4);

  yield* engine.dispatch({
    type: "thread.activity.append",
    commandId,
    threadId: summary.threadId,
    activity: {
      // Stable within a run so the projection replaces progress instead of
      // growing the activity timeline on every browser step.
      id: EventId.make(`browser-run:${summary.runId}`),
      tone: summary.status === "failed" || summary.status === "interrupted" ? "error" : "tool",
      kind: BROWSER_RUN_ACTIVITY_KIND,
      summary: activitySummary(summary.status),
      payload: summary,
      turnId: null,
      createdAt: summary.startedAt,
    },
    createdAt: summary.updatedAt,
  });
});

const isRunningStatus = (status: BrowserRunStatus) =>
  status === "observing" || status === "acting" || status === "verifying";

/**
 * A persisted nonterminal summary older than this server process cannot still
 * own an abort handle. Project it as interrupted on reconnect without replaying
 * any browser action. Live events remain unchanged.
 */
export function interruptBrowserRunForSnapshot(
  activity: OrchestrationThreadActivity,
  processStartedAtMs = PROCESS_STARTED_AT_MS,
): OrchestrationThreadActivity {
  if (activity.kind !== BROWSER_RUN_ACTIVITY_KIND) return activity;
  const decoded = decodeSummaryOption(activity.payload);
  if (Option.isNone(decoded)) return activity;
  const summary = decoded.value;
  const updatedAtMs = Date.parse(summary.updatedAt);
  if (
    !isRunningStatus(summary.status) ||
    !Number.isFinite(updatedAtMs) ||
    updatedAtMs >= processStartedAtMs
  ) {
    return activity;
  }

  const interrupted: BrowserRunSummaryType = {
    ...summary,
    sequence: summary.sequence + 1,
    status: "interrupted",
    handoffReason: "The server restarted before this browser run finished.",
    detail: "No browser action was replayed.",
  };
  return {
    ...activity,
    tone: "error",
    summary: activitySummary("interrupted"),
    payload: interrupted,
  };
}
