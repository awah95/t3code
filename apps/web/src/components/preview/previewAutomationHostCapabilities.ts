import {
  JEV_BROWSER_AUTOMATION_OPERATIONS,
  PREVIEW_AUTOMATION_OPERATIONS,
  type DesktopBrowserArtifactBridge,
  type DesktopBridge,
  type DesktopPreviewBridge,
  type PreviewAutomationOperation,
} from "@t3tools/contracts";

type JevBrowserHostBridge = Pick<
  DesktopBridge,
  | "getJevStatus"
  | "observeJevBrowser"
  | "verifyJevBrowser"
  | "decideJevBrowser"
  | "executeJevBrowser"
  | "cancelJevBrowser"
>;

type PreviewAutomationCapabilityBridge = Pick<
  DesktopPreviewBridge["automation"],
  "verify" | "select" | "check" | "hover" | "extract" | "waitForAssertion"
>;

const hasCompleteJevBrowserHost = (bridge: JevBrowserHostBridge | undefined) =>
  bridge?.getJevStatus !== undefined &&
  bridge.observeJevBrowser !== undefined &&
  bridge.verifyJevBrowser !== undefined &&
  bridge.decideJevBrowser !== undefined &&
  bridge.executeJevBrowser !== undefined &&
  bridge.cancelJevBrowser !== undefined;

export const hasJevBrowserHost = () => hasCompleteJevBrowserHost(window.desktopBridge);

export const resolvePreviewAutomationSupportedOperations = (
  automation: Partial<PreviewAutomationCapabilityBridge>,
  desktopBridge: JevBrowserHostBridge | undefined,
  artifacts: Partial<DesktopBrowserArtifactBridge> | undefined,
): readonly PreviewAutomationOperation[] => {
  const jevAvailable = hasCompleteJevBrowserHost(desktopBridge);
  return PREVIEW_AUTOMATION_OPERATIONS.filter((operation) => {
    switch (operation) {
      case "verify":
        return automation.verify !== undefined;
      case "select":
        return automation.select !== undefined;
      case "check":
        return automation.check !== undefined;
      case "hover":
        return automation.hover !== undefined;
      case "extract":
        return automation.extract !== undefined;
      case "waitForAssertion":
        return automation.waitForAssertion !== undefined;
      case "uploadFile":
        return artifacts?.prepareAction !== undefined && artifacts.selectUpload !== undefined;
      case "downloadFile":
        return (
          artifacts?.prepareAction !== undefined &&
          artifacts.startDownload !== undefined &&
          artifacts.readDownload !== undefined &&
          artifacts.acknowledgeArtifact !== undefined
        );
      case "dialogStatus":
        return artifacts?.dialogStatus !== undefined;
      case "dialogHandle":
        return artifacts?.handleDialog !== undefined;
      case "artifactAcknowledge":
        return artifacts?.acknowledgeArtifact !== undefined;
      default:
        return (
          !JEV_BROWSER_AUTOMATION_OPERATIONS.includes(
            operation as (typeof JEV_BROWSER_AUTOMATION_OPERATIONS)[number],
          ) || jevAvailable
        );
    }
  });
};
