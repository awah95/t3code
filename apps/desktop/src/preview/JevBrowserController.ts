import * as NodeCrypto from "node:crypto";
import type { DesktopPreviewPointerEvent } from "@t3tools/contracts";
import type {
  JevAutomationAction,
  JevAutomationCandidate,
  JevAutomationExecutionResult,
  JevAutomationInput,
  JevAutomationObservation,
} from "@t3tools/shared/jevAutomation";
import type { WebContents } from "electron";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import {
  buildJevBrowserGuardExpression,
  buildJevBrowserObservationExpression,
  buildJevBrowserReadyObservationExpression,
  buildJevBrowserSelectExpression,
  buildJevBrowserSetTextExpression,
} from "./JevBrowserObservation.ts";

export type JevBrowserSendCommand<E> = (
  method: string,
  commandParams?: Record<string, unknown>,
  sessionId?: string,
) => Effect.Effect<unknown, E>;

type ControlSessionUse<E, A> = (
  send: JevBrowserSendCommand<E>,
  sendCleanup: JevBrowserSendCommand<E>,
  checkControl: Effect.Effect<void, E>,
) => Effect.Effect<A, E>;

export type JevBrowserHost<E> = {
  readonly controlGeneration: (tabId: string) => Effect.Effect<number>;
  readonly requireWebContents: (tabId: string) => Effect.Effect<WebContents, E>;
  readonly withControlSession: <A>(
    tabId: string,
    webContents: WebContents,
    action: string,
    use: ControlSessionUse<E, A>,
  ) => Effect.Effect<A, E>;
  readonly evaluate: <A = unknown>(
    tabId: string,
    send: JevBrowserSendCommand<E>,
    expression: string,
    returnByValue: boolean,
    awaitPromise?: boolean,
    contextId?: number,
  ) => Effect.Effect<A, E>;
  readonly operationError: (input: {
    readonly operation: string;
    readonly tabId: string;
    readonly cause: unknown;
  }) => E;
  readonly prepareAutomationInput: (
    send: JevBrowserSendCommand<E>,
    enableRuntime: boolean,
  ) => Effect.Effect<void, E>;
  readonly emitPointerEvent: (event: DesktopPreviewPointerEvent) => Effect.Effect<void, E>;
  readonly nextPointerSequence: () => Effect.Effect<number>;
  readonly currentIso: () => Effect.Effect<string>;
  readonly expectAgentPointer: (
    tabId: string,
    point: { readonly x: number; readonly y: number; readonly button: number },
  ) => Effect.Effect<void, E>;
  readonly navigate: (tabId: string, url: string) => Effect.Effect<void, E>;
  readonly scroll: (
    tabId: string,
    input: { readonly deltaX?: number; readonly deltaY?: number },
    send: JevBrowserSendCommand<E>,
  ) => Effect.Effect<void, E>;
  readonly press: (
    tabId: string,
    webContents: WebContents,
    input: { readonly key: string },
    send: JevBrowserSendCommand<E>,
    sendCleanup: JevBrowserSendCommand<E>,
    checkControl: Effect.Effect<void, E>,
  ) => Effect.Effect<void, E>;
};

const RawControlSchema = Schema.Struct({
  id: Schema.String,
  tag: Schema.String,
  role: Schema.String,
  name: Schema.String,
  value: Schema.String,
  checked: Schema.Boolean,
  disabled: Schema.Boolean,
  href: Schema.optionalKey(Schema.String),
  options: Schema.Array(
    Schema.Struct({ value: Schema.String, label: Schema.String, disabled: Schema.Boolean }),
  ),
  selector: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});

const RawObservationSchema = Schema.Struct({
  revision: Schema.String,
  documentId: Schema.String,
  url: Schema.String,
  title: Schema.String,
  loading: Schema.Boolean,
  text: Schema.String,
  controls: Schema.Array(RawControlSchema),
  omissions: Schema.Array(Schema.String),
});

const GuardResultSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(false), reason: Schema.String }),
  Schema.Struct({
    ok: Schema.Literal(true),
    selector: Schema.optionalKey(Schema.String),
    x: Schema.optionalKey(Schema.Number),
    y: Schema.optionalKey(Schema.Number),
  }),
]);
const decodeRawObservation = Schema.decodeUnknownEffect(RawObservationSchema);
const decodeGuardResult = Schema.decodeUnknownEffect(GuardResultSchema);

type RawControl = typeof RawControlSchema.Type;

type RetainedRevision = {
  readonly runId: string;
  readonly revision: string;
  readonly documentRevision: string;
  readonly controlGeneration: number;
  readonly candidates: readonly JevAutomationCandidate[];
  readonly inputs: readonly JevAutomationInput[];
  readonly allowedOrigins: readonly string[];
  readonly contextId: number;
};

type RunState = {
  readonly tabId: string;
  readonly controlGeneration: number;
  readonly needsReadyObservation: boolean;
};

const MAX_CANDIDATES = 2_048;
const MAX_HOST_INPUTS = 512;
const MAX_DESCRIPTION_LENGTH = 1_000;
const MAX_VALUE_LENGTH = 20_000;
const RESERVED_PREFIX = "__t3_";
const ACTIVATABLE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "switch",
  "tab",
]);
const CHECKED_ROLES = new Set(["checkbox", "menuitemcheckbox", "menuitemradio", "radio", "switch"]);

const replaceMap = <K, V>(
  source: ReadonlyMap<K, V>,
  change: (copy: Map<K, V>) => void,
): ReadonlyMap<K, V> => {
  const copy = new Map(source);
  change(copy);
  return copy;
};

const originAllowed = (value: string, allowedOrigins: readonly string[]) => {
  try {
    const origin = new URL(value).origin;
    return allowedOrigins.some((allowed) => new URL(allowed).origin === origin);
  } catch {
    return false;
  }
};

