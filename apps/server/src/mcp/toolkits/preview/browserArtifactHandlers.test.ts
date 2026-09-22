import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  BrowserArtifactActionId,
  BrowserArtifactId,
  EnvironmentId,
  PreviewAutomationArtifactTransferError,
  PreviewTabId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { createPendingAttachmentId } from "../../../attachmentStore.ts";
import * as ServerConfig from "../../../config.ts";
import * as WorkspacePaths from "../../../workspace/WorkspacePaths.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as PreviewAutomationBroker from "../../PreviewAutomationBroker.ts";
import {
  browserArtifactHandlers,
  claimBrowserDownload,
  resolveWorkspaceUploadFile,
  uploadSourceBelongsToThread,
} from "./browserArtifactHandlers.ts";

const workspaceLayer = Layer.empty.pipe(
  Layer.provideMerge(WorkspacePaths.layer),
  Layer.provideMerge(NodeServices.layer),
);

const claimLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-browser-artifact-claim-",
}).pipe(Layer.provideMerge(NodeServices.layer));

const scope = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};

describe("browser upload source scope", () => {
  it("derives workspace ownership from the invocation when the public source omits threadId", () => {
    expect(
      uploadSourceBelongsToThread(scope.threadId, {
        kind: "workspace-file",
        path: "upload-sample.txt",
      }),
    ).toBe(true);
  });

  it("rejects foreign workspace and attachment identities before resolving paths", () => {
    expect(
      uploadSourceBelongsToThread(scope.threadId, {
        kind: "workspace-file",
        threadId: ThreadId.make("thread-2"),
        path: "report.csv",
      }),
    ).toBe(false);
    expect(
      uploadSourceBelongsToThread(scope.threadId, {
        kind: "attachment",
        attachmentId: "thread-2-00000000-0000-4000-8000-000000000001-csv",
      }),
    ).toBe(false);
    expect(
      uploadSourceBelongsToThread(scope.threadId, {
        kind: "attachment",
        attachmentId: "thread-1-00000000-0000-4000-8000-000000000001-csv",
      }),
    ).toBe(true);
  });

  it.effect(
    "accepts an exact regular file and rejects traversal or a symlink outside the workspace",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "browser-upload-root-" });
        const outside = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "browser-upload-outside-",
        });
        yield* fileSystem.writeFileString(path.join(root, "report.csv"), "a,b\n1,2\n");
        yield* fileSystem.writeFileString(path.join(outside, "secret.csv"), "secret\n");

        const file = yield* resolveWorkspaceUploadFile(scope, root, "report.csv");
        expect(file).toMatchObject({
          fileName: "report.csv",
          mimeType: "text/csv",
          sizeBytes: 8,
        });

        const traversal = yield* resolveWorkspaceUploadFile(scope, root, "../secret.csv").pipe(
          Effect.result,
        );
        expect(traversal).toMatchObject({
          _tag: "Failure",
          failure: { reason: "scope-mismatch" },
        });

        const alias = path.join(root, "linked.csv");
        yield* fileSystem.symlink(path.join(outside, "secret.csv"), alias);
        const linked = yield* resolveWorkspaceUploadFile(scope, root, "linked.csv").pipe(
          Effect.result,
        );
        expect(linked).toMatchObject({
          _tag: "Failure",
          failure: { reason: "scope-mismatch" },
        });
      }).pipe(Effect.scoped, Effect.provide(workspaceLayer)),
  );
});

