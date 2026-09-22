import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  BrowserNavigationTarget,
  BrowserSemanticTarget,
  BrowserVerificationCoverage,
} from "./browserVerification.ts";
import {
  JEV_BROWSER_ASSERTIONS_MAX_BYTES,
  JEV_BROWSER_AUTOMATION_OPERATIONS,
  JevBrowserRunTaskInput,
  JevBrowserVerifyInput,
  JevBrowserVerifyResult,
} from "./jevBrowser.ts";
import {
  PREVIEW_AUTOMATION_OPERATIONS,
  PreviewAutomationCheckInput,
  PreviewAutomationSelectInput,
  PreviewAutomationVerifyInput,
} from "./previewAutomation.ts";

const decodeNavigation = Schema.decodeUnknownSync(BrowserNavigationTarget);
const decodeTarget = Schema.decodeUnknownSync(BrowserSemanticTarget);
const decodeCoverage = Schema.decodeUnknownSync(BrowserVerificationCoverage);
const decodeVerifyInput = Schema.decodeUnknownSync(PreviewAutomationVerifyInput);
const decodeJevVerifyInput = Schema.decodeUnknownSync(JevBrowserVerifyInput);
const decodeRunTaskInput = Schema.decodeUnknownSync(JevBrowserRunTaskInput);
const decodeVerifyResult = Schema.decodeUnknownSync(JevBrowserVerifyResult);
const decodeSelect = Schema.decodeUnknownSync(PreviewAutomationSelectInput);
const decodeCheck = Schema.decodeUnknownSync(PreviewAutomationCheckInput);

describe("browser verification contracts", () => {
  it("keeps direct URLs and environment-relative navigation as finite alternatives", () => {
    expect(decodeNavigation({ kind: "url", url: "http://localhost:5173/settings" })).toEqual({
      kind: "url",
      url: "http://localhost:5173/settings",
    });
    expect(
      decodeNavigation({
        kind: "environment-port",
        port: 5173,
        protocol: "http",
        path: "/settings?tab=account",
      }),
    ).toMatchObject({ kind: "environment-port", port: 5173 });
    expect(() => decodeNavigation({ kind: "environment-port", port: 70_000 })).toThrow();
  });

  it("decodes bounded frame and ancestor scopes", () => {
    expect(
      decodeTarget({
        role: "button",
        name: "Save",
        scope: {
          frame: {
            kind: "frame-path",
            frames: [{ kind: "semantic", name: "Account editor" }],
          },
          ancestor: { kind: "semantic", role: "region", name: "Billing" },
        },
      }),
    ).toMatchObject({ role: "button", scope: { frame: { kind: "frame-path" } } });
    expect(() =>
      decodeTarget({
        role: "button",
        name: "Save",
        scope: { frame: { kind: "frame-path", frames: [] } },
      }),
    ).toThrow();
  });

  it("requires explicit coverage and freshness on tri-state verification results", () => {
    const assertion = {
      kind: "control-exists" as const,
      target: { role: "button", name: "Save" },
    };
    expect(
      decodeVerifyResult({
        results: [
          {
            assertion,
            verdict: "indeterminate",
            passed: false,
            reason: "A closed shadow root was not searchable.",
            matchCount: 0,
            coverage: {
              status: "partial",
              searchedScopes: 1,
              omittedScopes: 1,
              omissions: ["closed-shadow-root"],
            },
            document: { documentId: "doc-1", revision: "r2", status: "current" },
          },
        ],
      }).results[0],
    ).toMatchObject({ verdict: "indeterminate", passed: false });
    expect(() => decodeCoverage({ status: "partial", searchedScopes: 1 })).toThrow();
    expect(() =>
      decodeVerifyResult({
        results: [
          {
            assertion,
            verdict: "passed",
            passed: true,
            matchCount: 1,
            coverage: {
              status: "partial",
              searchedScopes: 1,
              omittedScopes: 1,
              omissions: ["bounded traversal"],
            },
            document: { documentId: "doc-1", revision: "r2", status: "current" },
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      decodeVerifyResult({
        results: [
          {
            assertion,
            verdict: "failed",
            passed: true,
            matchCount: 0,
            coverage: {
              status: "complete",
              searchedScopes: 1,
              omittedScopes: 0,
              omissions: [],
            },
            document: { documentId: "doc-1", revision: "r2", status: "current" },
          },
        ],
      }),
    ).toThrow();
  });

  it("validates direct verification and typed desired-state actions", () => {
    expect(
      decodeVerifyInput({
        assertions: [
          {
            kind: "control-count",
            target: { role: "button", name: "Save" },
            operator: "equals",
            expected: 1,
          },
        ],
      }).assertions,
    ).toHaveLength(1);
    expect(
      decodeSelect({ semanticTarget: { role: "combobox", name: "Country" }, label: "Egypt" }),
    ).toMatchObject({ label: "Egypt" });
    expect(
      decodeCheck({ semanticTarget: { role: "checkbox", name: "Stock only" }, checked: true }),
    ).toMatchObject({ checked: true });
    expect(() =>
      decodeSelect({
        locator: "role=combobox[name='Country']",
        semanticTarget: { role: "combobox", name: "Country" },
        value: "eg",
      }),
    ).toThrow();
  });

  it("bounds combined assertion payloads by UTF-8 bytes on direct and Jev inputs", () => {
    const compactAssertion = {
      kind: "location" as const,
      property: "title" as const,
      operator: "contains" as const,
      expected: "Saved",
    };
    expect(decodeVerifyInput({ assertions: [compactAssertion] }).assertions).toHaveLength(1);
    expect(
      decodeJevVerifyInput({ runId: "run-1", assertions: [compactAssertion] }).assertions,
    ).toHaveLength(1);
    expect(
      decodeRunTaskInput({ task: "Verify title", assertions: [compactAssertion] }).assertions,
    ).toHaveLength(1);

    const multibyteAssertion = {
      ...compactAssertion,
      expected: "🧪".repeat(Math.ceil(JEV_BROWSER_ASSERTIONS_MAX_BYTES / 4)),
    };
    expect(() => decodeVerifyInput({ assertions: [multibyteAssertion] })).toThrow();
    expect(() =>
      decodeJevVerifyInput({ runId: "run-1", assertions: [multibyteAssertion] }),
    ).toThrow();
    expect(() =>
      decodeRunTaskInput({ task: "Verify title", assertions: [multibyteAssertion] }),
    ).toThrow();
  });

  it("exposes verification through both capability sets", () => {
    expect(PREVIEW_AUTOMATION_OPERATIONS).toContain("verify");
    expect(JEV_BROWSER_AUTOMATION_OPERATIONS).toContain("jevBrowserVerify");
  });
});
