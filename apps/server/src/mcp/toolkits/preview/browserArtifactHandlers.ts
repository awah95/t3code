import {
  BROWSER_ARTIFACT_MAX_BYTES,
  BrowserArtifactActionId,
  BrowserArtifactFileName,
  BrowserArtifactId,
  BrowserDialogHandleRequest,
  BrowserDialogHandleResult,
  BrowserDialogId,
  BrowserDownloadHostResult,
  BrowserUploadSelection,
  EnvironmentId,
  PreviewAutomationArtifactTransferError,
  PreviewAutomationDialogStatusResult,
  PreviewAutomationStatus,
  PreviewTabId,
  type BrowserArtifactAcknowledgeHostInput,
  type BrowserDownloadHostInput,
  type BrowserUploadHostInput,
  type BrowserUploadSource,
  type PreviewAutomationDialogStatusInput,
  type PreviewAutomationDownloadFileInput,
  type PreviewAutomationUploadFileInput,
  type ThreadId,
  type ToolActivityIcon,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Mime from "effect/unstable/http/Mime";

import {
  attachmentFileExtension,
  createPendingAttachmentId,
  parseAttachmentFileExtension,
  parseAttachmentUuid,
  parseThreadSegmentFromAttachmentId,
  PENDING_ATTACHMENT_THREAD_SEGMENT,
  resolveAttachmentPathById,
  toSafeThreadAttachmentSegment,
} from "../../../attachmentStore.ts";
import { resolveAttachmentRelativePath } from "../../../attachmentPaths.ts";
import { issueAttachmentAssetUrl } from "../../../assets/AssetAccess.ts";
import * as ServerConfig from "../../../config.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as WorkspacePaths from "../../../workspace/WorkspacePaths.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as PreviewAutomationBroker from "../../PreviewAutomationBroker.ts";

const decodeUploadSelection = Schema.decodeUnknownEffect(BrowserUploadSelection);
const decodeDownloadResult = Schema.decodeUnknownEffect(BrowserDownloadHostResult);
const decodeFileName = Schema.decodeUnknownEffect(BrowserArtifactFileName);
const isArtifactTransferError = Schema.is(PreviewAutomationArtifactTransferError);

const transferError = (
  scope: Pick<McpInvocationContext.McpInvocationScope, "environmentId" | "threadId">,
  operation: "uploadFile" | "downloadFile",
  reason: PreviewAutomationArtifactTransferError["reason"],
  cause?: unknown,
) =>
  new PreviewAutomationArtifactTransferError({
    operation,
    environmentId: scope.environmentId,
    threadId: scope.threadId,
    reason,
    ...(cause === undefined ? {} : { cause }),
  });

const isWithinRoot = (
  path: {
    readonly relative: (from: string, to: string) => string;
    readonly isAbsolute: (value: string) => boolean;
    readonly sep: string;
  },
  root: string,
  candidate: string,
) => {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

interface ResolvedUploadSource {
  readonly filePath: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly cleanupPath?: string;
  readonly attachmentId: string;
}

export const uploadSourceBelongsToThread = (threadId: ThreadId, source: BrowserUploadSource) =>
  source.kind === "workspace-file"
    ? source.threadId === undefined || source.threadId === threadId
    : parseThreadSegmentFromAttachmentId(source.attachmentId) ===
      toSafeThreadAttachmentSegment(threadId);

const inspectUploadFile = Effect.fn("PreviewArtifact.inspectUploadFile")(function* (
  scope: Pick<McpInvocationContext.McpInvocationScope, "environmentId" | "threadId">,
  filePath: string,
  fileName: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const stat = yield* fileSystem
    .stat(filePath)
    .pipe(
      Effect.mapError((cause) => transferError(scope, "uploadFile", "source-not-found", cause)),
    );
  const sizeBytes = Number(stat.size);
  if (stat.type !== "File" || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    return yield* transferError(scope, "uploadFile", "source-invalid");
  }
  if (sizeBytes > BROWSER_ARTIFACT_MAX_BYTES) {
    return yield* transferError(scope, "uploadFile", "size-limit");
  }
  const safeFileName = yield* decodeFileName(fileName).pipe(
    Effect.mapError((cause) => transferError(scope, "uploadFile", "source-invalid", cause)),
  );
  return {
    fileName: safeFileName,
    mimeType: Option.getOrElse(Mime.getType(fileName), () => "application/octet-stream"),
    sizeBytes,
  };
});

const resolveWorkspaceRoot = Effect.fn("PreviewArtifact.resolveWorkspaceRoot")(function* (
  scope: Pick<McpInvocationContext.McpInvocationScope, "environmentId" | "threadId">,
) {
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const thread = yield* snapshots
    .getThreadShellById(scope.threadId)
    .pipe(Effect.mapError((cause) => transferError(scope, "uploadFile", "source-invalid", cause)));
  if (Option.isNone(thread)) {
    return yield* transferError(scope, "uploadFile", "source-invalid");
  }
  if (thread.value.worktreePath !== null) return thread.value.worktreePath;
  const project = yield* snapshots
    .getProjectShellById(thread.value.projectId)
    .pipe(Effect.mapError((cause) => transferError(scope, "uploadFile", "source-invalid", cause)));
  if (Option.isNone(project)) {
    return yield* transferError(scope, "uploadFile", "source-invalid");
  }
  return project.value.workspaceRoot;
});

export const resolveWorkspaceUploadFile = Effect.fn("PreviewArtifact.resolveWorkspaceUploadFile")(
  function* (
    scope: Pick<McpInvocationContext.McpInvocationScope, "environmentId" | "threadId">,
    workspaceRoot: string,
    relativePath: string,
  ) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
    const normalizedRoot = yield* workspacePaths
      .normalizeWorkspaceRoot(workspaceRoot)
      .pipe(
        Effect.mapError((cause) => transferError(scope, "uploadFile", "source-invalid", cause)),
      );
    const resolved = yield* workspacePaths
      .resolveRelativePathWithinRoot({ workspaceRoot: normalizedRoot, relativePath })
      .pipe(
        Effect.mapError((cause) => transferError(scope, "uploadFile", "scope-mismatch", cause)),
      );
    const [canonicalRoot, canonicalFile] = yield* Effect.all([
      fileSystem.realPath(normalizedRoot),
      fileSystem.realPath(resolved.absolutePath),
    ]).pipe(
      Effect.mapError((cause) => transferError(scope, "uploadFile", "source-not-found", cause)),
    );
    if (!isWithinRoot(path, canonicalRoot, canonicalFile)) {
      return yield* transferError(scope, "uploadFile", "scope-mismatch");
    }
    const inspected = yield* inspectUploadFile(scope, canonicalFile, path.basename(canonicalFile));
    return { filePath: canonicalFile, ...inspected };
  },
);

const stageWorkspaceUpload = Effect.fn("PreviewArtifact.stageWorkspaceUpload")(function* (
  scope: Pick<McpInvocationContext.McpInvocationScope, "environmentId" | "threadId">,
  source: Extract<BrowserUploadSource, { readonly kind: "workspace-file" }>,
) {
  if (!uploadSourceBelongsToThread(scope.threadId, source)) {
    return yield* transferError(scope, "uploadFile", "scope-mismatch");
  }
  const workspaceRoot = yield* resolveWorkspaceRoot(scope);
  const file = yield* resolveWorkspaceUploadFile(scope, workspaceRoot, source.path);
  const config = yield* ServerConfig.ServerConfig;
  const path = yield* Path.Path;
  const fileSystem = yield* FileSystem.FileSystem;
  const pendingId = createPendingAttachmentId(attachmentFileExtension(file.fileName));
  const extension = parseAttachmentFileExtension(pendingId);
  const stagingPath =
    extension === null
      ? null
      : resolveAttachmentRelativePath({
          attachmentsDir: config.attachmentsDir,
          relativePath: `${pendingId}.${extension}`,
        });
  if (!stagingPath) return yield* transferError(scope, "uploadFile", "source-invalid");
  yield* fileSystem.makeDirectory(path.dirname(stagingPath), { recursive: true }).pipe(
    Effect.andThen(fileSystem.copyFile(file.filePath, stagingPath)),
    Effect.tapError(() => fileSystem.remove(stagingPath, { force: true }).pipe(Effect.ignore)),
    Effect.mapError((cause) => transferError(scope, "uploadFile", "transfer-failed", cause)),
  );
  return {
    ...file,
    attachmentId: pendingId,
    cleanupPath: stagingPath,
  } satisfies ResolvedUploadSource;
});

const resolveAttachmentUpload = Effect.fn("PreviewArtifact.resolveAttachmentUpload")(function* (
  scope: Pick<McpInvocationContext.McpInvocationScope, "environmentId" | "threadId">,
  source: Extract<BrowserUploadSource, { readonly kind: "attachment" }>,
) {
  const config = yield* ServerConfig.ServerConfig;
  if (!uploadSourceBelongsToThread(scope.threadId, source)) {
    return yield* transferError(scope, "uploadFile", "scope-mismatch");
  }
  const filePath = resolveAttachmentPathById({
    attachmentsDir: config.attachmentsDir,
    attachmentId: source.attachmentId,
  });
  if (!filePath) return yield* transferError(scope, "uploadFile", "source-not-found");
  const path = yield* Path.Path;
  const inspected = yield* inspectUploadFile(scope, filePath, path.basename(filePath));
  return {
    filePath,
    ...inspected,
    attachmentId: source.attachmentId,
  } satisfies ResolvedUploadSource;
});

const resolveUploadSource = (
  scope: McpInvocationContext.McpInvocationScope,
  source: BrowserUploadSource,
) =>
  source.kind === "workspace-file"
    ? stageWorkspaceUpload(scope, source)
    : resolveAttachmentUpload(scope, source);

interface TargetedHost {
  readonly tabId: PreviewTabId;
  readonly hostLease: PreviewAutomationBroker.PreviewAutomationHostLease;
  readonly toolIcon?: ToolActivityIcon;
}

const resolveTargetedHost = Effect.fn("PreviewArtifact.resolveTargetedHost")(function* (
  scope: McpInvocationContext.McpInvocationScope,
  operation: "uploadFile" | "downloadFile",
  tabId?: PreviewTabId,
) {
  const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
  let hostLease: PreviewAutomationBroker.PreviewAutomationHostLease | undefined;
  const status = yield* broker.invoke<PreviewAutomationStatus>({
    scope,
    operation: "status",
    input: {},
    ...(tabId === undefined ? {} : { tabId }),
    requiredOperations: new Set(
      operation === "downloadFile" ? [operation, "artifactAcknowledge"] : [operation],
    ),
    updateCurrentTab: false,
    onHostLease: (lease) => {
      hostLease = lease;
    },
  });
  const resolvedTabId = tabId ?? status.tabId ?? undefined;
  if (!hostLease || resolvedTabId === undefined) return null;
  return {
    tabId: resolvedTabId,
    hostLease,
    ...(status.url && /^https?:\/\//i.test(status.url) && status.url.length <= 4096
      ? { toolIcon: { _tag: "website" as const, pageUrl: status.url } }
      : {}),
  } satisfies TargetedHost;
});

const assertArtifactIdentity = <A extends BrowserUploadSelection | BrowserDownloadHostResult>(
  scope: Pick<McpInvocationContext.McpInvocationScope, "environmentId" | "threadId">,
  operation: "uploadFile" | "downloadFile",
  value: A,
  expected: {
    readonly tabId: PreviewTabId;
    readonly actionId: BrowserArtifactActionId;
    readonly artifactId: BrowserArtifactId;
  },
) =>
  value.environmentId === scope.environmentId &&
  value.tabId === expected.tabId &&
  value.actionId === expected.actionId &&
  value.artifactId === expected.artifactId
    ? Effect.succeed(value)
    : Effect.fail(transferError(scope, operation, "scope-mismatch"));

export const claimBrowserDownload = Effect.fn("PreviewArtifact.claimBrowserDownload")(function* (
  scope: Pick<McpInvocationContext.McpInvocationScope, "environmentId" | "threadId">,
  response: BrowserDownloadHostResult,
) {
  if (!response.uploadedAttachmentId) {
    return yield* transferError(scope, "downloadFile", "claim-missing");
  }
  const config = yield* ServerConfig.ServerConfig;
  const uuid = parseAttachmentUuid(response.uploadedAttachmentId);
  const extension = parseAttachmentFileExtension(response.uploadedAttachmentId);
  const threadSegment = toSafeThreadAttachmentSegment(scope.threadId);
  const pendingId = `${PENDING_ATTACHMENT_THREAD_SEGMENT}-${uuid}-${extension}`;
  if (!uuid || !extension || !threadSegment || response.uploadedAttachmentId !== pendingId) {
    return yield* transferError(scope, "downloadFile", "claim-invalid");
  }
  const currentPath = resolveAttachmentRelativePath({
    attachmentsDir: config.attachmentsDir,
    relativePath: `${pendingId}.${extension}`,
  });
  const finalId = `${threadSegment}-${uuid}-${extension}`;
  const finalPath = resolveAttachmentRelativePath({
    attachmentsDir: config.attachmentsDir,
    relativePath: `${finalId}.${extension}`,
  });
  if (!currentPath || !finalPath) {
    return yield* transferError(scope, "downloadFile", "claim-invalid");
  }
  const fileSystem = yield* FileSystem.FileSystem;
  const validateFile = (filePath: string) =>
    fileSystem.stat(filePath).pipe(
      Effect.filterOrFail(
        (stat) =>
          stat.type === "File" &&
          response.sizeBytes > 0 &&
          response.sizeBytes <= BROWSER_ARTIFACT_MAX_BYTES &&
          Number(stat.size) === response.sizeBytes,
        () => transferError(scope, "downloadFile", "claim-invalid"),
      ),
    );
  yield* Effect.gen(function* () {
    yield* validateFile(currentPath);
    yield* fileSystem.rename(currentPath, finalPath);
  }).pipe(
    Effect.catchIf(
      (cause) =>
        cause._tag !== "PreviewAutomationArtifactTransferError" && cause.reason._tag === "NotFound",
      () => validateFile(finalPath),
    ),
    Effect.mapError((cause): PreviewAutomationArtifactTransferError =>
      isArtifactTransferError(cause)
        ? cause
        : transferError(scope, "downloadFile", "claim-invalid", cause),
    ),
  );
  const { uploadedAttachmentId: _uploadedAttachmentId, ...artifact } = response;
  return { ...artifact, attachmentId: finalId, path: finalPath };
});

const previewUpload = (input: PreviewAutomationUploadFileInput) =>
  Effect.gen(function* () {
    const scope = yield* McpInvocationContext.requireMcpCapability("preview");
    const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
    if (!uploadSourceBelongsToThread(scope.threadId, input.source)) {
      return yield* transferError(scope, "uploadFile", "scope-mismatch");
    }
    const target = yield* resolveTargetedHost(scope, "uploadFile", input.tabId);
    if (!target) return yield* transferError(scope, "uploadFile", "source-invalid");
    const source = yield* resolveUploadSource(scope, input.source);
    const cleanupPath = "cleanupPath" in source ? source.cleanupPath : undefined;
    const cleanup = cleanupPath
      ? (yield* FileSystem.FileSystem).remove(cleanupPath, { force: true }).pipe(Effect.ignore)
      : Effect.void;
    return yield* Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      const randomId = crypto.randomUUIDv4.pipe(
        Effect.mapError((cause) => transferError(scope, "uploadFile", "transfer-failed", cause)),
      );
      const actionId = BrowserArtifactActionId.make(yield* randomId);
      const artifactId = BrowserArtifactId.make(yield* randomId);
      const asset = yield* issueAttachmentAssetUrl({
        _tag: "attachment",
        attachmentId: source.attachmentId,
        fileName: source.fileName,
        mimeType: source.mimeType,
        disposition: "attachment",
      }).pipe(
        Effect.mapError((cause) => transferError(scope, "uploadFile", "transfer-failed", cause)),
      );
      const hostInput: BrowserUploadHostInput = {
        transfer: {
          environmentId: scope.environmentId,
          tabId: target.tabId,
          actionId,
          artifactId,
          fileName: source.fileName,
          mimeType: source.mimeType,
          sizeBytes: source.sizeBytes,
        },
        target: input.target,
        sourceUrl: asset.relativeUrl,
      };
      const response = yield* broker.invoke<unknown>({
        scope,
        operation: "uploadFile",
        input: hostInput,
        tabId: target.tabId,
        hostLease: target.hostLease,
      });
      const selection = yield* decodeUploadSelection(response).pipe(
        Effect.mapError((cause) => transferError(scope, "uploadFile", "transfer-failed", cause)),
      );
      const result = yield* assertArtifactIdentity(scope, "uploadFile", selection, {
        tabId: target.tabId,
        actionId,
        artifactId,
      });
      return { ...result, ...(target.toolIcon ? { toolIcon: target.toolIcon } : {}) };
    }).pipe(Effect.ensuring(cleanup));
  });

