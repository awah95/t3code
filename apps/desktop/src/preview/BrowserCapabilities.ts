import {
  PreviewAutomationVerifyResult,
  PreviewAutomationExtractResult,
  PreviewAutomationWaitForAssertionResult,
} from "@t3tools/contracts";
import type {
  PreviewAutomationVerifyInput,
  PreviewAutomationSelectInput,
  PreviewAutomationCheckInput,
  PreviewAutomationHoverInput,
  PreviewAutomationExtractInput,
  PreviewAutomationWaitForAssertionInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { JevBrowserHost, JevBrowserSendCommand } from "./JevBrowserController.ts";
import { buildJevBrowserSemanticProbeExpression } from "./JevBrowserSemanticProbe.ts";
import { buildJevBrowserObservationExpression } from "./JevBrowserObservation.ts";
import { buildBrowserDirectActionExpression } from "./BrowserSemanticActions.ts";
import {
  buildBrowserExtractExpression,
  buildBrowserWaitForAssertionExpression,
} from "./BrowserQueries.ts";

const decodeFrameTree = Schema.decodeUnknownEffect(
  Schema.Struct({ frameTree: Schema.Struct({ frame: Schema.Struct({ id: Schema.String }) }) }),
);
const decodeIsolatedWorld = Schema.decodeUnknownEffect(
  Schema.Struct({ executionContextId: Schema.Int }),
);
const decodeVerification = Schema.decodeUnknownEffect(PreviewAutomationVerifyResult);
const decodeExtraction = Schema.decodeUnknownEffect(PreviewAutomationExtractResult);
const decodeWait = Schema.decodeUnknownEffect(PreviewAutomationWaitForAssertionResult);
const decodeDirectAction = Schema.decodeUnknownEffect(
  Schema.Union([
    Schema.Struct({ ok: Schema.Literal(false), reason: Schema.String }),
    Schema.Struct({
      ok: Schema.Literal(true),
      point: Schema.optionalKey(Schema.Struct({ x: Schema.Finite, y: Schema.Finite })),
    }),
  ]),
);

export type BrowserCapabilityHost<E> = Pick<
  JevBrowserHost<E>,
  | "requireWebContents"
  | "withControlSession"
  | "evaluate"
  | "operationError"
  | "prepareAutomationInput"
  | "emitPointerEvent"
  | "nextPointerSequence"
  | "currentIso"
  | "expectAgentPointer"
> & {
  readonly ensurePlaywrightInjected: (
    tabId: string,
    send: JevBrowserSendCommand<E>,
    contextId?: number,
  ) => Effect.Effect<void, E>;
};

/** Additive native tools share the existing control lease and isolated page runtime. */
export function makeBrowserCapabilities<E>(host: BrowserCapabilityHost<E>) {
  const semanticWorld = Effect.fn("BrowserCapabilities.semanticWorld")(function* (
    tabId: string,
    send: JevBrowserSendCommand<E>,
  ) {
    const tree = yield* send("Page.getFrameTree");
    const frame = yield* decodeFrameTree(tree).pipe(
      Effect.mapError((cause) => host.operationError({ operation: "semanticWorld", tabId, cause })),
    );
    const world = yield* send("Page.createIsolatedWorld", {
      frameId: frame.frameTree.frame.id,
      worldName: "t3-browser-capabilities",
      grantUniveralAccess: false,
    });
    const decoded = yield* decodeIsolatedWorld(world).pipe(
      Effect.mapError((cause) => host.operationError({ operation: "semanticWorld", tabId, cause })),
    );
    return decoded.executionContextId;
  });

  const automationVerify = Effect.fn("BrowserCapabilities.automationVerify")(function* (
    tabId: string,
    input: PreviewAutomationVerifyInput,
  ) {
    const wc = yield* host.requireWebContents(tabId);
    return yield* host.withControlSession(tabId, wc, "verify", (send) =>
      Effect.gen(function* () {
        const contextId = yield* semanticWorld(tabId, send);
        yield* host.evaluate(
          tabId,
          send,
          buildJevBrowserObservationExpression(),
          true,
          true,
          contextId,
        );
        const raw = yield* host.evaluate<unknown>(
          tabId,
          send,
          buildJevBrowserSemanticProbeExpression(input),
          true,
          true,
          contextId,
        );
        return yield* decodeVerification(raw).pipe(
          Effect.mapError((cause) => host.operationError({ operation: "verify", tabId, cause })),
        );
      }),
    );
  });

  const typedBrowserAction = Effect.fn("BrowserCapabilities.typedBrowserAction")(function* (
    tabId: string,
    action: Parameters<typeof buildBrowserDirectActionExpression>[0],
  ) {
    const wc = yield* host.requireWebContents(tabId);
    yield* host.withControlSession(tabId, wc, action.operation, (send, _cleanup, checkControl) =>
      Effect.gen(function* () {
        const contextId = yield* semanticWorld(tabId, send);
        if (action.input.locator !== undefined)
          yield* host.ensurePlaywrightInjected(tabId, send, contextId);
        yield* host.evaluate(
          tabId,
          send,
          buildJevBrowserObservationExpression(),
          true,
          true,
          contextId,
        );
        yield* host.prepareAutomationInput(send, true);
        const raw = yield* host.evaluate<unknown>(
          tabId,
          send,
          buildBrowserDirectActionExpression(action),
          true,
          true,
          contextId,
        );
        const result = yield* decodeDirectAction(raw).pipe(
          Effect.mapError((cause) =>
            host.operationError({ operation: action.operation, tabId, cause }),
          ),
        );
        yield* checkControl;
        if (!result.ok)
          return yield* Effect.fail(
            host.operationError({
              operation: action.operation,
              tabId,
              cause: new Error(result.reason),
            }),
          );
        if (action.operation === "hover") {
          if (!result.point)
            return yield* Effect.fail(
              host.operationError({
                operation: "hover",
                tabId,
                cause: new Error("Target geometry is unavailable."),
              }),
            );
          yield* host.emitPointerEvent({
            tabId,
            phase: "move",
            ...result.point,
            sequence: yield* host.nextPointerSequence(),
            createdAt: yield* host.currentIso(),
          });
          yield* host.expectAgentPointer(tabId, { ...result.point, button: 0 });
          yield* send("Input.dispatchMouseEvent", { type: "mouseMoved", ...result.point });
        }
      }),
    );
  });
  const automationSelect = (tabId: string, input: PreviewAutomationSelectInput) =>
    typedBrowserAction(tabId, { operation: "select", input });
  const automationCheck = (tabId: string, input: PreviewAutomationCheckInput) =>
    typedBrowserAction(tabId, { operation: "check", input });
  const automationHover = (tabId: string, input: PreviewAutomationHoverInput) =>
    typedBrowserAction(tabId, { operation: "hover", input });

  const automationExtract = Effect.fn("BrowserCapabilities.automationExtract")(function* (
    tabId: string,
    input: PreviewAutomationExtractInput,
  ) {
    const wc = yield* host.requireWebContents(tabId);
    return yield* host.withControlSession(tabId, wc, "extract", (send) =>
      Effect.gen(function* () {
        const contextId = yield* semanticWorld(tabId, send);
        const raw = yield* host.evaluate<unknown>(
          tabId,
          send,
          buildBrowserExtractExpression(input),
          true,
          true,
          contextId,
        );
        return yield* decodeExtraction(raw).pipe(
          Effect.mapError((cause) => host.operationError({ operation: "extract", tabId, cause })),
        );
      }),
    );
  });

  const automationWaitForAssertion = Effect.fn("BrowserCapabilities.automationWaitForAssertion")(
    function* (tabId: string, input: PreviewAutomationWaitForAssertionInput) {
      const wc = yield* host.requireWebContents(tabId);
      return yield* host.withControlSession(tabId, wc, "waitForAssertion", (send) =>
        Effect.gen(function* () {
          const contextId = yield* semanticWorld(tabId, send);
          const raw = yield* host.evaluate<unknown>(
            tabId,
            send,
            buildBrowserWaitForAssertionExpression(input),
            true,
            true,
            contextId,
          );
          return yield* decodeWait(raw).pipe(
            Effect.mapError((cause) =>
              host.operationError({ operation: "waitForAssertion", tabId, cause }),
            ),
          );
        }),
      );
    },
  );

  return {
    automationVerify,
    automationSelect,
    automationCheck,
    automationHover,
    automationExtract,
    automationWaitForAssertion,
    semanticWorld,
  };
}
