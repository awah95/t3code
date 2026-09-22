import {
  DesktopBrowserUploadIpcInput,
  DesktopBrowserUploadSelectionResult,
  DesktopBrowserDownloadIpcInput,
  DesktopBrowserDownloadResult,
  DesktopBrowserArtifactReadInput,
  DesktopBrowserArtifactBytes,
  DesktopBrowserArtifactAcknowledgeInput,
  DesktopBrowserDialogPrepareIpcInput,
  DesktopBrowserDialogStatusIpcInput,
  PreviewAutomationDialogStatusResult,
  DesktopBrowserDialogHandleIpcInput,
  DesktopBrowserDialogHandleResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { PreviewManager } from "../../preview/Manager.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as Channels from "../browserArtifactChannels.ts";

export const selectUpload = DesktopIpc.makeIpcMethod({
  channel: Channels.BROWSER_ARTIFACT_UPLOAD_SELECT_CHANNEL,
  payload: DesktopBrowserUploadIpcInput,
  result: DesktopBrowserUploadSelectionResult,
  handler: Effect.fn("desktop.ipc.browser.selectUpload")(function* ({ tabId, input }) {
    return yield* (yield* (yield* PreviewManager).browserArtifacts()).selectUpload(tabId, input);
  }),
});

export const startDownload = DesktopIpc.makeIpcMethod({
  channel: Channels.BROWSER_ARTIFACT_DOWNLOAD_START_CHANNEL,
  payload: DesktopBrowserDownloadIpcInput,
  result: DesktopBrowserDownloadResult,
  handler: Effect.fn("desktop.ipc.browser.startDownload")(function* ({ tabId, input }) {
    return yield* (yield* (yield* PreviewManager).browserArtifacts()).startDownload(tabId, input);
  }),
});

export const readDownload = DesktopIpc.makeIpcMethod({
  channel: Channels.BROWSER_ARTIFACT_DOWNLOAD_READ_CHANNEL,
  payload: DesktopBrowserArtifactReadInput,
  result: DesktopBrowserArtifactBytes,
  handler: Effect.fn("desktop.ipc.browser.readDownload")(function* (input) {
    return yield* (yield* (yield* PreviewManager).browserArtifacts()).readDownload(input);
  }),
});

export const acknowledgeArtifact = DesktopIpc.makeIpcMethod({
  channel: Channels.BROWSER_ARTIFACT_ACKNOWLEDGE_CHANNEL,
  payload: DesktopBrowserArtifactAcknowledgeInput,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.browser.acknowledgeArtifact")(function* (input) {
    yield* (yield* (yield* PreviewManager).browserArtifacts()).acknowledgeArtifact(input);
  }),
});

export const prepareAction = DesktopIpc.makeIpcMethod({
  channel: Channels.BROWSER_DIALOG_PREPARE_ACTION_CHANNEL,
  payload: DesktopBrowserDialogPrepareIpcInput,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.browser.prepareAction")(function* ({ tabId, input }) {
    yield* (yield* (yield* PreviewManager).browserArtifacts()).prepareAction(tabId, input);
  }),
});

export const cancelPreparedAction = DesktopIpc.makeIpcMethod({
  channel: Channels.BROWSER_DIALOG_CANCEL_PREPARED_ACTION_CHANNEL,
  payload: DesktopBrowserDialogPrepareIpcInput,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.browser.cancelPreparedAction")(function* ({ tabId, input }) {
    yield* (yield* (yield* PreviewManager).browserArtifacts()).cancelPreparedAction(tabId, input);
  }),
});

export const dialogStatus = DesktopIpc.makeIpcMethod({
  channel: Channels.BROWSER_DIALOG_STATUS_CHANNEL,
  payload: DesktopBrowserDialogStatusIpcInput,
  result: PreviewAutomationDialogStatusResult,
  handler: Effect.fn("desktop.ipc.browser.dialogStatus")(function* ({ tabId, input }) {
    return yield* (yield* (yield* PreviewManager).browserArtifacts()).dialogStatus(tabId, input);
  }),
});

export const handleDialog = DesktopIpc.makeIpcMethod({
  channel: Channels.BROWSER_DIALOG_HANDLE_CHANNEL,
  payload: DesktopBrowserDialogHandleIpcInput,
  result: DesktopBrowserDialogHandleResult,
  handler: Effect.fn("desktop.ipc.browser.handleDialog")(function* ({ tabId, input }) {
    return yield* (yield* (yield* PreviewManager).browserArtifacts()).handleDialog(tabId, input);
  }),
});

export const methods = [
  selectUpload,
  startDownload,
  readDownload,
  acknowledgeArtifact,
  prepareAction,
  cancelPreparedAction,
  dialogStatus,
  handleDialog,
] as const;
