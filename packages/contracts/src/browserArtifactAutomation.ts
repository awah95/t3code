import * as Schema from "effect/Schema";

import { EnvironmentId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  BrowserArtifactFileName,
  BrowserArtifactId,
  BrowserArtifactMaximumBytes,
  BrowserArtifactOwnership,
  BrowserDialogHandleRequest,
  BrowserDialogHandleResult,
  BrowserDownloadArtifact,
  BrowserDownloadExpectation,
  BrowserObservedDialog,
  BrowserUploadSelection,
  BrowserUploadTransfer,
} from "./browserArtifacts.ts";
import { BrowserSemanticTarget } from "./browserVerification.ts";
import { PreviewTabId } from "./preview.ts";

export const PREVIEW_AUTOMATION_ARTIFACT_OPERATIONS = [
  "uploadFile",
  "downloadFile",
  "dialogStatus",
  "dialogHandle",
  "artifactAcknowledge",
] as const;

const Locator = TrimmedNonEmptyString.check(Schema.isMaxLength(4_096));
const LegacySelector = TrimmedNonEmptyString.check(Schema.isMaxLength(4_096));
const BoundedSourcePath = TrimmedNonEmptyString.check(Schema.isMaxLength(1_024));
const BoundedAttachmentId = TrimmedNonEmptyString.check(Schema.isMaxLength(256));
const BoundedUrl = TrimmedNonEmptyString.check(Schema.isMaxLength(4_096));
const RuntimeTabId = TrimmedNonEmptyString.check(Schema.isMaxLength(256));

export const BrowserArtifactTarget = Schema.Struct({
  selector: Schema.optionalKey(
    LegacySelector.annotate({
      description: "Legacy CSS selector for the exact file input or download trigger.",
    }),
  ),
  locator: Schema.optionalKey(
    Locator.annotate({
      description: "Playwright locator for the exact file input or download trigger.",
    }),
  ),
  semanticTarget: Schema.optionalKey(
    BrowserSemanticTarget.annotate({
      description: "Exact scoped semantic file input or download trigger.",
    }),
  ),
}).check(
  Schema.makeFilter(
    (input) =>
      Number(input.selector !== undefined) +
        Number(input.locator !== undefined) +
        Number(input.semanticTarget !== undefined) ===
        1 || "Provide exactly one browser artifact target.",
  ),
);
export type BrowserArtifactTarget = typeof BrowserArtifactTarget.Type;

/** The server resolves this inside the selected environment; the desktop never receives its path. */
export const BrowserUploadSource = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("workspace-file"),
    threadId: Schema.optional(
      ThreadId.annotate({
        description:
          "Deprecated thread scope hint. Omit it; the server uses the current tool invocation thread.",
      }),
    ).annotate({
      description:
        "Deprecated thread scope hint. Omit it; an explicitly supplied foreign thread is rejected.",
    }),
    path: BoundedSourcePath.annotate({
      description: "File path relative to the thread workspace root.",
    }),
  }),
  Schema.Struct({
    kind: Schema.Literal("attachment"),
    attachmentId: BoundedAttachmentId.annotate({
      description: "Existing environment attachment identity.",
    }),
  }),
]);
export type BrowserUploadSource = typeof BrowserUploadSource.Type;

export const PreviewAutomationUploadFileInput = Schema.Struct({
  tabId: Schema.optional(
    PreviewTabId.annotate({
      description: "Exact collaborative browser tab. Omit to use this agent session's current tab.",
    }),
  ).annotate({
    description: "Exact collaborative browser tab. Omit to use this agent session's current tab.",
  }),
  target: BrowserArtifactTarget.annotate({
    description: "Exact file input that receives the environment-owned artifact.",
  }),
  source: BrowserUploadSource.annotate({
    description: "Environment-owned workspace file or attachment to transfer to the browser host.",
  }),
});
export type PreviewAutomationUploadFileInput = typeof PreviewAutomationUploadFileInput.Type;

/**
 * Host-only request after the server resolves and signs the environment file.
 * `sourceUrl` carries authorization over the existing HTTP asset route. File
 * bytes do not cross the preview WebSocket.
 */
export const BrowserUploadHostInput = Schema.Struct({
  transfer: Schema.Struct({
    environmentId: BrowserUploadTransfer.fields.environmentId,
    tabId: BrowserUploadTransfer.fields.tabId,
    runId: BrowserUploadTransfer.fields.runId,
    actionId: BrowserUploadTransfer.fields.actionId,
    artifactId: BrowserUploadTransfer.fields.artifactId,
    fileName: BrowserUploadTransfer.fields.fileName,
    mimeType: BrowserUploadTransfer.fields.mimeType,
    sizeBytes: BrowserUploadTransfer.fields.sizeBytes,
  }),
  target: BrowserArtifactTarget,
  sourceUrl: BoundedUrl,
});
export type BrowserUploadHostInput = typeof BrowserUploadHostInput.Type;

