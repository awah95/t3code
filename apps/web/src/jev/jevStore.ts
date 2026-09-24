import { sanitizeJevText } from "@t3tools/shared/jevRouting";
import type {
  JevRouteRequest,
  JevRouteResult,
  JevRoutingContext,
  JevSubagentPolicy,
  CodexLedgerJevReceiptInput,
} from "@t3tools/contracts";
import { create } from "zustand";
import { isElectron } from "../env";
import { jevUsdDecimal, queueJevLedgerReceipt } from "./jevLedgerReceipts";

type ReceiptContext = { environmentId: string; projectId: string | null; threadId: string };
type CancellationTarget =
  | Pick<ReceiptContext, "environmentId" | "threadId">
  | { requestId: string };
type SideRoutingMode = "auto" | "manual";
const sideRoutingStorageKey = "t3:jev-side-routing-modes:v1";
const sideRoutingKey = (environmentId: string, threadId: string) =>
  JSON.stringify([environmentId, threadId]);

function loadSideRoutingModes(): Record<string, "manual"> {
  try {
    const stored = globalThis.localStorage?.getItem(sideRoutingStorageKey);
    const parsed: unknown = stored ? JSON.parse(stored) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const modes: Record<string, "manual"> = {};
    for (const [key, value] of Object.entries(parsed)) if (value === "manual") modes[key] = value;
    return modes;
  } catch {
    return {};
  }
}

function saveSideRoutingModes(modes: Record<string, "manual">): void {
  try {
    globalThis.localStorage?.setItem(sideRoutingStorageKey, JSON.stringify(modes));
  } catch {
    useJevStore.setState({ notice: "Could not save this side chat's routing preference." });
  }
}
const subagentReceiptContexts = new Map<string, ReceiptContext>();

function dispatchMatchesReceiptContext(call: JevCall, dispatch: NonNullable<JevCall["dispatch"]>) {
  const context = call.receiptContext;
  return (
    !context ||
    (context.threadId === dispatch.threadId &&
      (dispatch.environmentId === undefined || context.environmentId === dispatch.environmentId) &&
      (dispatch.projectId === undefined || context.projectId === dispatch.projectId))
  );
}

export interface JevCall {
  id: string;
  createdAt: string;
  request: JevRouteRequest;
  result: JevRouteResult | null;
  status:
    | "pending"
    | "awaiting-review"
    | "approved"
    | "blocked"
    | "dispatch-failed"
    | "prepared"
    | "routed"
    | "fallback"
    | "cancelled"
    | "skipped";
  decision?: "suggestion" | "current" | "alternative";
  approvedChoice?: string | null;
  notice: string | null;
  kind?: "turn" | "subagent";
  receiptContext?: ReceiptContext | undefined;
  threadLabel?: string | undefined;
  toolUseId?: string | undefined;
  attemptId?: string | undefined;
  parentProviderTurnId?: string | undefined;
  receiptStorageError?: boolean | undefined;
  dispatch?: {
    model: string;
    effort?: string | undefined;
    threadId: string;
    messageId?: string;
    environmentId?: string;
    projectId?: string | null;
    turnId?: string | null;
    dispatchId?: string | null;
    succeeded: boolean | null;
  };
}

type SubagentPolicy = JevSubagentPolicy;
const subagentPolicies = new Map<string, SubagentPolicy>();
const pendingTurnRequests = new Map<string, ReceiptContext | undefined>();
const cancelledTurnRequests = new Set<string>();
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

