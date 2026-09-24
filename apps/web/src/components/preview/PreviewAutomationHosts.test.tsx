import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ThreadId,
  type ClientSettings,
  type PreviewAutomationResponse,
  type PreviewAutomationStreamEvent,
  type PreviewOpenInput,
  type PreviewSessionSnapshot,
} from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { __resetClientSettingsPersistenceForTests } from "~/hooks/useSettings";
import { useBrowserSurfaceStore } from "~/browser/browserSurfaceStore";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import {
  applyPreviewDesktopState,
  applyPreviewServerSnapshot,
  readThreadPreviewState,
  resetPreviewStateForTests,
} from "~/previewStateStore";
import { appAtomRegistry, AppAtomRegistryProvider } from "~/rpc/atomRegistry";
import { resetJevBrowserStoreForTests, useJevBrowserStore } from "~/jevBrowser/jevBrowserStore";

import { PreviewAutomationHosts } from "./PreviewAutomationHosts";

const mocks = vi.hoisted(() => ({
  getClientSettings: vi.fn<() => Promise<ClientSettings | null>>(),
  setClientSettings: vi.fn(),
  open: vi.fn(async (_target: { environmentId: EnvironmentId; input: PreviewOpenInput }) =>
    AsyncResult.success(snapshot),
  ),
  list: vi.fn(async () => AsyncResult.success(emptyList)),
  resize: vi.fn(),
  respond:
    vi.fn<
      (target: { environmentId: EnvironmentId; input: PreviewAutomationResponse }) => Promise<void>
    >(),
  focus: vi.fn<() => Promise<AtomCommandResult<void, Error>>>(),
  previewStatus: vi.fn(),
  prepareAction: vi.fn(),
  cancelPreparedAction: vi.fn(),
  click: vi.fn(),
  dialogStatus: vi.fn(),
  handleDialog: vi.fn(),
}));

vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({ persistence: mocks }),
}));
vi.mock("~/env", () => ({ isElectron: true }));
vi.mock("~/state/environments", () => ({
  useEnvironments: () => ({ environments: [{ environmentId }] }),
}));
vi.mock("~/state/preview", () => ({
  previewEnvironment: {
    automationRequests: () => requestsAtom,
    list: () => listAtom,
    open: mocks.open,
    resize: mocks.resize,
    respondToAutomation: mocks.respond,
    focusAutomationHost: mocks.focus,
  },
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) => command,
}));
vi.mock("~/state/use-atom-query-runner", () => ({
  useAtomQueryRunner: () => mocks.list,
}));
vi.mock("./previewBridge", () => ({
  previewBridge: {
    automation: { status: mocks.previewStatus, click: mocks.click },
    artifacts: {
      prepareAction: mocks.prepareAction,
      cancelPreparedAction: mocks.cancelPreparedAction,
      selectUpload: vi.fn(),
      startDownload: vi.fn(),
      readDownload: vi.fn(),
      acknowledgeArtifact: vi.fn(),
      dialogStatus: mocks.dialogStatus,
      handleDialog: mocks.handleDialog,
    },
  },
}));

const environmentId = EnvironmentId.make("automation-environment");
const threadId = ThreadId.make("automation-thread");
const threadRef = { environmentId, threadId };
const viewport = { _tag: "freeform", width: 1440, height: 900 } as const;
const savedSettings: ClientSettings = {
  ...DEFAULT_CLIENT_SETTINGS,
  browserDefaultViewport: viewport,
  browserDefaultProfileId: "work",
  browserProfiles: [{ id: "work", name: "Work", kind: "persistent" }],
};
const snapshot: PreviewSessionSnapshot = {
  threadId,
  tabId: "automation-tab",
  navStatus: { _tag: "Idle" },
  canGoBack: false,
  canGoForward: false,
  viewport,
  profileId: "work",
  updatedAt: "2026-09-05T00:00:00.000Z",
};
const emptyList = { sessions: [], serverEpoch: "test-server", revision: 0 };
const listAtom = Atom.make(AsyncResult.success(emptyList));
const requestsAtom = Atom.make<AsyncResult.AsyncResult<PreviewAutomationStreamEvent, Error>>(
  AsyncResult.initial(false),
);
const requestEvent: PreviewAutomationStreamEvent = {
  type: "request",
  connectionId: "automation-connection",
  request: {
    requestId: "open-request",
    threadId,
    operation: "open",
    input: { open: false, reuseExistingTab: false },
    timeoutMs: 15_000,
  },
};

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

