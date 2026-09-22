"use client";

import { RegistryContext, useAtomSet, useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  FILL_PREVIEW_VIEWPORT,
  BrowserArtifactActionId,
  type BrowserArtifactAcknowledgeHostInput,
  type BrowserDialogHandleRequest,
  type BrowserDialogPrepareActionInput,
  type BrowserDialogStatusHostInput,
  type BrowserDownloadHostInput,
  type BrowserUploadHostInput,
  type EnvironmentId,
  type JevBrowserCancelInput,
  type JevBrowserDecideInput,
  type JevBrowserExecuteInput,
  type JevBrowserExecuteResult,
  type JevBrowserObserveInput,
  type JevBrowserVerifyInput,
  type PreviewAutomationNavigateInput,
  type PreviewAutomationOpenInput,
  type PreviewAutomationResizeInput,
  type PreviewAutomationResizeResult,
  type PreviewAutomationSetColorSchemeInput,
  type PreviewAutomationSetColorSchemeResult,
  type PreviewAutomationHost as PreviewAutomationHostState,
  type PreviewAutomationRequest,
  type PreviewAutomationStatus,
  type PreviewRenderedViewportSize,
  type PreviewViewportSetting,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { resolvePreviewViewport } from "@t3tools/shared/previewViewport";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Atom } from "effect/unstable/reactivity";

import {
  applyPreviewServerSnapshot,
  readThreadPreviewState,
  reconcilePreviewServerSessions,
  updatePreviewServerSnapshot,
} from "~/previewStateStore";
import {
  browserMiniPlayerSource,
  selectThreadPreviewMiniPlayerTabId,
  usePreviewMiniPlayerStore,
} from "~/previewMiniPlayerStore";
import { resolveBrowserNavigationTarget } from "~/browser/browserTargetResolver";
import {
  readActiveBrowserRecordingTargets,
  startBrowserRecording,
  stopBrowserRecording,
  stopBrowserRecordingForUpload,
} from "~/browser/browserRecording";
import { resolveBrowserRecordingStopTarget } from "~/browser/browserRecordingScope";
import { uploadBrowserRecording } from "~/browser/browserRecordingUpload";
import {
  acquireBrowserSurfaceActivity,
  useBrowserSurfaceStore,
} from "~/browser/browserSurfaceStore";
import {
  browserDefaultOpenProfileId,
  browserDefaultOpenViewport,
  resolveBrowserDefaults,
} from "~/browser/browserDefaults";
import { runBrowserViewportMutation } from "~/browser/browserViewportActions";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import { isElectron } from "~/env";
import { useEnvironments } from "~/state/environments";
import { previewEnvironment } from "~/state/preview";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  getJevBrowserExecutionMode,
  getJevBrowserStatus,
  jevBrowserDecisionCost,
  jevBrowserHandlerBridge,
} from "~/jevBrowser";

import { previewBridge } from "./previewBridge";
import { createBrowserArtifactAutomationHost } from "./browserArtifactAutomationHost";
import {
  hasJevBrowserHost,
  resolvePreviewAutomationSupportedOperations,
} from "./previewAutomationHostCapabilities";
import { resolveJevBrowserNavigations } from "./jevBrowserNavigationResolution";
import {
  PreviewAutomationOperationError,
  PreviewAutomationDialogPendingHostError,
  PreviewAutomationOverlayTimeoutError,
  PreviewAutomationRecordingNotActiveError,
  PreviewAutomationTargetUnavailableError,
  PreviewAutomationViewportTimeoutError,
} from "./previewAutomationErrors";
import {
  explicitlySuppressesPreviewMiniPlayer,
  previewAutomationDefaultViewport,
  previewAutomationOpenNeedsOverlay,
  shouldAutoShowPreviewForAutomationUse,
  shouldOpenPreviewMiniPlayer,
} from "./previewAutomationOpenReadiness";
import {
  assertPreviewRuntimeCurrent,
  waitForNavigationReadiness,
} from "./previewNavigationReadiness";
import { createPreviewAutomationRequestConsumerAtom } from "./previewAutomationRequestConsumer";
import { createPreviewAutomationClientId } from "./previewAutomationClientId";
import {
  needsPreviewAutomationSessionSync,
  resolvePreviewAutomationOpenTab,
  resolvePreviewAutomationTarget,
} from "./previewAutomationTarget";
import { resolveHostWaitBudgetMs, waitForHostReadiness } from "./previewAutomationHostBudget";
import { isPreviewViewportReady } from "./previewViewportReadiness";
import { shouldRollbackPreviewViewport } from "./previewViewportRollback";

const PREVIEW_PRESENTATION_SETTLE_TIMEOUT_MS = 500;

const previewAutomationHostNotReady = async (
  _request: PreviewAutomationRequest,
): Promise<unknown> => {
  throw new Error("Preview automation host is not ready.");
};

const readJevBrowserStatus = async (threadRef: ScopedThreadRef) => {
  const credential = hasJevBrowserHost()
    ? await window.desktopBridge!.getJevStatus!().catch(() => null)
    : null;
  return getJevBrowserStatus(
    threadRef,
    credential?.hasKey === true && credential.secureStorageAvailable,
  );
};

const waitForPreviewPresentation = async (runtimeTabId: string): Promise<void> => {
  const deadline = Date.now() + PREVIEW_PRESENTATION_SETTLE_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    if (useBrowserSurfaceStore.getState().byTabId[runtimeTabId]?.visible) return;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
  }
};

