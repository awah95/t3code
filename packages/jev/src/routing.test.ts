import { describe, expect, it } from "vite-plus/test";
import type { JevRoutingContext, ModelSelection } from "@t3tools/contracts";
import { buildJevRouteRequest, eligibleJevModels } from "./routing.ts";

const current = { instanceId: "codex", model: "gpt-6-sol" } as ModelSelection;
const provider = {
  instanceId: current.instanceId,
  driverKind: "codex",
  enabled: true,
  isAvailable: true,
  status: "ready",
  requiresNewThreadForModelChange: false,
  candidateModels: [
    { slug: "gpt-6-sol", isUnavailable: false, efforts: ["low", "high", "max"] },
    { slug: "gpt-6-luna", isUnavailable: false, efforts: ["medium"] },
  ],
};
const context: JevRoutingContext = {
  existingSession: false,
  hasAttachments: false,
  interactionMode: "default",
};

describe("Jev request routing", () => {
  it("uses the same candidate policy from normalized provider data", () => {
    const candidates = eligibleJevModels({
      providers: [provider],
      current,
      sessionInstanceId: null,
      hasStartedSession: false,
    });
    expect(candidates.map(({ model, effort }) => [model, effort])).toEqual([
      ["gpt-6-sol", "low"],
      ["gpt-6-sol", "high"],
      ["gpt-6-luna", "medium"],
    ]);
    expect(candidates.map((candidate) => candidate.key)).toEqual([
      "candidate_0",
      "candidate_1",
      "candidate_2",
    ]);
    expect(
      eligibleJevModels({
        providers: [{ ...provider, requiresNewThreadForModelChange: true }],
        current,
        sessionInstanceId: current.instanceId,
        hasStartedSession: true,
      }).map((candidate) => candidate.model),
    ).toEqual(["gpt-6-sol", "gpt-6-sol"]);
  });

  it("builds the same prompt and candidate envelope for each caller", () => {
    const candidates = eligibleJevModels({
      providers: [provider],
      current,
      sessionInstanceId: null,
      hasStartedSession: false,
    });
    const request = buildJevRouteRequest({
      requestId: "turn-1",
      prompt: "Fix this issue",
      context,
      candidates,
    });
    expect(request.prompt).toBe("Fix this issue");
    expect(request.candidates.map(({ key, model, effort }) => [key, model, effort])).toEqual(
      candidates.map(({ key, model, effort }) => [key, model, effort]),
    );
  });
});
