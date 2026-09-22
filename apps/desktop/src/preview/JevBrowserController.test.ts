import { it as effectIt } from "@effect/vitest";
import type { DesktopPreviewPointerEvent, JevBrowserAssertion } from "@t3tools/contracts";
import type { JevAutomationObservation } from "@t3tools/shared/jevAutomation";
import type { WebContents } from "electron";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import { describe, expect, it } from "vite-plus/test";

import {
  buildCandidates,
  makeJevBrowserController,
  type JevBrowserHost,
  type JevBrowserSendCommand,
} from "./JevBrowserController.ts";

const rawControl = (
  id: string,
  role: string,
  overrides: Partial<{
    readonly checked: boolean;
    readonly disabled: boolean;
    readonly href: string;
    readonly name: string;
    readonly options: ReadonlyArray<{
      readonly value: string;
      readonly label: string;
      readonly disabled: boolean;
    }>;
    readonly tag: string;
    readonly value: string;
    readonly scrollDirections: ReadonlyArray<"up" | "down" | "left" | "right">;
  }> = {},
) => ({
  id,
  tag: "div",
  role,
  name: id,
  value: "",
  checked: false,
  disabled: false,
  options: [],
  selector: `#${id}`,
  x: 10,
  y: 20,
  width: 100,
  height: 30,
  ...overrides,
});

const rawObservation = (
  revision: string,
  controls: ReadonlyArray<ReturnType<typeof rawControl>>,
) => ({
  revision,
  documentId: "document-1",
  url: "https://example.com/tools",
  title: "Tool",
  loading: false,
  text: "Tool controls",
  controls,
  omissions: [],
});

const containsString = (value: unknown, fragment: string): boolean => {
  if (typeof value === "string") return value.includes(fragment);
  if (Array.isArray(value)) return value.some((entry) => containsString(entry, fragment));
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).some((entry) => containsString(entry, fragment));
};

