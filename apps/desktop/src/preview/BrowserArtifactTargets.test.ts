import * as NodeVM from "node:vm";
import { describe, expect, it } from "vite-plus/test";
import { buildBrowserUploadTargetExpression } from "./BrowserArtifactTargets.ts";

const fileInput = (overrides: Record<string, unknown> = {}) => ({
  isConnected: true,
  localName: "input",
  type: "file",
  matches: () => false,
  getAttribute: () => null,
  ...overrides,
});

describe("browser upload target binding", () => {
  it("returns the exact hidden file input without activating the page", () => {
    const input = fileInput();
    const actual = NodeVM.runInNewContext(
      buildBrowserUploadTargetExpression({ selector: "input[type=file]" }),
      { document: { querySelectorAll: () => [input] } },
    );
    expect(actual).toBe(input);
  });

  it.each([{ matches: [] }, { matches: [fileInput(), fileInput()] }])(
    "rejects an ambiguous or absent input",
    ({ matches }) => {
      expect(() =>
        NodeVM.runInNewContext(buildBrowserUploadTargetExpression({ selector: "input" }), {
          document: { querySelectorAll: () => matches },
        }),
      ).toThrow("exactly one");
    },
  );

  it.each([
    { isConnected: false },
    { type: "text" },
    { matches: () => true },
    { getAttribute: () => "true" },
  ])("rejects a detached, non-file, or disabled target", (overrides) => {
    expect(() =>
      NodeVM.runInNewContext(buildBrowserUploadTargetExpression({ selector: "input" }), {
        document: { querySelectorAll: () => [fileInput(overrides)] },
      }),
    ).toThrow("enabled file input");
  });

  it("does not accept partial semantic coverage as a unique target", () => {
    expect(() =>
      NodeVM.runInNewContext(
        buildBrowserUploadTargetExpression({ semanticTarget: { role: "button", name: "Upload" } }),
        {
          __t3JevBrowser: {
            probe: () => ({
              results: [
                {
                  verdict: "passed",
                  coverage: { status: "partial" },
                  document: { status: "current" },
                  matchCount: 1,
                  matches: [{}],
                },
              ],
            }),
          },
        },
      ),
    ).toThrow("verified semantic match");
  });

  it("binds the retained element from a complete semantic probe", () => {
    const input = fileInput();
    const elementForCalls: unknown[][] = [];
    const actual = NodeVM.runInNewContext(
      buildBrowserUploadTargetExpression({
        semanticTarget: { role: "button", name: "Upload attachment" },
      }),
      {
        __t3JevBrowser: {
          probe: () => ({
            results: [
              {
                verdict: "passed",
                coverage: { status: "complete" },
                document: { status: "current", revision: "document-1:7" },
                matchCount: 1,
                matches: [{ elementId: "retained-file" }],
              },
            ],
          }),
          elementFor: (...args: unknown[]) => {
            elementForCalls.push(args);
            return input;
          },
        },
      },
    );
    expect(actual).toBe(input);
    expect(elementForCalls).toEqual([["document-1:7", "retained-file"]]);
  });

  it("uses the injected locator runtime and still requires one exact match", () => {
    const input = fileInput();
    const selectors: unknown[] = [];
    const document = {};
    const actual = NodeVM.runInNewContext(
      buildBrowserUploadTargetExpression({ locator: "label=Upload attachment" }),
      {
        document,
        __t3PlaywrightInjected: {
          parseSelector: (selector: string) => ({ parsed: selector }),
          querySelectorAll: (selector: unknown, root: unknown) => {
            selectors.push([selector, root]);
            return [input];
          },
        },
      },
    );
    expect(actual).toBe(input);
    expect(selectors).toEqual([[{ parsed: "label=Upload attachment" }, document]]);
  });
});