export async function registerJevSubagentPolicy(
  policy: SubagentPolicy,
  receiptContext?: ReceiptContext,
): Promise<void> {
  if (!isElectron || !window.desktopBridge?.setJevSubagentPolicy) return;
  if (receiptContext) subagentReceiptContexts.set(policy.threadId, receiptContext);
  const persistedPolicy: SubagentPolicy = receiptContext
    ? { ...policy, ledgerContext: { ...receiptContext, sourceScope: "subagent" } }
    : policy;
  const initialized = initializeSubagentPolicies();
  if (JSON.stringify(subagentPolicies.get(policy.threadId)) === JSON.stringify(persistedPolicy)) {
    void replayJevSubagentReceipts();
    return;
  }
  subagentPolicies.set(policy.threadId, persistedPolicy);
  try {
    await queuePolicyOperation(async () => {
      await initialized;
      if (
        policy.enabled &&
        !(useJevStore.getState().enabled && useJevStore.getState().subagentsEnabled)
      )
        return;
      await window.desktopBridge?.setJevSubagentPolicy?.(persistedPolicy);
    });
  } catch (error) {
    if (subagentPolicies.get(policy.threadId) === persistedPolicy)
      subagentPolicies.delete(policy.threadId);
    throw error;
  }
  void replayJevSubagentReceipts();
}

async function replayJevSubagentReceipts(): Promise<void> {
  try {
    for (const event of (await window.desktopBridge?.listJevSubagentReceipts?.()) ?? []) {
      if (event.ledgerContext || subagentReceiptContexts.has(event.threadId))
        handleSubagentDecision(event);
      else useJevStore.setState({ notice: "A legacy Jev receipt awaits its thread context." });
    }
  } catch {
    useJevStore.setState({ notice: "Could not replay pending Jev accounting receipts." });
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
  window.desktopBridge.onJevSubagentDecision(handleSubagentDecision);
  void replayJevSubagentReceipts();
}

function handleSubagentDecision(event: import("@t3tools/contracts").JevSubagentDecision) {
  if (event.receiptStorageError)
    useJevStore.setState({ notice: "Desktop could not retain a Jev accounting receipt." });
  const request = { ...event.request, prompt: sanitizeJevPrompt(event.request.prompt) };
  const mainTurn = event.ledgerContext?.sourceScope === "turn";
  const receiptContext = mainTurn
    ? event.ledgerContext
    : (event.ledgerContext ?? subagentReceiptContexts.get(event.threadId));
  if (event.receiptStorageError && event.result === null) {
    // A desktop outbox gap has no routing result or known charge, but must reach the ledger.
    recordJevReceipt({
      id: request.requestId,
      createdAt: new Date().toISOString(),
      request,
      result: null,
      status: "pending",
      notice: null,
      kind: mainTurn ? "turn" : "subagent",
      receiptContext,
      attemptId: event.attemptId,
      receiptStorageError: true,
    });
    return;
  }
  const store = useJevStore.getState();
  if (event.result === null)
    store.addCall({
      id: request.requestId,
      createdAt: new Date().toISOString(),
      request,
      result: null,
      status: "pending",
      notice: null,
      kind: mainTurn ? "turn" : "subagent",
      receiptContext,
      toolUseId: event.toolUseId,
      attemptId: event.attemptId,
      parentProviderTurnId: event.parentProviderTurnId,
      receiptStorageError: event.receiptStorageError,
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
        kind: mainTurn ? "turn" : "subagent",
        receiptContext,
        toolUseId: event.toolUseId,
        attemptId: event.attemptId,
        parentProviderTurnId: event.parentProviderTurnId,
        receiptStorageError: event.receiptStorageError,
      });
    useJevStore.getState().finishCall(request.requestId, event.result);
    const finalCall = useJevStore.getState().calls.find((call) => call.id === request.requestId);
    if (finalCall) recordJevReceipt(finalCall, event.dispatchModel, event.dispatchEffort);
  }
}

