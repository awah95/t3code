import { sanitizeJevText } from "@t3tools/shared/jevRouting";
import type { JevRouteRequest, JevRouteResult, JevSubagentPolicy } from "@t3tools/contracts";
import { create } from "zustand";
import { isElectron } from "../env";

export interface JevCall {
  id: string;
  createdAt: string;
  request: JevRouteRequest;
  result: JevRouteResult | null;
  status: "pending" | "awaiting-review" | "routed" | "fallback" | "cancelled" | "skipped";
  decision?: "suggestion" | "current" | "alternative";
  approvedChoice?: string | null;
  notice: string | null;
  kind?: "turn" | "subagent";
}

type SubagentPolicy = JevSubagentPolicy;
const subagentPolicies = new Map<string, SubagentPolicy>();
const pendingTurnRequests = new Set<string>();
type ReviewResolution = { action: "suggestion" | "current" | "alternative"; choice: string | null };
const pendingReviews = new Map<string, (resolution: ReviewResolution | null) => void>();
let listeningForSubagents = false;
let policyInitialization: Promise<void> | null = null;
let policyQueue = Promise.resolve();

function queuePolicyOperation(operation: () => Promise<void>): Promise<void> {
  const next = policyQueue.then(operation);
  policyQueue = next.catch(() => undefined);
  return next;
}

function initializeSubagentPolicies(): Promise<void> {
  policyInitialization ??= queuePolicyOperation(async () => {
    await window.desktopBridge?.clearJevSubagentPolicies?.();
  });
  return policyInitialization;
}

export async function registerJevSubagentPolicy(policy: SubagentPolicy): Promise<void> {
  if (!isElectron || !window.desktopBridge?.setJevSubagentPolicy) return;
  const initialized = initializeSubagentPolicies();
  if (JSON.stringify(subagentPolicies.get(policy.threadId)) === JSON.stringify(policy)) return;
  subagentPolicies.set(policy.threadId, policy);
  try {
    await queuePolicyOperation(async () => {
      await initialized;
      if (
        policy.enabled &&
        !(useJevStore.getState().enabled && useJevStore.getState().subagentsEnabled)
      )
        return;
      await window.desktopBridge?.setJevSubagentPolicy?.(policy);
    });
  } catch (error) {
    if (subagentPolicies.get(policy.threadId) === policy) subagentPolicies.delete(policy.threadId);
    throw error;
  }
}

function disableSubagentPolicies() {
  if (isElectron && window.desktopBridge?.clearJevSubagentPolicies) {
    const initialized = initializeSubagentPolicies();
    subagentPolicies.clear();
    void queuePolicyOperation(async () => {
      await initialized;
      await window.desktopBridge?.clearJevSubagentPolicies?.();
    }).catch(() =>
      useJevStore.setState({
        notice: "Could not disable subagent routing. Stop the Codex turn before continuing.",
      }),
    );
    return;
  }
  for (const policy of subagentPolicies.values()) {
    void registerJevSubagentPolicy({ ...policy, enabled: false }).catch(() => {
      useJevStore.setState({
        notice:
          "Could not disable a subagent routing policy. Stop its Codex turn before continuing.",
      });
    });
  }
}

export function listenForJevSubagents() {
  if (isElectron)
    void initializeSubagentPolicies().catch(() =>
      useJevStore.setState({ notice: "Could not initialize safe subagent routing state." }),
    );
  if (listeningForSubagents || !isElectron || !window.desktopBridge?.onJevSubagentDecision) return;
  listeningForSubagents = true;
  window.desktopBridge.onJevSubagentDecision((event) => {
    const request = { ...event.request, prompt: sanitizeJevPrompt(event.request.prompt) };
    const store = useJevStore.getState();
    if (event.result === null)
      store.addCall({
        id: request.requestId,
        createdAt: new Date().toISOString(),
        request,
        result: null,
        status: "pending",
        notice: null,
        kind: "subagent",
      });
    else {
      if (!store.calls.some((call) => call.id === request.requestId))
        store.addCall({
          id: request.requestId,
          createdAt: new Date().toISOString(),
          request,
          result: null,
          status: "pending",
          notice: null,
          kind: "subagent",
        });
      useJevStore.getState().finishCall(request.requestId, event.result);
    }
  });
}