describe("JevBrowserController", () => {
  it("reserves candidates for navigation, scrolling, and keys on dense forms", () => {
    const controls = Array.from({ length: 20 }, (_, index) =>
      rawControl(`field-${index}`, "textbox", { tag: "input" }),
    );
    const inputs = [
      {
        id: "destination",
        kind: "url" as const,
        value: "https://example.com/next",
        description: "next page",
      },
      ...Array.from({ length: 127 }, (_, index) => ({
        id: `text-${index}`,
        kind: "text" as const,
        value: `value-${index}`,
        description: `value ${index}`,
      })),
    ];
    const generated = buildCandidates(controls, inputs, ["https://example.com"]);
    expect(generated.truncated).toBe(true);
    expect(generated.candidates).toHaveLength(2_048);
    expect(generated.candidates.some(({ operation }) => operation === "navigate")).toBe(true);
    expect(generated.candidates.some(({ operation }) => operation === "scroll")).toBe(true);
    expect(generated.candidates.some(({ operation }) => operation === "press-key")).toBe(true);
  });

  it("projects desired checked state without a blind-toggle input", () => {
    const generated = buildCandidates(
      [rawControl("terms", "checkbox", { tag: "input", checked: false })],
      [],
      ["https://example.com"],
    );
    expect(generated.candidates.filter(({ operation }) => operation === "set-checked")).toEqual([
      expect.objectContaining({
        operation: "set-checked",
        targetId: "terms",
        checked: true,
      }),
    ]);
    expect(generated.candidates.some(({ operation }) => operation === "activate")).toBe(false);
  });

  it("targets a retained nested scroll scope", () => {
    const generated = buildCandidates(
      [rawControl("virtual-list", "listbox", { scrollDirections: ["down"] })],
      [],
      ["https://example.com"],
    );
    expect(
      generated.candidates.find(
        ({ operation, targetId }) => operation === "scroll" && targetId === "virtual-list",
      ),
    ).toMatchObject({ inputId: "__t3_scroll_down" });
  });

  effectIt.effect("keeps resolved navigation URLs host-held", () =>
    Effect.gen(function* () {
      const navigated: string[] = [];
      const evaluatedExpressions: string[] = [];
      const raw = rawObservation("document-1:1", [rawControl("go", "button")]);
      raw.url = "http://10.0.0.8:5173/tools";
      const physicalAssertion = {
        kind: "location" as const,
        property: "location" as const,
        operator: "equals" as const,
        expected: "http://10.0.0.8:5173/tools",
      };
      const probeResult = (assertion: JevBrowserAssertion) => ({
        assertion,
        verdict: "passed" as const,
        passed: true,
        actual: "expected" in assertion ? assertion.expected : undefined,
        matchCount: 1,
        coverage: {
          status: "complete" as const,
          searchedScopes: 1,
          omittedScopes: 0,
          omissions: [],
        },
        document: {
          documentId: "document-1",
          revision: "document-1:1",
          status: "current" as const,
        },
      });
      let probeResults = [probeResult(physicalAssertion)];
      const send: JevBrowserSendCommand<string> = (method) =>
        Effect.succeed(
          method === "Page.getFrameTree"
            ? { frameTree: { frame: { id: "frame-1" } } }
            : method === "Page.createIsolatedWorld"
              ? { executionContextId: 17 }
              : undefined,
        );
      const host: JevBrowserHost<string> = {
        controlGeneration: () => Effect.succeed(0),
        requireWebContents: () => Effect.succeed({} as WebContents),
        withControlSession: (_tabId, _webContents, _action, use) => use(send, send, Effect.void),
        evaluate: (_tabId, _send, expression) => {
          evaluatedExpressions.push(expression);
          return Effect.succeed(
            (expression.startsWith("globalThis.__t3JevBrowser?.guard(")
              ? { ok: true }
              : expression.includes("__t3JevBrowser?.probe?.(")
                ? {
                    results: probeResults,
                  }
                : raw) as never,
          );
        },
        operationError: ({ operation, cause }) => `${operation}: ${String(cause)}`,
        prepareAutomationInput: () => Effect.void,
        emitPointerEvent: () => Effect.void,
        nextPointerSequence: () => Effect.succeed(1),
        currentIso: () => Effect.succeed("2026-09-22T00:00:00.000Z"),
        expectAgentPointer: () => Effect.void,
        navigate: (_tabId, url) => Effect.sync(() => navigated.push(url)),
        scroll: () => Effect.void,
        press: () => Effect.void,
      };
      const controller = yield* makeJevBrowserController(host);
      const navigationTarget = {
        kind: "environment-port" as const,
        port: 5173,
        path: "/tools",
      };
      const observation = yield* controller.observe(
        "run-1",
        "tab-1",
        [
          {
            id: "dev-server",
            kind: "navigation",
            target: navigationTarget,
            description: "the selected environment dev server",
          },
        ],
        ["http://localhost:5173"],
        [
          {
            inputId: "dev-server",
            resolvedUrl: "http://10.0.0.8:5173/tools",
            logicalLocation: "http://localhost:5173/tools",
            allowedOrigins: ["http://10.0.0.8:5173"],
          },
        ],
      );
      expect(observation.location).toBe("http://localhost:5173/tools");
      expect(containsString(observation, "10.0.0.8")).toBe(false);
      const candidate = observation.candidates.find(({ operation }) => operation === "navigate");
      expect(candidate).toBeDefined();
      expect(
        yield* controller.execute("run-1", "tab-1", observation.revision, {
          candidateId: candidate!.id,
          operation: "navigate",
          inputId: "dev-server",
          navigationTarget,
        }),
      ).toEqual({ status: "executed" });
      expect(navigated).toEqual(["http://10.0.0.8:5173/tools"]);
      const logicalAssertion = {
        ...physicalAssertion,
        expected: "http://localhost:5173/tools",
      };
      const verified = yield* controller.verify("run-1", "tab-1", {
        runId: "run-1",
        tabId: "tab-1",
        assertions: [logicalAssertion],
      });
      expect(verified.results[0]).toMatchObject({
        assertion: logicalAssertion,
        verdict: "passed",
        actual: "http://localhost:5173/tools",
      });
      expect(containsString(verified, "10.0.0.8")).toBe(false);
      const deceptiveExpected =
        "https://evil.test/path?next=http://localhost:5173/tools#http://localhost:5173";
      yield* Effect.exit(
        controller.verify("run-1", "tab-1", {
          runId: "run-1",
          tabId: "tab-1",
          assertions: [{ ...logicalAssertion, expected: deceptiveExpected }],
        }),
      );
      const deceptiveProbe = evaluatedExpressions.at(-1)!;
      expect(deceptiveProbe).toContain(deceptiveExpected);
      expect(deceptiveProbe).not.toContain(
        "https://evil.test/path?next=http://10.0.0.8:5173/tools#http://localhost:5173",
      );
      const titleAssertion = {
        kind: "location" as const,
        property: "title" as const,
        operator: "equals" as const,
        expected: "Tool",
      };
      probeResults = [probeResult(titleAssertion), probeResult(physicalAssertion)];
      const swapped = yield* Effect.exit(
        controller.verify("run-1", "tab-1", {
          runId: "run-1",
          tabId: "tab-1",
          assertions: [logicalAssertion, titleAssertion],
        }),
      );
      expect(Exit.isFailure(swapped)).toBe(true);
    }),
  );

  effectIt.effect("owns semantic action state outside PreviewManager", () =>
    Effect.gen(function* () {
      const observations = [
        rawObservation("document-1:1", [
          rawControl("button", "button"),
          rawControl("checkbox", "checkbox", { tag: "input" }),
          rawControl("combobox", "combobox"),
          rawControl("native-select", "combobox", {
            tag: "select",
            value: "ts",
            options: [{ value: "js", label: "JavaScript", disabled: false }],
          }),
          rawControl("menu", "menuitem", { name: "Options" }),
          rawControl("menu-check", "menuitemcheckbox"),
          rawControl("menu-radio", "menuitemradio"),
          rawControl("option", "option"),
          rawControl("radio", "radio"),
          rawControl("switch", "switch"),
          rawControl("tab", "tab"),
          rawControl("allowed-link", "link", { href: "https://example.com/docs" }),
          rawControl("outside-menu-link", "menuitem", {
            href: "https://outside.example/docs",
          }),
          rawControl("disabled-tab", "tab", { disabled: true }),
        ]),
        rawObservation("document-1:1a", [
          rawControl("menu", "menuitem", { name: "Options" }),
          rawControl("checkbox", "checkbox", { tag: "input", checked: true }),
        ]),
        rawObservation("document-1:2", [
          rawControl("menu", "menuitem", { name: "Options" }),
          rawControl("toggle", "menuitemcheckbox", { name: "Match whole word" }),
        ]),
        rawObservation("document-1:3", [
          rawControl("menu", "menuitem", { name: "Options" }),
          rawControl("toggle", "menuitemcheckbox", {
            name: "Match whole word",
            checked: true,
          }),
        ]),
        rawObservation("document-1:4", [
          rawControl("menu", "menuitem", { name: "Options" }),
          rawControl("toggle", "menuitemcheckbox", { name: "Match whole word" }),
        ]),
        rawObservation("document-1:4", [
          rawControl("menu", "menuitem", { name: "Options" }),
          rawControl("toggle", "menuitemcheckbox", { name: "Match whole word" }),
        ]),
      ];
      let observationIndex = 0;
      let sequence = 0;
      let holdReady = false;
      const readyStarted = yield* Deferred.make<void>();
      const releaseReady = yield* Deferred.make<void>();
      const evaluatedExpressions: string[] = [];
      const pointerEvents: DesktopPreviewPointerEvent[] = [];
      const sentCommands: Array<{ method: string; params?: Record<string, unknown> }> = [];
      const send: JevBrowserSendCommand<string> = (method, params) =>
        Effect.sync(() => {
          sentCommands.push({ method, ...(params === undefined ? {} : { params }) });
          if (method === "Page.getFrameTree") {
            return { frameTree: { frame: { id: "frame-1" } } };
          }
          if (method === "Page.createIsolatedWorld") return { executionContextId: 17 };
          return undefined;
        });
      const evaluate = <A = unknown>(
        _tabId: string,
        _send: JevBrowserSendCommand<string>,
        expression: string,
      ): Effect.Effect<A, string> =>
        Effect.gen(function* () {
          evaluatedExpressions.push(expression);
          if (expression.startsWith("globalThis.__t3JevBrowser?.guard(")) {
            return { ok: true, selector: "#target", x: 60, y: 35 } as A;
          }
          if (expression.startsWith("globalThis.__t3JevBrowser?.check(")) {
            return { ok: true, changed: true, checked: true } as A;
          }
          if (holdReady && expression.startsWith("globalThis.__t3JevBrowser?.observeReady")) {
            yield* Deferred.succeed(readyStarted, undefined);
            yield* Deferred.await(releaseReady);
          }
          return observations[observationIndex++] as A;
        });
      const host: JevBrowserHost<string> = {
        controlGeneration: () => Effect.succeed(0),
        requireWebContents: () => Effect.succeed({} as WebContents),
        withControlSession: (_tabId, _webContents, _action, use) => use(send, send, Effect.void),
        evaluate,
        operationError: ({ operation, cause }) => `${operation}: ${String(cause)}`,
        prepareAutomationInput: () => Effect.void,
        emitPointerEvent: (event) =>
          Effect.sync(() => pointerEvents.push(event)).pipe(Effect.asVoid),
        nextPointerSequence: () => Effect.sync(() => ++sequence),
        currentIso: () => Effect.succeed("2026-09-22T00:00:00.000Z"),
        expectAgentPointer: () => Effect.void,
        navigate: () => Effect.void,
        scroll: () => Effect.void,
        press: () => Effect.void,
      };
      const controller = yield* makeJevBrowserController(host);
      const observe = () => controller.observe("run-1", "tab-1", [], ["https://example.com"]);
      const activate = (observation: JevAutomationObservation, targetId: string) => {
        const candidate = observation.candidates.find(
          (entry) => entry.operation === "activate" && entry.targetId === targetId,
        );
        expect(candidate).toBeDefined();
        return controller.execute("run-1", "tab-1", observation.revision, {
          candidateId: candidate!.id,
          operation: "activate",
          targetId,
        });
      };

      const initial = yield* observe();
      expect(
        initial.candidates
          .filter(({ operation }) => operation === "activate")
          .map(({ targetId }) => targetId),
      ).toEqual([
        "button",
        "combobox",
        "menu",
        "menu-check",
        "menu-radio",
        "option",
        "radio",
        "switch",
        "tab",
        "allowed-link",
      ]);
      expect(initial.controls.find(({ id }) => id === "switch")).toMatchObject({
        value: false,
        checked: false,
      });
      expect(initial.controls.find(({ id }) => id === "menu")).not.toHaveProperty("checked");
      expect(
        initial.candidates.some(
          ({ operation, targetId }) =>
            operation === "select-option" && targetId === "native-select",
        ),
      ).toBe(true);
      const check = initial.candidates.find(
        ({ operation, targetId }) => operation === "set-checked" && targetId === "checkbox",
      );
      expect(check).toBeDefined();
      expect(
        yield* controller.execute("run-1", "tab-1", initial.revision, {
          candidateId: check!.id,
          operation: "set-checked",
          targetId: "checkbox",
          checked: true,
        }),
      ).toMatchObject({ status: "executed" });

      const checked = yield* observe();
      expect(checked.controls.find(({ id }) => id === "checkbox")).toMatchObject({
        checked: true,
      });
      expect(yield* activate(checked, "menu")).toEqual({ status: "executed" });

      const opened = yield* observe();
      expect(opened.controls.find(({ id }) => id === "toggle")).toMatchObject({
        value: false,
        checked: false,
      });
      expect(yield* activate(opened, "toggle")).toEqual({ status: "executed" });

      const enabled = yield* observe();
      expect(enabled.controls.find(({ id }) => id === "toggle")).toMatchObject({
        value: true,
        checked: true,
      });
      expect(yield* activate(enabled, "toggle")).toEqual({ status: "executed" });

      const disabled = yield* observe();
      expect(disabled.controls.find(({ id }) => id === "toggle")).toMatchObject({
        value: false,
        checked: false,
      });
      expect(
        evaluatedExpressions.filter((expression) =>
          expression.startsWith("globalThis.__t3JevBrowser?.observeReady"),
        ),
      ).toHaveLength(4);
      expect(pointerEvents.map(({ phase }) => phase)).toEqual([
        "move",
        "click",
        "move",
        "click",
        "move",
        "click",
      ]);
      const hover = disabled.candidates.find(
        ({ operation, targetId }) => operation === "hover" && targetId === "menu",
      );
      expect(hover).toBeDefined();
      expect(
        yield* controller.execute("run-1", "tab-1", disabled.revision, {
          candidateId: hover!.id,
          operation: "hover",
          targetId: "menu",
        }),
      ).toEqual({ status: "executed" });
      expect(
        sentCommands.some(
          ({ method, params }) =>
            method === "Input.dispatchMouseEvent" && params?.type === "mouseMoved",
        ),
      ).toBe(true);
      holdReady = true;
      const pendingObservation = yield* observe().pipe(
        Effect.forkChild({ startImmediately: true }),
      );
      yield* Deferred.await(readyStarted);
      expect(yield* controller.cancel("run-1")).toBe(true);
      yield* Deferred.succeed(releaseReady, undefined);
      expect(Exit.isFailure(yield* Fiber.await(pendingObservation))).toBe(true);
      expect(yield* controller.cancel("run-1")).toBe(false);
    }),
  );
});
