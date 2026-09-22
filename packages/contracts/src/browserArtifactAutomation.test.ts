import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  BrowserUploadHostInput,
  DesktopBrowserUploadInput,
  PreviewAutomationDownloadFileInput,
  PreviewAutomationUploadFileInput,
} from "./browserArtifactAutomation.ts";

const isPreviewUpload = Schema.is(PreviewAutomationUploadFileInput);
const isHostUpload = Schema.is(BrowserUploadHostInput);
const decodeHostUpload = Schema.decodeUnknownSync(BrowserUploadHostInput);
const isDesktopUpload = Schema.is(DesktopBrowserUploadInput);
const isPreviewDownload = Schema.is(PreviewAutomationDownloadFileInput);

describe("browser artifact automation contracts", () => {
  it("derives workspace scope when omitted, accepts the legacy hint, and requires one target", () => {
    const input = {
      tabId: "tab-1",
      target: { semanticTarget: { role: "button", name: "Resume" } },
      source: { kind: "workspace-file", path: "fixtures/resume.pdf" },
    } as const;
    expect(isPreviewUpload(input)).toBe(true);
    expect(
      isPreviewUpload({
        ...input,
        source: { ...input.source, threadId: "thread-1" },
      }),
    ).toBe(true);
    expect(
      isPreviewUpload({
        ...input,
        target: { locator: "input[type=file]", selector: "#resume" },
      }),
    ).toBe(false);
  });

  it("keeps bytes out of the WebSocket host request", () => {
    const input = {
      transfer: {
        environmentId: "environment-1",
        tabId: "tab-1",
        actionId: "action-1",
        artifactId: "artifact-1",
        fileName: "resume.pdf",
        mimeType: "application/pdf",
        sizeBytes: 3,
      },
      target: { locator: "input[type=file]" },
      sourceUrl: "http://localhost:5173/api/assets/signed/resume.pdf",
    } as const;
    expect(isHostUpload(input)).toBe(true);
    expect(isHostUpload({ ...input, data: new Uint8Array(3) })).toBe(true);
    expect("data" in decodeHostUpload(input)).toBe(false);
  });

  it("admits bytes only on the local renderer-to-main bridge", () => {
    const input = {
      transfer: {
        environmentId: "environment-1",
        tabId: "tab-1",
        actionId: "action-1",
        artifactId: "artifact-1",
        fileName: "resume.pdf",
        mimeType: "application/pdf",
        sizeBytes: 3,
        data: new Uint8Array([1, 2, 3]),
      },
      target: { locator: "input[type=file]" },
    } as const;
    expect(isDesktopUpload(input)).toBe(true);
  });

  it("requires a single explicit download trigger target", () => {
    expect(
      isPreviewDownload({
        tabId: "tab-1",
        target: { locator: "role=button[name='Export']" },
        expectedFileName: "report.csv",
      }),
    ).toBe(true);
    expect(
      isPreviewDownload({
        tabId: "tab-1",
        target: {},
      }),
    ).toBe(false);
  });
});
