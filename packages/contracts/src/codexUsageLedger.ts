import * as Schema from "effect/Schema";
import { NonNegativeInt } from "./baseSchemas.ts";

const PageLimit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 200 }));
const PageCursor = Schema.String.check(Schema.isMaxLength(2048));
const LedgerId = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(256));
const SmallJson = Schema.String.check(Schema.isMaxLength(1_000_000));

/** Response facts are scoped to an account/source domain, not a T3 environment. */
export const CodexLedgerIdentity = Schema.Struct({
  sourceDomain: LedgerId,
  codexThreadId: LedgerId,
  codexTurnId: LedgerId,
  rootTurnId: Schema.NullOr(Schema.String),
  t3EnvironmentId: Schema.NullOr(Schema.String),
  t3ProjectId: Schema.NullOr(Schema.String),
  t3ThreadId: Schema.NullOr(Schema.String),
  t3TurnId: Schema.NullOr(Schema.String),
  t3MessageId: Schema.NullOr(Schema.String),
});
export type CodexLedgerIdentity = typeof CodexLedgerIdentity.Type;

/** Null means the upstream source did not report that counter. */
export const CodexLedgerTokens = Schema.Struct({
  inputTokens: Schema.NullOr(NonNegativeInt),
  cachedInputTokens: Schema.NullOr(NonNegativeInt),
  cacheWriteTokens: Schema.NullOr(NonNegativeInt),
  outputTokens: Schema.NullOr(NonNegativeInt),
  reasoningTokens: Schema.NullOr(NonNegativeInt),
  processedTokens: Schema.NullOr(NonNegativeInt),
});
export type CodexLedgerTokens = typeof CodexLedgerTokens.Type;

export const CodexLedgerCoverage = Schema.Struct({
  usage: Schema.Literals(["exact", "provisional", "partial", "unknown", "conflict"]),
  model: Schema.Literals(["observed", "inferred", "unknown", "conflict"]),
  pricing: Schema.Literals(["priced", "partial", "unpriced", "notValued"]),
  lineage: Schema.Literals(["resolved", "partial", "unknown"]),
  subscription: Schema.Literals(["observed", "ambiguous", "unknown"]),
});
export type CodexLedgerCoverage = typeof CodexLedgerCoverage.Type;

export const CodexLedgerValuation = Schema.Struct({
  snapshotId: Schema.NullOr(Schema.String),
  calculationVersion: Schema.NullOr(Schema.String),
  estimateKind: Schema.Literals(["standardApiEquivalent", "actualReported", "none"]),
  /** Exact decimal USD, never a rounded binary float. */
  pricedSubtotalUsd: Schema.NullOr(Schema.String),
  /** Null when any response in scope lacks a defensible price. */
  completeEstimateUsd: Schema.NullOr(Schema.String),
  unpricedResponseCount: NonNegativeInt,
  missingPriceReasons: Schema.Array(Schema.String),
});
export type CodexLedgerValuation = typeof CodexLedgerValuation.Type;

export const CodexLedgerResponse = Schema.Struct({
  sourceDomain: Schema.String,
  responseId: Schema.String,
  codexThreadId: Schema.String,
  codexTurnId: Schema.String,
  rootTurnId: Schema.NullOr(Schema.String),
  occurredAt: Schema.String,
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
  requestedModel: Schema.NullOr(Schema.String),
  servedModel: Schema.NullOr(Schema.String),
  requestedTier: Schema.NullOr(Schema.String),
  servedTier: Schema.NullOr(Schema.String),
  modelProvenance: Schema.Literals(["response", "turnContext", "unknown"]),
  scope: Schema.Literals(["main", "child", "guardian", "unknown"]),
  kind: Schema.Literals(["model", "compaction", "unknown"]),
  status: Schema.Literals(["reported", "provisional", "conflict", "invalid"]),
  tokens: CodexLedgerTokens,
  valuation: CodexLedgerValuation,
  observationCount: NonNegativeInt,
});
export type CodexLedgerResponse = typeof CodexLedgerResponse.Type;

export const CodexLedgerTurn = Schema.Struct({
  identity: CodexLedgerIdentity,
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
  scope: Schema.Literals(["main", "child", "guardian", "mixed", "unknown"]),
  lifecycle: Schema.Literals(["completed", "aborted", "active", "unknown"]),
  responseCount: NonNegativeInt,
  childTurnCount: NonNegativeInt,
  tokens: CodexLedgerTokens,
  valuation: CodexLedgerValuation,
  coverage: CodexLedgerCoverage,
});
export type CodexLedgerTurn = typeof CodexLedgerTurn.Type;

export const CodexLedgerSourceStatus = Schema.Struct({
  sourceDomain: Schema.String,
  state: Schema.Literals(["ready", "paused", "unavailable", "partial"]),
  lastCapturedAt: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String),
  pendingFileCount: NonNegativeInt,
  malformedRecordCount: NonNegativeInt,
});
export type CodexLedgerSourceStatus = typeof CodexLedgerSourceStatus.Type;

