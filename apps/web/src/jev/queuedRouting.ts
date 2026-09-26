import type { ConnectionTarget } from "@t3tools/client-runtime/connection";
import type {
  EnvironmentThread,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { ModelSelection, ScopedThreadRef, ServerConfig } from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import { isJevCandidateAllowed } from "@t3tools/shared/jevRouting";

import { isDesktopLocalConnectionTarget } from "../connection/desktopLocal";
import { isElectron } from "../env";
import { randomUUID } from "../lib/utils";
import { applyProviderInstanceSettings, deriveProviderInstanceEntries } from "../providerInstances";
import { useQueuedMessageStore, type QueuedComposerMessage } from "../queuedMessageStore";
import { isMediaOnlyJevTurn } from "./context";
import { decideWithJev, jevPriorAttempts, useJevStore } from "./jevStore";
import { prepareJevTurn } from "./routing";

export interface QueuedJevContext {
  settings: UnifiedSettings;
  environmentTarget: ConnectionTarget;
}

/** Decide at dispatch time, after the queue has claimed the message exactly once. */
export async function routeQueuedJevTurn(input: {
  threadRef: ScopedThreadRef;
  threadKey: string;
  message: QueuedComposerMessage;
  text: string;
  outgoingContext: Parameters<typeof isMediaOnlyJevTurn>[0]["context"];
  thread: EnvironmentThread | null;
  shell: EnvironmentThreadShell | null;
  config: ServerConfig | undefined;
  readConfig: () => ServerConfig | undefined;
  context?: QueuedJevContext;
  onReviewPending?: () => void;
}): Promise<{ modelSelection: ModelSelection; requestId: string | null }> {
  const { environmentId, threadId } = input.threadRef;
  const store = useJevStore.getState();
  const current = input.message.sendSettings.modelSelection;
  if (!isElectron || !store.getThreadEnabled(environmentId, threadId)) {
    return { modelSelection: current, requestId: null };
  }
  if (input.message.sendSettings.explicitModelSelection) {
    return { modelSelection: current, requestId: null };
  }
  const provider = input.config?.providers.find((entry) => entry.instanceId === current.instanceId);
  if (
    input.text.trimStart().startsWith("/") ||
    isMediaOnlyJevTurn({
      attachmentCount: input.message.images.length + input.message.files.length,
      context: input.outgoingContext,
      prompt: input.text,
    })
  ) {
    return { modelSelection: current, requestId: null };
  }
  if (input.config && provider?.driver !== "codex") {
    return { modelSelection: current, requestId: null };
  }
  if (!input.thread || !input.shell || !input.config)
    throw new Error("Jev routing needs this thread's current state. Use Send now to retry.");
  if (!input.context)
    throw new Error("Jev routing context is unavailable. Open this chat to retry.");
  const local =
    input.context.environmentTarget._tag === "PrimaryConnectionTarget" ||
    isDesktopLocalConnectionTarget(input.context.environmentTarget);
  if (!local) return { modelSelection: current, requestId: null };
  const providers = applyProviderInstanceSettings(
    deriveProviderInstanceEntries(input.config.providers),
    input.context.settings,
  );
  const requestId = randomUUID();
  const { request, candidates } = prepareJevTurn({
    requestId,
    providers,
    settings: input.context.settings,
    priorAttempts: jevPriorAttempts(threadId, input.thread.messages),
    messages: input.thread.messages,
    prompt: input.text,
    outgoingContext: input.outgoingContext,
    historyCompleteness: "windowed",
    current,
    candidateCurrent: input.thread.session ? input.shell.modelSelection : current,
    sessionInstanceId: input.thread.session?.providerInstanceId ?? null,
    hasStartedSession: input.thread.session !== null || input.thread.messages.length > 0,
    existingSession: input.thread.session !== null,
    interactionMode: input.message.sendSettings.interactionMode,
    plans: input.thread.proposedPlans,
  });
  if (candidates.length === 0) {
    throw new Error(
      "No supported Jev model and effort pair is available. Review the queued message.",
    );
  }
  const unsubscribe = useQueuedMessageStore.subscribe((queue) => {
    if (!queue.queuesByThreadKey[input.threadKey]?.some((entry) => entry.id === input.message.id)) {
      useJevStore.getState().cancelPending({ requestId });
    }
  });
  let decision;
  try {
    decision = await decideWithJev(
      request,
      { environmentId, projectId: input.shell.projectId, threadId },
      input.shell.title,
      input.onReviewPending,
    );
  } finally {
    unsubscribe();
  }
  if (!decision) throw new Error("Jev routing was cancelled. Use Send now to retry.");
  const approval = useJevStore.getState().calls.find((call) => call.id === requestId)?.decision;
  const chosen = candidates.find((candidate) => candidate.key === decision.choice);
  if (approval === "current") return { modelSelection: current, requestId };
  if (!chosen || (approval !== "alternative" && !isJevCandidateAllowed(chosen, request.context))) {
    throw new Error("The Jev selection is no longer supported. Use Send now to retry.");
  }
  const live = input
    .readConfig()
    ?.providers.find((entry) => entry.instanceId === chosen.selection.instanceId);
  const model = live?.models.find((entry) => entry.slug === chosen.selection.model);
  const efforts = model?.capabilities?.optionDescriptors?.find(
    (descriptor) => descriptor.id === "reasoningEffort",
  );
  if (
    !live ||
    live.status !== "ready" ||
    live.enabled === false ||
    live.availability === "unavailable" ||
    efforts?.type !== "select" ||
    !efforts.options.some((option) => option.id === chosen.effort)
  ) {
    throw new Error("The routed model became unavailable. Use Send now to retry.");
  }
  return { modelSelection: chosen.selection, requestId };
}
