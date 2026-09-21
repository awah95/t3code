import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  JevBrowserDecideResult,
  JevBrowserMode,
  JevBrowserStatus,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { create } from "zustand";

export const JEV_BROWSER_HISTORY_LIMIT = 20;
export const JEV_BROWSER_ACTIVE_RUN_LIMIT = 8;
const JEV_BROWSER_RUN_IDLE_MS = 30_000;

export type JevBrowserHistoryStatus = "pending" | "succeeded" | "failed" | "cancelled";
export type JevBrowserHistoryCost =
  | { readonly kind: "reported"; readonly usd: number }
  | { readonly kind: "unknown" }
  | { readonly kind: "none" };

export interface JevBrowserHistoryEntry {
  readonly id: string;
  readonly runId: string;
  readonly label: string;
  readonly startedAt: string;
  readonly completedAt?: string | undefined;
  readonly status: JevBrowserHistoryStatus;
  readonly cost: JevBrowserHistoryCost;
  readonly detail?: string | undefined;
}

interface JevBrowserScopeState {
  readonly enabled: boolean;
  readonly notice: string | null;
  readonly activeRunIds: readonly string[];
  readonly history: readonly JevBrowserHistoryEntry[];
}

interface JevBrowserStoreState {
  readonly byScope: Readonly<Record<string, JevBrowserScopeState>>;
  enable: (scope: ScopedThreadRef) => void;
  disable: (scope: ScopedThreadRef, notice?: string) => void;
  setNotice: (scope: ScopedThreadRef, notice: string | null) => void;
  begin: (
    scope: ScopedThreadRef,
    input: Pick<JevBrowserHistoryEntry, "id" | "runId" | "label" | "startedAt">,
  ) => AbortSignal | null;
  complete: (
    scope: ScopedThreadRef,
    id: string,
    input: Pick<JevBrowserHistoryEntry, "status" | "cost" | "completedAt" | "detail">,
  ) => void;
  record: (scope: ScopedThreadRef, entry: JevBrowserHistoryEntry) => void;
  cancelRun: (scope: ScopedThreadRef, runId: string, detail?: string) => boolean;
  cancelEnvironmentRuns: (environmentId: EnvironmentId, detail?: string) => readonly string[];
  clearHistory: (scope: ScopedThreadRef) => void;
}

const controllersByScope = new Map<string, Map<string, AbortController>>();
const idleTimersByScope = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();

const emptyScope = (): JevBrowserScopeState => ({
  enabled: false,
  notice: null,
  activeRunIds: [],
  history: [],
});

function scopeState(state: JevBrowserStoreState, key: string): JevBrowserScopeState {
  return state.byScope[key] ?? emptyScope();
}

function updateScope(
  state: JevBrowserStoreState,
  key: string,
  update: (current: JevBrowserScopeState) => JevBrowserScopeState,
): Pick<JevBrowserStoreState, "byScope"> {
  return { byScope: { ...state.byScope, [key]: update(scopeState(state, key)) } };
}

function abortScope(key: string) {
  const controllers = controllersByScope.get(key);
  for (const controller of controllers?.values() ?? []) controller.abort();
  controllersByScope.delete(key);
  for (const timer of idleTimersByScope.get(key)?.values() ?? []) clearTimeout(timer);
  idleTimersByScope.delete(key);
}

function scheduleRunRelease(key: string, runId: string) {
  const timers = idleTimersByScope.get(key) ?? new Map<string, ReturnType<typeof setTimeout>>();
  const current = timers.get(runId);
  if (current) clearTimeout(current);
  timers.set(
    runId,
    setTimeout(() => {
      controllersByScope.get(key)?.delete(runId);
      timers.delete(runId);
      if (timers.size === 0) idleTimersByScope.delete(key);
      useJevBrowserStore.setState((state) =>
        updateScope(state, key, (scope) => ({
          ...scope,
          activeRunIds: scope.activeRunIds.filter((candidate) => candidate !== runId),
        })),
      );
    }, JEV_BROWSER_RUN_IDLE_MS),
  );
  idleTimersByScope.set(key, timers);
}

