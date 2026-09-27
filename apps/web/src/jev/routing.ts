import { buildJevRouteRequest, eligibleJevModels as eligiblePairs } from "@t3tools/jev/routing";
import type { ModelSelection } from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import type { ProviderInstanceEntry } from "../providerInstances";
import { getAppModelOptionsForInstance } from "../modelSelection";
import { buildJevContext } from "./context";

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
}) {
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
    request: buildJevRouteRequest({
      requestId: input.requestId,
      prompt: input.prompt,
      context,
      candidates,
    }),
    candidates,
  };
}

/** Project the web provider catalog into the shared Jev candidate policy. */
export function eligibleJevModels(input: {
  providers: readonly ProviderInstanceEntry[];
  settings: UnifiedSettings;
  current: ModelSelection;
  sessionInstanceId: ModelSelection["instanceId"] | null;
  hasStartedSession: boolean;
}) {
  const providers = input.providers.map((provider) => ({
    instanceId: provider.instanceId,
    driverKind: provider.driverKind,
    enabled: provider.enabled,
    isAvailable: provider.isAvailable,
    status: provider.status,
    requiresNewThreadForModelChange: provider.snapshot.requiresNewThreadForModelChange === true,
    candidateModels: getAppModelOptionsForInstance(input.settings, provider).map((model) => {
      const descriptor = provider.models
        .find((entry) => entry.slug === model.slug)
        ?.capabilities?.optionDescriptors?.find((option) => option.id === "reasoningEffort");
      return {
        slug: model.slug,
        isUnavailable: model.isUnavailable === true,
        efforts: descriptor?.type === "select" ? descriptor.options.map((option) => option.id) : [],
      };
    }),
    source: provider,
  }));
  return eligiblePairs({
    providers,
    current: input.current,
    sessionInstanceId: input.sessionInstanceId,
    hasStartedSession: input.hasStartedSession,
  }).map(({ provider, ...candidate }) => ({ ...candidate, provider: provider.source }));
}
