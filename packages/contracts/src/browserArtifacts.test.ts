import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  BROWSER_ARTIFACT_MAX_BYTES,
  BrowserArtifactFileName,
  BrowserDialogHandleRequest,
  BrowserDownloadArtifact,
  BrowserUploadTransfer,
} from "./browserArtifacts.ts";

const upload = {
  environmentId: "environment-1",
  tabId: "tab-1",
  runId: "run-1",
  actionId: "action-1",
  artifactId: "artifact-1",
  fileName: "report.csv",
  mimeType: "text/csv",
  sizeBytes: 3,
  data: new Uint8Array([1, 2, 3]),
} as const;
const isUploadTransfer = Schema.is(BrowserUploadTransfer);
const isFileName = Schema.is(BrowserArtifactFileName);
const isDownloadArtifact = Schema.is(BrowserDownloadArtifact);
const isDialogHandleRequest = Schema.is(BrowserDialogHandleRequest);

describe("browser artifact contracts", () => {
  it("accepts bounded byte transfers whose declared and actual sizes agree", () => {
    expect(isUploadTransfer(upload)).toBe(true);
    expect(isUploadTransfer({ ...upload, sizeBytes: 2 })).toBe(false);
    expect(
      isUploadTransfer({
        ...upload,
        sizeBytes: BROWSER_ARTIFACT_MAX_BYTES + 1,
        data: new Uint8Array(),
      }),
    ).toBe(false);
  });

  it("keeps transport paths out by requiring a safe filename segment", () => {
    expect(isFileName("report (final).csv")).toBe(true);
    expect(isFileName("../report.csv")).toBe(false);
    expect(isFileName("folder/report.csv")).toBe(false);
    expect(isFileName("folder\\report.csv")).toBe(false);
    expect(isFileName("report\u0000.csv")).toBe(false);
    expect(isFileName(`${"😀".repeat(62)}.txt`)).toBe(true);
    expect(isFileName(`${"😀".repeat(63)}.txt`)).toBe(false);
  });

  it("requires exact completed download identity and bounded size", () => {
    const result = {
      environmentId: "environment-1",
      tabId: "tab-1",
      actionId: "action-1",
      artifactId: "artifact-1",
      fileName: "report.csv",
      sizeBytes: 20,
      status: "completed",
      completedAt: "2026-09-22T12:00:00.000Z",
    } as const;
    expect(isDownloadArtifact(result)).toBe(true);
    expect(isDownloadArtifact({ ...result, status: "interrupted" })).toBe(false);
    expect(
      isDownloadArtifact({
        ...result,
        sizeBytes: BROWSER_ARTIFACT_MAX_BYTES + 1,
      }),
    ).toBe(false);
  });

  it("allows prompt text only for an accepted dialog", () => {
    const identity = {
      environmentId: "environment-1",
      tabId: "tab-1",
      actionId: "action-1",
      dialogId: "dialog-1",
    } as const;
    expect(
      isDialogHandleRequest({
        ...identity,
        action: "accept",
        promptText: "confirmed",
      }),
    ).toBe(true);
    expect(
      isDialogHandleRequest({
        ...identity,
        action: "dismiss",
        promptText: "must not cross the wire",
      }),
    ).toBe(false);
  });
});