function boundedHistory(
  history: readonly JevBrowserHistoryEntry[],
): readonly JevBrowserHistoryEntry[] {
  return history.slice(0, JEV_BROWSER_HISTORY_LIMIT);
}

export const useJevBrowserStore = create<JevBrowserStoreState>((set, get) => ({
  byScope: {},
  enable: (scope) => {
    const key = scopedThreadKey(scope);
    set((state) =>
      updateScope(state, key, (current) => ({
        ...current,
        enabled: true,
        notice: "Jev browser is on for this thread.",
      })),
    );
  },
  disable: (scope, notice = "Jev browser is off for this thread.") => {
    const key = scopedThreadKey(scope);
    abortScope(key);
    const completedAt = new Date().toISOString();
    set((state) =>
      updateScope(state, key, (current) => ({
        enabled: false,
        notice,
        activeRunIds: [],
        history: current.history.map((entry) =>
          entry.status === "pending"
            ? {
                ...entry,
                status: "cancelled",
                completedAt,
                detail: "Cancelled when Jev browser was turned off.",
              }
            : entry,
        ),
      })),
    );
  },
  setNotice: (scope, notice) => {
    const key = scopedThreadKey(scope);
    set((state) => updateScope(state, key, (current) => ({ ...current, notice })));
  },
  begin: (scope, input) => {
    const key = scopedThreadKey(scope);
    if (!scopeState(get(), key).enabled) return null;
    const controllers = controllersByScope.get(key) ?? new Map<string, AbortController>();
    let controller = controllers.get(input.runId);
    if (!controller) {
      if (controllers.size >= JEV_BROWSER_ACTIVE_RUN_LIMIT) return null;
      controller = new AbortController();
      controllers.set(input.runId, controller);
    }
    const idleTimer = idleTimersByScope.get(key)?.get(input.runId);
    if (idleTimer) clearTimeout(idleTimer);
    idleTimersByScope.get(key)?.delete(input.runId);
    controllersByScope.set(key, controllers);
    set((state) =>
      updateScope(state, key, (current) => ({
        ...current,
        activeRunIds: current.activeRunIds.includes(input.runId)
          ? current.activeRunIds
          : [...current.activeRunIds, input.runId],
        history: boundedHistory([
          { ...input, status: "pending", cost: { kind: "none" } },
          ...current.history.filter((entry) => entry.id !== input.id),
        ]),
      })),
    );
    return controller.signal;
  },
  complete: (scope, id, input) => {
    const key = scopedThreadKey(scope);
    const runId = scopeState(get(), key).history.find((entry) => entry.id === id)?.runId;
    set((state) =>
      updateScope(state, key, (current) => ({
        ...current,
        history: current.history.map((entry) => (entry.id === id ? { ...entry, ...input } : entry)),
      })),
    );
    if (runId) scheduleRunRelease(key, runId);
  },
  record: (scope, entry) => {
    const key = scopedThreadKey(scope);
    set((state) =>
      updateScope(state, key, (current) => ({
        ...current,
        history: boundedHistory([
          entry,
          ...current.history.filter((candidate) => candidate.id !== entry.id),
        ]),
      })),
    );
  },
  cancelRun: (scope, runId, detail = "The Jev browser run was cancelled.") => {
    const key = scopedThreadKey(scope);
    const controller = controllersByScope.get(key)?.get(runId);
    controller?.abort();
    controllersByScope.get(key)?.delete(runId);
    const timer = idleTimersByScope.get(key)?.get(runId);
    if (timer) clearTimeout(timer);
    idleTimersByScope.get(key)?.delete(runId);
    const completedAt = new Date().toISOString();
    set((state) =>
      updateScope(state, key, (current) => ({
        ...current,
        activeRunIds: current.activeRunIds.filter((candidate) => candidate !== runId),
        history: current.history.map((entry) =>
          entry.runId === runId && entry.status === "pending"
            ? { ...entry, status: "cancelled", detail, completedAt }
            : entry,
        ),
      })),
    );
    return controller !== undefined;
  },
  cancelEnvironmentRuns: (
    environmentId,
    detail = "Stopped because the environment host disconnected.",
  ) => {
    const state = get();
    const matchingKeys = Object.keys(state.byScope).filter(
      (key) => parseScopedThreadKey(key)?.environmentId === environmentId,
    );
    const runIds = [
      ...new Set(matchingKeys.flatMap((key) => state.byScope[key]?.activeRunIds ?? [])),
    ];
    if (runIds.length === 0) return [];
    for (const key of matchingKeys) abortScope(key);
    const completedAt = new Date().toISOString();
    set((current) => ({
      byScope: Object.fromEntries(
        Object.entries(current.byScope).map(([key, scope]) =>
          matchingKeys.includes(key)
            ? [
                key,
                {
                  ...scope,
                  notice: detail,
                  activeRunIds: [],
                  history: scope.history.map((entry) =>
                    entry.status === "pending"
                      ? { ...entry, status: "cancelled" as const, detail, completedAt }
                      : entry,
                  ),
                },
              ]
            : [key, scope],
        ),
      ),
    }));
    return runIds;
  },
  clearHistory: (scope) => {
    const key = scopedThreadKey(scope);
    set((state) =>
      updateScope(state, key, (current) => ({
        ...current,
        history: current.history.filter((entry) => entry.status === "pending"),
      })),
    );
  },
}));