export const CodexLedgerSummary = Schema.Struct({
  captureState: Schema.Literals(["active", "paused"]),
  lastCapturedAt: Schema.NullOr(Schema.String),
  responseCount: NonNegativeInt,
  turnCount: NonNegativeInt,
  conflictCount: NonNegativeInt,
  missingUsageTurnCount: NonNegativeInt,
  tokens: CodexLedgerTokens,
  valuation: CodexLedgerValuation,
  coverage: CodexLedgerCoverage,
  sources: Schema.Array(CodexLedgerSourceStatus),
});
export type CodexLedgerSummary = typeof CodexLedgerSummary.Type;

export const CodexLedgerListTurnsInput = Schema.Struct({
  cursor: Schema.optional(PageCursor),
  limit: Schema.optional(PageLimit),
  sourceDomain: Schema.optional(LedgerId),
  codexThreadId: Schema.optional(LedgerId),
  t3ThreadId: Schema.optional(LedgerId),
  t3TurnId: Schema.optional(LedgerId),
  rootTurnId: Schema.optional(LedgerId),
  from: Schema.optional(Schema.String),
  to: Schema.optional(Schema.String),
});
export type CodexLedgerListTurnsInput = typeof CodexLedgerListTurnsInput.Type;
export const CodexLedgerListTurnsResult = Schema.Struct({
  items: Schema.Array(CodexLedgerTurn),
  nextCursor: Schema.NullOr(Schema.String),
});
export const CodexLedgerTurnInput = Schema.Struct({
  sourceDomain: LedgerId,
  codexThreadId: LedgerId,
  codexTurnId: LedgerId,
});
export type CodexLedgerTurnInput = typeof CodexLedgerTurnInput.Type;
export const CodexLedgerTurnDetail = Schema.Struct({
  turn: CodexLedgerTurn,
  responses: Schema.Array(CodexLedgerResponse),
  /** All observed root-linked turns are included in these totals, including children beyond the preview. */
  family: Schema.Struct({
    rootTurnId: LedgerId,
    includedTurnCount: NonNegativeInt,
    childTurnCount: NonNegativeInt,
    unresolvedChildCount: NonNegativeInt,
    activeChildTurnCount: NonNegativeInt,
    childPreviewTruncated: Schema.Boolean,
    tokens: CodexLedgerTokens,
    valuation: CodexLedgerValuation,
    coverage: CodexLedgerCoverage,
  }),
  childTurns: Schema.Array(CodexLedgerTurn),
  tools: Schema.Array(
    Schema.Struct({
      callId: Schema.String,
      name: Schema.NullOr(Schema.String),
      status: Schema.NullOr(Schema.String),
      outputBytes: Schema.NullOr(NonNegativeInt),
      occurredAt: Schema.NullOr(Schema.String),
    }),
  ),
});
export type CodexLedgerTurnDetail = typeof CodexLedgerTurnDetail.Type;
export const CodexLedgerFamilyInput = Schema.Struct({
  sourceDomain: LedgerId,
  rootTurnId: LedgerId,
  cursor: Schema.optional(PageCursor),
  limit: Schema.optional(PageLimit),
});
export type CodexLedgerFamilyInput = typeof CodexLedgerFamilyInput.Type;
export const CodexLedgerSetCaptureInput = Schema.Struct({ active: Schema.Boolean });
export const CodexLedgerExportInput = Schema.Struct({
  format: Schema.Literals(["jsonl"]),
  sourceDomain: Schema.optional(LedgerId),
  from: Schema.optional(Schema.String),
  to: Schema.optional(Schema.String),
  cursor: Schema.optional(PageCursor),
  limit: Schema.optional(PageLimit),
});
export type CodexLedgerExportInput = typeof CodexLedgerExportInput.Type;
export const CodexLedgerExportResult = Schema.Struct({
  format: Schema.Literal("jsonl"),
  data: Schema.String,
  nextCursor: Schema.NullOr(Schema.String),
});

