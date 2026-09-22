import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { PreviewTabId } from "./preview.ts";

const BoundedId = TrimmedNonEmptyString.check(Schema.isMaxLength(256));
const BoundedLabel = TrimmedNonEmptyString.check(Schema.isMaxLength(1_000));
const ReportedCostUsd = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

export const BROWSER_RUN_ACTIVITY_KIND = "browser.run.updated" as const;

export const BrowserRunStatus = Schema.Literals([
  "observing",
  "acting",
  "verifying",
  "needs-agent",
  "completed",
  "cancelled",
  "failed",
  "interrupted",
]);
export type BrowserRunStatus = typeof BrowserRunStatus.Type;

export const BrowserRunAssertionCounts = Schema.Struct({
  total: NonNegativeInt,
  passed: NonNegativeInt,
  failed: NonNegativeInt,
  indeterminate: NonNegativeInt,
  outstanding: NonNegativeInt,
});
export type BrowserRunAssertionCounts = typeof BrowserRunAssertionCounts.Type;

/**
 * Bounded task progress safe to persist in thread activity and send to every
 * connected client. Inputs, observations, decision payloads and receipts stay
 * in their existing host/ledger paths rather than entering this summary.
 */
export const BrowserRunSummary = Schema.Struct({
  runId: BoundedId,
  continuedFromRunId: Schema.optionalKey(BoundedId),
  sequence: PositiveInt,
  environmentId: EnvironmentId,
  threadId: ThreadId,
  tabId: Schema.optionalKey(PreviewTabId),
  hostClientId: Schema.optionalKey(BoundedId),
  browserBackend: Schema.Literals(["embedded", "external-chrome"]),
  status: BrowserRunStatus,
  startedAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastAction: Schema.optionalKey(BoundedLabel),
  handoffReason: Schema.optionalKey(BoundedLabel),
  assertionCounts: BrowserRunAssertionCounts,
  decisionCalls: NonNegativeInt,
  executedSteps: NonNegativeInt,
  reportedCostUsd: Schema.NullOr(ReportedCostUsd),
  hasUnknownCost: Schema.Boolean,
  detail: Schema.optionalKey(BoundedLabel),
});
export type BrowserRunSummary = typeof BrowserRunSummary.Type;

export const CancelBrowserRunInput = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
  runId: BoundedId,
});
export type CancelBrowserRunInput = typeof CancelBrowserRunInput.Type;

export const CancelBrowserRunResult = Schema.Struct({
  runId: BoundedId,
  cancelled: Schema.Boolean,
});
export type CancelBrowserRunResult = typeof CancelBrowserRunResult.Type;
