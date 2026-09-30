import * as Schema from "effect/Schema";

export const DiviWorkspaceOperation = Schema.Literals([
  "list",
  "identify",
  "main-info",
  "main-create",
  "main-repair",
  "main-site-status",
  "main-site-start",
  "main-site-stop",
  "inspect",
  "destroy",
  "validate",
  "create",
  "doctor",
  "status",
  "start",
  "stop",
  "restart",
  "watcher-start",
  "watcher-stop",
  "watcher-restart",
  "watcher-log",
  "test",
  "transfer-preview",
  "transfer-apply",
  "review-record",
  "cleanup-review",
]);
export type DiviWorkspaceOperation = typeof DiviWorkspaceOperation.Type;

export const DiviWorkspaceRunInput = Schema.Struct({
  operation: DiviWorkspaceOperation,
  workspaceId: Schema.optional(Schema.String),
  mainId: Schema.optional(Schema.String),
  projectPath: Schema.optional(Schema.String),
  manifestPath: Schema.optional(Schema.String),
  preset: Schema.optional(Schema.Literals(["divi", "fluent-forms"])),
  planId: Schema.optional(Schema.String),
  profileId: Schema.optional(Schema.String),
  reviewFile: Schema.optional(Schema.String),
  confirmWorkspaceId: Schema.optional(Schema.String),
  discardChanges: Schema.optional(Schema.Boolean),
  includeDiskUsage: Schema.optional(Schema.Boolean),
});
export type DiviWorkspaceRunInput = typeof DiviWorkspaceRunInput.Type;

export const DiviWorkspaceWatcherDetail = Schema.Struct({
  enabled: Schema.Boolean,
  state: Schema.Literals([
    "not-requested",
    "stopped",
    "running-unverified",
    "ready",
    "degraded",
    "stopping-unverified",
    "ownership-uncertain",
  ]),
  pid: Schema.optional(Schema.NullOr(Schema.Number)),
  startedAt: Schema.optional(Schema.NullOr(Schema.String)),
  logPath: Schema.optional(Schema.NullOr(Schema.String)),
  logTail: Schema.optional(Schema.NullOr(Schema.String)),
  logBytes: Schema.optional(Schema.NullOr(Schema.Number)),
  logTruncated: Schema.optional(Schema.Boolean),
  canVerifyBuild: Schema.optional(Schema.Boolean),
});

export const DiviWorkspaceWatcherLog = Schema.Struct({
  profileId: Schema.String,
  logTail: Schema.String,
  logBytes: Schema.Number,
  logTruncated: Schema.Boolean,
  observedAt: Schema.String,
});

export const DiviWorkspaceRuntimeService = Schema.Struct({
  state: Schema.Literals(["running", "stopped", "missing", "error"]),
  health: Schema.Literals(["healthy", "starting", "unhealthy", "unknown"]),
  containerName: Schema.String,
});

export const DiviWorkspaceRuntimeStatus = Schema.Struct({
  website: Schema.optional(
    Schema.Struct({
      ...DiviWorkspaceRuntimeService.fields,
      port: Schema.Number,
    }),
  ),
  database: Schema.optional(DiviWorkspaceRuntimeService),
  observedAt: Schema.optional(Schema.String),
});

// The helper owns the versioned resource schema. Keep the T3 boundary stable
// while preserving its structured result for display and future revisions.
export const DiviWorkspaceRunResult = Schema.Struct({
  schemaVersion: Schema.Number,
  helperVersion: Schema.String,
  operation: Schema.String,
  status: Schema.String,
  operationInProgress: Schema.optional(Schema.Boolean),
  workspaceId: Schema.optional(Schema.String),
  readiness: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  milestones: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  baseline: Schema.optional(Schema.Unknown),
  prepareProfiles: Schema.optional(Schema.Array(Schema.String)),
  prepareReceipts: Schema.optional(Schema.Unknown),
  paths: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  preview: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  resources: Schema.optional(Schema.Unknown),
  receipts: Schema.optional(Schema.Unknown),
  workspaces: Schema.optional(Schema.Unknown),
  operations: Schema.optional(Schema.Unknown),
  operationRecord: Schema.optional(Schema.Unknown),
  originalRepositories: Schema.optional(Schema.Unknown),
  mainCheckouts: Schema.optional(Schema.Unknown),
  mainCheckoutId: Schema.optional(Schema.NullOr(Schema.String)),
  repositoryGit: Schema.optional(Schema.Unknown),
  siteReadiness: Schema.optional(Schema.Unknown),
  previewUrl: Schema.optional(Schema.String),
  containerUsage: Schema.optional(Schema.Unknown),
  diskBytes: Schema.optional(Schema.Number),
  changed: Schema.optional(Schema.NullOr(Schema.Boolean)),
  planId: Schema.optional(Schema.String),
  verification: Schema.optional(Schema.Unknown),
  sourceDigest: Schema.optional(Schema.String),
  mainSnapshot: Schema.optional(Schema.String),
  watcherProfiles: Schema.optional(Schema.Array(Schema.String)),
  watcherDetails: Schema.optional(Schema.Record(Schema.String, DiviWorkspaceWatcherDetail)),
  watcherLog: Schema.optional(DiviWorkspaceWatcherLog),
  runtimeStatus: Schema.optional(DiviWorkspaceRuntimeStatus),
  testProfiles: Schema.optional(Schema.Array(Schema.String)),
  watchers: Schema.optional(Schema.Unknown),
  repositoryDetails: Schema.optional(Schema.Unknown),
  repositories: Schema.optional(Schema.Unknown),
  testReceipt: Schema.optional(Schema.Unknown),
  journal: Schema.optional(Schema.String),
  issues: Schema.optional(Schema.Array(Schema.String)),
  eligible: Schema.optional(Schema.Boolean),
  taskChanges: Schema.optional(Schema.Unknown),
  activeWatchers: Schema.optional(Schema.Unknown),
  resourceDispositionRequired: Schema.optional(Schema.Boolean),
  error: Schema.optional(Schema.Unknown),
  available: Schema.optional(Schema.Boolean),
});
export type DiviWorkspaceRunResult = typeof DiviWorkspaceRunResult.Type;

export class DiviWorkspaceError extends Schema.TaggedError<DiviWorkspaceError>()(
  "DiviWorkspaceError",
  { message: Schema.String, result: Schema.optional(DiviWorkspaceRunResult) },
) {}
