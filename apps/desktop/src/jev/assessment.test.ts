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
    raw.answers.model!.confidence = 0.37;
    expect(parseAssessmentDecision(raw, request, 100, parseJevDecision)).toMatchObject({
      choice: null,
      recommendedChoice: "luna_low",
      confidence: 0.37,
      costUsd: 0.001,
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
    delete raw.answers.task_kind;
    expect(
      parseAssessmentDecision(raw, request, 100, parseJevDecision).recommendedChoice,
    ).toBeNull();
  });
});