export const buildCandidates = (
  controls: readonly RawControl[],
  requestInputs: readonly JevAutomationInput[],
  allowedOrigins: readonly string[],
): {
  readonly inputs: readonly JevAutomationInput[];
  readonly candidates: readonly JevAutomationCandidate[];
  readonly truncated: boolean;
} => {
  const optionInputs: JevAutomationInput[] = [];
  const optionInputIds = new Set<string>();
  const hostOptionTargets = new Map<string, string>();
  let inputsTruncated = false;
  for (const control of controls) {
    for (const option of control.options) {
      if (option.disabled) continue;
      if (option.value.length > MAX_VALUE_LENGTH) {
        inputsTruncated = true;
        continue;
      }
      if (optionInputs.length >= MAX_HOST_INPUTS - 7) {
        inputsTruncated = true;
        break;
      }
      const suffix = NodeCrypto.createHash("sha256")
        .update(`${control.id}\0${option.value}`)
        .digest("hex")
        .slice(0, 20);
      const id = `__t3_option_${suffix}`;
      if (optionInputIds.has(id)) continue;
      optionInputIds.add(id);
      hostOptionTargets.set(id, control.id);
      optionInputs.push({
        id,
        kind: "option",
        value: option.value,
        description: `${option.label} in ${control.name || control.role}`.slice(
          0,
          MAX_DESCRIPTION_LENGTH,
        ),
      });
    }
  }
  const inputs: readonly JevAutomationInput[] = [
    ...optionInputs,
    { id: "__t3_scroll_up", kind: "scroll", value: "up", description: "viewport up" },
    { id: "__t3_scroll_down", kind: "scroll", value: "down", description: "viewport down" },
    { id: "__t3_scroll_left", kind: "scroll", value: "left", description: "viewport left" },
    { id: "__t3_scroll_right", kind: "scroll", value: "right", description: "viewport right" },
    { id: "__t3_key_enter", kind: "key", value: "Enter", description: "Enter key" },
    { id: "__t3_key_tab", kind: "key", value: "Tab", description: "Tab key" },
    { id: "__t3_key_escape", kind: "key", value: "Escape", description: "Escape key" },
  ];
  const activeInputs = [...requestInputs, ...inputs];
  const candidates: JevAutomationCandidate[] = [];
  let truncated = false;
  const add = (candidate: JevAutomationCandidate) => {
    if (candidates.length >= MAX_CANDIDATES) {
      truncated = true;
      return;
    }
    candidates.push({
      ...candidate,
      id: `${RESERVED_PREFIX}candidate_${NodeCrypto.createHash("sha256")
        .update(candidate.id)
        .digest("hex")}`,
      description: candidate.description.slice(0, MAX_DESCRIPTION_LENGTH),
    });
  };
  for (const control of controls) {
    if (control.disabled) continue;
    const allowedLink = control.href !== undefined && originAllowed(control.href, allowedOrigins);
    if (
      (ACTIVATABLE_ROLES.has(control.role) &&
        control.tag !== "select" &&
        (control.href === undefined || allowedLink)) ||
      (control.role === "link" && allowedLink)
    ) {
      add({
        id: `activate:${control.id}`,
        operation: "activate",
        targetId: control.id,
        description: `Activate ${control.role} ${control.name || control.id}`,
      });
    }
    if (["textbox", "searchbox", "spinbutton"].includes(control.role)) {
      for (const input of activeInputs.filter(({ kind }) => kind === "text")) {
        add({
          id: `set-text:${control.id}:${input.id}`,
          operation: "set-text",
          targetId: control.id,
          inputId: input.id,
          description: `Set ${control.name || control.role} from supplied ${input.description}`,
        });
      }
    }
    if (control.role === "combobox") {
      for (const input of activeInputs.filter(
        ({ id, kind }) =>
          kind === "option" &&
          (!id.startsWith("__t3_option_") || hostOptionTargets.get(id) === control.id),
      )) {
        const option = control.options.find(({ value }) => value === input.value);
        if (!option || option.disabled) continue;
        add({
          id: `select-option:${control.id}:${input.id}`,
          operation: "select-option",
          targetId: control.id,
          inputId: input.id,
          description: `Select ${option.label} in ${control.name || control.role}`,
        });
      }
    }
  }
  for (const input of activeInputs) {
    if (input.kind === "url" && originAllowed(input.value, allowedOrigins)) {
      add({
        id: `navigate:${input.id}`,
        operation: "navigate",
        inputId: input.id,
        description: `Navigate to supplied ${input.description}`,
      });
    } else if (input.kind === "scroll" && ["up", "down", "left", "right"].includes(input.value)) {
      add({
        id: `scroll:${input.id}`,
        operation: "scroll",
        inputId: input.id,
        description: `Scroll ${input.value}`,
      });
    } else if (input.kind === "key") {
      add({
        id: `press-key:${input.id}`,
        operation: "press-key",
        inputId: input.id,
        description: `Press supplied ${input.description}`,
      });
    }
  }
  return { inputs, candidates, truncated: truncated || inputsTruncated };
};