const waitForDesktopOverlay = async (
  threadRef: ScopedThreadRef,
  requestId: string,
  tabId: string,
  runtimeTabId: string,
  operation: PreviewAutomationRequest["operation"],
  deadlineMs: number,
): Promise<void> => {
  const waitBudgetMs = Math.max(0, deadlineMs - Date.now());
  const ready = await waitForHostReadiness(deadlineMs, async () => {
    const state = assertPreviewRuntimeCurrent(threadRef, tabId, runtimeTabId, {
      operation,
      requestId,
    });
    if (state.desktopByTabId[tabId] && previewBridge && isPreviewWebviewRendering(runtimeTabId)) {
      const status = await previewBridge.automation.status(runtimeTabId);
      return status.available;
    }
    return false;
  });
  if (ready) return;
  throw new PreviewAutomationOverlayTimeoutError({
    requestId,
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
    timeoutMs: waitBudgetMs,
  });
};

interface ExecutablePreviewWebview extends Element {
  readonly executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>;
}

const findPreviewWebview = (tabId: string): ExecutablePreviewWebview | null =>
  Array.from(document.querySelectorAll<ExecutablePreviewWebview>("webview[data-preview-tab]")).find(
    (candidate) => candidate.getAttribute("data-preview-tab") === tabId,
  ) ?? null;

const isPreviewWebviewRendering = (runtimeTabId: string): boolean => {
  const wrapper = findPreviewWebview(runtimeTabId)?.closest<HTMLElement>("[data-preview-viewport]");
  return wrapper?.getAttribute("data-preview-rendering") === "active";
};

const readWebviewViewport = async (
  webview: ExecutablePreviewWebview,
): Promise<PreviewRenderedViewportSize | null> => {
  const value = await webview.executeJavaScript(
    "({ width: window.innerWidth, height: window.innerHeight })",
  );
  if (typeof value !== "object" || value === null) return null;
  const { width, height } = value as { readonly width?: unknown; readonly height?: unknown };
  return typeof width === "number" &&
    Number.isInteger(width) &&
    width > 0 &&
    typeof height === "number" &&
    Number.isInteger(height) &&
    height > 0
    ? { width, height }
    : null;
};

const readRenderedViewport = async (
  runtimeTabId: string,
): Promise<PreviewRenderedViewportSize | null> => {
  const webview = findPreviewWebview(runtimeTabId);
  if (!webview) return null;
  return await readWebviewViewport(webview);
};

const readDeclaredViewport = (
  webview: ExecutablePreviewWebview | null,
): PreviewRenderedViewportSize | null => {
  const width = Number(webview?.getAttribute("data-preview-css-width"));
  const height = Number(webview?.getAttribute("data-preview-css-height"));
  return Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0
    ? { width, height }
    : null;
};

const waitForRenderedViewport = async (
  threadRef: ScopedThreadRef,
  tabId: string,
  runtimeTabId: string,
  setting: PreviewViewportSetting,
  timeoutMs: number,
  context: {
    readonly requestId: PreviewAutomationRequest["requestId"];
    readonly operation: PreviewAutomationRequest["operation"];
    readonly environmentId: EnvironmentId;
    readonly threadId: PreviewAutomationRequest["threadId"];
  },
): Promise<PreviewRenderedViewportSize> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    assertPreviewRuntimeCurrent(threadRef, tabId, runtimeTabId, context);
    try {
      const webview = findPreviewWebview(runtimeTabId);
      const appliedSettingKey = webview?.getAttribute("data-preview-viewport-key") ?? null;
      const declaredViewport = readDeclaredViewport(webview);
      const renderedViewport = webview ? await readWebviewViewport(webview) : null;
      if (
        renderedViewport &&
        isPreviewViewportReady({
          setting,
          appliedSettingKey,
          declaredViewport,
          renderedViewport,
        })
      ) {
        return renderedViewport;
      }
    } catch {
      // Registration and navigation can transiently replace the guest while
      // React applies the server snapshot. Retry until the operation deadline.
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
  }
  throw new PreviewAutomationViewportTimeoutError({
    ...context,
    tabId,
    timeoutMs,
  });
};

const currentStatus = async (
  threadRef: ScopedThreadRef,
  requestedTabId: string | null,
): Promise<PreviewAutomationStatus> => {
  const state = readThreadPreviewState(threadRef);
  const { snapshot, tabId } = resolvePreviewAutomationTarget(state, requestedTabId);
  const runtimeTabId = tabId ? previewRuntimeTabId(threadRef, state.serverEpoch, tabId) : null;
  const visible = runtimeTabId
    ? (useBrowserSurfaceStore.getState().byTabId[runtimeTabId]?.visible ?? false)
    : false;
  const renderingActive = runtimeTabId ? isPreviewWebviewRendering(runtimeTabId) : false;
  const viewportSetting = snapshot ? (snapshot.viewport ?? FILL_PREVIEW_VIEWPORT) : undefined;
  const viewport =
    runtimeTabId && renderingActive
      ? await readRenderedViewport(runtimeTabId).catch(() => null)
      : null;
  const viewportStatus = {
    ...(viewportSetting === undefined ? {} : { viewportSetting }),
    ...(viewport === null ? {} : { viewport }),
  };
  if (runtimeTabId && tabId && previewBridge && state.desktopByTabId[tabId]) {
    const status = await previewBridge.automation.status(runtimeTabId);
    return {
      ...status,
      tabId,
      visible,
      ...viewportStatus,
      jevBrowser: await readJevBrowserStatus(threadRef),
    };
  }
  const navStatus = snapshot?.navStatus;
  return {
    available: Boolean(previewBridge?.automation),
    visible,
    tabId,
    url: navStatus && navStatus._tag !== "Idle" ? navStatus.url : null,
    title: navStatus && navStatus._tag !== "Idle" ? navStatus.title : null,
    loading: navStatus?._tag === "Loading",
    jevBrowser: await readJevBrowserStatus(threadRef),
    ...viewportStatus,
  };
};

const raiseAtomCommandFailure = (result: Parameters<typeof squashAtomCommandFailure>[0]): never => {
  throw squashAtomCommandFailure(result);
};

const raisePreviewAutomationHostError = (
  error: PreviewAutomationRecordingNotActiveError,
): never => {
  throw error;
};

