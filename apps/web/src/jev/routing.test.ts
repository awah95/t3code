import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { deriveProviderInstanceEntries } from "../providerInstances";
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
    models: ["gpt-5.4", "gpt-5.3-codex"].map((slug) => ({
      slug,
      name: slug,
      isCustom: false,
      capabilities: {},
    })),
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}
const current = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };
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
    expect(candidates.map((candidate) => candidate.selection.model)).toEqual(["gpt-5.4"]);
  });
});