/** Local Electron IPC payload created only after the renderer fetches the signed source URL. */
export const DesktopBrowserUploadInput = Schema.Struct({
  transfer: BrowserUploadTransfer,
  target: BrowserArtifactTarget,
});
export type DesktopBrowserUploadInput = typeof DesktopBrowserUploadInput.Type;

export const DesktopBrowserUploadIpcInput = Schema.Struct({
  tabId: RuntimeTabId,
  input: DesktopBrowserUploadInput,
});
export type DesktopBrowserUploadIpcInput = typeof DesktopBrowserUploadIpcInput.Type;

export const PreviewAutomationDownloadFileInput = Schema.Struct({
  tabId: Schema.optional(
    PreviewTabId.annotate({
      description: "Exact collaborative browser tab. Omit to use this agent session's current tab.",
    }),
  ).annotate({
    description: "Exact collaborative browser tab. Omit to use this agent session's current tab.",
  }),
  target: BrowserArtifactTarget.annotate({
    description: "Exact control that starts the expected download.",
  }),
  expectedFileName: Schema.optional(
    BrowserArtifactFileName.annotate({
      description: "Expected completed filename when the site declares it in advance.",
    }),
  ).annotate({
    description: "Expected completed filename when the site declares it in advance.",
  }),
  expectedUrl: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(4_096)).annotate({
      description: "Exact expected download URL when known.",
    }),
  ).annotate({ description: "Exact expected download URL when known." }),
  expectedInitiatorOrigin: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(2_048)).annotate({
      description: "Exact expected origin that initiates the download when known.",
    }),
  ).annotate({
    description: "Exact expected origin that initiates the download when known.",
  }),
  maximumBytes: Schema.optional(
    BrowserArtifactMaximumBytes.annotate({
      description: "Maximum accepted completed download size in bytes.",
    }),
  ).annotate({
    description: "Maximum accepted completed download size in bytes.",
  }),
});
export type PreviewAutomationDownloadFileInput = typeof PreviewAutomationDownloadFileInput.Type;

/** Exact download identity and target supplied by the server after tab/run resolution. */
export const BrowserDownloadHostInput = Schema.Struct({
  expectation: BrowserDownloadExpectation,
  target: BrowserArtifactTarget,
});
export type BrowserDownloadHostInput = typeof BrowserDownloadHostInput.Type;

export const DesktopBrowserDownloadIpcInput = Schema.Struct({
  tabId: RuntimeTabId,
  input: BrowserDownloadHostInput,
});
export type DesktopBrowserDownloadIpcInput = typeof DesktopBrowserDownloadIpcInput.Type;

export const BrowserDownloadHostResult = Schema.Struct({
  ...BrowserDownloadArtifact.fields,
  uploadedAttachmentId: Schema.optionalKey(BoundedAttachmentId),
});
export type BrowserDownloadHostResult = typeof BrowserDownloadHostResult.Type;

export const PreviewAutomationDownloadFileResult = Schema.Struct({
  ...BrowserDownloadArtifact.fields,
  attachmentId: BoundedAttachmentId,
  path: TrimmedNonEmptyString.check(Schema.isMaxLength(1_024)),
  cleanupPending: Schema.optionalKey(Schema.Boolean),
  cleanupWarning: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(1_000))),
});
export type PreviewAutomationDownloadFileResult = typeof PreviewAutomationDownloadFileResult.Type;

export const PreviewAutomationDialogStatusInput = Schema.Struct({
  tabId: Schema.optional(
    PreviewTabId.annotate({
      description: "Exact collaborative browser tab. Omit to use this agent session's current tab.",
    }),
  ).annotate({
    description: "Exact collaborative browser tab. Omit to use this agent session's current tab.",
  }),
});
export type PreviewAutomationDialogStatusInput = typeof PreviewAutomationDialogStatusInput.Type;

export const PreviewAutomationDialogStatusResult = Schema.Struct({
  dialog: Schema.NullOr(BrowserObservedDialog),
});
export type PreviewAutomationDialogStatusResult = typeof PreviewAutomationDialogStatusResult.Type;

export const BrowserDialogStatusHostInput = Schema.Struct({
  environmentId: EnvironmentId,
  tabId: Schema.optionalKey(PreviewTabId),
});
export type BrowserDialogStatusHostInput = typeof BrowserDialogStatusHostInput.Type;

