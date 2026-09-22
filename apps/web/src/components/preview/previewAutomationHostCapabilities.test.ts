import {
  JEV_BROWSER_AUTOMATION_OPERATIONS,
  PREVIEW_AUTOMATION_ARTIFACT_OPERATIONS,
  PREVIEW_AUTOMATION_V1_OPERATIONS,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { resolvePreviewAutomationSupportedOperations } from "./previewAutomationHostCapabilities";

const completeJevBridge = () => ({
  getJevStatus: vi.fn(),
  observeJevBrowser: vi.fn(),
  verifyJevBrowser: vi.fn(),
  decideJevBrowser: vi.fn(),
  executeJevBrowser: vi.fn(),
  cancelJevBrowser: vi.fn(),
});

describe("preview automation host capabilities", () => {
  it("advertises each optional native action only when its bridge method exists", () => {
    const operations = resolvePreviewAutomationSupportedOperations(
      {
        verify: vi.fn(),
        check: vi.fn(),
        waitForAssertion: vi.fn(),
      },
      undefined,
      undefined,
    );

    expect(operations).toEqual([
      ...PREVIEW_AUTOMATION_V1_OPERATIONS,
      "resize",
      "setColorScheme",
      "verify",
      "check",
      "waitForAssertion",
    ]);
  });

  it("withholds every Jev operation when the native host lacks verification", () => {
    const { verifyJevBrowser: _verifyJevBrowser, ...bridge } = completeJevBridge();

    const operations = resolvePreviewAutomationSupportedOperations({}, bridge, undefined);

    expect(operations).not.toEqual(expect.arrayContaining([...JEV_BROWSER_AUTOMATION_OPERATIONS]));
  });

  it("advertises the complete Jev operation set only for a complete native host", () => {
    const operations = resolvePreviewAutomationSupportedOperations(
      {},
      completeJevBridge(),
      undefined,
    );

    expect(operations).toEqual(expect.arrayContaining([...JEV_BROWSER_AUTOMATION_OPERATIONS]));
  });

  it("advertises artifact operations only for their exact local bridge requirements", () => {
    const operations = resolvePreviewAutomationSupportedOperations({}, undefined, {
      prepareAction: vi.fn(),
      selectUpload: vi.fn(),
      startDownload: vi.fn(),
      readDownload: vi.fn(),
      dialogStatus: vi.fn(),
    });

    expect(operations).toEqual(expect.arrayContaining(["uploadFile", "dialogStatus"]));
    expect(operations).not.toEqual(
      expect.arrayContaining(
        PREVIEW_AUTOMATION_ARTIFACT_OPERATIONS.filter(
          (operation) => operation === "downloadFile" || operation === "dialogHandle",
        ),
      ),
    );
  });
});
