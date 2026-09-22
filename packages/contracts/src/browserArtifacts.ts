import * as Schema from "effect/Schema";

import { EnvironmentId, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { PreviewTabId } from "./preview.ts";

export const BROWSER_ARTIFACT_MAX_BYTES = 50 * 1024 * 1024;

const BoundedId = TrimmedNonEmptyString.check(Schema.isMaxLength(256));
const BoundedRunId = TrimmedNonEmptyString.check(Schema.isMaxLength(256));
const BoundedMimeType = TrimmedNonEmptyString.check(Schema.isMaxLength(255));
const BoundedDialogText = Schema.String.check(Schema.isMaxLength(20_000));

export const BrowserArtifactMaximumBytes = PositiveInt.check(
  Schema.isLessThanOrEqualTo(BROWSER_ARTIFACT_MAX_BYTES),
);

export const BrowserArtifactId = BoundedId.pipe(Schema.brand("BrowserArtifactId"));
export type BrowserArtifactId = typeof BrowserArtifactId.Type;

export const BrowserArtifactActionId = BoundedId.pipe(Schema.brand("BrowserArtifactActionId"));
export type BrowserArtifactActionId = typeof BrowserArtifactActionId.Type;

export const BrowserDialogId = BoundedId.pipe(Schema.brand("BrowserDialogId"));
export type BrowserDialogId = typeof BrowserDialogId.Type;

const isSafeFileName = (name: string): boolean => {
  if (name === "." || name === "..") return false;
  for (const character of name) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (character === "/" || character === "\\" || codePoint <= 0x1f || codePoint === 0x7f)
      return false;
  }
  return new TextEncoder().encode(name).byteLength <= 255;
};

export const BrowserArtifactFileName = TrimmedNonEmptyString.check(Schema.isMaxLength(255)).check(
  Schema.makeFilter(
    (name) =>
      isSafeFileName(name) ||
      "Browser artifact filenames must be one safe path segment of at most 255 UTF-8 bytes.",
  ),
);
export type BrowserArtifactFileName = typeof BrowserArtifactFileName.Type;

const BrowserArtifactActionScopeFields = {
  environmentId: EnvironmentId,
  tabId: PreviewTabId,
  runId: Schema.optionalKey(BoundedRunId),
  actionId: BrowserArtifactActionId,
};

export const BrowserArtifactOwnership = Schema.Struct({
  ...BrowserArtifactActionScopeFields,
  artifactId: BrowserArtifactId,
});
export type BrowserArtifactOwnership = typeof BrowserArtifactOwnership.Type;

/**
 * An environment-owned file copied over the authenticated preview connection.
 * The desktop host receives bytes, never a path it is expected to share with
 * the server host.
 */
export const BrowserUploadTransfer = Schema.Struct({
  ...BrowserArtifactActionScopeFields,
  artifactId: BrowserArtifactId,
  fileName: BrowserArtifactFileName,
  mimeType: Schema.optionalKey(BoundedMimeType),
  sizeBytes: BrowserArtifactMaximumBytes,
  data: Schema.Uint8Array,
}).check(
  Schema.makeFilter(
    (input) =>
      input.data.byteLength === input.sizeBytes ||
      "Browser upload bytes must match the declared artifact size.",
  ),
);
export type BrowserUploadTransfer = typeof BrowserUploadTransfer.Type;

/** File-input selection is only a browser result; callers verify the app result separately. */
export const BrowserUploadSelection = Schema.Struct({
  ...BrowserArtifactActionScopeFields,
  artifactId: BrowserArtifactId,
  fileName: BrowserArtifactFileName,
  sizeBytes: BrowserArtifactMaximumBytes,
  status: Schema.Literal("selected"),
});
export type BrowserUploadSelection = typeof BrowserUploadSelection.Type;

export const BrowserDownloadExpectation = Schema.Struct({
  ...BrowserArtifactActionScopeFields,
  expectedFileName: Schema.optionalKey(BrowserArtifactFileName),
  expectedUrl: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(4_096))),
  expectedInitiatorOrigin: Schema.optionalKey(
    TrimmedNonEmptyString.check(Schema.isMaxLength(2_048)),
  ),
  maximumBytes: Schema.optionalKey(BrowserArtifactMaximumBytes),
});
export type BrowserDownloadExpectation = typeof BrowserDownloadExpectation.Type;

/** Emitted only after Chromium reports completion and the host verifies the saved file size. */
export const BrowserDownloadArtifact = Schema.Struct({
  ...BrowserArtifactActionScopeFields,
  artifactId: BrowserArtifactId,
  fileName: BrowserArtifactFileName,
  mimeType: Schema.optionalKey(BoundedMimeType),
  sizeBytes: BrowserArtifactMaximumBytes,
  status: Schema.Literal("completed"),
  completedAt: Schema.String,
});
export type BrowserDownloadArtifact = typeof BrowserDownloadArtifact.Type;

export const BrowserDialogKind = Schema.Literals(["alert", "confirm", "prompt", "beforeunload"]);
export type BrowserDialogKind = typeof BrowserDialogKind.Type;

export const BrowserObservedDialog = Schema.Struct({
  ...BrowserArtifactActionScopeFields,
  dialogId: BrowserDialogId,
  kind: BrowserDialogKind,
  message: BoundedDialogText,
  messageTruncated: Schema.optionalKey(Schema.Boolean),
  defaultPrompt: Schema.optionalKey(BoundedDialogText),
  defaultPromptTruncated: Schema.optionalKey(Schema.Boolean),
  openedAt: Schema.String,
});
export type BrowserObservedDialog = typeof BrowserObservedDialog.Type;

const BrowserDialogIdentityFields = {
  environmentId: EnvironmentId.annotate({
    description: "Environment that owns the observed browser dialog.",
  }),
  tabId: PreviewTabId.annotate({
    description: "Exact collaborative browser tab that reported the dialog.",
  }),
  actionId: BrowserArtifactActionId.annotate({
    description: "Exact browser action correlated with the observed dialog.",
  }),
  dialogId: BrowserDialogId.annotate({
    description: "Opaque identity returned by preview_dialog_status.",
  }),
};

export const BrowserDialogHandleRequest = Schema.Struct({
  ...BrowserDialogIdentityFields,
  action: Schema.Literals(["accept", "dismiss"]).annotate({
    description: "Whether to accept or dismiss this exact observed dialog.",
  }),
  promptText: Schema.optional(
    BoundedDialogText.annotate({
      description: "Text supplied only when accepting a JavaScript prompt dialog.",
    }),
  ).annotate({
    description: "Text supplied only when accepting a JavaScript prompt dialog.",
  }),
}).check(
  Schema.makeFilter(
    (input) =>
      input.action === "accept" ||
      input.promptText === undefined ||
      "A dismissed browser dialog cannot carry prompt text.",
  ),
);
export type BrowserDialogHandleRequest = typeof BrowserDialogHandleRequest.Type;

export const BrowserDialogHandleResult = Schema.Struct({
  ...BrowserDialogIdentityFields,
  status: Schema.Literal("handled"),
  action: Schema.Literals(["accept", "dismiss"]),
});
export type BrowserDialogHandleResult = typeof BrowserDialogHandleResult.Type;
