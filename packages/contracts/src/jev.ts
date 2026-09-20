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
  objectiveProvenance: Schema.optionalKey(
    Schema.Literals(["user_message", "accepted_plan", "first_available", "unknown"]),
  ),
  historyCompleteness: Schema.optionalKey(Schema.Literals(["complete", "windowed", "missing"])),
  missingContext: Schema.optionalKey(Schema.Array(Schema.String)),
  evidence: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        kind: Schema.String,
        text: Schema.String,
        sourceTurnId: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
  priorAttempts: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        turnId: Schema.String,
        model: Schema.optionalKey(Schema.String),
        effort: Schema.optionalKey(Schema.String),
        outcome: Schema.String,
      }),
    ),
  ),
  target: Schema.optionalKey(
    Schema.Struct({
      kind: Schema.Literals(["turn", "independent_child"]),
      inheritedContext: Schema.Literals(["none", "bounded", "full"]),
    }),
  ),
  selectionSource: Schema.optionalKey(Schema.Literals(["user", "agent_default"])),
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
  evaluationPolicy: Schema.optionalKey(Schema.Literals(["baseline-v3", "baseline-v4.1"])),
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
  policyOutcome: Schema.optionalKey(
    Schema.Literals(["route", "review", "needs_context", "unavailable"]),
  ),
  reasons: Schema.optionalKey(Schema.Array(Schema.String)),
  admissibleCandidateKeys: Schema.optionalKey(Schema.Array(Schema.String)),
  proposedChoice: Schema.optionalKey(Schema.NullOr(Schema.String)),
  modelConfidence: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  effortConfidence: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  responseModel: Schema.optionalKey(Schema.String),
  requestFingerprint: Schema.optionalKey(Schema.String),
  evaluationPayload: Schema.optionalKey(Schema.String),
  policyVersion: Schema.optionalKey(Schema.String),
  conditionalEffort: Schema.optionalKey(
    Schema.Struct({
      model: Schema.String,
      effort: JevEffort,
      confidence: Schema.Number,
    }),
  ),
  decisionStable: Schema.optionalKey(Schema.Boolean),
  uncertaintyAlternatives: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Array(Schema.String)),
  ),
  explanation: Schema.optionalKey(Schema.String),
  receiptStorageError: Schema.optional(Schema.Boolean),
});
export type JevRouteResult = typeof JevRouteResult.Type;

export const JevSubagentPolicy = Schema.Struct({
  threadId: Schema.String,
  providerInstanceId: Schema.String,
  enabled: Schema.Boolean,
  candidates: Schema.Array(JevCandidate),
  context: Schema.optionalKey(JevRoutingContext),
  ledgerContext: Schema.optional(
    Schema.Struct({
      environmentId: Schema.String,
      projectId: Schema.NullOr(Schema.String),
      threadId: Schema.String,
      sourceScope: Schema.Literal("subagent"),
    }),
  ),
});
export type JevSubagentPolicy = typeof JevSubagentPolicy.Type;

export const JevSubagentDecision = Schema.Struct({
  threadId: Schema.String,
  providerInstanceId: Schema.String,
  request: JevRouteRequest,
  result: Schema.NullOr(JevRouteResult),
  toolUseId: Schema.optional(Schema.String),
  attemptId: Schema.optional(Schema.String),
  dispatchModel: Schema.optional(Schema.String),
  dispatchEffort: Schema.optional(Schema.String),
  parentProviderTurnId: Schema.optional(Schema.String),
  receiptStorageError: Schema.optional(Schema.Boolean),
  ledgerContext: Schema.optional(
    Schema.Struct({
      environmentId: Schema.String,
      projectId: Schema.NullOr(Schema.String),
      threadId: Schema.String,
      sourceScope: Schema.Literals(["turn", "subagent"]),
    }),
  ),
});
export type JevSubagentDecision = typeof JevSubagentDecision.Type;
