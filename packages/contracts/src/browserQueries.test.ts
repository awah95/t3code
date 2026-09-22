import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  BROWSER_QUERY_MAX_INPUT_BYTES,
  BrowserExtractQuery,
  BrowserExtractResult,
  BrowserWaitForAssertionQuery,
  BrowserWaitForAssertionResult,
} from "./browserQueries.ts";
import {
  PreviewAutomationExtractInput,
  PreviewAutomationWaitForAssertionInput,
} from "./previewAutomation.ts";

const decodeExtract = Schema.decodeUnknownSync(BrowserExtractQuery);
const decodeExtractResult = Schema.decodeUnknownSync(BrowserExtractResult);
const decodeWait = Schema.decodeUnknownSync(BrowserWaitForAssertionQuery);
const decodeWaitResult = Schema.decodeUnknownSync(BrowserWaitForAssertionResult);
const decodePreviewExtract = Schema.decodeUnknownSync(PreviewAutomationExtractInput);
const decodePreviewWait = Schema.decodeUnknownSync(PreviewAutomationWaitForAssertionInput);

describe("bounded browser query contracts", () => {
  it("accepts declared list fields and rejects duplicate output keys", () => {
    const query = {
      source: {
        kind: "list",
        target: { role: "list", name: "Search results" },
        itemRole: "listitem",
      },
      fields: [
        {
          kind: "descendant",
          key: "title",
          target: { role: "heading", name: "Result title" },
          property: "text",
        },
      ],
      maxRows: 25,
      maxFieldChars: 500,
    };
    expect(decodeExtract(query)).toMatchObject({ maxRows: 25 });
    expect(() =>
      decodeExtract({
        ...query,
        fields: [
          { kind: "container", key: "title", property: "name" },
          { kind: "container", key: "title", property: "text" },
        ],
      }),
    ).toThrow();
    expect(() =>
      decodePreviewExtract({
        ...query,
        fields: [
          { kind: "container", key: "title", property: "name" },
          { kind: "container", key: "title", property: "text" },
        ],
      }),
    ).toThrow();
  });

  it("bounds aggregate extraction queries by encoded UTF-8 bytes", () => {
    const oversized = {
      source: {
        kind: "region" as const,
        target: {
          role: "region",
          name: "🧪".repeat(Math.ceil(BROWSER_QUERY_MAX_INPUT_BYTES / 4)),
        },
      },
      fields: [{ kind: "container" as const, key: "title", property: "text" as const }],
    };
    expect(() => decodeExtract(oversized)).toThrow();
    expect(() => decodePreviewExtract(oversized)).toThrow();
  });

  it("keeps result rows bounded and carries explicit omissions", () => {
    expect(
      decodeExtractResult({
        rows: [{ fields: [{ key: "title", value: "Studio" }] }],
        omittedRows: 3,
        omittedFields: 1,
        omissions: ["Three rows exceeded maxRows."],
        coverage: {
          status: "partial",
          searchedScopes: 1,
          omittedScopes: 0,
          omissions: ["row-limit"],
        },
        document: { documentId: "doc-1", revision: "r3", status: "current" },
      }),
    ).toMatchObject({ omittedRows: 3, coverage: { status: "partial" } });
  });

  it("models one typed event-backed wait with an exact deadline", () => {
    const assertion = {
      kind: "location" as const,
      property: "visibleText" as const,
      operator: "contains" as const,
      expected: "Saved",
    };
    expect(decodeWait({ assertion, timeoutMs: 5_000 })).toMatchObject({ timeoutMs: 5_000 });
    expect(() => decodeWait({ assertion, timeoutMs: 60_001 })).toThrow();
    expect(() =>
      decodeWait({
        assertion: {
          ...assertion,
          expected: "🧪".repeat(Math.ceil(BROWSER_QUERY_MAX_INPUT_BYTES / 4)),
        },
        timeoutMs: 5_000,
      }),
    ).toThrow();
    expect(() =>
      decodePreviewWait({
        assertion: {
          ...assertion,
          expected: "🧪".repeat(Math.ceil(BROWSER_QUERY_MAX_INPUT_BYTES / 4)),
        },
        timeoutMs: 5_000,
      }),
    ).toThrow();
    expect(
      decodeWaitResult({
        status: "timed-out",
        result: {
          assertion,
          verdict: "failed",
          passed: false,
          actual: "Saving",
          matchCount: 1,
          coverage: { status: "complete", searchedScopes: 1, omittedScopes: 0, omissions: [] },
          document: { documentId: "doc-1", revision: "r4", status: "current" },
        },
      }),
    ).toMatchObject({ status: "timed-out", result: { passed: false } });
    expect(() =>
      decodeWaitResult({
        status: "satisfied",
        result: {
          assertion,
          verdict: "failed",
          passed: false,
          matchCount: 0,
          coverage: { status: "complete", searchedScopes: 1, omittedScopes: 0, omissions: [] },
          document: { documentId: "doc-1", revision: "r4", status: "current" },
        },
      }),
    ).toThrow();
  });
});
