import {
  BrowserObservedDialog,
  type BrowserObservedDialog as BrowserObservedDialogType,
  BrowserDownloadHostInput,
  BrowserDownloadArtifact,
  DesktopBrowserUploadInput,
  BrowserArtifactOwnership,
  BrowserArtifactTarget,
  BrowserDialogPrepareActionInput,
  BrowserDialogStatusHostInput,
  BrowserDialogHandleRequest,
} from "@t3tools/contracts";
import type { Debugger, WebContents, WebFrameMain } from "electron";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { BrowserCapabilityHost } from "./BrowserCapabilities.ts";
import type { JevBrowserSendCommand } from "./JevBrowserController.ts";
import { makeBrowserArtifactStore } from "./BrowserArtifacts.ts";
import { buildBrowserUploadTargetExpression } from "./BrowserArtifactTargets.ts";
import { buildJevBrowserObservationExpression } from "./JevBrowserObservation.ts";
import {
  buildBrowserDirectActionExpression,
  buildBrowserSemanticGuardExpression,
} from "./BrowserSemanticActions.ts";
import { makeBrowserDialogObserver, type BrowserDialogObserver } from "./BrowserDialogs.ts";

type ArtifactHost<E> = BrowserCapabilityHost<E> & {
  readonly semanticWorld: (
    tabId: string,
    send: JevBrowserSendCommand<E>,
  ) => Effect.Effect<number, E>;
  readonly getDebugger: (wc: WebContents) => Effect.Effect<Debugger, E>;
  readonly controlGeneration: (tabId: string) => Effect.Effect<number>;
};

const ResolvedTrigger = Schema.Struct({
  ok: Schema.Literal(true),
  targetId: Schema.String,
  revision: Schema.String,
  point: Schema.Struct({ x: Schema.Finite, y: Schema.Finite }),
  href: Schema.optionalKey(Schema.String),
  framePath: Schema.Array(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).check(
    Schema.isMaxLength(8),
  ),
});
const RemoteObjectResult = Schema.Struct({
  result: Schema.Struct({ objectId: Schema.String }),
  exceptionDetails: Schema.optionalKey(Schema.Unknown),
});
const UploadVerificationResult = Schema.Struct({
  result: Schema.Struct({ value: Schema.Literal(true) }),
});
const GuardPoint = Schema.Struct({
  ok: Schema.Literal(true),
  x: Schema.Finite,
  y: Schema.Finite,
});
const decodeResolvedTrigger = Schema.decodeUnknownEffect(ResolvedTrigger);
const decodeRemoteObjectResult = Schema.decodeUnknownEffect(RemoteObjectResult);
const decodeUploadVerificationResult = Schema.decodeUnknownEffect(UploadVerificationResult);
const decodeGuardPoint = Schema.decodeUnknownEffect(GuardPoint);

/** Local desktop failure serialized by the renderer with trusted request context. */
export class PreviewAutomationDialogPendingError extends Schema.TaggedError<PreviewAutomationDialogPendingError>()(
  "PreviewAutomationDialogPendingError",
  { dialog: BrowserObservedDialog },
) {
  override get message(): string {
    return "The browser action is paused by a JavaScript dialog. Handle it with preview_dialog and do not repeat the original action.";
  }
}

const deepEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length && left.every((value, index) => deepEqual(value, right[index]))
    );
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftEntries = Object.entries(left);
  const rightRecord = right as Record<string, unknown>;
  return (
    leftEntries.length === Object.keys(rightRecord).length &&
    leftEntries.every(([key, value]) => key in rightRecord && deepEqual(value, rightRecord[key]))
  );
};

const frameAtPath = (root: WebFrameMain, framePath: readonly number[]) => {
  let frame = root;
  for (const index of framePath) {
    const child = frame.frames[index];
    if (!child || child.detached) return undefined;
    frame = child;
  }
  return frame.detached ? undefined : frame;
};

const cancelElectronNativeDialogSheet = (wc: WebContents): void => {
  // Electron 44.4.2 lib/browser/api/web-contents.ts retains native
  // JavaScript-dialog sheets in AbortControllers and exposes only this private,
  // per-WebContents event to clear them. CDP still resolves the page dialog
  // immediately after. Keep this shim local so an Electron upgrade has one audit point.
  wc.emit("-cancel-dialogs");
};

