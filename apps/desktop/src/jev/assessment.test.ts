import { describe, expect, it } from "vite-plus/test";
import type { JevRouteRequest } from "@t3tools/contracts";
import { buildAssessmentQuestions, parseAssessmentDecision } from "./assessment.ts";
import { parseJevDecision } from "./decision.ts";

const request: JevRouteRequest = {
  requestId: "assessment-test",
  prompt: "What is the latest commit I made?",
  context: {
    existingSession: true,
    hasAttachments: false,
    interactionMode: "default",
    currentModel: "gpt-6-astra",
    currentEffort: "medium",
  },
  candidates: [
    { key: "luna_low", model: "gpt-5.6-luna", effort: "low", description: "Luna low" },
    { key: "luna_high", model: "gpt-5.6-luna", effort: "high", description: "Luna high" },
    { key: "astra_low", model: "gpt-6-astra", effort: "low", description: "Astra low" },
  ],
};
function response() {
  const questions = buildAssessmentQuestions(request)!;
  return {
    model: "jev-1.13.0",
    usage: { cost: 0.001, input_tokens: 100 },
    answers: Object.fromEntries(
      Object.entries(questions).map(([key, q]) => {
        const keys = Object.keys(q.criteria);
        const chosen = keys[0]!;
        return [
          key,
          {
            type: "choice",
            choice: chosen,
            confidence: 0.9,
            probabilities: Object.fromEntries(keys.map((k) => [k, k === chosen ? 1 : 0])),
          },
        ];
      }),
    ),
  };
}
describe("independent Jev task assessment", () => {
  it("asks model separately from effort, only for available pairs", () => {
    const q = buildAssessmentQuestions(request)!;
    expect(Object.keys(q.model!.criteria)).toHaveLength(2);
    expect(Object.keys(q.effort_model_0!.criteria)).toEqual(["low", "high"]);
    expect(Object.keys(q.effort_model_1!.criteria)).toEqual(["low"]);
  });
  it("combines model with its effort and accounts cost once", () => {
    const result = parseAssessmentDecision(response(), request, 100, parseJevDecision);
    expect(result).toMatchObject({
      choice: "luna_low",
      recommendedChoice: "luna_low",
      costUsd: 0.001,
      confidence: 0.9,
    });
    expect(result.assessments?.model?.choice).toBe("gpt-5.6-luna");
  });
  it("preserves a low-confidence valid recommendation for guided review", () => {
    const raw = response();
    raw.answers.procedure!.confidence = 0.37;
    expect(parseAssessmentDecision(raw, request, 100, parseJevDecision)).toMatchObject({
      choice: null,
      recommendedChoice: "luna_low",
      confidence: 0.37,
      costUsd: 0.001,
    });
  });
  it("uncertain context adequacy preserves a reviewable recommendation rather than declaring facts missing", () => {
    const raw = response();
    raw.answers.context_status!.choice = "missing";
    raw.answers.context_status!.confidence = 0.14;
    raw.answers.context_status!.probabilities = { missing: 0.57, sufficient: 0.43 };
    expect(parseAssessmentDecision(raw, request, 100, parseJevDecision)).toMatchObject({
      choice: null,
      recommendedChoice: "luna_low",
      policyOutcome: "review",
      confidence: 0.14,
    });
  });
  it("rejects an unsupported effort even with a valid model", () => {
    const raw = response();
    raw.answers.effort_model_0!.choice = "xhigh";
    expect(parseAssessmentDecision(raw, request, 100, parseJevDecision)).toMatchObject({
      choice: null,
      recommendedChoice: null,
      costUsd: 0.001,
    });
  });
  it("rejects missing assessment fields rather than guessing an explanation", () => {
    const raw = response();
    delete raw.answers.procedure;
    expect(
      parseAssessmentDecision(raw, request, 100, parseJevDecision).recommendedChoice,
    ).toBeNull();
  });
});

describe("capability policy controls execution", () => {
  const pool: JevRouteRequest = {
    ...request,
    candidates: [
      { key: "luna_low", model: "gpt-5.6-luna", effort: "low", description: "" },
      { key: "terra_medium", model: "gpt-5.6-terra", effort: "medium", description: "" },
      { key: "sol_medium", model: "gpt-5.6-sol", effort: "medium", description: "" },
      { key: "sol_high", model: "gpt-5.6-sol", effort: "high", description: "" },
      { key: "astra_high", model: "gpt-6-astra", effort: "high", description: "" },
    ],
  };
  function assess(overrides: Record<string, string>, input = pool) {
    const questions = buildAssessmentQuestions(input)!;
    const raw = {
      model: "jev-1.13.0",
      usage: { cost: 0.001 },
      answers: Object.fromEntries(
        Object.entries(questions).map(([key, q]) => {
          const choices = Object.keys(q.criteria);
          const chosen = overrides[key] ?? choices[0]!;
          return [
            key,
            {
              type: "choice",
              choice: chosen,
              confidence: 0.9,
              probabilities: Object.fromEntries(choices.map((c) => [c, c === chosen ? 1 : 0])),
            },
          ];
        }),
      ),
    };
    return parseAssessmentDecision(raw, input, 40, parseJevDecision);
  }
  it("keeps a known direct lookup cheap", () => {
    expect(assess({})).toMatchObject({ choice: "luna_low", policyOutcome: "route" });
  });
  it("does not permit Luna to reconstruct conflicting history even when its proposal is confident", () => {
    expect(assess({ procedure: "discovery", evidence_work: "reconciliation" })).toMatchObject({
      choice: "sol_medium",
      proposedChoice: "luna_low",
      modelConfidence: 0.9,
    });
  });
  it("assigns synthesis enough capability even when output is only an acknowledgement", () => {
    expect(assess({ evidence_work: "synthesis" })).toMatchObject({ choice: "terra_medium" });
  });
  it("requires sufficient model and effort for an unproven interacting invariant", () => {
    const result = assess({ correctness: "interacting_invariant", verification: "must_design" });
    expect(result.choice).toBe("sol_high");
    expect(result.admissibleCandidateKeys).not.toContain("terra_medium");
    expect(result.admissibleCandidateKeys).not.toContain("sol_medium");
  });
  it("missing requirements abstain even with a confident model proposal", () => {
    expect(assess({ context_status: "missing" })).toMatchObject({
      choice: null,
      recommendedChoice: null,
      proposedChoice: "luna_low",
      policyOutcome: "needs_context",
    });
  });
  it("does not use an available weak pair when sufficient candidates are unavailable", () => {
    expect(
      assess(
        { correctness: "interacting_invariant" },
        { ...pool, candidates: pool.candidates.slice(0, 2) },
      ),
    ).toMatchObject({ choice: null, recommendedChoice: null, policyOutcome: "review" });
  });
  it("an explicit incomplete evidence packet cannot auto route despite a sufficient classification", () => {
    expect(
      assess(
        {},
        {
          ...pool,
          context: { ...pool.context, missingContext: ["Required review annotation body missing"] },
        },
      ),
    ).toMatchObject({ choice: null, policyOutcome: "review" });
  });
  it("keeps a valid stronger proposal instead of forcibly using the smallest default", () => {
    expect(assess({ model: "model_2" })).toMatchObject({
      choice: "sol_medium",
      proposedChoice: "sol_medium",
    });
  });
  it("candidate ordering does not change the required capability floor", () => {
    const reversed = { ...pool, candidates: pool.candidates.toReversed() };
    const result = assess({ model: "model_3", evidence_work: "reconciliation" }, reversed);
    expect(result.choice).toBe("sol_medium");
  });
});