const previewDownload = (input: PreviewAutomationDownloadFileInput) =>
  Effect.gen(function* () {
    const scope = yield* McpInvocationContext.requireMcpCapability("preview");
    const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
    const target = yield* resolveTargetedHost(scope, "downloadFile", input.tabId);
    if (!target) return yield* transferError(scope, "downloadFile", "source-invalid");
    const crypto = yield* Crypto.Crypto;
    const actionId = BrowserArtifactActionId.make(
      yield* crypto.randomUUIDv4.pipe(
        Effect.mapError((cause) => transferError(scope, "downloadFile", "transfer-failed", cause)),
      ),
    );
    const hostInput: BrowserDownloadHostInput = {
      expectation: {
        environmentId: scope.environmentId,
        tabId: target.tabId,
        actionId,
        ...(input.expectedFileName === undefined
          ? {}
          : { expectedFileName: input.expectedFileName }),
        ...(input.expectedUrl === undefined ? {} : { expectedUrl: input.expectedUrl }),
        ...(input.expectedInitiatorOrigin === undefined
          ? {}
          : { expectedInitiatorOrigin: input.expectedInitiatorOrigin }),
        ...(input.maximumBytes === undefined ? {} : { maximumBytes: input.maximumBytes }),
      },
      target: input.target,
    };
    const rawResponse = yield* broker.invoke<unknown>({
      scope,
      operation: "downloadFile",
      input: hostInput,
      tabId: target.tabId,
      hostLease: target.hostLease,
    });
    const response = yield* decodeDownloadResult(rawResponse).pipe(
      Effect.mapError((cause) => transferError(scope, "downloadFile", "transfer-failed", cause)),
      Effect.filterOrFail(
        (artifact) =>
          artifact.environmentId === scope.environmentId &&
          artifact.tabId === target.tabId &&
          artifact.actionId === actionId,
        () => transferError(scope, "downloadFile", "scope-mismatch"),
      ),
    );
    const retained = yield* claimBrowserDownload(scope, response).pipe(
      Effect.mapError((cause): PreviewAutomationArtifactTransferError =>
        isArtifactTransferError(cause)
          ? cause
          : transferError(scope, "downloadFile", "claim-invalid", cause),
      ),
    );
    const acknowledge: BrowserArtifactAcknowledgeHostInput = {
      environmentId: scope.environmentId,
      tabId: target.tabId,
      actionId,
      artifactId: response.artifactId,
    };
    const acknowledged = yield* broker
      .invoke({
        scope,
        operation: "artifactAcknowledge",
        input: acknowledge,
        tabId: target.tabId,
        hostLease: target.hostLease,
        updateCurrentTab: false,
      })
      .pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
    return {
      ...retained,
      ...(acknowledged
        ? {}
        : {
            cleanupPending: true,
            cleanupWarning:
              "The file was retained in this environment, but the browser host has not confirmed cleanup yet.",
          }),
      ...(target.toolIcon ? { toolIcon: target.toolIcon } : {}),
    };
  });

