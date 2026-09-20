import * as Schema from "effect/Schema";

export const JevStatus = Schema.Struct({
  hasKey: Schema.Boolean,
  secureStorageAvailable: Schema.Boolean,
});
export type JevStatus = typeof JevStatus.Type;

export const JevEffort = Schema.Literals(["low", "medium", "high", "xhigh"]);
export type JevEffort = typeof JevEffort.Type;
export const JevCandidate = Schema.Struct({
  key: Schema.String,
  description: Schema.String,
  model: Schema.optionalKey(Schema.String),
  effort: Schema.optionalKey(JevEffort),
});
export type JevCandidate = typeof JevCandidate.Type;
export const JevRoutingContext = Schema.Struct({
  existingSession: Schema.Boolean,
  hasAttachments: Schema.Boolean,
  interactionMode: Schema.String,
  originalTask: Schema.optionalKey(Schema.String),
  activePlan: Schema.optionalKey(Schema.String),
  currentModel: Schema.optionalKey(Schema.String),
  currentEffort: Schema.optionalKey(Schema.String),
  history: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        role: Schema.Literals(["user", "assistant"]),
        text: Schema.String,
        model: Schema.optionalKey(Schema.String),
        effort: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
  historyExchangeCount: Schema.optionalKey(Schema.Number),
  omissions: Schema.optionalKey(Schema.Array(Schema.String)),
  failure: Schema.optionalKey(
    Schema.Struct({
      unresolved: Schema.Boolean,
      signals: Schema.Array(Schema.String),
      model: Schema.optionalKey(Schema.String),
      effort: Schema.optionalKey(Schema.String),
    }),
  ),
  budget: Schema.optionalKey(
    Schema.Struct({
      checkedAt: Schema.String,
      windows: Schema.Array(
        Schema.Struct({
          label: Schema.String,
          remainingPercent: Schema.Number,
          resetsAt: Schema.optionalKey(Schema.String),
        }),
      ),
      unavailableReason: Schema.optionalKey(Schema.String),
    }),
  ),
});
export type JevRoutingContext = typeof JevRoutingContext.Type;

export const JevRouteRequest = Schema.Struct({
  requestId: Schema.String,
  prompt: Schema.String,
  candidates: Schema.Array(JevCandidate),
  context: JevRoutingContext,
});
export type JevRouteRequest = typeof JevRouteRequest.Type;

export const JevRouteResult = Schema.Struct({
  choice: Schema.NullOr(Schema.String),
  confidence: Schema.NullOr(Schema.Number),
  probabilities: Schema.Record(Schema.String, Schema.Number),
  latencyMs: Schema.Number,
  error: Schema.NullOr(Schema.String),
  inputTokens: Schema.NullOr(Schema.Number),
  outputTokens: Schema.NullOr(Schema.Number),
  costUsd: Schema.NullOr(Schema.Number),
  costKind: Schema.Literals(["billed", "estimated", "unknown"]),
  recommendedChoice: Schema.optionalKey(Schema.NullOr(Schema.String)),
  assessments: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        choice: Schema.String,
        confidence: Schema.Number,
        probabilities: Schema.Record(Schema.String, Schema.Number),
      }),
    ),
  ),
  policyVersion: Schema.optionalKey(Schema.String),
  explanation: Schema.optionalKey(Schema.String),
});
export type JevRouteResult = typeof JevRouteResult.Type;

export const JevSubagentPolicy = Schema.Struct({
  threadId: Schema.String,
  providerInstanceId: Schema.String,
  enabled: Schema.Boolean,
  candidates: Schema.Array(JevCandidate),
  context: Schema.optionalKey(JevRoutingContext),
});
export type JevSubagentPolicy = typeof JevSubagentPolicy.Type;

export const JevSubagentDecision = Schema.Struct({
  threadId: Schema.String,
  providerInstanceId: Schema.String,
  request: JevRouteRequest,
  result: Schema.NullOr(JevRouteResult),
});
export type JevSubagentDecision = typeof JevSubagentDecision.Type;