let renderer: ReactTestRenderer | null = null;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.getClientSettings.mockReset().mockResolvedValue(savedSettings);
  mocks.respond.mockReset();
  mocks.focus.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  mocks.previewStatus.mockReset().mockResolvedValue({ available: true, loading: false });
  mocks.prepareAction.mockReset().mockResolvedValue(undefined);
  mocks.cancelPreparedAction.mockReset().mockResolvedValue(undefined);
  mocks.click.mockReset().mockResolvedValue(undefined);
  mocks.dialogStatus.mockReset().mockResolvedValue({ dialog: null });
  mocks.handleDialog.mockReset().mockImplementation(async (_runtimeTabId, input) => ({
    ...input,
    status: "handled",
  }));
  __resetClientSettingsPersistenceForTests();
  resetPreviewStateForTests();
  resetJevBrowserStoreForTests();
  useBrowserSurfaceStore.setState({ byTabId: {} });
  appAtomRegistry.set(requestsAtom, AsyncResult.initial(false));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), {
      hasFocus: () => false,
      visibilityState: "visible",
      querySelectorAll: () => [],
    }),
  );
  await act(() => {
    renderer = create(
      <AppAtomRegistryProvider>
        <PreviewAutomationHosts />
      </AppAtomRegistryProvider>,
    );
  });
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = null;
  resetPreviewStateForTests();
  resetJevBrowserStoreForTests();
  useBrowserSurfaceStore.setState({ byTabId: {} });
  __resetClientSettingsPersistenceForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PreviewAutomationHosts open", () => {
  it("waits for saved settings before opening a tab with the configured profile and viewport", async () => {
    const readStarted = deferred<void>();
    const read = deferred<ClientSettings>();
    const response = deferred<PreviewAutomationResponse>();
    mocks.getClientSettings.mockImplementationOnce(() => {
      readStarted.resolve();
      return read.promise;
    });
    mocks.respond.mockImplementationOnce(async ({ input }) => response.resolve(input));

    await act(async () => {
      appAtomRegistry.set(requestsAtom, AsyncResult.success(requestEvent));
      await readStarted.promise;
    });
    expect(mocks.open).not.toHaveBeenCalled();

    await act(async () => {
      read.resolve(savedSettings);
      await response.promise;
    });

    expect(mocks.open).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { threadId, viewport, profileId: "work" },
    });
    expect(mocks.getClientSettings).toHaveBeenCalledOnce();
    await expect(response.promise).resolves.toMatchObject({ requestId: "open-request", ok: true });
    expect(readThreadPreviewState(threadRef).snapshot).toEqual(snapshot);
    expect(mocks.setClientSettings).not.toHaveBeenCalled();
  });

  it("reports a settings read failure without opening a tab", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getClientSettings.mockRejectedValueOnce(new Error("Settings read failed"));
    const response = deferred<PreviewAutomationResponse>();
    mocks.respond.mockImplementationOnce(async ({ input }) => response.resolve(input));

    await act(async () => {
      appAtomRegistry.set(requestsAtom, AsyncResult.success(requestEvent));
      await response.promise;
    });

    await expect(response.promise).resolves.toMatchObject({
      requestId: "open-request",
      ok: false,
      error: { _tag: "PreviewAutomationExecutionError" },
    });
    expect(mocks.getClientSettings).toHaveBeenCalledOnce();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(readThreadPreviewState(threadRef).snapshot).toBeNull();
    expect(mocks.setClientSettings).not.toHaveBeenCalled();
  });
});