export const useJevStore = create<{
  enabled: boolean;
  mode: "guided" | "auto";
  setMode: (mode: "guided" | "auto") => void;
  resolveReview: (
    id: string,
    action: "suggestion" | "current" | "alternative",
    choice?: string,
  ) => void;
  subagentsEnabled: boolean;
  setSubagentsEnabled: (enabled: boolean) => void;
  panelOpen: boolean;
  revision: number;
  calls: JevCall[];
  notice: string | null;
  billedUsd: number;
  estimatedUsd: number;
  unknownCostCalls: number;
  setEnabled: (enabled: boolean) => void;
  setPanelOpen: (open: boolean) => void;
  pinManual: () => void;
  addCall: (call: JevCall) => void;
  finishCall: (id: string, result: JevRouteResult, cancelled?: boolean) => void;
  clearCalls: () => void;
  cancelPending: () => void;
}>((set, get) => ({
  enabled: false,
  mode: "guided",
  setMode: (mode) => {
    get().cancelPending();
    set({
      mode,
      notice:
        mode === "guided"
          ? "Guided mode: review each recommendation before sending."
          : "Automatic routing enabled; low confidence retains your current selection.",
    });
  },
  resolveReview: (id, action, choice) => {
    const call = get().calls.find((entry) => entry.id === id && entry.status === "awaiting-review");
    const resolve = pendingReviews.get(id);
    if (!call || !resolve) return;
    const selected =
      action === "current"
        ? null
        : action === "suggestion"
          ? (call.result?.recommendedChoice ?? call.result?.choice)
          : choice;
    if (
      action !== "current" &&
      (!selected || !call.request.candidates.some((candidate) => candidate.key === selected))
    )
      return;
    pendingReviews.delete(id);
    resolve({ action, choice: selected ?? null });
  },
  subagentsEnabled: false,
  panelOpen: false,
  revision: 0,
  calls: [],
  notice: null,
  billedUsd: 0,
  estimatedUsd: 0,
  unknownCostCalls: 0,
  setEnabled: (enabled) => {
    get().cancelPending();
    if (!enabled) disableSubagentPolicies();
    set({
      enabled,
      revision: get().revision + 1,
      notice: enabled
        ? "Jev Auto enabled. Task text, recent chat history and plan context are sent to OpenRouter for routing."
        : "Jev Auto is off.",
    });
  },
  setSubagentsEnabled: (subagentsEnabled) => {
    if (!subagentsEnabled) disableSubagentPolicies();
    set({ subagentsEnabled });
  },
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  pinManual: () => {
    if (!get().enabled) return;
    get().cancelPending();
    disableSubagentPolicies();
    set({
      enabled: false,
      revision: get().revision + 1,
      notice: "Manual model pinned. Enable Jev Auto to resume routing.",
    });
  },
  addCall: (call) =>
    set({
      calls: [call, ...get().calls].filter(
        (entry, index) =>
          index < 50 || entry.status === "awaiting-review" || entry.status === "pending",
      ),
      notice: call.notice,
    }),
  finishCall: (id, result, cancelled = false) =>
    set({
      billedUsd: get().billedUsd + (result.costKind === "billed" ? (result.costUsd ?? 0) : 0),
      estimatedUsd:
        get().estimatedUsd + (result.costKind === "estimated" ? (result.costUsd ?? 0) : 0),
      unknownCostCalls: get().unknownCostCalls + (result.costKind === "unknown" ? 1 : 0),
      calls: get().calls.map((call) =>
        call.id === id
          ? {
              ...call,
              result,
              status: cancelled ? "cancelled" : result.choice ? "routed" : "fallback",
              notice: cancelled ? "Routing cancelled. Message was not sent." : result.error,
            }
          : call,
      ),
      notice: cancelled ? "Routing cancelled. Message was not sent." : result.error,
    }),
  clearCalls: () =>
    set({
      calls: get().calls.filter(
        (call) => call.status === "pending" || call.status === "awaiting-review",
      ),
    }),
  cancelPending: () => {
    for (const resolve of pendingReviews.values()) resolve(null);
    pendingReviews.clear();
    set({
      calls: get().calls.map((call) =>
        call.status === "awaiting-review"
          ? { ...call, status: "cancelled", notice: "Review cancelled. Message was not sent." }
          : call,
      ),
    });
    if (!isElectron) return;
    for (const id of pendingTurnRequests) {
      void window.desktopBridge?.cancelJevRoute?.(id);
    }
    set({ revision: get().revision + 1 });
  },
}));

/** Redact common credentials without shortening the current request. */
export const sanitizeJevPrompt = sanitizeJevText;

export async function decideWithJev(request: JevRouteRequest): Promise<JevRouteResult | null> {
  const store = useJevStore.getState();
  if (!isElectron || !store.enabled) return null;
  const revision = store.revision;
  pendingTurnRequests.add(request.requestId);
  store.addCall({
    id: request.requestId,
    createdAt: new Date().toISOString(),
    request,
    result: null,
    status: "pending",
    notice: null,
  });
  let result: JevRouteResult;
  try {
    if (!window.desktopBridge?.decideJevRoute) throw new Error("Desktop routing unavailable");
    result = await window.desktopBridge.decideJevRoute(request);
  } catch {
    result = {
      choice: null,
      confidence: null,
      probabilities: {},
      latencyMs: 0,
      error: "Jev is unavailable; using the selected model.",
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      costKind: "unknown",
    };
  } finally {
    pendingTurnRequests.delete(request.requestId);
  }
  const cancelled = useJevStore.getState().revision !== revision;
  useJevStore.getState().finishCall(request.requestId, result, cancelled);
  if (cancelled) return null;
  if (store.mode !== "guided") return result;
  const resolution = await new Promise<ReviewResolution | null>((resolve) => {
    pendingReviews.set(request.requestId, resolve);
    useJevStore.setState((state) => ({
      panelOpen: true,
      notice: "Review Jev's recommendation before the message is sent.",
      calls: state.calls.map((call) =>
        call.id === request.requestId ? { ...call, status: "awaiting-review" } : call,
      ),
    }));
  });
  if (!resolution || useJevStore.getState().revision !== revision) return null;
  useJevStore.setState((state) => ({
    calls: state.calls.map((call) =>
      call.id === request.requestId
        ? {
            ...call,
            status: resolution.choice ? "routed" : "fallback",
            decision: resolution.action,
            approvedChoice: resolution.choice,
            notice: resolution.choice
              ? "Selection approved for sending."
              : "Current model selected for sending.",
          }
        : call,
    ),
    notice: null,
  }));
  return {
    ...result,
    choice: resolution.choice,
    error: resolution.choice ? null : "Using your current model by your choice.",
  };
}
