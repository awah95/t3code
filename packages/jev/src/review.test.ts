import { describe, expect, it } from "vite-plus/test";
import type { JevRouteRequest, JevRouteResult } from "@t3tools/contracts";
import { isAutomaticJevRoute, resolveJevReviewSelection } from "./review.ts";

const request: JevRouteRequest = {
  requestId: "turn-1",
  prompt: "Fix the issue",
  candidates: [
    { key: "recommended", description: "Recommended model", model: "gpt-6-sol", effort: "high" },
    { key: "other", description: "Other model", model: "gpt-6-astra", effort: "high" },
  ],
  context: { existingSession: false, hasAttachments: false, interactionMode: "default" },
};
const result: JevRouteResult = {
  choice: "recommended",
  recommendedChoice: "recommended",
  confidence: 0.9,
  probabilities: { recommended: 0.9, other: 0.1 },
  latencyMs: 10,
  error: null,
  inputTokens: 1,
  outputTokens: 1,
  costUsd: 0.001,
  costKind: "estimated",
  policyOutcome: "route",
  admissibleCandidateKeys: ["recommended"],
};

describe("Jev turn review policy", () => {
  it("automatically routes only a valid, admissible route result", () => {
    expect(isAutomaticJevRoute(request, result)).toBe(true);
    expect(isAutomaticJevRoute(request, { ...result, policyOutcome: "review" })).toBe(false);
    expect(isAutomaticJevRoute(request, { ...result, policyOutcome: "needs_context" })).toBe(false);
    expect(isAutomaticJevRoute(request, { ...result, choice: "missing" })).toBe(false);
    expect(isAutomaticJevRoute(request, { ...result, admissibleCandidateKeys: ["other"] })).toBe(
      false,
    );
    expect(isAutomaticJevRoute(request, { ...result, choice: null })).toBe(false);
    const { policyOutcome: _policyOutcome, ...legacyResult } = result;
    expect(isAutomaticJevRoute(request, legacyResult)).toBe(true);
  });

  it("uses the recommendation only when it is present and admissible", () => {
    expect(resolveJevReviewSelection(request, result, "suggestion")).toEqual({
      action: "suggestion",
      choice: "recommended",
    });
    expect(
      resolveJevReviewSelection(request, { ...result, recommendedChoice: "other" }, "suggestion"),
    ).toBeUndefined();
    expect(
      resolveJevReviewSelection(request, { ...result, recommendedChoice: "missing" }, "suggestion"),
    ).toBeUndefined();
    expect(
      resolveJevReviewSelection(
        request,
        { ...result, recommendedChoice: null, choice: "recommended" },
        "suggestion",
      ),
    ).toEqual({ action: "suggestion", choice: "recommended" });
  });

  it("allows explicit current or compatible alternative overrides", () => {
    expect(resolveJevReviewSelection(request, result, "current")).toEqual({
      action: "current",
      choice: null,
    });
    expect(resolveJevReviewSelection(request, result, "alternative", "other")).toEqual({
      action: "alternative",
      choice: "other",
    });
    expect(resolveJevReviewSelection(request, result, "alternative", "missing")).toBeUndefined();
  });

  it("cancels without choosing a model", () => {
    expect(resolveJevReviewSelection(request, result, "cancel")).toBeNull();
  });
});
