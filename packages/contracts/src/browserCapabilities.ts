import type {
  PreviewAutomationExtractInput,
  PreviewAutomationExtractResult,
  PreviewAutomationWaitForAssertionInput,
  PreviewAutomationWaitForAssertionResult,
  PreviewAutomationCheckInput,
  PreviewAutomationHoverInput,
  PreviewAutomationSelectInput,
  PreviewAutomationVerifyInput,
  PreviewAutomationVerifyResult,
} from "./previewAutomation.ts";

/** Optional desktop methods let newer clients negotiate older browser hosts. */
export interface DesktopBrowserCapabilityBridge {
  extract?: (
    tabId: string,
    input: PreviewAutomationExtractInput,
  ) => Promise<PreviewAutomationExtractResult>;
  waitForAssertion?: (
    tabId: string,
    input: PreviewAutomationWaitForAssertionInput,
  ) => Promise<PreviewAutomationWaitForAssertionResult>;
  verify?: (
    tabId: string,
    input: PreviewAutomationVerifyInput,
  ) => Promise<PreviewAutomationVerifyResult>;
  select?: (tabId: string, input: PreviewAutomationSelectInput) => Promise<void>;
  check?: (tabId: string, input: PreviewAutomationCheckInput) => Promise<void>;
  hover?: (tabId: string, input: PreviewAutomationHoverInput) => Promise<void>;
}