describe("PreviewAutomationHosts paused dialogs", () => {
  const prepareRegisteredPreview = () => {
    applyPreviewServerSnapshot(threadRef, snapshot);
    applyPreviewDesktopState(threadRef, snapshot.tabId, {
      hasWebContents: true,
      canGoBack: false,
      canGoForward: false,
      loading: false,
      zoomFactor: 1,
      pictureInPicture: false,
      colorScheme: "system",
      audioMuted: false,
      audible: false,
      controller: "none",
      favicon: null,
    });
    const runtimeTabId = previewRuntimeTabId(threadRef, null, snapshot.tabId);
    const webview = {
      getAttribute: (name: string) => (name === "data-preview-tab" ? runtimeTabId : null),
      closest: () => ({
        getAttribute: (name: string) => (name === "data-preview-rendering" ? "active" : null),
      }),
    };
    Object.assign(document, { querySelectorAll: () => [webview] });
    return runtimeTabId;
  };

  it("reads dialog status from the registered runtime without probing page status", async () => {
    const runtimeTabId = prepareRegisteredPreview();
    const response = deferred<PreviewAutomationResponse>();
    mocks.respond.mockImplementationOnce(async ({ input }) => response.resolve(input));

    await act(async () => {
      appAtomRegistry.set(
        requestsAtom,
        AsyncResult.success({
          type: "request",
          connectionId: "automation-connection",
          request: {
            requestId: "dialog-status-request",
            threadId,
            tabId: snapshot.tabId,
            operation: "dialogStatus",
            input: { environmentId },
            timeoutMs: 15_000,
          },
        }),
      );
      await response.promise;
    });

    expect(mocks.previewStatus).not.toHaveBeenCalled();
    expect(mocks.dialogStatus).toHaveBeenCalledExactlyOnceWith(runtimeTabId, {
      environmentId,
      tabId: snapshot.tabId,
    });
    await expect(response.promise).resolves.toMatchObject({ ok: true, result: { dialog: null } });
  });

  it("handles an exact dialog from the registered runtime without probing page status", async () => {
    const runtimeTabId = prepareRegisteredPreview();
    const response = deferred<PreviewAutomationResponse>();
    mocks.respond.mockImplementationOnce(async ({ input }) => response.resolve(input));
    const input = {
      environmentId,
      tabId: snapshot.tabId,
      actionId: "dialog-action",
      dialogId: "dialog-one",
      action: "dismiss" as const,
    };

    await act(async () => {
      appAtomRegistry.set(
        requestsAtom,
        AsyncResult.success({
          type: "request",
          connectionId: "automation-connection",
          request: {
            requestId: "dialog-handle-request",
            threadId,
            tabId: snapshot.tabId,
            operation: "dialogHandle",
            input,
            timeoutMs: 15_000,
          },
        }),
      );
      await response.promise;
    });

    expect(mocks.previewStatus).not.toHaveBeenCalled();
    expect(mocks.handleDialog).toHaveBeenCalledExactlyOnceWith(runtimeTabId, input);
    await expect(response.promise).resolves.toMatchObject({
      ok: true,
      result: { ...input, status: "handled" },
    });
  });

  it("recovers the exact pending dialog after Electron reduces the mutation failure to Error", async () => {
    const runtimeTabId = prepareRegisteredPreview();
    const response = deferred<PreviewAutomationResponse>();
    const dialog = {
      environmentId,
      tabId: snapshot.tabId,
      actionId: "click-dialog-request",
      dialogId: "dialog-one",
      kind: "confirm" as const,
      message: "Continue?",
      openedAt: "2026-09-22T12:00:00.000Z",
    };
    mocks.click.mockRejectedValueOnce(new Error("Error invoking remote method 'preview:click'"));
    mocks.dialogStatus.mockResolvedValueOnce({ dialog });
    mocks.respond.mockImplementationOnce(async ({ input }) => response.resolve(input));

    await act(async () => {
      appAtomRegistry.set(
        requestsAtom,
        AsyncResult.success({
          type: "request",
          connectionId: "automation-connection",
          request: {
            requestId: "click-dialog-request",
            threadId,
            tabId: snapshot.tabId,
            operation: "click",
            input: { tabId: snapshot.tabId, selector: "#submit" },
            timeoutMs: 15_000,
          },
        }),
      );
      await response.promise;
    });

    expect(mocks.prepareAction).toHaveBeenCalledExactlyOnceWith(runtimeTabId, {
      environmentId,
      tabId: snapshot.tabId,
      actionId: "click-dialog-request",
      operation: "click",
    });
    expect(mocks.dialogStatus).toHaveBeenCalledExactlyOnceWith(runtimeTabId, {
      environmentId,
      tabId: snapshot.tabId,
    });
    expect(mocks.previewStatus).toHaveBeenCalledOnce();
    expect(mocks.cancelPreparedAction).not.toHaveBeenCalled();
    await expect(response.promise).resolves.toMatchObject({
      ok: false,
      error: {
        _tag: "PreviewAutomationDialogPendingError",
        detail: { dialog },
      },
    });
  });

  it("keeps a mismatched dialog generic and cancels the exact unused preparation", async () => {
    const runtimeTabId = prepareRegisteredPreview();
    const response = deferred<PreviewAutomationResponse>();
    mocks.click.mockRejectedValueOnce(new Error("Error invoking remote method 'preview:click'"));
    mocks.dialogStatus.mockResolvedValueOnce({
      dialog: {
        environmentId,
        tabId: snapshot.tabId,
        actionId: "another-action",
        dialogId: "dialog-other",
        kind: "confirm",
        message: "Unrelated",
        openedAt: "2026-09-22T12:00:00.000Z",
      },
    });
    mocks.respond.mockImplementationOnce(async ({ input }) => response.resolve(input));

    await act(async () => {
      appAtomRegistry.set(
        requestsAtom,
        AsyncResult.success({
          type: "request",
          connectionId: "automation-connection",
          request: {
            requestId: "click-mismatch-request",
            threadId,
            tabId: snapshot.tabId,
            operation: "click",
            input: { tabId: snapshot.tabId, selector: "#submit" },
            timeoutMs: 15_000,
          },
        }),
      );
      await response.promise;
    });

    const prepared = {
      environmentId,
      tabId: snapshot.tabId,
      actionId: "click-mismatch-request",
      operation: "click",
    };
    expect(mocks.cancelPreparedAction).toHaveBeenCalledExactlyOnceWith(runtimeTabId, prepared);
    expect(mocks.previewStatus).toHaveBeenCalledOnce();
    await expect(response.promise).resolves.toMatchObject({
      ok: false,
      error: { _tag: "PreviewAutomationExecutionError" },
    });
  });
});

