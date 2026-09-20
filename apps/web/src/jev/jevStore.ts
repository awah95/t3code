import type { JevRouteRequest, JevRouteResult } from "@t3tools/contracts";
import { create } from "zustand";
import { isElectron } from "../env";

export interface JevCall {
  id: string;
  createdAt: string;
  request: JevRouteRequest;
  result: JevRouteResult | null;
  status: "pending" | "routed" | "fallback" | "cancelled" | "skipped";
  notice: string | null;
  kind?: "turn" | "subagent";
}

type SubagentPolicy = {
  threadId: string;
  providerInstanceId: string;
  enabled: boolean;
  candidates: { key: string; description: string }[];
};
const subagentPolicies = new Map<string, SubagentPolicy>();
const pendingTurnRequests = new Set<string>();
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
        ? "Jev Auto enabled. Task text is sent to OpenRouter for routing."
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
  addCall: (call) => set({ calls: [call, ...get().calls].slice(0, 50), notice: call.notice }),
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
  clearCalls: () => set({ calls: get().calls.filter((call) => call.status === "pending") }),
  cancelPending: () => {
    if (!isElectron) return;
    for (const id of pendingTurnRequests) {
      void window.desktopBridge?.cancelJevRoute?.(id);
    }
    set({ revision: get().revision + 1 });
  },
}));

/** Send only task text, never attachment bodies, terminal output or full history. */
export function sanitizeJevPrompt(prompt: string): string {
  return prompt
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      "[private key redacted]",
    )
    .replace(
      /\b(?:sk-[a-zA-Z0-9_-]{8,}|gh[pousr]_[a-zA-Z0-9_]{8,}|AKIA[A-Z0-9]{16})\b/g,
      "[credential redacted]",
    )
    .replace(/Bearer\s+[a-zA-Z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(
      /\b(api[_-]?key|authorization|password|secret|token)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    )
    .slice(0, 12_000);
}

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
  return cancelled ? null : result;
}