/** File bytes stay on the authenticated HTTP/local IPC path; browser mutations keep their action identity. */
export function makeBrowserArtifactController<E>(host: ArtifactHost<E>, stagingDirectory: string) {
  const store = makeBrowserArtifactStore({ stagingDirectory });
  const actionKinds = new Map<string, "upload" | "download">();
  const artifactActionScopes = new Map<
    string,
    {
      readonly runtimeTabId: string;
      readonly scope: Pick<
        BrowserArtifactOwnership,
        "environmentId" | "tabId" | "runId" | "actionId"
      >;
    }
  >();
  const downloadOperations = new Map<
    string,
    { readonly input: BrowserDownloadHostInput; readonly promise: Promise<BrowserDownloadArtifact> }
  >();
  const dialogs = new Map<
    string,
    {
      readonly observer: BrowserDialogObserver;
      readonly debugger: Debugger;
      readonly dispose: () => Promise<void>;
      generation: number;
      disarm: (() => void) | undefined;
      prepared: BrowserDialogPrepareActionInput | undefined;
      active: BrowserDialogPrepareActionInput | undefined;
    }
  >();
  const consumedPreparations = new Map<
    string,
    { readonly runtimeTabId: string; readonly prepared: BrowserDialogPrepareActionInput }
  >();
  const reserveArtifactAction = (
    runtimeTabId: string,
    scope: Pick<BrowserArtifactOwnership, "environmentId" | "tabId" | "runId" | "actionId">,
  ) => {
    const existing = artifactActionScopes.get(scope.actionId);
    if (existing)
      return existing.runtimeTabId === runtimeTabId && deepEqual(existing.scope, scope)
        ? undefined
        : "The browser artifact action identity is already reserved with different scope.";
    if (artifactActionScopes.size >= 512)
      return "The browser artifact action identity limit was reached for this desktop session.";
    artifactActionScopes.set(scope.actionId, { runtimeTabId, scope });
    return undefined;
  };
  const forgetArtifactRuntimeTab = (runtimeTabId: string) => {
    for (const [actionId, reserved] of artifactActionScopes) {
      if (reserved.runtimeTabId !== runtimeTabId) continue;
      artifactActionScopes.delete(actionId);
      actionKinds.delete(actionId);
      downloadOperations.delete(actionId);
    }
  };
  const rememberConsumedPreparation = (
    runtimeTabId: string,
    prepared: BrowserDialogPrepareActionInput,
  ) => {
    consumedPreparations.delete(prepared.actionId);
    consumedPreparations.set(prepared.actionId, { runtimeTabId, prepared });
  };
  const forgetConsumedScopes = (
    scopes: ReadonlyMap<string, Pick<BrowserArtifactOwnership, "environmentId" | "tabId">>,
  ) => {
    for (const [actionId, consumed] of consumedPreparations) {
      const { prepared } = consumed;
      if (
        [...scopes.values()].some(
          (scope) =>
            scope.environmentId === prepared.environmentId && scope.tabId === prepared.tabId,
        )
      ) {
        consumedPreparations.delete(actionId);
      }
    }
  };
  const forgetConsumedRuntimeTab = (runtimeTabId: string) => {
    for (const [actionId, consumed] of consumedPreparations) {
      if (consumed.runtimeTabId === runtimeTabId) consumedPreparations.delete(actionId);
    }
  };
  const artifactTabs = new Map<
    string,
    {
      readonly wc: WebContents;
      readonly scopes: Map<string, Pick<BrowserArtifactOwnership, "environmentId" | "tabId">>;
      readonly destroyed: () => void;
    }
  >();
  const error = (operation: string, tabId: string, cause: unknown) =>
    host.operationError({ operation, tabId, cause });
  const releaseScopes = (
    scopes: ReadonlyMap<string, Pick<BrowserArtifactOwnership, "environmentId" | "tabId">>,
  ) =>
    Promise.all([...scopes.values()].map((scope) => store.releaseTab(scope))).then(() => undefined);
  const bindArtifactTab = async (
    runtimeTabId: string,
    wc: WebContents,
    scope: Pick<BrowserArtifactOwnership, "environmentId" | "tabId">,
  ) => {
    let entry = artifactTabs.get(runtimeTabId);
    if (entry && entry.wc !== wc) {
      artifactTabs.delete(runtimeTabId);
      entry.wc.off("destroyed", entry.destroyed);
      forgetConsumedScopes(entry.scopes);
      forgetArtifactRuntimeTab(runtimeTabId);
      await releaseScopes(entry.scopes);
      entry = undefined;
    }
    if (!entry) {
      const scopes = new Map<string, Pick<BrowserArtifactOwnership, "environmentId" | "tabId">>();
      const destroyed = () => {
        const current = artifactTabs.get(runtimeTabId);
        if (!current || current.wc !== wc) return;
        artifactTabs.delete(runtimeTabId);
        forgetConsumedScopes(current.scopes);
        forgetArtifactRuntimeTab(runtimeTabId);
        void releaseScopes(current.scopes).catch(() => undefined);
      };
      wc.once("destroyed", destroyed);
      entry = { wc, scopes, destroyed };
      artifactTabs.set(runtimeTabId, entry);
    }
    entry.scopes.set(`${scope.environmentId}\0${scope.tabId}`, scope);
  };
  const prepare = Effect.fn("BrowserArtifactController.prepare")(function* (
    tabId: string,
    send: JevBrowserSendCommand<E>,
    target: BrowserArtifactTarget,
  ) {
    const contextId = yield* host.semanticWorld(tabId, send);
    if (target.locator !== undefined) yield* host.ensurePlaywrightInjected(tabId, send, contextId);
    yield* host.evaluate(
      tabId,
      send,
      buildJevBrowserObservationExpression(),
      true,
      true,
      contextId,
    );
    return contextId;
  });

  const performSelectUpload = Effect.fn("BrowserArtifactController.selectUpload")(function* (
    tabId: string,
    input: DesktopBrowserUploadInput,
  ) {
    const actionId = input.transfer.actionId;
    const reservationProblem = reserveArtifactAction(tabId, input.transfer);
    if (reservationProblem)
      return yield* Effect.fail(error("uploadFile", tabId, new Error(reservationProblem)));
    const kind = actionKinds.get(actionId);
    if (kind && kind !== "upload")
      return yield* Effect.fail(
        error(
          "uploadFile",
          tabId,
          new Error("The browser action identity is already reserved for a download."),
        ),
      );
    actionKinds.set(actionId, "upload");
    const wc = yield* host.requireWebContents(tabId);
    yield* Effect.promise(() => bindArtifactTab(tabId, wc, input.transfer));
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    return yield* Effect.tryPromise({
      try: (signal) =>
        store.selectUpload(input.transfer, (ownedPath) =>
          runPromise(
            host.withControlSession(tabId, wc, "uploadFile", (send, cleanup, checkControl) =>
              Effect.gen(function* () {
                const contextId = yield* prepare(tabId, send, input.target);
                const raw = yield* send("Runtime.evaluate", {
                  expression: buildBrowserUploadTargetExpression(input.target),
                  contextId,
                  returnByValue: false,
                  awaitPromise: true,
                });
                const response = yield* decodeRemoteObjectResult(raw).pipe(
                  Effect.mapError((cause) => error("uploadFile.resolve", tabId, cause)),
                );
                const objectId = response.result.objectId;
                yield* Effect.gen(function* () {
                  if (response.exceptionDetails !== undefined)
                    return yield* Effect.fail(
                      error("uploadFile.resolve", tabId, response.exceptionDetails),
                    );
                  yield* checkControl;
                  yield* send("DOM.setFileInputFiles", { objectId, files: [ownedPath] });
                  const selected = yield* send("Runtime.callFunctionOn", {
                    objectId,
                    functionDeclaration:
                      "function() { return this.isConnected && this.type === 'file' && this.files?.length === 1 && this.files[0].name === arguments[0] && this.files[0].size === arguments[1]; }",
                    arguments: [
                      { value: input.transfer.fileName },
                      { value: input.transfer.sizeBytes },
                    ],
                    returnByValue: true,
                  });
                  const verified = yield* decodeUploadVerificationResult(selected).pipe(
                    Effect.mapError((cause) => error("uploadFile.verify", tabId, cause)),
                  );
                  return verified.result.value;
                }).pipe(
                  Effect.ensuring(
                    cleanup("Runtime.releaseObject", { objectId }).pipe(Effect.ignore),
                  ),
                );
              }),
            ),
            { signal },
          ),
        ),
      catch: (cause) => error("uploadFile", tabId, cause),
    });
  });

  const performDownload = Effect.fn("BrowserArtifactController.performDownload")(function* (
    tabId: string,
    input: BrowserDownloadHostInput,
  ) {
    const wc = yield* host.requireWebContents(tabId);
    yield* Effect.promise(() => bindArtifactTab(tabId, wc, input.expectation));
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    return yield* host.withControlSession(
      tabId,
      wc,
      "downloadFile",
      (send, _cleanup, checkControl) =>
        Effect.gen(function* () {
          const contextId = yield* prepare(tabId, send, input.target);
          const raw = yield* host.evaluate(
            tabId,
            send,
            buildBrowserDirectActionExpression({ operation: "resolve", input: input.target }),
            true,
            true,
            contextId,
          );
          const target = yield* decodeResolvedTrigger(raw).pipe(
            Effect.mapError((cause) => error("downloadFile.resolve", tabId, cause)),
          );
          const expectedFrame = frameAtPath(wc.mainFrame, target.framePath);
          if (!expectedFrame)
            return yield* Effect.fail(
              error(
                "downloadFile.resolveFrame",
                tabId,
                new Error("The resolved download frame detached or changed."),
              ),
            );
          if (
            input.expectation.expectedFileName === undefined &&
            input.expectation.expectedUrl === undefined &&
            target.href === undefined
          )
            return yield* Effect.fail(
              error(
                "downloadFile.expectation",
                tabId,
                new Error(
                  "A download needs an expected filename or URL before its trigger can be clicked.",
                ),
              ),
            );
          yield* host.prepareAutomationInput(send, true);
          return yield* Effect.tryPromise({
            try: (signal) =>
              store.armDownload({
                expectation: {
                  ...input.expectation,
                  ...(input.expectation.expectedUrl === undefined && target.href
                    ? { expectedUrl: target.href }
                    : {}),
                  ...(input.expectation.expectedInitiatorOrigin === undefined
                    ? { expectedInitiatorOrigin: new URL(wc.getURL()).origin }
                    : {}),
                },
                session: wc.session,
                webContentsId: wc.id,
                expectedFrame,
                signal,
                trigger: () =>
                  runPromise(
                    Effect.gen(function* () {
                      yield* checkControl;
                      const rawGuard = yield* host.evaluate(
                        tabId,
                        send,
                        buildBrowserSemanticGuardExpression(target.revision, target.targetId),
                        true,
                        true,
                        contextId,
                      );
                      const guard = yield* decodeGuardPoint(rawGuard).pipe(
                        Effect.mapError((cause) => error("downloadFile.guard", tabId, cause)),
                      );
                      yield* host.expectAgentPointer(tabId, { x: guard.x, y: guard.y, button: 0 });
                      yield* send("Input.dispatchMouseEvent", {
                        type: "mousePressed",
                        x: guard.x,
                        y: guard.y,
                        button: "left",
                        clickCount: 1,
                      });
                      yield* send("Input.dispatchMouseEvent", {
                        type: "mouseReleased",
                        x: guard.x,
                        y: guard.y,
                        button: "left",
                        clickCount: 1,
                      });
                    }),
                    { signal },
                  ),
              }),
            catch: (cause) => error("downloadFile", tabId, cause),
          });
        }),
    );
  });

  const startDownloadOperation = (tabId: string, input: BrowserDownloadHostInput) =>
    Effect.gen(function* () {
      const reservationProblem = reserveArtifactAction(tabId, input.expectation);
      if (reservationProblem)
        return yield* Effect.fail(error("downloadFile", tabId, new Error(reservationProblem)));
      const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
      return yield* Effect.tryPromise({
        try: (signal) => {
          const actionId = input.expectation.actionId;
          const kind = actionKinds.get(actionId);
          if (kind && kind !== "download")
            return Promise.reject(
              error(
                "downloadFile",
                tabId,
                new Error("The browser action identity is already reserved for an upload."),
              ),
            );
          const cached = downloadOperations.get(actionId);
          if (cached) {
            return deepEqual(cached.input, input)
              ? cached.promise
              : Promise.reject(
                  error(
                    "downloadFile",
                    tabId,
                    new Error("The browser download action was reused with different inputs."),
                  ),
                );
          }
          actionKinds.set(actionId, "download");
          const promise = runPromise(performDownload(tabId, input), { signal });
          downloadOperations.set(actionId, { input, promise });
          return promise;
        },
        catch: (cause) => error("downloadFile", tabId, cause),
      });
    });

  const readDownload = (ownership: BrowserArtifactOwnership) =>
    Effect.tryPromise({
      try: () =>
        store.readDownload(ownership).then((data) => ({ artifactId: ownership.artifactId, data })),
      catch: (cause) => error("readDownload", ownership.tabId, cause),
    });
  const acknowledgeArtifact = (ownership: BrowserArtifactOwnership) =>
    Effect.tryPromise({
      try: () => store.acknowledge(ownership),
      catch: (cause) => error("acknowledgeArtifact", ownership.tabId, cause),
    });
  const prepareAction = Effect.fn("BrowserArtifactController.prepareAction")(function* (
    tabId: string,
    scope: BrowserDialogPrepareActionInput,
  ) {
    const wc = yield* host.requireWebContents(tabId);
    const debuggerInstance = yield* host.getDebugger(wc);
    const generation = yield* host.controlGeneration(tabId);
    let entry = dialogs.get(tabId);
    if (entry && entry.debugger !== debuggerInstance) {
      yield* Effect.promise(() => entry!.dispose());
      entry = undefined;
    }
    if (!entry) {
      const observer = makeBrowserDialogObserver({
        debugger: debuggerInstance,
        beforeHandle: () => cancelElectronNativeDialogSheet(wc),
      });
      const disposeEntry = async () => {
        await observer.dispose();
        wc.off("destroyed", disposeEntry);
        debuggerInstance.off("detach", disposeEntry);
        forgetConsumedRuntimeTab(tabId);
        if (dialogs.get(tabId)?.observer === observer) dialogs.delete(tabId);
      };
      wc.once("destroyed", disposeEntry);
      debuggerInstance.once("detach", disposeEntry);
      entry = {
        observer,
        debugger: debuggerInstance,
        dispose: disposeEntry,
        generation,
        disarm: undefined,
        prepared: undefined,
        active: undefined,
      };
      dialogs.set(tabId, entry);
    }
    if (entry.observer.current())
      return yield* Effect.fail(
        error(
          "prepareAction",
          tabId,
          new Error("Handle the observed dialog before starting another action."),
        ),
      );
    const consumed = consumedPreparations.get(scope.actionId);
    if (consumed) {
      if (consumed.runtimeTabId === tabId && deepEqual(consumed.prepared, scope)) return;
      return yield* Effect.fail(
        error(
          "prepareAction",
          tabId,
          new Error("The browser action identity was already consumed with different scope."),
        ),
      );
    }
    const consumedForTab = [...consumedPreparations.values()].filter(
      (candidate) => candidate.runtimeTabId === tabId,
    ).length;
    if (consumedForTab >= 512 || consumedPreparations.size >= 2_048) {
      return yield* Effect.fail(
        error(
          "prepareAction",
          tabId,
          new Error("The prepared browser action identity limit was reached for this tab."),
        ),
      );
    }
    if (entry.prepared || entry.active) {
      return yield* Effect.fail(
        error(
          "prepareAction",
          tabId,
          new Error("Another prepared browser action is still pending or active."),
        ),
      );
    }
    entry.generation = generation;
    entry.disarm = yield* Effect.tryPromise({
      try: () => entry.observer.arm(scope),
      catch: (cause) => error("prepareAction", tabId, cause),
    });
    entry.prepared = scope;
  });

  const racePreparedAction = <A>(
    tabId: string,
    operation: string,
    action: Effect.Effect<A, E>,
  ): Effect.Effect<A, E | PreviewAutomationDialogPendingError> =>
    Effect.gen(function* () {
      const entry = dialogs.get(tabId);
      if (!entry?.prepared) return yield* action;
      if (entry.prepared.operation !== operation) {
        return yield* Effect.fail(
          error(
            "preparedAction",
            tabId,
            new Error(
              `Prepared operation ${entry.prepared.operation} cannot be consumed by ${operation}.`,
            ),
          ),
        );
      }
      const generation = yield* host.controlGeneration(tabId);
      if (generation !== entry.generation) {
        yield* Effect.promise(() => entry.dispose());
        return yield* Effect.fail(
          error(
            "preparedAction",
            tabId,
            new Error("The browser or human-control generation changed before the action started."),
          ),
        );
      }
      const prepared = entry.prepared;
      const disarm = entry.disarm;
      entry.prepared = undefined;
      entry.disarm = undefined;
      entry.active = prepared;
      const pendingDialog = Effect.tryPromise({
        try: (signal) => entry.observer.waitForObserved(signal, null),
        catch: () => undefined,
      }).pipe(
        Effect.catch(() => Effect.never),
        Effect.flatMap((dialog: BrowserObservedDialogType) =>
          Effect.fail(new PreviewAutomationDialogPendingError({ dialog })),
        ),
      );
      return yield* Effect.raceFirst(action, pendingDialog).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            disarm?.();
            if (entry.active === prepared) entry.active = undefined;
            rememberConsumedPreparation(tabId, prepared);
          }),
        ),
      );
    });

  const cancelPreparedAction = Effect.fn("BrowserArtifactController.cancelPreparedAction")(
    (tabId: string, scope: BrowserDialogPrepareActionInput) =>
      Effect.sync(() => {
        const entry = dialogs.get(tabId);
        if (
          !entry ||
          entry.active !== undefined ||
          entry.observer.current() !== null ||
          !entry.prepared ||
          !deepEqual(entry.prepared, scope)
        ) {
          return;
        }
        const disarm = entry.disarm;
        entry.prepared = undefined;
        entry.disarm = undefined;
        disarm?.();
      }),
  );

  const selectUpload = (tabId: string, input: DesktopBrowserUploadInput) =>
    racePreparedAction(tabId, "uploadFile", performSelectUpload(tabId, input));
  const startDownload = (tabId: string, input: BrowserDownloadHostInput) =>
    racePreparedAction(tabId, "downloadFile", startDownloadOperation(tabId, input));

  const currentDialog = Effect.fn("BrowserArtifactController.currentDialog")(function* (
    tabId: string,
    scope: BrowserDialogStatusHostInput,
  ) {
    const entry = dialogs.get(tabId);
    if (!entry) return null;
    const generation = yield* host.controlGeneration(tabId);
    if (generation !== entry.generation) {
      yield* Effect.promise(() => entry.dispose());
      return null;
    }
    const dialog = entry.observer.current();
    return dialog?.environmentId === scope.environmentId && dialog.tabId === scope.tabId
      ? dialog
      : null;
  });
  const dialogStatus = (tabId: string, scope: BrowserDialogStatusHostInput) =>
    currentDialog(tabId, scope).pipe(Effect.map((dialog) => ({ dialog })));
  const handleDialog = Effect.fn("BrowserArtifactController.handleDialog")(function* (
    tabId: string,
    input: BrowserDialogHandleRequest,
  ) {
    const dialog = yield* currentDialog(tabId, input);
    const entry = dialogs.get(tabId);
    if (!dialog || !entry)
      return yield* Effect.fail(
        error(
          "handleDialog",
          tabId,
          new Error("The exact observed dialog is no longer available."),
        ),
      );
    // A dialog can suspend Runtime.evaluate while it holds the ordinary control
    // semaphore. CDP dialog handling must not queue behind that suspended action.
    return yield* Effect.tryPromise({
      try: () => entry.observer.handle(input),
      catch: (cause) => error("handleDialog", tabId, cause),
    });
  });
  const dispose = Effect.promise(async () => {
    for (const entry of artifactTabs.values()) entry.wc.off("destroyed", entry.destroyed);
    artifactTabs.clear();
    consumedPreparations.clear();
    artifactActionScopes.clear();
    actionKinds.clear();
    downloadOperations.clear();
    await Promise.all([...dialogs.values()].map((entry) => entry.dispose()));
    await store.dispose();
  });
  return {
    selectUpload,
    startDownload,
    readDownload,
    acknowledgeArtifact,
    prepareAction,
    cancelPreparedAction,
    racePreparedAction,
    dialogStatus,
    handleDialog,
    dispose,
  };
}
