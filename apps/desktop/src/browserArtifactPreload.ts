import type { DesktopBrowserArtifactBridge } from "@t3tools/contracts";
import { ipcRenderer } from "electron";

import * as Channels from "./ipc/browserArtifactChannels.ts";

/** Additive preview methods installed into `desktopBridge.preview.artifacts` by the main preload. */
export const browserArtifactPreload: DesktopBrowserArtifactBridge = {
  prepareAction: (tabId, input) =>
    ipcRenderer.invoke(Channels.BROWSER_DIALOG_PREPARE_ACTION_CHANNEL, { tabId, input }),
  cancelPreparedAction: (tabId, input) =>
    ipcRenderer.invoke(Channels.BROWSER_DIALOG_CANCEL_PREPARED_ACTION_CHANNEL, { tabId, input }),
  selectUpload: (tabId, input) =>
    ipcRenderer.invoke(Channels.BROWSER_ARTIFACT_UPLOAD_SELECT_CHANNEL, { tabId, input }),
  startDownload: (tabId, input) =>
    ipcRenderer.invoke(Channels.BROWSER_ARTIFACT_DOWNLOAD_START_CHANNEL, { tabId, input }),
  readDownload: (input) =>
    ipcRenderer.invoke(Channels.BROWSER_ARTIFACT_DOWNLOAD_READ_CHANNEL, input),
  acknowledgeArtifact: (input) =>
    ipcRenderer.invoke(Channels.BROWSER_ARTIFACT_ACKNOWLEDGE_CHANNEL, input),
  dialogStatus: (tabId, input) =>
    ipcRenderer.invoke(Channels.BROWSER_DIALOG_STATUS_CHANNEL, { tabId, input }),
  handleDialog: (tabId, input) =>
    ipcRenderer.invoke(Channels.BROWSER_DIALOG_HANDLE_CHANNEL, { tabId, input }),
};
