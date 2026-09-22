import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect } from "vite-plus/test";
import { it } from "@effect/vitest";
import type { WebContents } from "electron";
import { makeBrowserCapabilities, type BrowserCapabilityHost } from "./BrowserCapabilities.ts";

class TestBrowserError extends Schema.TaggedError<TestBrowserError>()("TestBrowserError", {
  message: Schema.String,
}) {}

function harness(results: unknown[], interrupted = false) {
  const commands: string[] = [];
  const contexts: Array<number | undefined> = [];
  const host: BrowserCapabilityHost<TestBrowserError> = {
    requireWebContents: () => Effect.succeed({ id: 42 } as WebContents),
    withControlSession: (_tab, _wc, _action, use) => {
      const send = (method: string) => {
        commands.push(method);
        return Effect.succeed(
          method === "Page.getFrameTree"
            ? { frameTree: { frame: { id: "main-frame" } } }
            : method === "Page.createIsolatedWorld"
              ? { executionContextId: 7 }
              : {},
        );
      };
      return use(
        send,
        send,
        interrupted
          ? Effect.fail(new TestBrowserError({ message: "human takeover" }))
          : Effect.void,
      );
    },
    evaluate: <A>(
      _tab: string,
      _send: unknown,
      _expression: string,
      _value: boolean,
      _await?: boolean,
      contextId?: number,
    ) => {
      contexts.push(contextId);
      return Effect.succeed(results.shift() as A);
    },
    operationError: ({ operation }) => new TestBrowserError({ message: operation }),
    prepareAutomationInput: () => Effect.void,
    emitPointerEvent: () => Effect.void,
    nextPointerSequence: () => Effect.succeed(1),
    currentIso: () => Effect.succeed("2026-09-22T00:00:00.000Z"),
    expectAgentPointer: () => Effect.void,
    ensurePlaywrightInjected: () => Effect.void,
  };
  return { api: makeBrowserCapabilities(host), commands, contexts };
}

describe("native browser capability boundary", () => {
  it.effect("validates verification results and executes all page code in an isolated world", () =>
    Effect.gen(function* () {
      const { api, contexts } = harness([{}, { results: [] }]);
      expect(yield* api.automationVerify("tab", { assertions: [] })).toEqual({ results: [] });
      expect(contexts).toEqual([7, 7]);
      const malformed = harness([{}, { results: [{ verdict: "passed" }] }]);
      const result = yield* Effect.exit(malformed.api.automationVerify("tab", { assertions: [] }));
      expect(Exit.isFailure(result)).toBe(true);
    }),
  );

  it.effect("never dispatches a native hover after the human takes control", () =>
    Effect.gen(function* () {
      const { api, commands } = harness([{}, { ok: true, point: { x: 40, y: 50 } }], true);
      const result = yield* Effect.exit(api.automationHover("tab", { selector: "button" }));
      expect(Exit.isFailure(result)).toBe(true);
      expect(commands).not.toContain("Input.dispatchMouseEvent");
    }),
  );

  it.effect("rejects non-finite geometry instead of dispatching native input", () =>
    Effect.gen(function* () {
      const { api, commands } = harness([{}, { ok: true, point: { x: Infinity, y: 50 } }]);
      const result = yield* Effect.exit(api.automationHover("tab", { selector: "button" }));
      expect(Exit.isFailure(result)).toBe(true);
      expect(commands).not.toContain("Input.dispatchMouseEvent");
    }),
  );
});
