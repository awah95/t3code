import { describeJevCandidate, JEV_MODEL_PROFILES } from "@t3tools/shared/jevRouting";
import type { JevEffort, ModelSelection } from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import type { ProviderInstanceEntry } from "../providerInstances";
import { getAppModelOptionsForInstance } from "../modelSelection";
import { getStartedThreadModelChangeBlockReason } from "../components/ChatView.logic";

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