function recordJevReceipt(call: JevCall, dispatchModel?: string, dispatchEffort?: string): boolean {
  const context = call.receiptContext;
  if (!context) return false;
  const result = call.result;
  const dispatch = call.dispatch;
  const status: CodexLedgerJevReceiptInput["status"] = dispatch
    ? dispatch.succeeded === true
      ? "dispatched"
      : dispatch.succeeded === false
        ? "failed"
        : "proposed"
    : call.status === "cancelled"
      ? "cancelled"
      : result
        ? "completed"
        : "proposed";
  const input: CodexLedgerJevReceiptInput = {
    requestId: call.id,
    attemptId: call.attemptId ?? call.id,
    rootTurnId: dispatch?.turnId ?? null,
    toolUseId: call.toolUseId ?? null,
    environmentId: context.environmentId,
    projectId: context.projectId,
    threadId: context.threadId,
    messageId: dispatch?.messageId ?? null,
    turnId: dispatch?.turnId ?? null,
    providerThreadId: null,
    providerTurnId: null,
    childProviderThreadId: null,
    parentProviderTurnId: call.parentProviderTurnId ?? null,
    dispatchId: dispatch?.dispatchId ?? null,
    observedModel: null,
    sourceScope: call.kind === "subagent" ? "subagent" : "turn",
    decisionJson: JSON.stringify({
      beforeModel: call.request.context.currentModel ?? null,
      beforeEffort: call.request.context.currentEffort ?? null,
      proposedChoice: result?.proposedChoice ?? result?.recommendedChoice ?? result?.choice ?? null,
      appliedChoice: result?.choice ?? null,
      approvedChoice: call.approvedChoice ?? null,
      reviewAction: call.decision ?? null,
      policyOutcome: result?.policyOutcome ?? null,
      policyVersion: result?.policyVersion ?? null,
      responseModel: result?.responseModel ?? null,
      requestFingerprint: result?.requestFingerprint ?? null,
      costKind: result?.costKind ?? "unknown",
      inputTokens: result?.inputTokens ?? null,
      outputTokens: result?.outputTokens ?? null,
    }),
    dispatchJson:
      dispatch || dispatchModel
        ? JSON.stringify({
            model: dispatch?.model ?? dispatchModel,
            effort: dispatch?.effort ?? dispatchEffort ?? null,
            accepted: dispatch?.succeeded ?? null,
            brokerSelected: dispatchModel !== undefined,
          })
        : null,
    reportedCostUsd: result?.costKind === "billed" ? jevUsdDecimal(result.costUsd ?? null) : null,
    estimatedCostUsd:
      result?.costKind === "estimated" ? jevUsdDecimal(result.costUsd ?? null) : null,
    status,
    receiptStorageError: call.receiptStorageError ?? result?.receiptStorageError ?? false,
  };
  const persisted = queueJevLedgerReceipt({ environmentId: context.environmentId, input });
  if (!persisted) {
    useJevStore.setState({ notice: "Jev accounting receipt could not be saved locally." });
  }
  return persisted;
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
  sideRoutingModes: Record<string, "manual">;
  getSideRoutingMode: (environmentId: string, threadId: string) => SideRoutingMode;
  setSideRoutingMode: (environmentId: string, threadId: string, mode: SideRoutingMode) => void;
  setEnabled: (enabled: boolean) => void;
  setPanelOpen: (open: boolean) => void;
  pinManual: () => void;
  addCall: (call: JevCall) => void;
  finishCall: (id: string, result: JevRouteResult, cancelled?: boolean) => void;
  recordPreparedDispatch: (id: string, dispatch: NonNullable<JevCall["dispatch"]>) => boolean;
  recordDispatch: (id: string, dispatch: NonNullable<JevCall["dispatch"]>) => void;
  clearCalls: () => void;
  cancelPending: (target?: CancellationTarget) => void;
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
          : "Automatic routing enabled; uncertain or unavailable decisions pause sending.",
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
    if (
      action === "suggestion" &&
      selected &&
      call.result?.admissibleCandidateKeys &&
      !call.result.admissibleCandidateKeys.includes(selected)
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
  sideRoutingModes: loadSideRoutingModes(),
  getSideRoutingMode: (environmentId, threadId) =>
    get().sideRoutingModes[sideRoutingKey(environmentId, threadId)] ?? "auto",
  setSideRoutingMode: (environmentId, threadId, mode) => {
    const key = sideRoutingKey(environmentId, threadId);
    const sideRoutingModes = { ...get().sideRoutingModes };
    if (mode === "manual") sideRoutingModes[key] = "manual";
    else delete sideRoutingModes[key];
    set({ sideRoutingModes });
    saveSideRoutingModes(sideRoutingModes);
  },
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
      billedUsd:
        get().billedUsd +
        (get().calls.find((call) => call.id === id)?.result
          ? 0
          : result.costKind === "billed"
            ? (result.costUsd ?? 0)
            : 0),
      estimatedUsd:
        get().estimatedUsd +
        (get().calls.find((call) => call.id === id)?.result
          ? 0
          : result.costKind === "estimated"
            ? (result.costUsd ?? 0)
            : 0),
      unknownCostCalls:
        get().unknownCostCalls +
        (get().calls.find((call) => call.id === id)?.result
          ? 0
          : result.costKind === "unknown"
            ? 1
            : 0),
      calls: get().calls.map((call) =>
        call.id === id
          ? {
              ...call,
              result,
              status: cancelled ? "cancelled" : result.choice ? "approved" : "blocked",
              notice: cancelled ? "Routing cancelled. Message was not sent." : result.error,
            }
          : call,
      ),
      notice: cancelled ? "Routing cancelled. Message was not sent." : result.error,
    }),
  recordPreparedDispatch: (id, dispatch) => {
    const call = get().calls.find((entry) => entry.id === id);
    if (!call || !dispatchMatchesReceiptContext(call, dispatch)) return false;
    const prepared = {
      ...call,
      dispatch: { ...dispatch, succeeded: null },
      status: "prepared" as const,
    };
    set({ calls: get().calls.map((entry) => (entry.id === id ? prepared : entry)) });
    return recordJevReceipt(prepared);
  },
  recordDispatch: (id, dispatch) => {
    const current = get().calls.find((call) => call.id === id);
    if (!current || !dispatchMatchesReceiptContext(current, dispatch)) return;
    set({
      calls: get().calls.map((call) =>
        call.id === id
          ? {
              ...call,
              dispatch,
              status: dispatch.succeeded ? "routed" : "dispatch-failed",
              notice: dispatch.succeeded
                ? "Executor dispatch accepted."
                : "Executor dispatch failed.",
            }
          : call,
      ),
    });
    const call = get().calls.find((entry) => entry.id === id);
    if (call) recordJevReceipt(call);
  },
  clearCalls: () =>
    set({
      calls: get().calls.filter(
        (call) => call.status === "pending" || call.status === "awaiting-review",
      ),
    }),
  cancelPending: (target) => {
    const matches = (id: string, context: ReceiptContext | undefined) =>
      target === undefined ||
      ("requestId" in target
        ? id === target.requestId
        : context?.environmentId === target.environmentId && context.threadId === target.threadId);
    const cancelledIds = new Set(
      get()
        .calls.filter(
          (call) =>
            call.kind !== "subagent" &&
            (call.status === "pending" || call.status === "awaiting-review") &&
            matches(call.id, call.receiptContext),
        )
        .map((call) => call.id),
    );
    for (const [id, resolve] of pendingReviews) {
      if (!cancelledIds.has(id)) continue;
      pendingReviews.delete(id);
      resolve(null);
    }
    for (const id of cancelledIds) cancelledTurnRequests.add(id);
    set({
      calls: get().calls.map((call) =>
        cancelledIds.has(call.id)
          ? { ...call, status: "cancelled", notice: "Review cancelled. Message was not sent." }
          : call,
      ),
    });
    if (isElectron)
      for (const [id, context] of pendingTurnRequests) {
        if (matches(id, context)) void window.desktopBridge?.cancelJevRoute?.(id);
      }
    if (target === undefined) set({ revision: get().revision + 1 });
  },
}));