export const makeJevBrowserController = <E>(host: JevBrowserHost<E>) =>
  Effect.gen(function* () {
    const revisionsRef = yield* Ref.make<ReadonlyMap<string, RetainedRevision>>(new Map());
    const runsRef = yield* Ref.make<ReadonlyMap<string, RunState>>(new Map());

    const fail = (operation: string, tabId: string, cause: unknown) =>
      Effect.fail(host.operationError({ operation, tabId, cause }));

    const evaluateGuard = Effect.fn("JevBrowserController.evaluateGuard")(function* (
      tabId: string,
      send: JevBrowserSendCommand<E>,
      contextId: number,
      revision: string,
      targetId?: string,
    ) {
      const raw = yield* host.evaluate(
        tabId,
        send,
        buildJevBrowserGuardExpression(revision, targetId),
        true,
        true,
        contextId,
      );
      return yield* decodeGuardResult(raw).pipe(
        Effect.mapError((cause) =>
          host.operationError({ operation: "jevBrowser.guard", tabId, cause }),
        ),
      );
    });

    const observe = Effect.fn("JevBrowserController.observe")(function* (
      runId: string,
      tabId: string,
      inputs: readonly JevAutomationInput[],
      allowedOrigins: readonly string[],
    ) {
      if (inputs.some(({ id }) => id.startsWith(RESERVED_PREFIX))) {
        return yield* fail(
          "jevBrowser.observeInputs",
          tabId,
          new Error(`Input IDs beginning with ${RESERVED_PREFIX} are reserved.`),
        );
      }
      const currentGeneration = yield* host.controlGeneration(tabId);
      const runState = yield* Ref.modify(runsRef, (runs) => {
        const existing = runs.get(runId);
        if (existing) return [existing, runs] as const;
        const created = {
          tabId,
          controlGeneration: currentGeneration,
          needsReadyObservation: false,
        };
        return [created, replaceMap(runs, (copy) => copy.set(runId, created))] as const;
      });
      if (runState.tabId !== tabId || runState.controlGeneration !== currentGeneration) {
        return yield* fail(
          "jevBrowser.observeGeneration",
          tabId,
          new Error("Human control changed during this Jev browser run."),
        );
      }
      const webContents = yield* host.requireWebContents(tabId);
      return yield* host.withControlSession<JevAutomationObservation>(
        tabId,
        webContents,
        "jevBrowserObserve",
        (send, _cleanup, checkControl) =>
          Effect.gen(function* () {
            yield* send("Page.enable");
            const frameTree = (yield* send("Page.getFrameTree")) as {
              frameTree?: { frame?: { id?: unknown } };
            };
            const frameId = frameTree.frameTree?.frame?.id;
            if (typeof frameId !== "string") {
              return yield* fail(
                "jevBrowser.createIsolatedWorld",
                tabId,
                new Error("The preview main frame is unavailable."),
              );
            }
            const isolated = (yield* send("Page.createIsolatedWorld", {
              frameId,
              worldName: "t3-jev-browser",
              grantUniveralAccess: false,
            })) as { executionContextId?: unknown };
            if (typeof isolated.executionContextId !== "number") {
              return yield* fail(
                "jevBrowser.createIsolatedWorld",
                tabId,
                new Error("The Jev browser isolated world is unavailable."),
              );
            }
            const contextId = isolated.executionContextId;
            const raw = yield* host.evaluate(
              tabId,
              send,
              runState.needsReadyObservation
                ? buildJevBrowserReadyObservationExpression()
                : buildJevBrowserObservationExpression(),
              true,
              true,
              contextId,
            );
            const observed = yield* decodeRawObservation(raw).pipe(
              Effect.mapError((cause) =>
                host.operationError({ operation: "jevBrowser.observe", tabId, cause }),
              ),
            );
            yield* checkControl;
            if ((yield* Ref.get(runsRef)).get(runId) !== runState) {
              return yield* fail(
                "jevBrowser.observeGeneration",
                tabId,
                new Error("The Jev browser run ended while observation was waiting."),
              );
            }
            if (!originAllowed(observed.url, allowedOrigins)) {
              return yield* fail(
                "jevBrowser.observeOrigin",
                tabId,
                new Error("The preview URL is outside the allowed browser origins."),
              );
            }
            if (runState.needsReadyObservation) {
              yield* Ref.update(runsRef, (runs) =>
                runs.get(runId) === runState
                  ? replaceMap(runs, (copy) =>
                      copy.set(runId, { ...runState, needsReadyObservation: false }),
                    )
                  : runs,
              );
            }
            const revision = `${runState.controlGeneration}:${observed.revision}`;
            const generated = buildCandidates(observed.controls, inputs, allowedOrigins);
            const activeInputs = [...inputs, ...generated.inputs];
            const controls = observed.controls.map((control) => ({
              id: control.id,
              role: control.role,
              ...(control.name ? { name: control.name, text: control.name } : {}),
              value: CHECKED_ROLES.has(control.role) ? control.checked : control.value,
              ...(CHECKED_ROLES.has(control.role) ? { checked: control.checked } : {}),
              disabled: control.disabled,
              ...(control.options.length === 0
                ? {}
                : {
                    options: control.options.map((option) => ({
                      ...option,
                      selected: option.value === control.value,
                    })),
                  }),
            }));
            const observation: JevAutomationObservation = {
              revision,
              surface: "browser",
              location: observed.url,
              title: observed.title,
              visibleText: observed.text,
              omissions: [
                ...observed.omissions,
                ...(generated.truncated
                  ? ["browser host inputs or action candidates truncated"]
                  : []),
              ],
              inputs: generated.inputs,
              controls,
              candidates: generated.candidates,
            };
            yield* Ref.update(revisionsRef, (revisions) =>
              replaceMap(revisions, (copy) => {
                copy.set(tabId, {
                  runId,
                  revision,
                  documentRevision: observed.revision,
                  controlGeneration: runState.controlGeneration,
                  candidates: generated.candidates,
                  inputs: activeInputs,
                  allowedOrigins,
                  contextId,
                });
              }),
            );
            return observation;
          }),
      );
    });

    const execute = Effect.fn("JevBrowserController.execute")(function* (
      runId: string,
      tabId: string,
      revision: string,
      action: JevAutomationAction,
    ): Effect.fn.Return<JevAutomationExecutionResult, E> {
      const state = (yield* Ref.get(revisionsRef)).get(tabId);
      const currentGeneration = yield* host.controlGeneration(tabId);
      if (
        !state ||
        state.runId !== runId ||
        state.revision !== revision ||
        state.controlGeneration !== currentGeneration
      ) {
        return { status: "stale", detail: "The browser or human-control generation changed." };
      }
      const matches = state.candidates.filter(
        (candidate) =>
          candidate.id === action.candidateId &&
          candidate.operation === action.operation &&
          candidate.targetId === action.targetId &&
          candidate.inputId === action.inputId,
      );
      if (matches.length !== 1) {
        return { status: "rejected", detail: "The action was not an exact retained candidate." };
      }
      const supplied = action.inputId
        ? state.inputs.find(({ id }) => id === action.inputId)
        : undefined;
      if (action.value !== supplied?.value) {
        return { status: "rejected", detail: "The action value did not match its retained input." };
      }
      const markExecuted = Ref.update(runsRef, (runs) => {
        const run = runs.get(runId);
        return !run || run.needsReadyObservation
          ? runs
          : replaceMap(runs, (copy) => copy.set(runId, { ...run, needsReadyObservation: true }));
      });
      const webContents = yield* host.requireWebContents(tabId);
      return yield* host.withControlSession<JevAutomationExecutionResult>(
        tabId,
        webContents,
        `jevBrowserExecute:${action.operation}`,
        (send, sendCleanup, checkControl) =>
          Effect.gen(function* () {
            if ((yield* host.controlGeneration(tabId)) !== state.controlGeneration) {
              return {
                status: "stale",
                detail: "Human control changed while browser execution was waiting.",
              } as const;
            }
            const guarded = yield* evaluateGuard(
              tabId,
              send,
              state.contextId,
              state.documentRevision,
              action.targetId,
            );
            if (!guarded.ok) return { status: "stale", detail: guarded.reason } as const;
            yield* Ref.update(revisionsRef, (revisions) =>
              replaceMap(revisions, (copy) => copy.delete(tabId)),
            );

            if (action.operation === "select-option") {
              if (!action.targetId || action.value === undefined) {
                return {
                  status: "rejected",
                  detail: "Select requires a target and value.",
                } as const;
              }
              const selected = yield* host.evaluate(
                tabId,
                send,
                buildJevBrowserSelectExpression(
                  state.documentRevision,
                  action.targetId,
                  action.value,
                ),
                true,
                true,
                state.contextId,
              );
              const result = yield* decodeGuardResult(selected).pipe(
                Effect.mapError((cause) =>
                  host.operationError({ operation: "jevBrowser.select", tabId, cause }),
                ),
              );
              if (!result.ok) return { status: "stale", detail: result.reason } as const;
              yield* markExecuted;
              return { status: "executed" } as const;
            }

            if (action.operation === "activate") {
              if (guarded.x === undefined || guarded.y === undefined) {
                return {
                  status: "rejected",
                  detail: "Activate requires guarded geometry.",
                } as const;
              }
              yield* host.prepareAutomationInput(send, true);
              yield* host.emitPointerEvent({
                tabId,
                phase: "move",
                x: guarded.x,
                y: guarded.y,
                sequence: yield* host.nextPointerSequence(),
                createdAt: yield* host.currentIso(),
              });
              const current = yield* evaluateGuard(
                tabId,
                send,
                state.contextId,
                state.documentRevision,
                action.targetId,
              );
              if (!current.ok || current.x === undefined || current.y === undefined) {
                return {
                  status: "stale",
                  detail: current.ok ? "Target geometry disappeared." : current.reason,
                } as const;
              }
              yield* host.emitPointerEvent({
                tabId,
                phase: "click",
                x: current.x,
                y: current.y,
                sequence: yield* host.nextPointerSequence(),
                createdAt: yield* host.currentIso(),
              });
              yield* host.expectAgentPointer(tabId, {
                x: current.x,
                y: current.y,
                button: 0,
              });
              yield* send("Input.dispatchMouseEvent", {
                type: "mousePressed",
                x: current.x,
                y: current.y,
                button: "left",
                clickCount: 1,
              });
              yield* send("Input.dispatchMouseEvent", {
                type: "mouseReleased",
                x: current.x,
                y: current.y,
                button: "left",
                clickCount: 1,
              });
              yield* markExecuted;
              return { status: "executed" } as const;
            }

            if (action.operation === "set-text") {
              if (!action.targetId || action.value === undefined) {
                return {
                  status: "rejected",
                  detail: "Text entry requires a guarded target.",
                } as const;
              }
              const inserted = yield* host.evaluate(
                tabId,
                send,
                buildJevBrowserSetTextExpression(
                  state.documentRevision,
                  action.targetId,
                  action.value,
                ),
                true,
                true,
                state.contextId,
              );
              const result = yield* decodeGuardResult(inserted).pipe(
                Effect.mapError((cause) =>
                  host.operationError({ operation: "jevBrowser.setText", tabId, cause }),
                ),
              );
              if (!result.ok) {
                return yield* fail(
                  "jevBrowser.setTextUnknownMutation",
                  tabId,
                  new Error(
                    `Text entry may have partially changed the retained target: ${result.reason}`,
                  ),
                );
              }
              yield* markExecuted;
              return { status: "executed" } as const;
            }

            if (action.operation === "navigate") {
              if (
                action.value === undefined ||
                !originAllowed(action.value, state.allowedOrigins)
              ) {
                return {
                  status: "rejected",
                  detail: "Navigation requires a supplied URL.",
                } as const;
              }
              yield* checkControl;
              yield* host.navigate(tabId, action.value);
              yield* markExecuted;
              return { status: "executed" } as const;
            }

            if (action.operation === "scroll") {
              const deltas = {
                up: { deltaY: -600 },
                down: { deltaY: 600 },
                left: { deltaX: -600 },
                right: { deltaX: 600 },
              } as const;
              const delta = action.value ? deltas[action.value as keyof typeof deltas] : undefined;
              if (!delta) {
                return { status: "rejected", detail: "Unsupported scroll input." } as const;
              }
              yield* host.scroll(tabId, delta, send);
              yield* markExecuted;
              return { status: "executed" } as const;
            }

            if (action.operation === "press-key") {
              if (action.value === undefined) {
                return {
                  status: "rejected",
                  detail: "Key press requires a supplied key.",
                } as const;
              }
              yield* host.press(
                tabId,
                webContents,
                { key: action.value },
                send,
                sendCleanup,
                checkControl,
              );
              yield* markExecuted;
              return { status: "executed" } as const;
            }

            return { status: "rejected", detail: "Unsupported browser action." } as const;
          }),
      );
    });

    const cancel = Effect.fn("JevBrowserController.cancel")(function* (runId: string) {
      const cancelled = yield* Ref.modify(runsRef, (runs) => [
        runs.has(runId),
        replaceMap(runs, (copy) => copy.delete(runId)),
      ]);
      yield* Ref.update(revisionsRef, (revisions) =>
        replaceMap(revisions, (copy) => {
          for (const [tabId, state] of copy) {
            if (state.runId === runId) copy.delete(tabId);
          }
        }),
      );
      return cancelled;
    });

    const clear = Effect.all([Ref.set(revisionsRef, new Map()), Ref.set(runsRef, new Map())], {
      discard: true,
    });

    return { observe, execute, cancel, clear } as const;
  });