const previewDialogStatus = (input: PreviewAutomationDialogStatusInput) =>
  Effect.gen(function* () {
    const scope = yield* McpInvocationContext.requireMcpCapability("preview");
    const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
    return yield* broker.invoke<PreviewAutomationDialogStatusResult>({
      scope,
      operation: "dialogStatus",
      input: {
        environmentId: scope.environmentId,
        ...(input.tabId === undefined ? {} : { tabId: input.tabId }),
      },
      ...(input.tabId === undefined ? {} : { tabId: input.tabId }),
      updateCurrentTab: false,
    });
  });

interface PreviewDialogToolInput {
  readonly environmentId: string;
  readonly tabId: string;
  readonly actionId: string;
  readonly dialogId: string;
  readonly action: "accept" | "dismiss";
  readonly promptText?: string | undefined;
}

const previewDialog = (input: PreviewDialogToolInput) =>
  Effect.gen(function* () {
    const scope = yield* McpInvocationContext.requireMcpCapability("preview");
    const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
    const request: BrowserDialogHandleRequest = {
      environmentId: EnvironmentId.make(input.environmentId),
      tabId: PreviewTabId.make(input.tabId),
      actionId: BrowserArtifactActionId.make(input.actionId),
      dialogId: BrowserDialogId.make(input.dialogId),
      action: input.action,
      ...(input.promptText === undefined ? {} : { promptText: input.promptText }),
    };
    return yield* broker.invoke<BrowserDialogHandleResult>({
      scope,
      operation: "dialogHandle",
      input: request,
      tabId: request.tabId,
      updateCurrentTab: false,
    });
  });

export const browserArtifactHandlers = {
  preview_upload: previewUpload,
  preview_download: previewDownload,
  preview_dialog_status: previewDialogStatus,
  preview_dialog: previewDialog,
} as const;
