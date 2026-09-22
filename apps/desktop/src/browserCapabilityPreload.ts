import type { DesktopBrowserCapabilityBridge } from "@t3tools/contracts";
import { ipcRenderer } from "electron";
import * as Channels from "./ipc/browserCapabilityChannels.ts";

export const browserCapabilityPreload: DesktopBrowserCapabilityBridge = {
  extract: (tabId, input) => ipcRenderer.invoke(Channels.BROWSER_EXTRACT_CHANNEL, { tabId, input }),
  waitForAssertion: (tabId, input) =>
    ipcRenderer.invoke(Channels.BROWSER_WAIT_FOR_ASSERTION_CHANNEL, { tabId, input }),
  verify: (tabId, input) => ipcRenderer.invoke(Channels.BROWSER_VERIFY_CHANNEL, { tabId, input }),
  select: (tabId, input) => ipcRenderer.invoke(Channels.BROWSER_SELECT_CHANNEL, { tabId, input }),
  check: (tabId, input) => ipcRenderer.invoke(Channels.BROWSER_CHECK_CHANNEL, { tabId, input }),
  hover: (tabId, input) => ipcRenderer.invoke(Channels.BROWSER_HOVER_CHANNEL, { tabId, input }),
};