describe("PreviewAutomationHosts Jev browser authority", () => {
  const decisionInput = {
    runId: "run-one",
    task: "Submit the form",
    observation: {
      revision: "revision-one",
      surface: "browser" as const,
      controls: [],
      candidates: [],
    },
    inputs: [],
    unmetConditions: [],
    priorReceipts: [],
  };

  const request = {
    type: "request" as const,
    connectionId: "automation-connection",
    request: {
      requestId: "jev-decision-request",
      threadId,
      operation: "jevBrowserDecide" as const,
      input: decisionInput,
      timeoutMs: 15_000,
    },
  };

  const prepareReadyPreview = () => {
    applyPreviewServerSnapshot(threadRef, snapshot);
    applyPreviewDesktopState(threadRef, snapshot.tabId, {
      hasWebContents: true,
      canGoBack: false,
      canGoForward: false,
      loading: false,
      zoomFactor: 1,
      pictureInPicture: false,
      colorScheme: "system",
      audioMuted: false,
      audible: false,
      controller: "none",
      favicon: null,
    });
    const runtimeTabId = previewRuntimeTabId(threadRef, null, snapshot.tabId);
    const webview = {
      getAttribute: (name: string) => (name === "data-preview-tab" ? runtimeTabId : null),
      closest: () => ({
        getAttribute: (name: string) => (name === "data-preview-rendering" ? "active" : null),
      }),
    };
    Object.assign(document, { querySelectorAll: () => [webview] });
    return runtimeTabId;
  };

  const executeRequest: PreviewAutomationStreamEvent = {
    type: "request",
    connectionId: "automation-connection",
    request: {
      requestId: "jev-execute-request",
      threadId,
      tabId: snapshot.tabId,
      operation: "jevBrowserExecute",
      input: {
        runId: "run-readiness",
        tabId: snapshot.tabId,
        revision: "revision-one",
        action: { candidateId: "activate:button", operation: "activate" },
      },
      timeoutMs: 15_000,
    },
  };

  const observeRequest: PreviewAutomationStreamEvent = {
    type: "request",
    connectionId: "automation-connection",
    request: {
      requestId: "jev-observe-request",
      threadId,
      tabId: snapshot.tabId,
      operation: "jevBrowserObserve",
      input: {
        runId: "run-observe",
        tabId: snapshot.tabId,
        task: "Inspect the page",
        inputs: [],
        allowedOrigins: [],
      },
      timeoutMs: 15_000,
    },
  };

  it("cancels only this environment's active runs when its host disconnects", async () => {
    const cancelJevBrowser = vi.fn(async () => ({ cancelled: true }));
    Object.assign(window, { desktopBridge: { cancelJevBrowser } });
    useJevBrowserStore.getState().enable(threadRef);
    const signal = useJevBrowserStore.getState().begin(threadRef, {
      id: "disconnect-request",
      runId: "disconnect-run",
      label: "Observe browser",
      startedAt: "2026-09-21T10:00:00Z",
    });

    await act(() => renderer?.unmount());
    renderer = null;

    expect(signal?.aborted).toBe(true);
    expect(cancelJevBrowser).toHaveBeenCalledExactlyOnceWith({
      runId: "disconnect-run",
      reason: "failed",
    });
    expect(
      useJevBrowserStore.getState().byScope["automation-environment:automation-thread"],
    ).toMatchObject({
      enabled: true,
      activeRunIds: [],
      notice: "Stopped because the environment host disconnected.",
      history: [{ id: "disconnect-request", status: "cancelled" }],
    });
  });

  it("rejects Jev decision work while the scoped toggle is off", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const decideJevBrowser = vi.fn();
    Object.assign(window, {
      desktopBridge: {
        getJevStatus: vi.fn(async () => ({ hasKey: true, secureStorageAvailable: true })),
        observeJevBrowser: vi.fn(),
        verifyJevBrowser: vi.fn(),
        decideJevBrowser,
        executeJevBrowser: vi.fn(),
        cancelJevBrowser: vi.fn(),
      },
    });
    const response = deferred<PreviewAutomationResponse>();
    mocks.respond.mockImplementationOnce(async ({ input }) => response.resolve(input));

    await act(async () => {
      appAtomRegistry.set(requestsAtom, AsyncResult.success(request));
      await response.promise;
    });

    expect(decideJevBrowser).not.toHaveBeenCalled();
    await expect(response.promise).resolves.toMatchObject({ ok: false });
  });

  it("aborts an in-flight decision when the scoped toggle turns off", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const decision = deferred<{
      decision: { outcome: "done" };
      accounting: { inputTokens: null; outputTokens: null; costUsd: number };
    }>();
    const cancelJevBrowser = vi.fn(async () => ({ cancelled: true }));
    Object.assign(window, {
      desktopBridge: {
        getJevStatus: vi.fn(async () => ({ hasKey: true, secureStorageAvailable: true })),
        observeJevBrowser: vi.fn(),
        verifyJevBrowser: vi.fn(),
        decideJevBrowser: vi.fn(() => decision.promise),
        executeJevBrowser: vi.fn(),
        cancelJevBrowser,
      },
    });
    useJevBrowserStore.getState().enable(threadRef);
    const response = deferred<PreviewAutomationResponse>();
    mocks.respond.mockImplementationOnce(async ({ input }) => response.resolve(input));

    await act(async () => {
      appAtomRegistry.set(requestsAtom, AsyncResult.success(request));
      await Promise.resolve();
    });
    useJevBrowserStore.getState().disable(threadRef);
    expect(cancelJevBrowser).toHaveBeenCalledWith({
      runId: "run-one",
      reason: "policy-disabled",
    });

    await act(async () => {
      decision.resolve({
        decision: { outcome: "done" },
        accounting: { inputTokens: null, outputTokens: null, costUsd: 0.002 },
      });
      await response.promise;
    });

    await expect(response.promise).resolves.toMatchObject({ ok: false });
    expect(
      useJevBrowserStore.getState().byScope["automation-environment:automation-thread"]?.history[0],
    ).toMatchObject({
      runId: "run-one",
      status: "cancelled",
      cost: { kind: "reported", usd: 0.002 },
    });
  });

  it("does not execute after an off-on toggle while browser readiness is pending", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const readiness = deferred<{ available: boolean; loading: boolean }>();
    mocks.previewStatus.mockReturnValueOnce(readiness.promise);
    const executeJevBrowser = vi.fn();
    Object.assign(window, {
      desktopBridge: {
        getJevStatus: vi.fn(async () => ({ hasKey: true, secureStorageAvailable: true })),
        observeJevBrowser: vi.fn(),
        verifyJevBrowser: vi.fn(),
        decideJevBrowser: vi.fn(),
        executeJevBrowser,
        cancelJevBrowser: vi.fn(async () => ({ cancelled: true })),
      },
    });
    prepareReadyPreview();
    useJevBrowserStore.getState().enable(threadRef);
    const response = deferred<PreviewAutomationResponse>();
    mocks.respond.mockImplementationOnce(async ({ input }) => response.resolve(input));

    await act(async () => {
      appAtomRegistry.set(requestsAtom, AsyncResult.success(executeRequest));
      while (!mocks.previewStatus.mock.calls.length) await Promise.resolve();
    });
    useJevBrowserStore.getState().disable(threadRef);
    useJevBrowserStore.getState().enable(threadRef);

    await act(async () => {
      readiness.resolve({ available: true, loading: false });
      await response.promise;
    });

    expect(executeJevBrowser).not.toHaveBeenCalled();
    await expect(response.promise).resolves.toMatchObject({ ok: false });
  });

  it("forwards toggle-off cancellation after native execution has started", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const execution = deferred<{ status: "rejected"; detail: string }>();
    const executeJevBrowser = vi.fn(() => execution.promise);
    const cancelJevBrowser = vi.fn(async () => ({ cancelled: true }));
    Object.assign(window, {
      desktopBridge: {
        getJevStatus: vi.fn(async () => ({ hasKey: true, secureStorageAvailable: true })),
        observeJevBrowser: vi.fn(),
        verifyJevBrowser: vi.fn(),
        decideJevBrowser: vi.fn(),
        executeJevBrowser,
        cancelJevBrowser,
      },
    });
    const runtimeTabId = prepareReadyPreview();
    useJevBrowserStore.getState().enable(threadRef);
    const response = deferred<PreviewAutomationResponse>();
    mocks.respond.mockImplementationOnce(async ({ input }) => response.resolve(input));

    await act(async () => {
      appAtomRegistry.set(requestsAtom, AsyncResult.success(executeRequest));
      while (!executeJevBrowser.mock.calls.length) await Promise.resolve();
    });
    expect(mocks.prepareAction).toHaveBeenCalledExactlyOnceWith(runtimeTabId, {
      environmentId,
      tabId: snapshot.tabId,
      runId: "run-readiness",
      actionId: "jev-execute-request",
      operation: "jevBrowserExecute:activate",
    });
    useJevBrowserStore.getState().disable(threadRef);

    expect(cancelJevBrowser).toHaveBeenCalledWith({
      runId: "run-readiness",
      tabId: runtimeTabId,
      reason: "policy-disabled",
    });

    await act(async () => {
      execution.resolve({ status: "rejected", detail: "Cancelled by policy." });
      await response.promise;
    });
    await expect(response.promise).resolves.toMatchObject({ ok: false });
  });

  it("forwards toggle-off cancellation after native observation has started", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const observation = deferred<{
      observation: {
        revision: string;
        surface: "browser";
        controls: [];
        candidates: [];
      };
    }>();
    const observeJevBrowser = vi.fn(() => observation.promise);
    const cancelJevBrowser = vi.fn(async () => ({ cancelled: true }));
    Object.assign(window, {
      desktopBridge: {
        getJevStatus: vi.fn(async () => ({ hasKey: true, secureStorageAvailable: true })),
        observeJevBrowser,
        verifyJevBrowser: vi.fn(),
        decideJevBrowser: vi.fn(),
        executeJevBrowser: vi.fn(),
        cancelJevBrowser,
      },
    });
    const runtimeTabId = prepareReadyPreview();
    useJevBrowserStore.getState().enable(threadRef);
    const response = deferred<PreviewAutomationResponse>();
    mocks.respond.mockImplementationOnce(async ({ input }) => response.resolve(input));

    await act(async () => {
      appAtomRegistry.set(requestsAtom, AsyncResult.success(observeRequest));
      while (!observeJevBrowser.mock.calls.length) await Promise.resolve();
    });
    useJevBrowserStore.getState().disable(threadRef);

    expect(cancelJevBrowser).toHaveBeenCalledWith({
      runId: "run-observe",
      tabId: runtimeTabId,
      reason: "policy-disabled",
    });

    await act(async () => {
      observation.resolve({
        observation: {
          revision: "revision-observe",
          surface: "browser",
          controls: [],
          candidates: [],
        },
      });
      await response.promise;
    });
    await expect(response.promise).resolves.toMatchObject({ ok: false });
  });
});

