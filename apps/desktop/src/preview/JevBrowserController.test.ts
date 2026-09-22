import { it as effectIt } from "@effect/vitest";
import type { DesktopPreviewPointerEvent } from "@t3tools/contracts";
import type { JevAutomationObservation } from "@t3tools/shared/jevAutomation";
import type { WebContents } from "electron";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import { describe, expect } from "vite-plus/test";

import {
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

describe("JevBrowserController", () => {
  effectIt.effect("owns semantic action state outside PreviewManager", () =>
    Effect.gen(function* () {
      const observations = [
        rawObservation("document-1:1", [
          rawControl("button", "button"),
          rawControl("checkbox", "checkbox"),
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
      const send: JevBrowserSendCommand<string> = (method) =>
        Effect.sync(() => {
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
        "checkbox",
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
      expect(yield* activate(initial, "menu")).toEqual({ status: "executed" });

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
      ).toHaveLength(3);
      expect(pointerEvents.map(({ phase }) => phase)).toEqual([
        "move",
        "click",
        "move",
        "click",
        "move",
        "click",
      ]);
      expect(yield* activate(disabled, "menu")).toEqual({ status: "executed" });
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