/** Attribute only acknowledged sends whose durable user message has an actual turn id. */
export function jevPriorAttempts(
  threadId: string,
  messages: readonly { id: string; turnId: string | null }[],
): NonNullable<JevRoutingContext["priorAttempts"]> {
  return useJevStore.getState().calls.flatMap((call) => {
    const dispatch = call.dispatch;
    if (!dispatch?.succeeded || dispatch.threadId !== threadId || !dispatch.messageId) return [];
    const turnId = messages.find((message) => message.id === dispatch.messageId)?.turnId;
    return turnId
      ? [
          {
            turnId,
            model: dispatch.model,
            ...(dispatch.effort ? { effort: dispatch.effort } : {}),
            outcome: "dispatch_accepted",
          },
        ]
      : [];
  });
}

/** Redact common credentials without shortening the current request. */
export const sanitizeJevPrompt = sanitizeJevText;

export async function decideWithJev(
  request: JevRouteRequest,
  receiptContext?: ReceiptContext,
  threadLabel?: string,
): Promise<JevRouteResult | null> {
  const store = useJevStore.getState();
  if (!isElectron || !store.enabled) return null;
  const revision = store.revision;
  pendingTurnRequests.set(request.requestId, receiptContext);
  store.addCall({
    id: request.requestId,
    createdAt: new Date().toISOString(),
    request,
    result: null,
    status: "pending",
    notice: null,
    receiptContext,
    threadLabel,
    kind: "turn",
  });
  let result: JevRouteResult;
  try {
    if (!window.desktopBridge?.decideJevRoute) throw new Error("Desktop routing unavailable");
    result = await window.desktopBridge.decideJevRoute(
      request,
      receiptContext ? { ...receiptContext, sourceScope: "turn" } : undefined,
    );
    if (result.receiptStorageError)
      useJevStore.setState({ notice: "Desktop could not retain a Jev accounting receipt." });
  } catch {
    result = {
      choice: null,
      confidence: null,
      probabilities: {},
      latencyMs: 0,
      error: "Jev is unavailable. Sending paused.",
      policyOutcome: "unavailable",
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      costKind: "unknown",
    };
  } finally {
    pendingTurnRequests.delete(request.requestId);
  }
  const cancelled =
    useJevStore.getState().revision !== revision || cancelledTurnRequests.has(request.requestId);
  useJevStore.getState().finishCall(request.requestId, result, cancelled);
  const completedCall = useJevStore.getState().calls.find((call) => call.id === request.requestId);
  if (completedCall) recordJevReceipt(completedCall);
  if (cancelled) {
    cancelledTurnRequests.delete(request.requestId);
    return null;
  }
  const automaticChoiceAllowed =
    result.choice !== null &&
    (!result.policyOutcome || result.policyOutcome === "route") &&
    request.candidates.some((candidate) => candidate.key === result.choice) &&
    (!result.admissibleCandidateKeys || result.admissibleCandidateKeys.includes(result.choice));
  if (store.mode !== "guided" && automaticChoiceAllowed) return result;
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
  if (
    !resolution ||
    useJevStore.getState().revision !== revision ||
    cancelledTurnRequests.has(request.requestId)
  ) {
    cancelledTurnRequests.delete(request.requestId);
    return null;
  }
  cancelledTurnRequests.delete(request.requestId);
  useJevStore.setState((state) => ({
    calls: state.calls.map((call) =>
      call.id === request.requestId
        ? {
            ...call,
            status: "approved",
            decision: resolution.action,
            approvedChoice: resolution.choice,
            notice: resolution.choice
              ? resolution.action === "alternative"
                ? "Alternative explicitly approved; user bypasses routing policy."
                : "Policy recommendation approved for sending."
              : "Current model explicitly approved; user bypasses routing policy.",
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
