import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { DiviWorkspaceRunResult } from "./diviWorkspace.ts";

it("preserves repository and profile details across the RPC result schema", () => {
  const payload = {
    schemaVersion: 1,
    helperVersion: "0.1.0",
    operation: "status",
    status: "degraded",
    workspaceId: "pilot-a",
    operationInProgress: false,
    milestones: {
      code: {
        startedAt: "2026-09-29T09:00:00Z",
        readyAt: "2026-09-29T09:00:08Z",
        durationMs: 8000,
      },
    },
    repositoryDetails: {
      builder: {
        mainPath: "/main/builder",
        taskPath: "/workspaces/pilot-a/builder",
        baseCommit: "abc",
      },
    },
    watcherProfiles: ["builder"],
    watcherDetails: {
      builder: {
        enabled: true,
        state: "ready",
        pid: null,
        startedAt: null,
        logBytes: 21,
        logTruncated: false,
        canVerifyBuild: true,
      },
    },
    runtimeStatus: {
      website: {
        state: "running",
        health: "healthy",
        containerName: "diviws-pilot-a-web-1",
        port: 8110,
      },
      database: {
        state: "running",
        health: "healthy",
        containerName: "diviws_database-db-1",
      },
      observedAt: "2026-09-29T13:00:00Z",
    },
    testProfiles: ["fluent-jest"],
    verification: {
      status: "ready",
      digest: "abc",
      testReceiptIds: { "fluent-jest": "receipt-1" },
    },
  } as const;
  const decoded = Schema.decodeSync(DiviWorkspaceRunResult)(payload);
  const encoded = Schema.encodeSync(DiviWorkspaceRunResult)(decoded);
  assert.deepEqual(encoded.repositoryDetails, payload.repositoryDetails);
  assert.deepEqual(encoded.watcherProfiles, payload.watcherProfiles);
  assert.deepEqual(encoded.watcherDetails, payload.watcherDetails);
  assert.deepEqual(encoded.runtimeStatus, payload.runtimeStatus);
  assert.deepEqual(encoded.testProfiles, payload.testProfiles);
  assert.equal(encoded.operationInProgress, false);
  assert.deepEqual(encoded.milestones, payload.milestones);
  assert.deepEqual(encoded.verification, payload.verification);
});

it("accepts a source-only workspace without a website runtime", () => {
  const decoded = Schema.decodeSync(DiviWorkspaceRunResult)({
    schemaVersion: 1,
    helperVersion: "0.1.0",
    operation: "status",
    status: "ready",
    workspaceId: "code-only",
    runtimeStatus: {},
    readiness: { code: "ready", website: "not-requested", tests: "not-requested" },
  });
  assert.deepEqual(decoded.runtimeStatus, {});
});

it("encodes replicas that use the original main checkout", () => {
  const result = {
    schemaVersion: 1,
    helperVersion: "0.1.0",
    operation: "inspect",
    status: "ready",
    workspaceId: "pilot-a",
    mainCheckoutId: null,
  };
  assert.equal(
    Schema.encodeSync(DiviWorkspaceRunResult)(Schema.decodeSync(DiviWorkspaceRunResult)(result))
      .mainCheckoutId,
    null,
  );
});

it("preserves an explicitly requested bounded watcher log", () => {
  const decoded = Schema.decodeSync(DiviWorkspaceRunResult)({
    schemaVersion: 1,
    helperVersion: "0.1.0",
    operation: "watcher-log",
    status: "ready",
    workspaceId: "pilot-a",
    watcherLog: {
      profileId: "builder",
      logTail: "Compiled successfully",
      logBytes: 21,
      logTruncated: false,
      observedAt: "2026-09-29T13:00:00Z",
    },
  });
  assert.equal(decoded.watcherLog?.logTail, "Compiled successfully");
});

it("preserves lifecycle progress in a workspace list", () => {
  const operations = [
    {
      workspaceId: "pilot-a",
      operation: "destroy",
      phase: "Removing site files",
      status: "running",
    },
  ];
  const result = Schema.encodeSync(DiviWorkspaceRunResult)(
    Schema.decodeSync(DiviWorkspaceRunResult)({
      schemaVersion: 1,
      helperVersion: "0.1.0",
      operation: "list",
      status: "ready",
      workspaces: [],
      operations,
    }),
  );
  assert.deepEqual(result.operations, operations);
});