export function PreviewAutomationHosts() {
  const { environments } = useEnvironments();
  if (!isElectron || !previewBridge?.automation) return null;
  return (
    <>
      {/*
       * Host lifetime follows the desktop runtime's environment connections,
       * not the routed thread. This keeps background threads automatable and
       * lets the subscription runtime own reconnects for every saved target.
       */}
      {environments.map((environment) => (
        <PreviewAutomationHost
          key={environment.environmentId}
          environmentId={environment.environmentId}
        />
      ))}
    </>
  );
}

function PreviewAutomationHost(props: { readonly environmentId: EnvironmentId }) {
  const { environmentId } = props;
  const registry = useContext(RegistryContext);
  const [automationClientId] = useState(createPreviewAutomationClientId);
  const initialAutomationHost = useMemo<PreviewAutomationHostState>(
    () => ({
      clientId: automationClientId,
      environmentId,
      supportedOperations: resolvePreviewAutomationSupportedOperations(
        previewBridge!.automation,
        window.desktopBridge,
        previewBridge!.artifacts,
      ),
    }),
    [automationClientId, environmentId],
  );
  const automationRequestsAtom = previewEnvironment.automationRequests({
    environmentId,
    input: initialAutomationHost,
  });
  const listPreviews = useAtomQueryRunner(previewEnvironment.list, {
    reportFailure: false,
  });
  const open = useAtomCommand(previewEnvironment.open, {
    reportFailure: false,
  });
  const resize = useAtomCommand(previewEnvironment.resize, {
    reportFailure: false,
  });
  const respondToAutomation = useAtomCommand(
    previewEnvironment.respondToAutomation,
    "preview automation response",
  );
  const focusAutomationHost = useAtomCommand(
    previewEnvironment.focusAutomationHost,
    "preview automation host focus",
  );
  const [automationConnectionAtom] = useState(() => Atom.make<string | null>(null));
  const automationConnectionId = useAtomValue(automationConnectionAtom);
  const presentationSuppressedRuntimeTabsRef = useRef(new Map<string, Set<string>>());
  const artifactAutomationHost = useMemo(
    () =>
      previewBridge?.artifacts
        ? createBrowserArtifactAutomationHost(previewBridge.artifacts)
        : null,
    [],
  );

  useEffect(
    () => () => {
      const runIds = jevBrowserHandlerBridge.cancelEnvironmentRuns(
        environmentId,
        "Stopped because the environment host disconnected.",
      );
      for (const runId of runIds) {
        void window.desktopBridge?.cancelJevBrowser?.({
          runId,
          reason: "failed",
        });
      }
    },
    [environmentId],
  );

  const handleRequest = useCallback(
    async (request: PreviewAutomationRequest): Promise<unknown> => {
      // Session sync and tab creation consume the same budget as overlay registration.
      const hostDeadlineMs = Date.now() + resolveHostWaitBudgetMs(request.timeoutMs);
      const threadRef: ScopedThreadRef = {
        environmentId,
        threadId: request.threadId,
      };
      let tabId = request.tabId ?? null;
      const browserActivity = { release: null as (() => void) | null };
      try {
        let state = readThreadPreviewState(threadRef);
        const needsSessionSync = needsPreviewAutomationSessionSync(state, request.tabId);
        if (needsSessionSync) {
          const listTarget = {
            environmentId,
            input: { threadId: request.threadId },
          } as const;
          registry.refresh(previewEnvironment.list(listTarget));
          const result = await listPreviews(listTarget);
          if (result._tag === "Failure") {
            return raiseAtomCommandFailure(result);
          }
          reconcilePreviewServerSessions(threadRef, result.value);
          state = readThreadPreviewState(threadRef);
        }
        tabId = request.tabId ?? state.snapshot?.tabId ?? null;
        const unavailableTarget = {
          requestId: request.requestId,
          operation: request.operation,
          environmentId,
          threadId: request.threadId,
          tabId,
          bridgeAvailable: Boolean(previewBridge),
        };
        const requireReadyTab = async () => {
          const bridge = previewBridge;
          const readyTabId = tabId;
          if (!bridge || !readyTabId) {
            throw new PreviewAutomationTargetUnavailableError(unavailableTarget);
          }
          const readyState = readThreadPreviewState(threadRef);
          const runtimeTabId = previewRuntimeTabId(threadRef, readyState.serverEpoch, readyTabId);
          if (request.operation !== "open") {
            const { autoShowFloatingPreview } = await resolveBrowserDefaults();
            if (
              shouldAutoShowPreviewForAutomationUse({
                operation: request.operation,
                autoShowFloatingPreview,
                presentationSuppressed:
                  presentationSuppressedRuntimeTabsRef.current
                    .get(request.threadId)
                    ?.has(runtimeTabId) ?? false,
              })
            ) {
              usePreviewMiniPlayerStore
                .getState()
                .open(threadRef, browserMiniPlayerSource(readyTabId));
            }
          }
          browserActivity.release ??= acquireBrowserSurfaceActivity(runtimeTabId);
          await waitForDesktopOverlay(
            threadRef,
            request.requestId,
            readyTabId,
            runtimeTabId,
            request.operation,
            hostDeadlineMs,
          );
          return {
            bridge,
            tabId: readyTabId,
            runtimeTabId,
          };
        };
        const requireDialogTab = (input: {
          readonly environmentId: EnvironmentId;
          readonly tabId?: string;
        }) => {
          const artifacts = previewBridge?.artifacts;
          const readyTabId = tabId;
          if (!artifacts || !readyTabId) {
            throw new PreviewAutomationTargetUnavailableError(unavailableTarget);
          }
          if (
            input.environmentId !== environmentId ||
            (input.tabId !== undefined && input.tabId !== readyTabId)
          ) {
            throw new Error("The browser dialog request does not match the selected host tab.");
          }
          const readyState = readThreadPreviewState(threadRef);
          const runtimeTabId = previewRuntimeTabId(threadRef, readyState.serverEpoch, readyTabId);
          const currentState = assertPreviewRuntimeCurrent(
            threadRef,
            readyTabId,
            runtimeTabId,
            request,
          );
          if (!currentState.desktopByTabId[readyTabId]) {
            throw new PreviewAutomationTargetUnavailableError(unavailableTarget);
          }
          return { artifacts, tabId: readyTabId, runtimeTabId };
        };
        const requireJevBrowserAuthority = () => {
          if (getJevBrowserExecutionMode(threadRef) === "disabled") {
            throw new Error("Jev browser automation is disabled for this environment and thread.");
          }
          if (!hasJevBrowserHost()) {
            throw new Error("This client does not provide the Jev browser host bridge.");
          }
        };
        const prepareBrowserAction = async (
          ready: Awaited<ReturnType<typeof requireReadyTab>>,
          identity?: {
            readonly actionId?: string;
            readonly runId?: string;
            readonly operation?: string;
          },
        ): Promise<BrowserDialogPrepareActionInput | null> => {
          const prepareAction = ready.bridge.artifacts?.prepareAction;
          if (!prepareAction) return null;
          const prepared = {
            environmentId,
            tabId: ready.tabId,
            ...(identity?.runId === undefined ? {} : { runId: identity.runId }),
            actionId: BrowserArtifactActionId.make(identity?.actionId ?? request.requestId),
            operation: identity?.operation ?? request.operation,
          } satisfies BrowserDialogPrepareActionInput;
          await prepareAction(ready.runtimeTabId, prepared);
          return prepared;
        };
        const runPreparedBrowserAction = async <A,>(
          ready: Awaited<ReturnType<typeof requireReadyTab>>,
          identity: {
            readonly actionId?: string;
            readonly runId?: string;
            readonly operation?: string;
          },
          action: () => Promise<A>,
        ): Promise<A> => {
          const prepared = await prepareBrowserAction(ready, identity);
          try {
            return await action();
          } catch (cause) {
            return await rethrowPreparedBrowserActionFailure(ready, prepared, cause);
          }
        };
        const rethrowPreparedBrowserActionFailure = async (
          ready: Awaited<ReturnType<typeof requireReadyTab>>,
          prepared: BrowserDialogPrepareActionInput | null,
          cause: unknown,
        ): Promise<never> => {
          if (prepared) {
            const status = await ready.bridge.artifacts
              ?.dialogStatus(ready.runtimeTabId, {
                environmentId: prepared.environmentId,
                tabId: prepared.tabId,
              })
              .catch(() => null);
            const dialog = status?.dialog;
            if (
              dialog &&
              dialog.environmentId === prepared.environmentId &&
              dialog.tabId === prepared.tabId &&
              dialog.actionId === prepared.actionId
            ) {
              throw new PreviewAutomationDialogPendingHostError({ dialog });
            }
            await ready.bridge.artifacts
              ?.cancelPreparedAction?.(ready.runtimeTabId, prepared)
              .catch(() => undefined);
          }
          throw cause;
        };
        const runDeferredPreparedBrowserAction = async <A,>(
          ready: Awaited<ReturnType<typeof requireReadyTab>>,
          identity: {
            readonly actionId?: string;
            readonly runId?: string;
            readonly operation?: string;
          },
          action: (beforeNative: () => Promise<void>) => Promise<A>,
        ): Promise<A> => {
          let prepared: BrowserDialogPrepareActionInput | null = null;
          try {
            return await action(async () => {
              prepared = await prepareBrowserAction(ready, identity);
            });
          } catch (cause) {
            return await rethrowPreparedBrowserActionFailure(ready, prepared, cause);
          }
        };
        const runJevBrowserOperation = async <A,>(input: {
          readonly runId: string;
          readonly label: string;
          readonly execute: (signal: AbortSignal) => Promise<A>;
          readonly cost?: (result: A) => ReturnType<typeof jevBrowserDecisionCost>;
          readonly detail?: (result: A) => string | undefined;
          readonly failed?: (result: A) => boolean;
        }): Promise<A> => {
          requireJevBrowserAuthority();
          let landedCost: ReturnType<typeof jevBrowserDecisionCost> | null = null;
          const signal = jevBrowserHandlerBridge.begin(threadRef, {
            id: request.requestId,
            runId: input.runId,
            label: input.label,
            startedAt: new Date().toISOString(),
          });
          if (!signal) {
            throw new Error("Jev browser automation is off or its active-run limit was reached.");
          }
          try {
            requireJevBrowserAuthority();
            if (signal.aborted) throw new Error("Jev browser automation was cancelled.");
            const result = await input.execute(signal);
            landedCost = input.cost?.(result) ?? null;
            if (signal.aborted || getJevBrowserExecutionMode(threadRef) === "disabled") {
              throw new Error("Jev browser automation was cancelled before the result landed.");
            }
            const failed = input.failed?.(result) ?? false;
            const detail = input.detail?.(result);
            jevBrowserHandlerBridge.complete(threadRef, request.requestId, {
              status: failed ? "failed" : "succeeded",
              cost: landedCost ?? { kind: "none" },
              completedAt: new Date().toISOString(),
              ...(detail === undefined ? {} : { detail }),
            });
            return result;
          } catch (cause) {
            jevBrowserHandlerBridge.complete(threadRef, request.requestId, {
              status: signal.aborted ? "cancelled" : "failed",
              // A decision may have reached the paid provider even when the
              // response failed or cancellation won the renderer race.
              cost: landedCost ?? (input.cost ? { kind: "unknown" } : { kind: "none" }),
              completedAt: new Date().toISOString(),
              detail: cause instanceof Error ? cause.message : "Jev browser operation failed.",
            });
            throw cause;
          }
        };
        switch (request.operation) {
          case "status":
            return await currentStatus(threadRef, tabId);
          case "jevBrowserObserve": {
            const input = request.input as JevBrowserObserveInput;
            return await runJevBrowserOperation({
              runId: input.runId,
              label: "Observe browser",
              execute: async (signal) => {
                requireJevBrowserAuthority();
                const ready = await requireReadyTab();
                if (signal.aborted) throw new Error("Jev browser observation was cancelled.");
                requireJevBrowserAuthority();
                const cancelInput: JevBrowserCancelInput = {
                  runId: input.runId,
                  tabId: ready.runtimeTabId,
                  reason: "policy-disabled",
                };
                const cancel = () => {
                  void window.desktopBridge?.cancelJevBrowser?.(cancelInput);
                };
                signal.addEventListener("abort", cancel, { once: true });
                if (signal.aborted) {
                  cancel();
                  signal.removeEventListener("abort", cancel);
                  throw new Error("Jev browser observation was cancelled.");
                }
                try {
                  return await window.desktopBridge!.observeJevBrowser!({
                    ...input,
                    tabId: ready.runtimeTabId,
                    resolvedNavigations: resolveJevBrowserNavigations(environmentId, input),
                  });
                } finally {
                  signal.removeEventListener("abort", cancel);
                }
              },
            });
          }
          case "jevBrowserVerify": {
            const input = request.input as JevBrowserVerifyInput;
            return await runJevBrowserOperation({
              runId: input.runId,
              label: "Verify browser",
              execute: async (signal) => {
                requireJevBrowserAuthority();
                const ready = await requireReadyTab();
                if (signal.aborted) throw new Error("Jev browser verification was cancelled.");
                requireJevBrowserAuthority();
                const cancelInput: JevBrowserCancelInput = {
                  runId: input.runId,
                  tabId: ready.runtimeTabId,
                  reason: "policy-disabled",
                };
                const cancel = () => {
                  void window.desktopBridge?.cancelJevBrowser?.(cancelInput);
                };
                signal.addEventListener("abort", cancel, { once: true });
                if (signal.aborted) {
                  cancel();
                  signal.removeEventListener("abort", cancel);
                  throw new Error("Jev browser verification was cancelled.");
                }
                try {
                  return await window.desktopBridge!.verifyJevBrowser!({
                    ...input,
                    tabId: ready.runtimeTabId,
                  });
                } finally {
                  signal.removeEventListener("abort", cancel);
                }
              },
            });
          }
          case "jevBrowserDecide": {
            const input = request.input as JevBrowserDecideInput;
            return await runJevBrowserOperation({
              runId: input.runId,
              label: "Choose browser action",
              cost: jevBrowserDecisionCost,
              detail: (result) =>
                result.decision.outcome === "unavailable" ? result.decision.reason : undefined,
              failed: (result) => result.decision.outcome === "unavailable",
              execute: async (signal) => {
                requireJevBrowserAuthority();
                const cancel = () => {
                  void window.desktopBridge?.cancelJevBrowser?.({
                    runId: input.runId,
                    ...(input.tabId === undefined ? {} : { tabId: input.tabId }),
                    reason: "policy-disabled",
                  });
                };
                signal.addEventListener("abort", cancel, { once: true });
                try {
                  return await window.desktopBridge!.decideJevBrowser!(input);
                } finally {
                  signal.removeEventListener("abort", cancel);
                }
              },
            });
          }
          case "jevBrowserExecute": {
            const input = request.input as JevBrowserExecuteInput;
            return await runJevBrowserOperation({
              runId: input.runId,
              label: input.action.operation,
              detail: (result: JevBrowserExecuteResult) => result.detail,
              failed: (result: JevBrowserExecuteResult) => result.status !== "executed",
              execute: async (signal) => {
                requireJevBrowserAuthority();
                const ready = await requireReadyTab();
                if (signal.aborted) throw new Error("Jev browser action was cancelled.");
                requireJevBrowserAuthority();
                const cancelInput: JevBrowserCancelInput = {
                  runId: input.runId,
                  tabId: ready.runtimeTabId,
                  reason: "policy-disabled",
                };
                const cancel = () => {
                  void window.desktopBridge?.cancelJevBrowser?.(cancelInput);
                };
                signal.addEventListener("abort", cancel, { once: true });
                if (signal.aborted) {
                  cancel();
                  signal.removeEventListener("abort", cancel);
                  throw new Error("Jev browser action was cancelled.");
                }
                try {
                  return await runPreparedBrowserAction(
                    ready,
                    {
                      runId: input.runId,
                      actionId: request.requestId,
                      operation: `jevBrowserExecute:${input.action.operation}`,
                    },
                    () =>
                      window.desktopBridge!.executeJevBrowser!({
                        ...input,
                        tabId: ready.runtimeTabId,
                      }),
                  );
                } finally {
                  signal.removeEventListener("abort", cancel);
                }
              },
            });
          }
          case "jevBrowserCancel": {
            const input = request.input as JevBrowserCancelInput;
            const cancelledLocally = jevBrowserHandlerBridge.cancelRun(
              threadRef,
              input.runId,
              `Cancelled: ${input.reason}.`,
            );
            const result = await window.desktopBridge?.cancelJevBrowser?.(input);
            return { cancelled: cancelledLocally || result?.cancelled === true };
          }
          case "open": {
            const input = request.input as PreviewAutomationOpenInput;
            const resolvedInputUrl = input.url
              ? resolveBrowserNavigationTarget(environmentId, {
                  kind: "url",
                  url: input.url,
                }).resolvedUrl
              : undefined;
            let activeTabId = resolvePreviewAutomationOpenTab(
              state,
              request.tabId,
              input.reuseExistingTab ?? true,
            );
            let activeSnapshot = activeTabId
              ? (state.sessions[activeTabId] ?? state.snapshot ?? undefined)
              : undefined;
            const reusedExistingTab = activeTabId !== null;
            tabId = activeTabId;
            if (!activeTabId) {
              const defaults = await resolveBrowserDefaults();
              const result = await open({
                environmentId,
                input: {
                  threadId: request.threadId,
                  ...(resolvedInputUrl ? { url: resolvedInputUrl } : {}),
                  // An agent that didn't state a size gets the user's
                  // configured default, same as a hand-opened tab.
                  viewport: browserDefaultOpenViewport(defaults),
                  profileId: browserDefaultOpenProfileId(defaults),
                },
              });
              if (result._tag === "Failure") {
                return raiseAtomCommandFailure(result);
              }
              const snapshot = result.value;
              applyPreviewServerSnapshot(threadRef, snapshot);
              activeTabId = snapshot.tabId;
              activeSnapshot = snapshot;
              tabId = activeTabId;
            }
            const activeRuntimeTabId = previewRuntimeTabId(
              threadRef,
              readThreadPreviewState(threadRef).serverEpoch,
              activeTabId,
            );
            if (activeSnapshot) {
              const defaultViewport = previewAutomationDefaultViewport(
                reusedExistingTab,
                activeSnapshot,
              );
              if (defaultViewport) {
                const resizeResult = await runBrowserViewportMutation(
                  activeRuntimeTabId,
                  async () => {
                    assertPreviewRuntimeCurrent(
                      threadRef,
                      activeTabId,
                      activeRuntimeTabId,
                      request,
                    );
                    return await resize({
                      environmentId,
                      input: {
                        threadId: request.threadId,
                        tabId: activeTabId,
                        viewport: defaultViewport,
                      },
                    });
                  },
                );
                if (resizeResult._tag === "Failure") {
                  return raiseAtomCommandFailure(resizeResult);
                }
                activeSnapshot = resizeResult.value;
                updatePreviewServerSnapshot(threadRef, resizeResult.value);
              }
            }
            const shouldPresentPreview = shouldOpenPreviewMiniPlayer(
              input,
              (await resolveBrowserDefaults()).autoShowFloatingPreview,
            );
            const explicitlySuppressed = explicitlySuppressesPreviewMiniPlayer(input);
            const suppressedTabs = presentationSuppressedRuntimeTabsRef.current.get(
              request.threadId,
            );
            if (explicitlySuppressed) {
              if (suppressedTabs) {
                suppressedTabs.add(activeRuntimeTabId);
              } else {
                presentationSuppressedRuntimeTabsRef.current.set(
                  request.threadId,
                  new Set([activeRuntimeTabId]),
                );
              }
              const miniPlayerTabId = selectThreadPreviewMiniPlayerTabId(
                usePreviewMiniPlayerStore.getState().byThreadKey,
                threadRef,
              );
              if (miniPlayerTabId === activeTabId) {
                usePreviewMiniPlayerStore.getState().close(threadRef);
              }
            } else if (shouldPresentPreview) {
              suppressedTabs?.delete(activeRuntimeTabId);
              if (suppressedTabs?.size === 0) {
                presentationSuppressedRuntimeTabsRef.current.delete(request.threadId);
              }
            }
            if (shouldPresentPreview) {
              usePreviewMiniPlayerStore
                .getState()
                .open(threadRef, browserMiniPlayerSource(activeTabId));
            }
            if (activeSnapshot && previewAutomationOpenNeedsOverlay(input, activeSnapshot)) {
              await requireReadyTab();
            }
            if (shouldPresentPreview) {
              // React commits the thread-bound surface asynchronously. Settle
              // briefly so active-thread opens report visible=true, without
              // turning a background thread's offscreen mini player into an
              // operation failure.
              await waitForPreviewPresentation(activeRuntimeTabId);
            }
            if (reusedExistingTab && resolvedInputUrl && previewBridge) {
              const ready = await requireReadyTab();
              assertPreviewRuntimeCurrent(threadRef, activeTabId, activeRuntimeTabId, request);
              await runPreparedBrowserAction(ready, { operation: "navigate" }, () =>
                ready.bridge.navigate(ready.runtimeTabId, resolvedInputUrl),
              );
              await waitForNavigationReadiness(
                threadRef,
                request.requestId,
                activeTabId,
                activeRuntimeTabId,
                request.operation,
                "load",
                request.timeoutMs,
              );
            }
            return await currentStatus(threadRef, activeTabId);
          }
          case "navigate": {
            const ready = await requireReadyTab();
            const input = request.input as PreviewAutomationNavigateInput;
            const resolution = resolveBrowserNavigationTarget(
              environmentId,
              input.target ?? {
                kind: "url",
                url: input.url!,
              },
            );
            await runPreparedBrowserAction(ready, {}, () =>
              ready.bridge.navigate(ready.runtimeTabId, resolution.resolvedUrl),
            );
            await waitForNavigationReadiness(
              threadRef,
              request.requestId,
              ready.tabId,
              ready.runtimeTabId,
              request.operation,
              input.readiness ?? "load",
              input.timeoutMs ?? request.timeoutMs,
            );
            return await currentStatus(threadRef, ready.tabId);
          }
          case "resize": {
            const ready = await requireReadyTab();
            const input = request.input as PreviewAutomationResizeInput;
            const setting = resolvePreviewViewport(input);
            const applied = await runBrowserViewportMutation(ready.runtimeTabId, async () => {
              const operationState = assertPreviewRuntimeCurrent(
                threadRef,
                ready.tabId,
                ready.runtimeTabId,
                request,
              );
              const previousSetting =
                operationState.sessions[ready.tabId]?.viewport ?? FILL_PREVIEW_VIEWPORT;
              const result = await resize({
                environmentId,
                input: {
                  threadId: request.threadId,
                  tabId: ready.tabId,
                  viewport: setting,
                },
              });
              if (result._tag === "Failure") {
                return raiseAtomCommandFailure(result);
              }
              updatePreviewServerSnapshot(threadRef, result.value);
              return {
                previousSetting,
                serverEpoch: operationState.serverEpoch,
              };
            });
            let viewport: PreviewRenderedViewportSize;
            try {
              viewport = await waitForRenderedViewport(
                threadRef,
                ready.tabId,
                ready.runtimeTabId,
                setting,
                input.timeoutMs ?? request.timeoutMs,
                {
                  requestId: request.requestId,
                  operation: request.operation,
                  environmentId,
                  threadId: request.threadId,
                },
              );
            } catch (cause) {
              await runBrowserViewportMutation(ready.runtimeTabId, async () => {
                const latestState = readThreadPreviewState(threadRef);
                const latestSetting =
                  latestState.sessions[ready.tabId]?.viewport ?? FILL_PREVIEW_VIEWPORT;
                if (
                  shouldRollbackPreviewViewport(
                    applied.previousSetting,
                    setting,
                    latestSetting,
                    applied.serverEpoch,
                    latestState.serverEpoch,
                  )
                ) {
                  const rollback = await resize({
                    environmentId,
                    input: {
                      threadId: request.threadId,
                      tabId: ready.tabId,
                      viewport: applied.previousSetting,
                    },
                  });
                  if (rollback._tag !== "Failure") {
                    updatePreviewServerSnapshot(threadRef, rollback.value);
                  }
                }
              });
              throw cause;
            }
            return {
              tabId: ready.tabId,
              setting,
              viewport,
            } satisfies PreviewAutomationResizeResult;
          }
          case "setColorScheme": {
            const ready = await requireReadyTab();
            const input = request.input as PreviewAutomationSetColorSchemeInput;
            await ready.bridge.setColorScheme(ready.runtimeTabId, input.colorScheme);
            return {
              tabId: ready.tabId,
              colorScheme: input.colorScheme,
            } satisfies PreviewAutomationSetColorSchemeResult;
          }
          case "snapshot": {
            const ready = await requireReadyTab();
            return await ready.bridge.automation.snapshot(ready.runtimeTabId);
          }
          case "verify": {
            const ready = await requireReadyTab();
            const verify = ready.bridge.automation.verify;
            if (!verify)
              throw new Error("This desktop browser host does not support verification.");
            return await verify(ready.runtimeTabId, request.input as Parameters<typeof verify>[1]);
          }
          case "select": {
            const ready = await requireReadyTab();
            const select = ready.bridge.automation.select;
            if (!select) throw new Error("This desktop browser host does not support selection.");
            return await runPreparedBrowserAction(ready, {}, () =>
              select(ready.runtimeTabId, request.input as Parameters<typeof select>[1]),
            );
          }
          case "check": {
            const ready = await requireReadyTab();
            const check = ready.bridge.automation.check;
            if (!check) throw new Error("This desktop browser host does not support checking.");
            return await runPreparedBrowserAction(ready, {}, () =>
              check(ready.runtimeTabId, request.input as Parameters<typeof check>[1]),
            );
          }
          case "hover": {
            const ready = await requireReadyTab();
            const hover = ready.bridge.automation.hover;
            if (!hover) throw new Error("This desktop browser host does not support hovering.");
            return await runPreparedBrowserAction(ready, {}, () =>
              hover(ready.runtimeTabId, request.input as Parameters<typeof hover>[1]),
            );
          }
          case "extract": {
            const ready = await requireReadyTab();
            const extract = ready.bridge.automation.extract;
            if (!extract) throw new Error("This desktop browser host does not support extraction.");
            return await extract(
              ready.runtimeTabId,
              request.input as Parameters<typeof extract>[1],
            );
          }
          case "waitForAssertion": {
            const ready = await requireReadyTab();
            const waitForAssertion = ready.bridge.automation.waitForAssertion;
            if (!waitForAssertion) {
              throw new Error("This desktop browser host does not support assertion waits.");
            }
            return await waitForAssertion(
              ready.runtimeTabId,
              request.input as Parameters<typeof waitForAssertion>[1],
            );
          }
          case "uploadFile": {
            const ready = await requireReadyTab();
            if (!artifactAutomationHost) {
              throw new Error("This desktop browser host does not support file upload.");
            }
            const input = request.input as BrowserUploadHostInput;
            return await runDeferredPreparedBrowserAction(
              ready,
              {
                ...(input.transfer.runId === undefined ? {} : { runId: input.transfer.runId }),
                actionId: input.transfer.actionId,
              },
              (beforeNative) =>
                artifactAutomationHost.selectUpload(
                  threadRef,
                  ready.tabId,
                  ready.runtimeTabId,
                  input,
                  hostDeadlineMs,
                  beforeNative,
                ),
            );
          }
          case "downloadFile": {
            const ready = await requireReadyTab();
            if (!artifactAutomationHost) {
              throw new Error("This desktop browser host does not support file download.");
            }
            const input = request.input as BrowserDownloadHostInput;
            return await runDeferredPreparedBrowserAction(
              ready,
              {
                ...(input.expectation.runId === undefined
                  ? {}
                  : { runId: input.expectation.runId }),
                actionId: input.expectation.actionId,
              },
              (beforeNative) =>
                artifactAutomationHost.download(
                  threadRef,
                  ready.tabId,
                  ready.runtimeTabId,
                  input,
                  hostDeadlineMs,
                  beforeNative,
                ),
            );
          }
          case "dialogStatus": {
            const input = request.input as BrowserDialogStatusHostInput;
            const ready = requireDialogTab(input);
            return await ready.artifacts.dialogStatus(ready.runtimeTabId, {
              ...input,
              tabId: ready.tabId,
            });
          }
          case "dialogHandle": {
            const input = request.input as BrowserDialogHandleRequest;
            const ready = requireDialogTab(input);
            return await ready.artifacts.handleDialog(ready.runtimeTabId, input);
          }
          case "artifactAcknowledge": {
            const input = request.input as BrowserArtifactAcknowledgeHostInput;
            if (!artifactAutomationHost || !tabId) {
              throw new Error("This desktop browser host does not support artifact cleanup.");
            }
            return await artifactAutomationHost.acknowledge(threadRef, tabId, input);
          }
          case "click": {
            const ready = await requireReadyTab();
            return await runPreparedBrowserAction(ready, {}, () =>
              ready.bridge.automation.click(
                ready.runtimeTabId,
                request.input as Parameters<typeof ready.bridge.automation.click>[1],
              ),
            );
          }
          case "type": {
            const ready = await requireReadyTab();
            return await runPreparedBrowserAction(ready, {}, () =>
              ready.bridge.automation.type(
                ready.runtimeTabId,
                request.input as Parameters<typeof ready.bridge.automation.type>[1],
              ),
            );
          }
          case "press": {
            const ready = await requireReadyTab();
            return await runPreparedBrowserAction(ready, {}, () =>
              ready.bridge.automation.press(
                ready.runtimeTabId,
                request.input as Parameters<typeof ready.bridge.automation.press>[1],
              ),
            );
          }
          case "scroll": {
            const ready = await requireReadyTab();
            return await runPreparedBrowserAction(ready, {}, () =>
              ready.bridge.automation.scroll(
                ready.runtimeTabId,
                request.input as Parameters<typeof ready.bridge.automation.scroll>[1],
              ),
            );
          }
          case "evaluate": {
            const ready = await requireReadyTab();
            return await runPreparedBrowserAction(ready, {}, () =>
              ready.bridge.automation.evaluate(
                ready.runtimeTabId,
                request.input as Parameters<typeof ready.bridge.automation.evaluate>[1],
              ),
            );
          }
          case "waitFor": {
            const ready = await requireReadyTab();
            return await ready.bridge.automation.waitFor(
              ready.runtimeTabId,
              request.input as Parameters<typeof ready.bridge.automation.waitFor>[1],
            );
          }
          case "recordingStart": {
            const ready = await requireReadyTab();
            const startedAt = await startBrowserRecording(
              ready.runtimeTabId,
              threadRef,
              ready.tabId,
            );
            return {
              tabId: ready.tabId,
              recording: true,
              startedAt,
            };
          }
          case "recordingStop": {
            const activeRecordings = readActiveBrowserRecordingTargets(threadRef);
            const activeTabIds = new Set(
              activeRecordings.map((recording) => recording.serverTabId),
            );
            const stopTabId = resolveBrowserRecordingStopTarget(
              activeTabIds,
              tabId,
              request.tabIdExplicit ? request.tabId : undefined,
            );
            tabId = stopTabId ?? tabId;
            const stopRuntimeTabId =
              activeRecordings.find((recording) => recording.serverTabId === stopTabId)
                ?.runtimeTabId ?? null;
            const transferToEnvironment =
              typeof request.input === "object" &&
              request.input !== null &&
              "transferToEnvironment" in request.input &&
              request.input.transferToEnvironment === true;
            const artifact = stopRuntimeTabId
              ? transferToEnvironment
                ? await stopBrowserRecordingForUpload(stopRuntimeTabId, (saved, blob) =>
                    uploadBrowserRecording(threadRef, saved, blob, hostDeadlineMs),
                  )
                : await stopBrowserRecording(stopRuntimeTabId)
              : null;
            if (!artifact || !stopTabId) {
              return raisePreviewAutomationHostError(
                new PreviewAutomationRecordingNotActiveError({
                  requestId: request.requestId,
                  environmentId,
                  threadId: request.threadId,
                  tabId,
                }),
              );
            }
            return {
              ...artifact,
              tabId: stopTabId,
            };
          }
        }
      } catch (cause) {
        throw PreviewAutomationOperationError.fromCause({
          requestId: request.requestId,
          operation: request.operation,
          environmentId,
          threadId: request.threadId,
          tabId,
          cause,
        });
      } finally {
        browserActivity.release?.();
      }
    },
    [artifactAutomationHost, environmentId, listPreviews, open, registry, resize],
  );
  const [requestHandlerAtom] = useState(() => Atom.make({ handle: previewAutomationHostNotReady }));
  const setRequestHandler = useAtomSet(requestHandlerAtom);
  useEffect(() => {
    setRequestHandler({ handle: handleRequest });
  }, [handleRequest, setRequestHandler]);

  const automationRequestConsumerAtom = useMemo(
    () =>
      createPreviewAutomationRequestConsumerAtom({
        requestsAtom: automationRequestsAtom,
        clientId: automationClientId,
        connectionAtom: automationConnectionAtom,
        environmentId,
        requestHandlerAtom,
        respond: (response) =>
          respondToAutomation({
            environmentId,
            input: response,
          }),
        label: `preview:automation-host:${environmentId}:${automationClientId}`,
      }),
    [
      automationClientId,
      automationConnectionAtom,
      automationRequestsAtom,
      requestHandlerAtom,
      respondToAutomation,
      environmentId,
    ],
  );
  useAtomValue(automationRequestConsumerAtom);

  useEffect(() => {
    const report = () => {
      if (!automationConnectionId) return;
      void focusAutomationHost({
        environmentId,
        input: {
          clientId: automationClientId,
          environmentId,
          connectionId: automationConnectionId,
          focused: document.hasFocus(),
        },
      });
    };
    report();
    window.addEventListener("focus", report);
    window.addEventListener("blur", report);
    return () => {
      window.removeEventListener("focus", report);
      window.removeEventListener("blur", report);
    };
  }, [automationClientId, automationConnectionId, environmentId, focusAutomationHost]);

  return null;
}