export function getJevBrowserExecutionMode(scope: ScopedThreadRef): JevBrowserMode {
  const state = useJevBrowserStore.getState().byScope[scopedThreadKey(scope)];
  if (!state?.enabled) return "disabled";
  return state.activeRunIds.length > 0 ? "running" : "idle";
}

export function getJevBrowserStatus(scope: ScopedThreadRef, available: boolean): JevBrowserStatus {
  const mode = getJevBrowserExecutionMode(scope);
  const runId = useJevBrowserStore.getState().byScope[scopedThreadKey(scope)]?.activeRunIds[0];
  return {
    available,
    mode,
    ...(mode === "running" && runId ? { runId } : {}),
  };
}

export function subscribeJevBrowserExecutionMode(
  scope: ScopedThreadRef,
  listener: (mode: JevBrowserMode) => void,
): () => void {
  let previous = getJevBrowserExecutionMode(scope);
  return useJevBrowserStore.subscribe(() => {
    const next = getJevBrowserExecutionMode(scope);
    if (next === previous) return;
    previous = next;
    listener(next);
  });
}

export const jevBrowserHandlerBridge = {
  getExecutionMode: getJevBrowserExecutionMode,
  getStatus: getJevBrowserStatus,
  subscribeExecutionMode: subscribeJevBrowserExecutionMode,
  begin: (
    scope: ScopedThreadRef,
    input: Pick<JevBrowserHistoryEntry, "id" | "runId" | "label" | "startedAt">,
  ) => useJevBrowserStore.getState().begin(scope, input),
  complete: (
    scope: ScopedThreadRef,
    id: string,
    input: Pick<JevBrowserHistoryEntry, "status" | "cost" | "completedAt" | "detail">,
  ) => useJevBrowserStore.getState().complete(scope, id, input),
  record: (scope: ScopedThreadRef, entry: JevBrowserHistoryEntry) =>
    useJevBrowserStore.getState().record(scope, entry),
  cancelRun: (scope: ScopedThreadRef, runId: string, detail?: string) =>
    useJevBrowserStore.getState().cancelRun(scope, runId, detail),
  cancelEnvironmentRuns: (environmentId: EnvironmentId, detail?: string) =>
    useJevBrowserStore.getState().cancelEnvironmentRuns(environmentId, detail),
} as const;

export function jevBrowserDecisionCost(result: JevBrowserDecideResult): JevBrowserHistoryCost {
  return result.accounting.costUsd === null
    ? { kind: "unknown" }
    : { kind: "reported", usd: result.accounting.costUsd };
}

export function resetJevBrowserStoreForTests() {
  for (const key of controllersByScope.keys()) abortScope(key);
  useJevBrowserStore.setState({ byScope: {} });
}
