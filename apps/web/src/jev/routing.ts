import type { ModelSelection } from "@t3tools/contracts";
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
    if (!provider.enabled || !provider.isAvailable || provider.status !== "ready") continue;
    // Keep Auto inside the user's chosen integration, including brand-new threads.
    if (provider.instanceId !== (input.sessionInstanceId ?? input.current.instanceId)) continue;
    for (const model of getAppModelOptionsForInstance(input.settings, provider)) {
      if (model.isUnavailable) continue;
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
      candidates.push({
        key: `candidate_${candidates.length}`,
        description:
          `${provider.displayName} (${provider.driverKind}), model ${model.name} (${model.slug})`.slice(
            0,
            1000,
          ),
        selection,
        provider,
      });
    }
  }
  return candidates.slice(0, 128);
}
