import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { deriveProviderInstanceEntries } from "../providerInstances";
import { getComposerProviderState } from "../components/chat/composerProviderState";
import { eligibleJevModels } from "./routing";

function provider(instance: string, overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instance),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-09-20T00:00:00.000Z",
    models: ["gpt-5.6-sol", "gpt-5.6-terra"].map((slug) => ({
      slug,
      name: slug,
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            id: "reasoningEffort",
            label: "Effort",
            type: "select",
            options: [{ id: "medium", label: "Medium" }],
          },
        ],
      },
    })),
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}
const current = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" };
describe("eligible Jev models", () => {
  it("keeps a new thread inside the manually chosen integration", () => {
    const candidates = eligibleJevModels({
      providers: deriveProviderInstanceEntries([provider("codex"), provider("codex_work")]),
      settings: DEFAULT_UNIFIED_SETTINGS,
      current,
      sessionInstanceId: null,
      hasStartedSession: false,
    });
    expect(candidates.map((candidate) => candidate.selection.instanceId)).toEqual([
      "codex",
      "codex",
    ]);
  });
  it("excludes disabled and unavailable provider instances", () => {
    const candidates = eligibleJevModels({
      providers: deriveProviderInstanceEntries([
        provider("codex"),
        provider("disabled", { enabled: false }),
        provider("offline", { status: "error" }),
        provider("unavailable", { availability: "unavailable" }),
      ]),
      settings: DEFAULT_UNIFIED_SETTINGS,
      current,
      sessionInstanceId: null,
      hasStartedSession: false,
    });
    expect(candidates.map((candidate) => candidate.selection.instanceId)).toEqual([
      "codex",
      "codex",
    ]);
  });
  it("keeps an existing conversation on its exact provider instance", () => {
    const candidates = eligibleJevModels({
      providers: deriveProviderInstanceEntries([provider("codex"), provider("codex_work")]),
      settings: DEFAULT_UNIFIED_SETTINGS,
      current,
      sessionInstanceId: ProviderInstanceId.make("codex_work"),
      hasStartedSession: true,
    });
    expect(candidates.map((candidate) => candidate.selection.instanceId)).toEqual([
      "codex_work",
      "codex_work",
    ]);
  });
  it("does not switch a model if the provider requires a fresh thread", () => {
    const candidates = eligibleJevModels({
      providers: deriveProviderInstanceEntries([
        provider("codex", { requiresNewThreadForModelChange: true }),
      ]),
      settings: DEFAULT_UNIFIED_SETTINGS,
      current,
      sessionInstanceId: current.instanceId,
      hasStartedSession: true,
    });
    expect(candidates.map((candidate) => candidate.selection.model)).toEqual(["gpt-5.6-sol"]);
  });
  it("uses only declared supported effort pairs and preserves non-reasoning options", () => {
    const base = provider("codex");
    const candidates = eligibleJevModels({
      providers: deriveProviderInstanceEntries([
        {
          ...base,
          models: [
            {
              ...base.models[0]!,
              capabilities: {
                optionDescriptors: [
                  {
                    id: "reasoningEffort",
                    label: "Effort",
                    type: "select",
                    options: ["low", "high", "max"].map((id) => ({ id, label: id })),
                  },
                ],
              },
            },
            { ...base.models[1]!, slug: "unknown-model" },
          ],
        },
      ]),
      settings: DEFAULT_UNIFIED_SETTINGS,
      current: {
        ...current,
        options: [
          { id: "fastMode", value: true },
          { id: "reasoningEffort", value: "medium" },
        ],
      },
      sessionInstanceId: null,
      hasStartedSession: false,
    });
    expect(candidates.map((candidate) => candidate.effort)).toEqual(["low", "high"]);
    expect(candidates.every((candidate) => /^[a-zA-Z0-9_-]{1,128}$/.test(candidate.key))).toBe(
      true,
    );
    expect(candidates[1]?.selection.options).toEqual([
      { id: "fastMode", value: true },
      { id: "reasoningEffort", value: "high" },
    ]);
    const chosen = candidates[1]!;
    const dispatch = getComposerProviderState({
      provider: chosen.provider.driverKind,
      model: chosen.model,
      models: chosen.provider.models,
      modelOptions: chosen.selection.options,
      planModeEnabled: false,
    });
    expect(
      dispatch.modelOptionsForDispatch?.find((option) => option.id === "reasoningEffort")?.value,
    ).toBe("high");
  });
  it("does not guess effort support when capability descriptors are absent", () => {
    const base = provider("codex");
    expect(
      eligibleJevModels({
        providers: deriveProviderInstanceEntries([
          { ...base, models: base.models.map((model) => ({ ...model, capabilities: {} })) },
        ]),
        settings: DEFAULT_UNIFIED_SETTINGS,
        current,
        sessionInstanceId: null,
        hasStartedSession: false,
      }),
    ).toEqual([]);
  });
});
