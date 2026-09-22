// @effect-diagnostics globalDate:off globalTimers:off -- CDP dialog receipts and observation deadlines live at this native boundary.
// @effect-diagnostics cryptoRandomUUID:off -- Native dialog IDs are generated in an event-listener Promise API outside Effect services.
import type {
  BrowserArtifactActionId,
  BrowserDialogHandleRequest,
  BrowserDialogHandleResult,
  BrowserDialogId,
  BrowserDialogKind,
  BrowserObservedDialog,
  EnvironmentId,
  PreviewTabId,
} from "@t3tools/contracts";

const MAX_DIALOG_TEXT_LENGTH = 20_000;

export class BrowserDialogError extends Error {
  override readonly name = "BrowserDialogError";
  readonly code:
    | "active-action"
    | "active-dialog"
    | "closed"
    | "identity-mismatch"
    | "not-observed"
    | "timeout";

  constructor(code: BrowserDialogError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

type DebuggerMessageListener = (
  event: unknown,
  method: string,
  params: unknown,
  sessionId?: string,
) => void;

export interface BrowserDialogDebugger {
  on(event: "message", listener: DebuggerMessageListener): unknown;
  off(event: "message", listener: DebuggerMessageListener): unknown;
  sendCommand(method: string, params?: unknown, sessionId?: string): Promise<unknown>;
}

export interface BrowserDialogActionScope {
  readonly environmentId: EnvironmentId;
  readonly tabId: PreviewTabId;
  readonly runId?: string;
  readonly actionId: BrowserArtifactActionId;
}

export interface BrowserDialogObserver {
  /** Listener registration precedes Page.enable; call for every attached CDP session that may show dialogs. */
  readonly enable: (sessionId?: string) => Promise<void>;
  /** Enables the exact session before arming one action. */
  readonly arm: (scope: BrowserDialogActionScope, sessionId?: string) => Promise<() => void>;
  readonly current: () => BrowserObservedDialog | null;
  readonly waitForObserved: (
    signal?: AbortSignal,
    timeoutMs?: number | null,
  ) => Promise<BrowserObservedDialog>;
  readonly handle: (request: BrowserDialogHandleRequest) => Promise<BrowserDialogHandleResult>;
  readonly dispose: () => Promise<void>;
}

export interface BrowserDialogObserverOptions {
  readonly debugger: BrowserDialogDebugger;
  readonly nowIso?: () => string;
  readonly randomId?: () => string;
  readonly beforeHandle?: (dialog: BrowserObservedDialog) => void;
  readonly onObserved?: (dialog: BrowserObservedDialog) => void;
  readonly onClosed?: (dialog: BrowserObservedDialog) => void;
}

interface CdpDialogOpening {
  readonly type: BrowserDialogKind;
  readonly message: string;
  readonly defaultPrompt?: string;
}

interface RetainedDialog {
  readonly value: BrowserObservedDialog;
  readonly sessionId: string | undefined;
  handling: Promise<BrowserDialogHandleResult> | null;
  handlingFingerprint: string | null;
}

interface ArmedDialogAction {
  readonly scope: BrowserDialogActionScope;
  readonly sessionId: string | undefined;
}

interface DialogWaiter {
  readonly resolve: (dialog: BrowserObservedDialog) => void;
  readonly reject: (error: BrowserDialogError) => void;
  readonly signal: AbortSignal | undefined;
  readonly onAbort: () => void;
  readonly timer: ReturnType<typeof setTimeout> | undefined;
}

const parseDialogOpening = (params: unknown): CdpDialogOpening | null => {
  if (typeof params !== "object" || params === null) return null;
  const value = params as Record<string, unknown>;
  if (
    (value.type !== "alert" &&
      value.type !== "confirm" &&
      value.type !== "prompt" &&
      value.type !== "beforeunload") ||
    typeof value.message !== "string"
  ) {
    return null;
  }
  return {
    type: value.type,
    message: value.message,
    ...(typeof value.defaultPrompt === "string" ? { defaultPrompt: value.defaultPrompt } : {}),
  };
};

const boundedText = (value: string): { readonly value: string; readonly truncated: boolean } => ({
  value: value.slice(0, MAX_DIALOG_TEXT_LENGTH),
  truncated: value.length > MAX_DIALOG_TEXT_LENGTH,
});

export function makeBrowserDialogObserver(
  options: BrowserDialogObserverOptions,
): BrowserDialogObserver {
  const nowIso = options.nowIso ?? (() => new Date().toISOString());
  const randomId = options.randomId ?? (() => crypto.randomUUID());
  let armed: ArmedDialogAction | null = null;
  let retained: RetainedDialog | null = null;
  let disposed = false;
  const enabledSessions = new Map<string, Promise<void>>();
  const waiters = new Set<DialogWaiter>();

  // Electron reports root-target debugger events with an empty session ID, while
  // sendCommand represents that same root target by omitting the session argument.
  const normalizeEventSessionId = (sessionId: string | undefined): string | undefined =>
    sessionId === "" ? undefined : sessionId;
  const sendCommand = (method: string, params: unknown, sessionId: string | undefined) =>
    sessionId === undefined
      ? options.debugger.sendCommand(method, params)
      : options.debugger.sendCommand(method, params, sessionId);
  const sessionKey = (sessionId: string | undefined): string => sessionId ?? "<root>";
  const finishWaiter = (waiter: DialogWaiter): void => {
    if (waiter.timer !== undefined) clearTimeout(waiter.timer);
    waiter.signal?.removeEventListener("abort", waiter.onAbort);
    waiters.delete(waiter);
  };
  const publish = (dialog: BrowserObservedDialog): void => {
    options.onObserved?.(dialog);
    for (const waiter of waiters) {
      finishWaiter(waiter);
      waiter.resolve(dialog);
    }
  };
  const closeRetained = (sessionId: string | undefined): void => {
    if (!retained || retained.sessionId !== sessionId) return;
    const closed = retained.value;
    retained = null;
    options.onClosed?.(closed);
  };

  const onMessage: DebuggerMessageListener = (_event, method, params, sessionId) => {
    if (disposed) return;
    const normalizedSessionId = normalizeEventSessionId(sessionId);
    if (method === "Page.javascriptDialogClosed") {
      closeRetained(normalizedSessionId);
      return;
    }
    if (
      method !== "Page.javascriptDialogOpening" ||
      retained ||
      !armed ||
      armed.sessionId !== normalizedSessionId
    ) {
      return;
    }
    const event = parseDialogOpening(params);
    if (!event) return;
    const message = boundedText(event.message);
    const defaultPrompt =
      event.defaultPrompt === undefined ? undefined : boundedText(event.defaultPrompt);
    const value: BrowserObservedDialog = {
      environmentId: armed.scope.environmentId,
      tabId: armed.scope.tabId,
      ...(armed.scope.runId === undefined ? {} : { runId: armed.scope.runId }),
      actionId: armed.scope.actionId,
      dialogId: `browser-dialog-${randomId()}` as BrowserDialogId,
      kind: event.type,
      message: message.value,
      ...(message.truncated ? { messageTruncated: true } : {}),
      ...(defaultPrompt === undefined
        ? {}
        : {
            defaultPrompt: defaultPrompt.value,
            ...(defaultPrompt.truncated ? { defaultPromptTruncated: true } : {}),
          }),
      openedAt: nowIso(),
    };
    retained = {
      value,
      sessionId: normalizedSessionId,
      handling: null,
      handlingFingerprint: null,
    };
    publish(value);
  };

  // This must precede every Page.enable dispatch so a synchronous opening event cannot be lost.
  options.debugger.on("message", onMessage);

  const enable: BrowserDialogObserver["enable"] = (sessionId) => {
    if (disposed) {
      return Promise.reject(
        new BrowserDialogError("closed", "Browser dialog observation is closed."),
      );
    }
    const key = sessionKey(sessionId);
    const existing = enabledSessions.get(key);
    if (existing) return existing;
    const enabling = sendCommand("Page.enable", undefined, sessionId).then(() => undefined);
    enabledSessions.set(key, enabling);
    void enabling.catch(() => {
      if (enabledSessions.get(key) === enabling) enabledSessions.delete(key);
    });
    return enabling;
  };

  const arm: BrowserDialogObserver["arm"] = async (scope, sessionId) => {
    if (disposed) throw new BrowserDialogError("closed", "Browser dialog observation is closed.");
    if (retained) {
      throw new BrowserDialogError(
        "active-dialog",
        `Browser dialog ${retained.value.dialogId} must be closed before another action is armed.`,
      );
    }
    if (armed) {
      throw new BrowserDialogError(
        "active-action",
        `Browser action ${armed.scope.actionId} is already armed for dialog observation.`,
      );
    }
    const armedAction: ArmedDialogAction = { scope, sessionId };
    armed = armedAction;
    try {
      await enable(sessionId);
    } catch (cause) {
      if (armed === armedAction) armed = null;
      throw cause;
    }
    if (disposed) {
      if (armed === armedAction) armed = null;
      throw new BrowserDialogError("closed", "Browser dialog observation is closed.");
    }
    let current = true;
    return () => {
      if (current && armed === armedAction) armed = null;
      current = false;
    };
  };

  const current = (): BrowserObservedDialog | null => retained?.value ?? null;

  const waitForObserved: BrowserDialogObserver["waitForObserved"] = (
    signal,
    requestedTimeoutMs,
  ) => {
    if (retained) return Promise.resolve(retained.value);
    if (disposed) {
      return Promise.reject(
        new BrowserDialogError("closed", "Browser dialog observation is closed."),
      );
    }
    if (signal?.aborted) {
      return Promise.reject(
        new BrowserDialogError("closed", "Browser dialog observation was aborted."),
      );
    }
    const timeoutMs =
      requestedTimeoutMs === null
        ? undefined
        : Math.max(1, Math.min(requestedTimeoutMs ?? 15_000, 60_000));
    return new Promise((resolve, reject) => {
      let waiter: DialogWaiter;
      const onAbort = () => {
        finishWaiter(waiter);
        reject(new BrowserDialogError("closed", "Browser dialog observation was aborted."));
      };
      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              finishWaiter(waiter);
              reject(
                new BrowserDialogError(
                  "timeout",
                  `No correlated browser dialog was observed within ${timeoutMs}ms.`,
                ),
              );
            }, timeoutMs);
      waiter = { resolve, reject, signal, onAbort, timer };
      waiters.add(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  };

  const handle: BrowserDialogObserver["handle"] = (request) => {
    const observed = retained;
    if (!observed) {
      return Promise.reject(
        new BrowserDialogError("not-observed", "No observed browser dialog is available."),
      );
    }
    const dialog = observed.value;
    if (
      request.environmentId !== dialog.environmentId ||
      request.tabId !== dialog.tabId ||
      request.actionId !== dialog.actionId ||
      request.dialogId !== dialog.dialogId
    ) {
      return Promise.reject(
        new BrowserDialogError(
          "identity-mismatch",
          `Browser dialog ${request.dialogId} does not match the currently observed dialog.`,
        ),
      );
    }
    if (request.promptText !== undefined && dialog.kind !== "prompt") {
      return Promise.reject(
        new BrowserDialogError(
          "identity-mismatch",
          `Browser dialog ${request.dialogId} is not a prompt and cannot receive prompt text.`,
        ),
      );
    }
    const handlingFingerprint = JSON.stringify([
      request.environmentId,
      request.tabId,
      request.actionId,
      request.dialogId,
      request.action,
      request.promptText ?? null,
    ]);
    if (observed.handling) {
      return observed.handlingFingerprint === handlingFingerprint
        ? observed.handling
        : Promise.reject(
            new BrowserDialogError(
              "identity-mismatch",
              `Browser dialog ${request.dialogId} is already being handled by a different request.`,
            ),
          );
    }
    options.beforeHandle?.(dialog);
    const handling = sendCommand(
      "Page.handleJavaScriptDialog",
      {
        accept: request.action === "accept",
        ...(request.action === "accept" && request.promptText !== undefined
          ? { promptText: request.promptText }
          : {}),
      },
      observed.sessionId,
    ).then((): BrowserDialogHandleResult => ({
      environmentId: request.environmentId,
      tabId: request.tabId,
      actionId: request.actionId,
      dialogId: request.dialogId,
      status: "handled",
      action: request.action,
    }));
    // Cache both success and failure. An uncertain CDP send is never replayed.
    observed.handling = handling;
    observed.handlingFingerprint = handlingFingerprint;
    return handling;
  };

  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    armed = null;
    const active = retained;
    if (active && !active.handling) {
      active.handling = sendCommand(
        "Page.handleJavaScriptDialog",
        { accept: false },
        active.sessionId,
      ).then((): BrowserDialogHandleResult => ({
        environmentId: active.value.environmentId,
        tabId: active.value.tabId,
        actionId: active.value.actionId,
        dialogId: active.value.dialogId,
        status: "handled",
        action: "dismiss",
      }));
      active.handlingFingerprint = "<dispose-dismiss>";
    }
    retained = null;
    options.debugger.off("message", onMessage);
    for (const waiter of waiters) {
      finishWaiter(waiter);
      waiter.reject(new BrowserDialogError("closed", "Browser dialog observation is closed."));
    }
    await active?.handling?.catch(() => undefined);
  };

  return { enable, arm, current, waitForObserved, handle, dispose };
}