describe("claimBrowserDownload", () => {
  it.effect("claims one exact pending upload idempotently without trusting the desktop path", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const uploadedAttachmentId = createPendingAttachmentId(".csv");
      const pendingPath = path.join(config.attachmentsDir, `${uploadedAttachmentId}.csv`);
      yield* fileSystem.makeDirectory(config.attachmentsDir, { recursive: true });
      yield* fileSystem.writeFileString(pendingPath, "a,b\n1,2\n");
      const response = {
        environmentId: scope.environmentId,
        tabId: PreviewTabId.make("tab-1"),
        actionId: BrowserArtifactActionId.make("action-1"),
        artifactId: BrowserArtifactId.make("desktop-artifact-1"),
        fileName: "report.csv",
        mimeType: "text/csv",
        sizeBytes: 8,
        status: "completed" as const,
        completedAt: "2026-09-22T00:00:00.000Z",
        uploadedAttachmentId,
      };

      const claim = claimBrowserDownload(scope, response);
      const [first, overlapping] = yield* Effect.all([claim, claim], {
        concurrency: "unbounded",
      });
      expect(overlapping).toEqual(first);
      expect(yield* claim).toEqual(first);
      expect(first.path).not.toContain("desktop-artifact-1");
      expect(yield* fileSystem.readFileString(first.path)).toBe("a,b\n1,2\n");
      expect(yield* fileSystem.exists(pendingPath)).toBe(false);
    }).pipe(Effect.provide(claimLayer)),
  );

  it.effect("leaves a mismatched pending upload unclaimed", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const uploadedAttachmentId = createPendingAttachmentId(".csv");
      const pendingPath = path.join(config.attachmentsDir, `${uploadedAttachmentId}.csv`);
      yield* fileSystem.makeDirectory(config.attachmentsDir, { recursive: true });
      yield* fileSystem.writeFileString(pendingPath, "actual");
      const result = yield* claimBrowserDownload(scope, {
        environmentId: scope.environmentId,
        tabId: PreviewTabId.make("tab-1"),
        actionId: BrowserArtifactActionId.make("action-1"),
        artifactId: BrowserArtifactId.make("desktop-artifact-1"),
        fileName: "report.csv",
        sizeBytes: 4,
        status: "completed",
        completedAt: "2026-09-22T00:00:00.000Z",
        uploadedAttachmentId,
      }).pipe(Effect.result);

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { reason: "claim-invalid" },
      });
      expect(yield* fileSystem.exists(pendingPath)).toBe(true);
    }).pipe(Effect.provide(claimLayer)),
  );
});

describe("preview_download routing", () => {
  it.effect(
    "pins cleanup to the download lease and never repeats the click when cleanup fails",
    () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const uploadedAttachmentId = createPendingAttachmentId(".csv");
        const pendingPath = path.join(config.attachmentsDir, `${uploadedAttachmentId}.csv`);
        yield* fileSystem.makeDirectory(config.attachmentsDir, { recursive: true });
        yield* fileSystem.writeFileString(pendingPath, "data");

        const lease = { clientId: "desktop-1", connectionId: "connection-1" };
        const calls: Array<{
          operation: string;
          hostLease?: PreviewAutomationBroker.PreviewAutomationHostLease;
          tabId?: PreviewTabId;
        }> = [];
        const broker = PreviewAutomationBroker.PreviewAutomationBroker.of({
          connect: () => Effect.die("unused"),
          focusHost: () => Effect.die("unused"),
          respond: () => Effect.die("unused"),
          invoke: <A>(request: PreviewAutomationBroker.PreviewAutomationInvokeInput) => {
            calls.push({
              operation: request.operation,
              ...(request.hostLease ? { hostLease: request.hostLease } : {}),
              ...(request.tabId ? { tabId: request.tabId } : {}),
            });
            if (request.operation === "status") {
              request.onHostLease?.(lease);
              return Effect.succeed({
                available: true,
                visible: false,
                tabId: PreviewTabId.make("tab-1"),
                url: "https://example.test/report",
                title: "Report",
                loading: false,
              } as A);
            }
            if (request.operation === "downloadFile") {
              const input = request.input as {
                readonly expectation: {
                  readonly actionId: ReturnType<typeof BrowserArtifactActionId.make>;
                };
              };
              return Effect.succeed({
                environmentId: scope.environmentId,
                tabId: PreviewTabId.make("tab-1"),
                actionId: input.expectation.actionId,
                artifactId: BrowserArtifactId.make("desktop-artifact-1"),
                fileName: "report.csv",
                sizeBytes: 4,
                status: "completed",
                completedAt: "2026-09-22T00:00:00.000Z",
                uploadedAttachmentId,
              } as A);
            }
            return Effect.fail(
              new PreviewAutomationArtifactTransferError({
                operation: "downloadFile",
                environmentId: scope.environmentId,
                threadId: scope.threadId,
                reason: "transfer-failed",
              }),
            );
          },
        });
        const invocation: McpInvocationContext.McpInvocationScope = {
          ...scope,
          providerSessionId: "provider-session-1",
          providerInstanceId: ProviderInstanceId.make("provider-1"),
          capabilities: new Set(["preview"]),
          issuedAt: 0,
        };

        const result = yield* browserArtifactHandlers
          .preview_download({ target: { selector: "#export" } })
          .pipe(
            Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
            Effect.provideService(PreviewAutomationBroker.PreviewAutomationBroker, broker),
          );

        expect(result).toMatchObject({
          status: "completed",
          cleanupPending: true,
          cleanupWarning: expect.stringContaining("retained"),
        });
        expect(calls.map((call) => call.operation)).toEqual([
          "status",
          "downloadFile",
          "artifactAcknowledge",
        ]);
        expect(calls[1]).toMatchObject({ hostLease: lease, tabId: "tab-1" });
        expect(calls[2]).toMatchObject({ hostLease: lease, tabId: "tab-1" });
        expect(yield* fileSystem.readFileString(result.path)).toBe("data");
      }).pipe(Effect.provide(claimLayer)),
  );
});