export const CodexLedgerExperiment = Schema.Struct({
  experimentId: LedgerId,
  name: Schema.String,
  createdAt: Schema.String,
  manifestJson: SmallJson,
});
export const CodexLedgerExperimentInput = Schema.Struct({
  experimentId: LedgerId,
  name: Schema.String,
  manifestJson: SmallJson,
});
export type CodexLedgerExperimentInput = typeof CodexLedgerExperimentInput.Type;
export const CodexLedgerRun = Schema.Struct({
  runId: Schema.String,
  experimentId: Schema.String,
  caseId: Schema.String,
  cohort: Schema.String,
  rootTurnId: Schema.NullOr(Schema.String),
  sourceDomain: Schema.NullOr(Schema.String),
  status: Schema.Literals(["planned", "running", "accepted", "failed", "unknown"]),
  metadataJson: SmallJson,
  outcomeJson: Schema.NullOr(SmallJson),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export const CodexLedgerRunInput = Schema.Struct({
  runId: Schema.String,
  experimentId: Schema.String,
  caseId: Schema.String,
  cohort: Schema.String,
  rootTurnId: Schema.NullOr(Schema.String),
  sourceDomain: Schema.NullOr(Schema.String),
  status: Schema.Literals(["planned", "running", "accepted", "failed", "unknown"]),
  metadataJson: SmallJson,
  outcomeJson: Schema.NullOr(SmallJson),
});
export type CodexLedgerRunInput = typeof CodexLedgerRunInput.Type;
export const CodexLedgerExperimentIdInput = Schema.Struct({ experimentId: Schema.String });
export const CodexLedgerExperimentDetail = Schema.Struct({
  experiment: CodexLedgerExperiment,
  runs: Schema.Array(CodexLedgerRun),
  reportJson: Schema.String,
});
export const CodexLedgerExperimentList = Schema.Struct({
  items: Schema.Array(CodexLedgerExperiment),
});
export const CodexLedgerRateSnapshot = Schema.Struct({
  snapshotId: Schema.String,
  capturedAt: Schema.String,
  sourceUrl: Schema.String,
  rulesJson: Schema.String,
  calculationVersion: Schema.String,
  active: Schema.Boolean,
});
export const CodexLedgerRateSnapshotList = Schema.Struct({
  items: Schema.Array(CodexLedgerRateSnapshot),
});
export const CodexLedgerCreateRateSnapshotInput = Schema.Struct({
  snapshotId: LedgerId,
  /** Full immutable CodexRateSnapshot JSON. Source, retrieval date, and tier are required. */
  rulesJson: SmallJson,
});
export type CodexLedgerCreateRateSnapshotInput = typeof CodexLedgerCreateRateSnapshotInput.Type;
export const CodexLedgerSelectRateSnapshotInput = Schema.Struct({ snapshotId: LedgerId });
export type CodexLedgerSelectRateSnapshotInput = typeof CodexLedgerSelectRateSnapshotInput.Type;
export const CodexLedgerJevReceiptInput = Schema.Struct({
  requestId: Schema.String,
  attemptId: Schema.String,
  rootTurnId: Schema.NullOr(Schema.String),
  toolUseId: Schema.NullOr(Schema.String),
  environmentId: Schema.NullOr(Schema.String),
  projectId: Schema.NullOr(Schema.String),
  threadId: Schema.NullOr(Schema.String),
  messageId: Schema.NullOr(Schema.String),
  turnId: Schema.NullOr(Schema.String),
  providerThreadId: Schema.NullOr(Schema.String),
  providerTurnId: Schema.NullOr(Schema.String),
  childProviderThreadId: Schema.NullOr(Schema.String),
  parentProviderTurnId: Schema.NullOr(Schema.String),
  dispatchId: Schema.NullOr(Schema.String),
  observedModel: Schema.NullOr(Schema.String),
  sourceScope: Schema.NullOr(Schema.Literals(["turn", "subagent"])),
  receiptStorageError: Schema.optional(Schema.Boolean),
  decisionJson: Schema.String,
  dispatchJson: Schema.NullOr(Schema.String),
  /** Actual Jev charge, kept separate from hypothetical Codex API valuation. */
  reportedCostUsd: Schema.NullOr(Schema.String),
  estimatedCostUsd: Schema.NullOr(Schema.String),
  status: Schema.Literals(["proposed", "dispatched", "cancelled", "failed", "completed"]),
});
export type CodexLedgerJevReceiptInput = typeof CodexLedgerJevReceiptInput.Type;
export const CodexLedgerQuotaObservation = Schema.Struct({
  sourceDomain: Schema.String,
  bucketId: Schema.String,
  observedAt: Schema.String,
  usedPercent: Schema.NullOr(Schema.Number),
  windowDurationMins: Schema.NullOr(Schema.Number),
  resetsAt: Schema.NullOr(Schema.String),
  plan: Schema.NullOr(Schema.String),
});
export const CodexLedgerQuotaInput = Schema.Struct({
  sourceDomain: Schema.optional(LedgerId),
  cursor: Schema.optional(PageCursor),
  limit: Schema.optional(PageLimit),
});
export type CodexLedgerQuotaInput = typeof CodexLedgerQuotaInput.Type;
export const CodexLedgerQuotaResult = Schema.Struct({
  items: Schema.Array(CodexLedgerQuotaObservation),
  nextCursor: Schema.NullOr(Schema.String),
});
export class CodexLedgerError extends Schema.TaggedError<CodexLedgerError>()("CodexLedgerError", {
  message: Schema.String,
}) {}
