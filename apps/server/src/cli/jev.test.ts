// @effect-diagnostics nodeBuiltinImport:off -- Temporary directories isolate CLI state.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { JevRouteRequest, JevRouteResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  claimJevCliReviewExecution,
  loadResolvedJevCliReview,
  makeJevCliOutcome,
  persistJevCliReview,
  resumeJevCliReview,
  routeJevCliRequest,
} from "./jev.ts";

const request: JevRouteRequest = {
  requestId: "route-1",
  prompt: "Fix the parser",
  candidates: [
    { key: "fast", description: "Fast", model: "model-fast", effort: "medium" },
    { key: "strong", description: "Strong", model: "model-strong", effort: "high" },
  ],
  context: {
    existingSession: false,
    hasAttachments: false,
    interactionMode: "default",
    currentModel: "model-fast",
    currentEffort: "medium",
  },
};

const result: JevRouteResult = {
  choice: "strong",
  recommendedChoice: "strong",
  confidence: 0.8,
  probabilities: { fast: 0.2, strong: 0.8 },
  latencyMs: 2,
  error: null,
  inputTokens: 10,
  outputTokens: 2,
  costUsd: 0.001,
  costKind: "billed",
  policyOutcome: "route",
  admissibleCandidateKeys: ["strong"],
};

describe("Jev CLI routing review", () => {
  it("reviews every Guided result but automatically routes a valid Automatic result", () => {
    const guided = makeJevCliOutcome(request, result, "guided");
    const automatic = makeJevCliOutcome(request, result, "auto");
    expect(guided.status).toBe("review_required");
    expect(automatic).toMatchObject({ status: "routed", choice: "strong" });
    if (guided.status === "review_required") {
      expect(guided.options.map((option) => option.id)).toEqual([
        "recommended",
        "current",
        "alternative:fast",
        "cancel",
      ]);
    }
  });

  it("pauses Automatic mode on a policy review and never treats a proposed choice as a route", () => {
    const review = makeJevCliOutcome(
      request,
      {
        ...result,
        choice: null,
        policyOutcome: "review",
        proposedChoice: "strong",
        reasons: ["uncertainty_changes_required_capability"],
      },
      "auto",
    );
    expect(review.status).toBe("review_required");
    if (review.status === "review_required") {
      expect(review.reason).toContain("uncertainty_changes_required_capability");
    }
  });

  it("keeps a resolved review durable and rejects a conflicting second selection", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "jev-cli-review-"));
    try {
      const review = makeJevCliOutcome(request, result, "guided");
      if (review.status !== "review_required") throw new Error("Expected review");
      const pending = await persistJevCliReview(directory, request, review);
      const selected = await resumeJevCliReview(directory, pending.reviewId, "recommended");
      expect(selected).toMatchObject({ status: "selected", choice: "strong" });
      expect(await resumeJevCliReview(directory, pending.reviewId, "recommended")).toEqual(
        selected,
      );
      await expect(resumeJevCliReview(directory, pending.reviewId, "current")).rejects.toThrow(
        "different selection",
      );
      expect((await loadResolvedJevCliReview(directory, pending.reviewId)).request).toEqual(
        request,
      );
      await claimJevCliReviewExecution(directory, pending.reviewId);
      await expect(claimJevCliReviewExecution(directory, pending.reviewId)).rejects.toThrow(
        "already submitted",
      );
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });

  it("does not invoke the provider without a key", async () => {
    const outcome = await routeJevCliRequest(request, undefined, "auto", () => {
      throw new Error("Provider was called");
    });
    expect(outcome.status).toBe("review_required");
    if (outcome.status === "review_required") {
      expect(outcome.result.policyOutcome).toBe("unavailable");
    }
  });

  it("uses the shared decision transport for a headless Automatic route", async () => {
    const simpleRequest: JevRouteRequest = {
      ...request,
      candidates: [
        { key: "fast", description: "Fast model" },
        { key: "strong", description: "Strong model" },
      ],
    };
    let sent = false;
    const outcome = await routeJevCliRequest(
      simpleRequest,
      "private-test-key",
      "auto",
      async (_url, init) => {
        sent = true;
        expect(init?.headers).toMatchObject({ Authorization: "Bearer private-test-key" });
        return new Response(
          JSON.stringify({
            model: "jev-1.13.0",
            answers: {
              route: {
                type: "choice",
                choice: "strong",
                confidence: 0.8,
                probabilities: { fast: 0.2, strong: 0.8 },
              },
            },
            usage: { input_tokens: 10, output_tokens: 2 },
          }),
          { status: 200 },
        );
      },
    );
    expect(sent).toBe(true);
    expect(outcome).toMatchObject({ status: "routed", choice: "strong" });
    expect(JSON.stringify(outcome)).not.toContain("private-test-key");
  });
});
