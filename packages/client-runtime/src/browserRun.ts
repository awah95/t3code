import {
  BROWSER_RUN_ACTIVITY_KIND,
  BrowserRunSummary,
  type BrowserRunStatus,
  type OrchestrationThreadActivity,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const BROWSER_RUN_COMPLETED_HISTORY_LIMIT = 20;

const decodeBrowserRunSummary = Schema.decodeUnknownOption(BrowserRunSummary);
const terminalStatuses = new Set<BrowserRunStatus>([
  "completed",
  "cancelled",
  "failed",
  "interrupted",
  "needs-agent",
]);

export interface BrowserRunProjection {
  /** Active tasks first, followed by at most the 20 most recent finished tasks. */
  readonly runs: ReadonlyArray<BrowserRunSummary>;
  readonly activeRuns: ReadonlyArray<BrowserRunSummary>;
  readonly finishedRuns: ReadonlyArray<BrowserRunSummary>;
  readonly reportedCostUsd: number;
  readonly hasUnknownCost: boolean;
}

export function browserRunIsActive(status: BrowserRunStatus): boolean {
  return !terminalStatuses.has(status);
}

function newestFirst(left: BrowserRunSummary, right: BrowserRunSummary): number {
  const updated = right.updatedAt.localeCompare(left.updatedAt);
  if (updated !== 0) return updated;
  const started = right.startedAt.localeCompare(left.startedAt);
  if (started !== 0) return started;
  return right.runId.localeCompare(left.runId);
}

/**
 * Folds the persisted activity snapshot into the browser-task state used by
 * every client. A run's own sequence is authoritative: duplicate delivery or
 * a late older activity can never move it backwards after reconnect.
 */
export function deriveBrowserRunProjection(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  scope: ScopedThreadRef,
): BrowserRunProjection {
  const latestByRun = new Map<string, BrowserRunSummary>();

  for (const activity of activities) {
    if (activity.kind !== BROWSER_RUN_ACTIVITY_KIND) continue;
    const decoded = decodeBrowserRunSummary(activity.payload);
    if (Option.isNone(decoded)) continue;
    const summary = decoded.value;
    if (summary.environmentId !== scope.environmentId || summary.threadId !== scope.threadId) {
      continue;
    }
    const current = latestByRun.get(summary.runId);
    if (current && summary.sequence <= current.sequence) continue;
    latestByRun.set(summary.runId, summary);
  }

  const all = [...latestByRun.values()];
  const activeRuns = all.filter((run) => browserRunIsActive(run.status)).sort(newestFirst);
  const finishedRuns = all
    .filter((run) => !browserRunIsActive(run.status))
    .sort(newestFirst)
    .slice(0, BROWSER_RUN_COMPLETED_HISTORY_LIMIT);
  const runs = [...activeRuns, ...finishedRuns];

  return {
    runs,
    activeRuns,
    finishedRuns,
    reportedCostUsd: runs.reduce((total, run) => total + (run.reportedCostUsd ?? 0), 0),
    hasUnknownCost: runs.some((run) => run.hasUnknownCost),
  };
}
