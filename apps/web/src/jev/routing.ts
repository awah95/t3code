import {
  describeJevCandidate,
  JEV_MODEL_PROFILES,
  sanitizeJevText,
} from "@t3tools/shared/jevRouting";
import type { JevEffort, JevRouteRequest, ModelSelection } from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import type { ProviderInstanceEntry } from "../providerInstances";
import { getAppModelOptionsForInstance } from "../modelSelection";
import { getStartedThreadModelChangeBlockReason } from "../components/ChatView.logic";
import { buildJevContext, textOnlyJevPrompt } from "./context";

type ContextInput = Parameters<typeof buildJevContext>[0];

/** Build the same routing envelope for a main or side thread from that thread's own history. */
export function prepareJevTurn(input: {
  requestId: string;
  prompt: string;
  messages: ContextInput["messages"];
  priorAttempts?: ContextInput["priorAttempts"];
  current: ModelSelection;
  candidateCurrent: ModelSelection;
  providers: readonly ProviderInstanceEntry[];
  settings: UnifiedSettings;
  sessionInstanceId: ModelSelection["instanceId"] | null;
  hasStartedSession: boolean;
  existingSession?: boolean;
  interactionMode: string;
  plans?: ContextInput["plans"];
  outgoingContext?: ContextInput["outgoingContext"];
  historyCompleteness?: ContextInput["historyCompleteness"];
}): { request: JevRouteRequest; candidates: ReturnType<typeof eligibleJevModels> } {
  const provider = input.providers.find((entry) => entry.instanceId === input.current.instanceId);
  const context = buildJevContext({
    messages: input.messages,
    ...(input.priorAttempts ? { priorAttempts: input.priorAttempts } : {}),
    prompt: input.prompt,
    current: input.current,
    existingSession: input.existingSession ?? input.sessionInstanceId !== null,
    interactionMode: input.interactionMode,
    ...(input.plans ? { plans: input.plans } : {}),
    ...(input.outgoingContext ? { outgoingContext: input.outgoingContext } : {}),
    ...(input.historyCompleteness ? { historyCompleteness: input.historyCompleteness } : {}),
    ...(provider?.snapshot.usageLimits ? { usageLimits: provider.snapshot.usageLimits } : {}),
  });
  const candidates = eligibleJevModels({
    providers: input.providers,
    settings: input.settings,
    current: input.candidateCurrent,
    sessionInstanceId: input.sessionInstanceId,
    hasStartedSession: input.hasStartedSession,
  });
  return {
    request: {
      requestId: input.requestId,
      prompt: textOnlyJevPrompt(input.prompt),
      context,
      candidates: candidates.map(({ key, description, model, effort }) => ({
        key,
        model,
        effort,
        description: sanitizeJevText(description),
      })),
    },
    candidates,
  };
}

export function eligibleJevModels(input: {
  providers: readonly ProviderInstanceEntry[];
  settings: UnifiedSettings;
  current: ModelSelection;
  sessionInstanceId: ModelSelection["instanceId"] | null;
  hasStartedSession: boolean;
}) {
  const candidates = [];
  for (const provider of input.providers) {
    if (provider.driverKind !== "codex") continue;
    if (!provider.enabled || !provider.isAvailable || provider.status !== "ready") continue;
    // Keep Auto inside the user's chosen integration, including brand-new threads.
    if (provider.instanceId !== (input.sessionInstanceId ?? input.current.instanceId)) continue;
    for (const model of getAppModelOptionsForInstance(input.settings, provider)) {
      if (
        model.isUnavailable ||
        !JEV_MODEL_PROFILES.some((profile) => profile.model === model.slug)
      )
        continue;
      const descriptor = provider.models
        .find((entry) => entry.slug === model.slug)
        ?.capabilities?.optionDescriptors?.find((option) => option.id === "reasoningEffort");
      if (!descriptor || descriptor.type !== "select") continue;
      const efforts = descriptor.options
        .map((option) => option.id)
        .filter((value): value is JevEffort => ["low", "medium", "high", "xhigh"].includes(value));
      const selection: ModelSelection = { instanceId: provider.instanceId, model: model.slug };
      if (
        getStartedThreadModelChangeBlockReason({
          providers: input.providers.map((entry) => entry.snapshot),
          hasStartedSession: input.hasStartedSession,
          currentModelSelection: input.current,
          currentProviderInstanceId: input.sessionInstanceId,
          nextModelSelection: selection,
        })
      )
        continue;
      for (const effort of efforts) {
        candidates.push({
          key: `candidate_${candidates.length}`,
          model: model.slug,
          effort,
          description: describeJevCandidate(model.slug, effort),
          selection: {
            ...selection,
            options: [
              ...(input.current.options ?? []).filter((option) => option.id !== "reasoningEffort"),
              { id: "reasoningEffort", value: effort },
            ],
          },
          provider,
        });
      }
    }
  }
  return candidates.slice(0, 128);
}
