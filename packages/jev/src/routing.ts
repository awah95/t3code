import type {
  JevEffort,
  JevRouteRequest,
  JevRoutingContext,
  ModelSelection,
} from "@t3tools/contracts";
import {
  describeJevCandidate,
  JEV_MODEL_PROFILES,
  sanitizeJevText,
} from "@t3tools/shared/jevRouting";
import { textOnlyJevPrompt } from "./context.ts";

export interface JevEligibleModel {
  slug: string;
  isUnavailable: boolean;
  efforts: readonly string[];
}

export interface JevEligibleProvider {
  instanceId: ModelSelection["instanceId"];
  driverKind: string;
  enabled: boolean;
  isAvailable: boolean;
  status: string;
  requiresNewThreadForModelChange: boolean;
  candidateModels: readonly JevEligibleModel[];
}

/** Provider configuration is normalized at the caller boundary; Jev policy lives here. */
export function eligibleJevModels<P extends JevEligibleProvider>(input: {
  providers: readonly P[];
  current: ModelSelection;
  sessionInstanceId: ModelSelection["instanceId"] | null;
  hasStartedSession: boolean;
}) {
  const candidates: Array<{
    key: string;
    model: string;
    effort: JevEffort;
    description: string;
    selection: ModelSelection;
    provider: P;
  }> = [];
  for (const provider of input.providers) {
    if (provider.driverKind !== "codex") continue;
    if (!provider.enabled || !provider.isAvailable || provider.status !== "ready") continue;
    if (provider.instanceId !== (input.sessionInstanceId ?? input.current.instanceId)) continue;
    for (const model of provider.candidateModels) {
      if (
        model.isUnavailable ||
        !JEV_MODEL_PROFILES.some((profile) => profile.model === model.slug)
      )
        continue;
      const efforts = model.efforts.filter((value): value is JevEffort =>
        ["low", "medium", "high", "xhigh"].includes(value),
      );
      const selection: ModelSelection = { instanceId: provider.instanceId, model: model.slug };
      const currentInstanceId = input.sessionInstanceId ?? input.current.instanceId;
      const currentProvider = input.providers.find(
        (entry) => entry.instanceId === currentInstanceId,
      );
      const modelChanged =
        currentInstanceId !== selection.instanceId || input.current.model !== selection.model;
      if (
        input.hasStartedSession &&
        modelChanged &&
        (currentProvider?.requiresNewThreadForModelChange ||
          provider.requiresNewThreadForModelChange)
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

/** Construct the wire request from the same context and candidate pair for every caller. */
export function buildJevRouteRequest(input: {
  requestId: string;
  prompt: string;
  context: JevRoutingContext;
  candidates: ReadonlyArray<
    Pick<ReturnType<typeof eligibleJevModels>[number], "key" | "description" | "model" | "effort">
  >;
}): JevRouteRequest {
  return {
    requestId: input.requestId,
    prompt: textOnlyJevPrompt(input.prompt),
    context: input.context,
    candidates: input.candidates.map(({ key, description, model, effort }) => ({
      key,
      model,
      effort,
      description: sanitizeJevText(description),
    })),
  };
}