describe("preview_dialog_status routing", () => {
  it.effect(
    "routes directly while preserving the invocation environment and exact optional tab",
    () =>
      Effect.gen(function* () {
        const calls: Array<PreviewAutomationBroker.PreviewAutomationInvokeInput> = [];
        const broker = PreviewAutomationBroker.PreviewAutomationBroker.of({
          connect: () => Effect.die("unused"),
          focusHost: () => Effect.die("unused"),
          respond: () => Effect.die("unused"),
          invoke: <A>(request: PreviewAutomationBroker.PreviewAutomationInvokeInput) => {
            calls.push(request);
            if (request.operation !== "dialogStatus") {
              return Effect.die(`unexpected preliminary ${request.operation} request`);
            }
            return Effect.succeed({ dialog: null } as A);
          },
        });
        const invocation: McpInvocationContext.McpInvocationScope = {
          ...scope,
          providerSessionId: "provider-session-1",
          providerInstanceId: ProviderInstanceId.make("provider-1"),
          capabilities: new Set(["preview"]),
          issuedAt: 0,
        };
        expect(
          yield* browserArtifactHandlers
            .preview_dialog_status({ tabId: PreviewTabId.make("tab-7") })
            .pipe(
              Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
              Effect.provideService(PreviewAutomationBroker.PreviewAutomationBroker, broker),
            ),
        ).toEqual({ dialog: null });
        expect(
          yield* browserArtifactHandlers
            .preview_dialog_status({})
            .pipe(
              Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
              Effect.provideService(PreviewAutomationBroker.PreviewAutomationBroker, broker),
            ),
        ).toEqual({ dialog: null });

        expect(calls).toHaveLength(2);
        expect(calls[0]).toMatchObject({
          scope: invocation,
          operation: "dialogStatus",
          input: { environmentId: scope.environmentId, tabId: "tab-7" },
          tabId: "tab-7",
          updateCurrentTab: false,
        });
        expect(calls[1]).toMatchObject({
          scope: invocation,
          operation: "dialogStatus",
          input: { environmentId: scope.environmentId },
          updateCurrentTab: false,
        });
        expect(calls[1]?.tabId).toBeUndefined();
      }),
  );
});
