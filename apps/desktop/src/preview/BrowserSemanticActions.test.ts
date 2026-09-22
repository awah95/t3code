import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { describe, expect, it } from "vite-plus/test";

import {
  buildBrowserSemanticCheckExpression,
  buildBrowserDirectActionExpression,
  buildBrowserSemanticHoverExpression,
  buildBrowserSemanticScrollExpression,
  decodeBrowserSemanticCheckResult,
  decodeBrowserSemanticHoverResult,
  decodeBrowserSemanticScrollResult,
  uniqueBrowserSemanticActionTarget,
} from "./BrowserSemanticActions.ts";

const evaluateDirect = (
  expression: string,
  page: Record<string, unknown>,
  document: { querySelectorAll: (selector: string) => readonly unknown[] },
) => Function("globalThis", "document", `return (${expression})`)(page, document);

describe("BrowserSemanticActions", () => {
  it("quotes every page-owned action argument", () => {
    expect(buildBrowserSemanticCheckExpression('revision"', 'target"', true)).toContain(
      'check("revision\\\"", "target\\\"", true)',
    );
    expect(buildBrowserSemanticHoverExpression('revision"', 'target"')).toContain(
      'hover("revision\\\"", "target\\\"")',
    );
    expect(buildBrowserSemanticScrollExpression('revision"', 'target"', "down")).toContain(
      'scrollTarget("revision\\\"", "target\\\"", "down")',
    );
  });

  effectIt.effect("accepts observed milestones and rejects incomplete successes", () =>
    Effect.gen(function* () {
      expect(
        yield* decodeBrowserSemanticCheckResult({ ok: true, changed: false, checked: true }),
      ).toEqual({ ok: true, changed: false, checked: true });
      expect(yield* decodeBrowserSemanticHoverResult({ ok: true })).toEqual({ ok: true });
      expect(
        yield* decodeBrowserSemanticScrollResult({
          ok: true,
          before: { x: 0, y: 100 },
          after: { x: 0, y: 500 },
          progressed: true,
        }),
      ).toMatchObject({ progressed: true });

      expect(
        Exit.isFailure(
          yield* Effect.exit(
            decodeBrowserSemanticScrollResult({
              ok: true,
              before: { x: 0, y: 100 },
              after: { x: 0, y: 500 },
            }),
          ),
        ),
      ).toBe(true);
    }),
  );

  it("requires one current target from a completely searched semantic scope", () => {
    const assertion = {
      kind: "control-exists" as const,
      target: { role: "button", name: "Save" },
    };
    const complete = {
      assertion,
      verdict: "passed" as const,
      passed: true,
      matchCount: 1,
      matches: [{ documentId: "doc", frameId: "main", elementId: "save" }],
      coverage: { status: "complete" as const, searchedScopes: 1, omittedScopes: 0, omissions: [] },
      document: { documentId: "doc", revision: "doc:3", status: "current" as const },
    };
    expect(uniqueBrowserSemanticActionTarget(complete)).toEqual({
      ok: true,
      revision: "doc:3",
      targetId: "save",
    });
    expect(
      uniqueBrowserSemanticActionTarget({
        ...complete,
        verdict: "indeterminate",
        passed: false,
        coverage: { ...complete.coverage, status: "partial", omittedScopes: 1 },
      }),
    ).toEqual({ ok: false, reason: "semantic-scope-incomplete" });
    expect(
      uniqueBrowserSemanticActionTarget({
        ...complete,
        verdict: "failed",
        passed: false,
        matchCount: 2,
        matches: [
          { documentId: "doc", frameId: "main", elementId: "save-1" },
          { documentId: "doc", frameId: "main", elementId: "save-2" },
        ],
      }),
    ).toEqual({ ok: false, reason: "semantic-target-not-unique" });
  });

  it("resolves one locator and selects an exact full-list label", () => {
    const element = {};
    const selected: unknown[][] = [];
    const runtime = {
      registerTarget: (target: unknown) =>
        target === element
          ? { ok: true, revision: "doc:1", targetId: "target" }
          : { ok: false, reason: "wrong-target" },
      scrollIntoViewTarget: () => ({
        ok: true,
        revision: "doc:2",
        targetId: "target",
        href: "https://example.test/download",
        framePath: [0, 2],
      }),
      guard: () => ({ ok: true, x: 20, y: 30 }),
      selectLabel: (...input: unknown[]) => {
        selected.push(input);
        return { ok: true };
      },
    };
    const page = {
      __t3JevBrowser: runtime,
      __t3PlaywrightInjected: {
        parseSelector: (locator: string) => locator,
        querySelectorAll: () => [element],
      },
    };
    const result = evaluateDirect(
      buildBrowserDirectActionExpression({
        operation: "select",
        input: { locator: "role=combobox[name='Language']", label: "TypeScript" },
      }),
      page,
      { querySelectorAll: () => [] },
    );
    expect(result).toEqual({ ok: true });
    expect(selected).toEqual([["doc:2", "target", "TypeScript"]]);
  });

  it("rejects ambiguous selectors before mutation and returns a native hover point", () => {
    const element = {};
    let checks = 0;
    const runtime = {
      registerTarget: () => ({ ok: true, revision: "doc:1", targetId: "target" }),
      scrollIntoViewTarget: () => ({
        ok: true,
        revision: "doc:2",
        targetId: "target",
        href: "https://example.test/download",
        framePath: [0, 2],
      }),
      guard: () => ({ ok: true, x: 12, y: 34 }),
      check: () => {
        checks++;
        return { ok: true };
      },
    };
    const page = { __t3JevBrowser: runtime };
    const ambiguous = evaluateDirect(
      buildBrowserDirectActionExpression({
        operation: "check",
        input: { selector: ".duplicate", checked: true },
      }),
      page,
      { querySelectorAll: () => [element, {}] },
    );
    expect(ambiguous).toEqual({ ok: false, reason: "target-not-unique" });
    expect(checks).toBe(0);
    const checked = evaluateDirect(
      buildBrowserDirectActionExpression({
        operation: "check",
        input: { selector: "#terms", checked: true },
      }),
      page,
      { querySelectorAll: () => [element] },
    );
    expect(checked).toEqual({ ok: true });
    expect(checks).toBe(1);

    const hovered = evaluateDirect(
      buildBrowserDirectActionExpression({
        operation: "hover",
        input: { selector: "#menu" },
      }),
      page,
      { querySelectorAll: () => [element] },
    );
    expect(hovered).toEqual({ ok: true, point: { x: 12, y: 34 } });
    const resolved = evaluateDirect(
      buildBrowserDirectActionExpression({
        operation: "resolve",
        input: { selector: "#download" },
      }),
      page,
      { querySelectorAll: () => [element] },
    );
    expect(resolved).toEqual({
      ok: true,
      targetId: "target",
      revision: "doc:2",
      framePath: [0, 2],
      point: { x: 12, y: 34 },
      href: "https://example.test/download",
    });
  });
});
