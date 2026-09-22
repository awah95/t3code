import {
  BrowserArtifactTarget,
  BrowserDialogHandleResult,
  BrowserUploadSelection,
  PreviewAutomationDialogStatusInput,
  PreviewAutomationDialogStatusResult,
  PreviewAutomationDownloadFileInput,
  PreviewAutomationDownloadFileResult,
  PreviewAutomationError,
  PreviewAutomationUploadFileInput,
  ToolActivityIcon,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Tool } from "effect/unstable/ai";

import * as ServerSecretStore from "../../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../../config.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as WorkspacePaths from "../../../workspace/WorkspacePaths.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as PreviewAutomationBroker from "../../PreviewAutomationBroker.ts";

const sharedDependencies = [
  McpInvocationContext.McpInvocationContext,
  PreviewAutomationBroker.PreviewAutomationBroker,
];

const uploadDependencies = [
  ...sharedDependencies,
  Clock.Clock,
  Crypto.Crypto,
  FileSystem.FileSystem,
  Path.Path,
  ServerConfig.ServerConfig,
  ServerSecretStore.ServerSecretStore,
  WorkspacePaths.WorkspacePaths,
  ProjectionSnapshotQuery.ProjectionSnapshotQuery,
];

const downloadDependencies = [
  ...sharedDependencies,
  Crypto.Crypto,
  FileSystem.FileSystem,
  ServerConfig.ServerConfig,
];

const presentationFields = {
  toolIcon: Schema.optional(ToolActivityIcon),
};

const PreviewUploadResult = Schema.Struct({
  ...BrowserUploadSelection.fields,
  ...presentationFields,
});

const ToolBrowserArtifactTarget = Schema.Struct(BrowserArtifactTarget.fields).annotate({
  description: "One exact file input or download trigger target.",
});

const toolUploadSourcePath = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isNonEmpty(),
  Schema.isMaxLength(1_024),
);
const ToolUploadSource = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("workspace-file"),
    path: toolUploadSourcePath.annotate({
      description: "File path relative to this task's current workspace root.",
    }),
  }),
  Schema.Struct({
    kind: Schema.Literal("attachment"),
    attachmentId: Schema.String.check(
      Schema.isTrimmed(),
      Schema.isNonEmpty(),
      Schema.isMaxLength(256),
    ).annotate({
      description: "Retained attachment identity from this current task.",
    }),
  }),
]);

const hasExactlyOneTarget = (target: typeof ToolBrowserArtifactTarget.Type) =>
  Number(target.selector !== undefined) +
    Number(target.locator !== undefined) +
    Number(target.semanticTarget !== undefined) ===
    1 || "Provide exactly one browser artifact target.";

const PreviewUploadParameters = Schema.Struct({
  ...PreviewAutomationUploadFileInput.fields,
  target: ToolBrowserArtifactTarget,
  source: ToolUploadSource.annotate({
    description: "Current-task workspace file or retained attachment to transfer.",
  }),
}).check(Schema.makeFilter((input) => hasExactlyOneTarget(input.target)));

const PreviewDownloadParameters = Schema.Struct({
  ...PreviewAutomationDownloadFileInput.fields,
  target: ToolBrowserArtifactTarget,
}).check(Schema.makeFilter((input) => hasExactlyOneTarget(input.target)));

const describedDialogId = (description: string, maximumLength: number) =>
  Schema.String.check(
    Schema.isTrimmed(),
    Schema.isNonEmpty(),
    Schema.isMaxLength(maximumLength),
  ).annotate({
    description,
  });

const PreviewDialogParameters = Schema.Struct({
  environmentId: describedDialogId("Environment identity returned with the observed dialog.", 256),
  tabId: describedDialogId("Exact collaborative browser tab that owns the dialog.", 128),
  actionId: describedDialogId("Exact browser action identity returned with the dialog.", 256),
  dialogId: describedDialogId("Opaque dialog identity returned by preview_dialog_status.", 256),
  action: Schema.Literals(["accept", "dismiss"]).annotate({
    description: "Accept or dismiss this exact observed dialog.",
  }),
  promptText: Schema.optional(
    Schema.String.check(Schema.isMaxLength(20_000)).annotate({
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

const PreviewDownloadResult = Schema.Struct({
  ...PreviewAutomationDownloadFileResult.fields,
  ...presentationFields,
});

export const PreviewUploadTool = Tool.make("preview_upload", {
  description:
    "Transfer one environment-owned workspace file or retained attachment to the browser host and select it on one exact file input. The file stays scoped to this thread and browser tab; verify the site's resulting state separately.",
  parameters: PreviewUploadParameters,
  success: PreviewUploadResult,
  failure: PreviewAutomationError,
  dependencies: uploadDependencies,
})
  .annotate(Tool.Title, "Upload file in browser")
  .annotate(Tool.OpenWorld, true)
  .annotate(Tool.Destructive, true);

export const PreviewDownloadTool = Tool.make("preview_download", {
  description:
    "Arm one exact expected browser download before clicking its trigger once, then retain the completed file in this environment. The returned path and attachment identity refer to the environment copy; a transfer retry never repeats the browser click.",
  parameters: PreviewDownloadParameters,
  success: PreviewDownloadResult,
  failure: PreviewAutomationError,
  dependencies: downloadDependencies,
})
  .annotate(Tool.Title, "Download file from browser")
  .annotate(Tool.OpenWorld, true)
  .annotate(Tool.Destructive, true);

export const PreviewDialogStatusTool = Tool.make("preview_dialog_status", {
  description:
    "Read the exact currently observed JavaScript dialog for one collaborative browser tab. Returns null when the browser host has not observed an open dialog; it never infers a dialog from page text.",
  parameters: PreviewAutomationDialogStatusInput,
  success: PreviewAutomationDialogStatusResult,
  failure: PreviewAutomationError,
  dependencies: sharedDependencies,
})
  .annotate(Tool.Title, "Inspect browser dialog")
  .annotate(Tool.OpenWorld, true)
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const PreviewDialogTool = Tool.make("preview_dialog", {
  description:
    "Accept or dismiss one exact browser dialog previously returned by preview_dialog_status. All environment, tab, action, and dialog identities must match the observed dialog; prompt text is sent only when accepting a prompt.",
  parameters: PreviewDialogParameters,
  success: BrowserDialogHandleResult,
  failure: PreviewAutomationError,
  dependencies: sharedDependencies,
})
  .annotate(Tool.Title, "Respond to browser dialog")
  .annotate(Tool.OpenWorld, true)
  .annotate(Tool.Destructive, true);

export const browserArtifactTools = [
  PreviewUploadTool,
  PreviewDownloadTool,
  PreviewDialogStatusTool,
  PreviewDialogTool,
] as const;