export const BrowserDialogPrepareActionInput = Schema.Struct({
  environmentId: EnvironmentId,
  tabId: PreviewTabId,
  runId: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(256))),
  actionId: BrowserArtifactOwnership.fields.actionId,
  /** Bounded manager operation key used only to correlate the prepared action. */
  operation: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
});
export type BrowserDialogPrepareActionInput = typeof BrowserDialogPrepareActionInput.Type;

export const PreviewAutomationDialogHandleInput = BrowserDialogHandleRequest;
export type PreviewAutomationDialogHandleInput = typeof PreviewAutomationDialogHandleInput.Type;

export const DesktopBrowserArtifactReadInput = BrowserArtifactOwnership;
export type DesktopBrowserArtifactReadInput = typeof DesktopBrowserArtifactReadInput.Type;

export const DesktopBrowserArtifactBytes = Schema.Struct({
  artifactId: BrowserArtifactId,
  data: Schema.Uint8Array,
});
export type DesktopBrowserArtifactBytes = typeof DesktopBrowserArtifactBytes.Type;

export const BrowserArtifactAcknowledgeHostInput = BrowserArtifactOwnership;
export type BrowserArtifactAcknowledgeHostInput = typeof BrowserArtifactAcknowledgeHostInput.Type;

export const DesktopBrowserArtifactAcknowledgeInput = BrowserArtifactOwnership;
export type DesktopBrowserArtifactAcknowledgeInput =
  typeof DesktopBrowserArtifactAcknowledgeInput.Type;

export const DesktopBrowserDialogStatusIpcInput = Schema.Struct({
  tabId: RuntimeTabId,
  input: BrowserDialogStatusHostInput,
});
export type DesktopBrowserDialogStatusIpcInput = typeof DesktopBrowserDialogStatusIpcInput.Type;

export const DesktopBrowserDialogPrepareIpcInput = Schema.Struct({
  tabId: RuntimeTabId,
  input: BrowserDialogPrepareActionInput,
});
export type DesktopBrowserDialogPrepareIpcInput = typeof DesktopBrowserDialogPrepareIpcInput.Type;

export const DesktopBrowserDialogHandleIpcInput = Schema.Struct({
  tabId: RuntimeTabId,
  input: BrowserDialogHandleRequest,
});
export type DesktopBrowserDialogHandleIpcInput = typeof DesktopBrowserDialogHandleIpcInput.Type;

export const DesktopBrowserArtifactReadIpcInput = DesktopBrowserArtifactReadInput;

export class PreviewAutomationArtifactTransferError extends Schema.TaggedError<PreviewAutomationArtifactTransferError>()(
  "PreviewAutomationArtifactTransferError",
  {
    operation: Schema.Literals(["uploadFile", "downloadFile"]),
    environmentId: EnvironmentId,
    threadId: ThreadId,
    reason: Schema.Literals([
      "scope-mismatch",
      "source-not-found",
      "source-invalid",
      "size-limit",
      "transfer-failed",
      "claim-missing",
      "claim-invalid",
    ]),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Preview automation ${this.operation} could not complete its scoped artifact transfer (${this.reason}).`;
  }
}

/** Optional methods preserve older desktop hosts during capability rollout. */
export interface DesktopBrowserArtifactBridge {
  prepareAction: (runtimeTabId: string, input: BrowserDialogPrepareActionInput) => Promise<void>;
  cancelPreparedAction?: (
    runtimeTabId: string,
    input: BrowserDialogPrepareActionInput,
  ) => Promise<void>;
  selectUpload: (
    runtimeTabId: string,
    input: DesktopBrowserUploadInput,
  ) => Promise<BrowserUploadSelection>;
  startDownload: (
    runtimeTabId: string,
    input: BrowserDownloadHostInput,
  ) => Promise<BrowserDownloadArtifact>;
  readDownload: (input: DesktopBrowserArtifactReadInput) => Promise<DesktopBrowserArtifactBytes>;
  acknowledgeArtifact: (input: DesktopBrowserArtifactAcknowledgeInput) => Promise<void>;
  dialogStatus: (
    runtimeTabId: string,
    input: BrowserDialogStatusHostInput,
  ) => Promise<PreviewAutomationDialogStatusResult>;
  handleDialog: (
    runtimeTabId: string,
    input: BrowserDialogHandleRequest,
  ) => Promise<BrowserDialogHandleResult>;
}

/** Shapes used by additive IPC methods without reaching into the legacy IPC contract file. */
export const DesktopBrowserUploadSelectionResult = BrowserUploadSelection;
export const DesktopBrowserDownloadResult = BrowserDownloadArtifact;
export const DesktopBrowserDialogHandleResult = BrowserDialogHandleResult;
