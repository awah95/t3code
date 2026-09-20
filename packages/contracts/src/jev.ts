import * as Schema from "effect/Schema";

export const JevStatus = Schema.Struct({
  hasKey: Schema.Boolean,
  secureStorageAvailable: Schema.Boolean,
});
export type JevStatus = typeof JevStatus.Type;

export const JevRouteRequest = Schema.Struct({
  requestId: Schema.String,
  prompt: Schema.String,
  candidates: Schema.Array(Schema.Struct({ key: Schema.String, description: Schema.String })),
  context: Schema.Struct({
    existingSession: Schema.Boolean,
    hasAttachments: Schema.Boolean,
    interactionMode: Schema.String,
  }),
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
});
export type JevRouteResult = typeof JevRouteResult.Type;

export const JevSubagentPolicy = Schema.Struct({
  threadId: Schema.String,
  providerInstanceId: Schema.String,
  enabled: Schema.Boolean,
  candidates: Schema.Array(Schema.Struct({ key: Schema.String, description: Schema.String })),
});
export type JevSubagentPolicy = typeof JevSubagentPolicy.Type;

export const JevSubagentDecision = Schema.Struct({
  threadId: Schema.String,
  providerInstanceId: Schema.String,
  request: JevRouteRequest,
  result: Schema.NullOr(JevRouteResult),
});
export type JevSubagentDecision = typeof JevSubagentDecision.Type;