describe("PreviewAutomationHosts ownership", () => {
  it("reports only local live tabs and removes ownership when their web contents close", async () => {
    await act(() => {
      appAtomRegistry.set(
        requestsAtom,
        AsyncResult.success({ type: "connected", connectionId: "automation-connection" }),
      );
      applyPreviewServerSnapshot(threadRef, snapshot);
    });
    expect(mocks.focus).toHaveBeenLastCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ liveTabs: [] }) }),
    );
    const overlay = {
      hasWebContents: true,
      canGoBack: false,
      canGoForward: false,
      loading: false,
      zoomFactor: 1,
      pictureInPicture: false,
      colorScheme: "system" as const,
      audioMuted: false,
      audible: false,
      controller: "none" as const,
      favicon: null,
    };
    await act(() => applyPreviewDesktopState(threadRef, snapshot.tabId, overlay));
    expect(mocks.focus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          liveTabs: [{ threadId, tabId: snapshot.tabId, visible: false }],
        }),
      }),
    );
    const reportCount = mocks.focus.mock.calls.length;
    await act(() =>
      applyPreviewDesktopState(threadRef, snapshot.tabId, { ...overlay, loading: true }),
    );
    expect(mocks.focus).toHaveBeenCalledTimes(reportCount);
    const runtimeTabId = previewRuntimeTabId(threadRef, null, snapshot.tabId);
    const owner = Symbol();
    await act(() => {
      useBrowserSurfaceStore.getState().claim(runtimeTabId, owner, false);
      useBrowserSurfaceStore
        .getState()
        .present(runtimeTabId, owner, { x: 0, y: 0, width: 800, height: 600 }, true, 0, 1);
    });
    expect(mocks.focus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          liveTabs: [{ threadId, tabId: snapshot.tabId, visible: true }],
        }),
      }),
    );
    for (const visibilityState of ["hidden", "visible"]) {
      await act(() => {
        Object.assign(document, { visibilityState });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(mocks.focus).toHaveBeenLastCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            focused: false,
            liveTabs: [{ threadId, tabId: snapshot.tabId, visible: visibilityState === "visible" }],
          }),
        }),
      );
    }
    await act(() => {
      appAtomRegistry.set(
        requestsAtom,
        AsyncResult.success({ type: "connected", connectionId: "reconnected" }),
      );
    });
    expect(mocks.focus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          connectionId: "reconnected",
          liveTabs: [{ threadId, tabId: snapshot.tabId, visible: true }],
        }),
      }),
    );
    await act(() =>
      applyPreviewDesktopState(threadRef, snapshot.tabId, { ...overlay, hasWebContents: false }),
    );
    expect(mocks.focus).toHaveBeenLastCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ liveTabs: [] }) }),
    );
  });

  it.each([false, true])(
    "retries failed reports without clearing newer connection reports (reconnect: %s)",
    async (reconnect) => {
      const report = deferred<Awaited<ReturnType<typeof mocks.focus>>>();
      mocks.focus.mockReturnValueOnce(report.promise);
      await act(() => {
        appAtomRegistry.set(
          requestsAtom,
          AsyncResult.success({ type: "connected", connectionId: "first" }),
        );
      });
      if (reconnect) {
        await act(() => {
          appAtomRegistry.set(
            requestsAtom,
            AsyncResult.success({ type: "connected", connectionId: "second" }),
          );
        });
      }
      await act(async () => {
        report.resolve(AsyncResult.failure(Cause.fail(new Error("Focus report failed"))));
        await report.promise;
      });
      expect(mocks.focus).toHaveBeenCalledTimes(reconnect ? 2 : 1);
      await act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(mocks.focus).toHaveBeenCalledTimes(2);
      expect(mocks.focus).toHaveBeenLastCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ connectionId: reconnect ? "second" : "first" }),
        }),
      );
    },
  );

  it("does not claim an available runtime from a server snapshot alone", async () => {
    const response = deferred<PreviewAutomationResponse>();
    mocks.respond.mockImplementationOnce(async ({ input }) => response.resolve(input));
    await act(async () => {
      applyPreviewServerSnapshot(threadRef, snapshot);
      appAtomRegistry.set(
        requestsAtom,
        AsyncResult.success({
          ...requestEvent,
          request: {
            ...requestEvent.request,
            operation: "status",
            tabId: snapshot.tabId,
            input: {},
          },
        }),
      );
      await response.promise;
    });
    await expect(response.promise).resolves.toMatchObject({
      ok: true,
      result: { available: false, tabId: snapshot.tabId },
    });
  });
});
