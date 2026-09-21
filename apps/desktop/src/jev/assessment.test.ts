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
  it("only asks for continuity when an existing parent turn can benefit from it", () => {
    expect(buildAssessmentQuestions(request)?.task_relation).toBeDefined();
    expect(
      buildAssessmentQuestions({
        ...request,
        context: { ...request.context, existingSession: false },
      })?.task_relation,
    ).toBeUndefined();
    expect(
      buildAssessmentQuestions({
        ...request,
        context: {
          ...request.context,
          target: { kind: "independent_child", inheritedContext: "bounded" },
        },
      })?.task_relation,
    ).toBeUndefined();
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
  it("keeps raw classifier confidence while routing when its checked interpretation does not change the pair", () => {
    const raw = response();
    raw.answers.procedure!.confidence = 0.37;
    expect(parseAssessmentDecision(raw, request, 100, parseJevDecision)).toMatchObject({
      choice: "luna_low",
      recommendedChoice: "luna_low",
      decisionStable: true,
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
  it("does not silently choose a new model when a required continuity answer is missing", () => {
    const raw = response();
    delete raw.answers.task_relation;
    expect(parseAssessmentDecision(raw, request, 100, parseJevDecision)).toMatchObject({
      choice: null,
      recommendedChoice: null,
      policyOutcome: "review",
      reasons: ["invalid_assessment"],
    });
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
  function assess(
    overrides: Record<string, string>,
    input = pool,
    uncertain: Record<string, { confidence: number; probabilities: Record<string, number> }> = {},
  ) {
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
              ...uncertain[key],
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
  it("retains a strong raw proposal for review while recommending the least provisioned admissible pair", () => {
    expect(assess({ model: "model_2" })).toMatchObject({
      choice: null,
      recommendedChoice: "luna_low",
      policyOutcome: "review",
      proposedChoice: "sol_medium",
    });
  });
  it("candidate ordering does not change the required capability floor", () => {
    const reversed = { ...pool, candidates: pool.candidates.toReversed() };
    const result = assess(
      { model: "model_3", evidence_work: "reconciliation", effort_model_1: "medium" },
      reversed,
    );
    expect(result.choice).toBe("sol_medium");
  });
  it("does not pause over minor versus material consequence when both fit the same pair", () => {
    const result = assess({}, pool, {
      consequence: { confidence: 0.31, probabilities: { minor: 0.55, material: 0.45, high: 0 } },
    });
    expect(result).toMatchObject({
      choice: "luna_low",
      confidence: 0.31,
      decisionStable: true,
      policyOutcome: "route",
    });
    expect(result.uncertaintyAlternatives).toEqual({ consequence: ["minor", "material"] });
  });
  it("pauses if an uncertain interpretation requires more capability", () => {
    const result = assess({}, pool, {
      procedure: {
        confidence: 0.2,
        probabilities: { established: 0.55, local_choices: 0.45, discovery: 0 },
      },
    });
    expect(result).toMatchObject({
      choice: null,
      recommendedChoice: "luna_low",
      decisionStable: false,
      policyOutcome: "review",
    });
  });
  it("can route when competing interpretations only relax the selected requirements", () => {
    expect(
      assess({ evidence_work: "synthesis" }, pool, {
        evidence_work: {
          confidence: 0.3,
          probabilities: { extraction: 0.45, synthesis: 0.55, reconciliation: 0 },
        },
      }),
    ).toMatchObject({ choice: "terra_medium", confidence: 0.3, decisionStable: true });
  });
  it("checks combinations that require Astra even though each alternative alone fits Sol", () => {
    const input = {
      ...pool,
      candidates: pool.candidates.filter((c) => ["sol_high", "astra_high"].includes(c.key)),
    };
    expect(
      assess({ correctness: "local_reasoning", consequence: "material" }, input, {
        correctness: {
          confidence: 0.3,
          probabilities: { direct_check: 0, local_reasoning: 0.55, interacting_invariant: 0.45 },
        },
        consequence: { confidence: 0.3, probabilities: { minor: 0, material: 0.55, high: 0.45 } },
      }),
    ).toMatchObject({ choice: null, recommendedChoice: "sol_high", decisionStable: false });
  });
  it("does not discard even a small missing-context alternative in an uncertain context assessment", () => {
    expect(
      assess({}, pool, {
        context_status: { confidence: 0.4, probabilities: { sufficient: 0.81, missing: 0.19 } },
      }),
    ).toMatchObject({ choice: null, decisionStable: false });
  });
  it("reduces an unnecessary Astra proposal to Sol when conflicting evidence requires Sol", () => {
    expect(assess({ model: "model_3", evidence_work: "reconciliation" })).toMatchObject({
      choice: "sol_medium",
      proposedChoice: "astra_high",
      decisionStable: true,
    });
  });
  it("keeps high-consequence interacting invariants at Astra immediately", () => {
    expect(assess({ correctness: "interacting_invariant", consequence: "high" })).toMatchObject({
      choice: "astra_high",
    });
  });
  it("never economizes below the attributed unresolved failure floor", () => {
    expect(
      assess(
        {},
        {
          ...pool,
          context: {
            ...pool.context,
            failure: {
              unresolved: true,
              model: "gpt-5.6-sol",
              effort: "high",
              signals: ["The same defect remains"],
            },
          },
        },
      ),
    ).toMatchObject({ choice: "sol_high" });
  });
  it("honors the economical model's own effort assessment and identifies its confidence separately", () => {
    const result = assess(
      { model: "model_3", evidence_work: "reconciliation", effort_model_2: "high" },
      pool,
      {
        effort_model_2: { confidence: 0.35, probabilities: { medium: 0.45, high: 0.55 } },
      },
    );
    expect(result).toMatchObject({
      choice: "sol_high",
      proposedChoice: "astra_high",
      effortConfidence: 0.9,
      conditionalEffort: { model: "gpt-5.6-sol", effort: "high", confidence: 0.35 },
      decisionStable: true,
    });
  });
  it("pauses when the selected model may need a higher effort despite confident task classifiers", () => {
    const result = assess({ evidence_work: "reconciliation" }, pool, {
      effort_model_2: { confidence: 0.35, probabilities: { medium: 0.55, high: 0.45 } },
    });
    expect(result).toMatchObject({
      choice: null,
      recommendedChoice: "sol_medium",
      decisionStable: false,
      confidence: 0.9,
    });
    expect(result.uncertaintyAlternatives).toEqual({ effort_model_2: ["medium", "high"] });
  });

  const continuing: JevRouteRequest = {
    ...pool,
    prompt: "Add the agreed regression test for the fix.",
    context: {
      ...pool.context,
      currentModel: "gpt-5.6-sol",
      currentEffort: "high",
      target: { kind: "turn", inheritedContext: "bounded" },
      history: [{ role: "assistant", text: "The fix is complete; next add its regression test." }],
    },
  };

  it("retains a capable current model for a continuation and uses that model's effort assessment", () => {
    const result = assess({ task_relation: "continuation" }, continuing);
    expect(result).toMatchObject({
      choice: "sol_medium",
      proposedChoice: "luna_low",
      policyOutcome: "route",
      conditionalEffort: { model: "gpt-5.6-sol", effort: "medium" },
    });
    expect(result.reasons).toContain("continuation_retained_model");
    expect(result.reasons).toContain("current_model_effort_adjusted");
  });

  it("can increase effort on the retained model", () => {
    expect(
      assess(
        { task_relation: "continuation", effort_model_2: "high" },
        { ...continuing, context: { ...continuing.context, currentEffort: "medium" } },
      ),
    ).toMatchObject({ choice: "sol_high", policyOutcome: "route" });
  });

  it("reassesses a new phase instead of retaining an expensive current model", () => {
    const result = assess({ task_relation: "new_phase" }, continuing);
    expect(result).toMatchObject({ choice: "luna_low", policyOutcome: "route" });
    expect(result.reasons).toContain("new_phase_reassessed_model");
  });

  it("does not treat a new session's selected model as warm context", () => {
    expect(
      assess(
        { task_relation: "continuation" },
        { ...continuing, context: { ...continuing.context, existingSession: false } },
      ),
    ).toMatchObject({ choice: "luna_low", policyOutcome: "route" });
  });

  it("assesses independent children without preferring their parent's model", () => {
    const result = assess(
      { task_relation: "continuation" },
      {
        ...continuing,
        context: {
          ...continuing.context,
          target: { kind: "independent_child", inheritedContext: "bounded" },
        },
      },
    );
    expect(result).toMatchObject({ choice: "luna_low", policyOutcome: "route" });
    expect(result.reasons).toContain("independent_child_selected_model");
  });

  it("escalates capability immediately when the current model cannot meet the task floor", () => {
    const result = assess(
      { task_relation: "continuation", correctness: "interacting_invariant" },
      {
        ...continuing,
        context: { ...continuing.context, currentModel: "gpt-5.6-luna", currentEffort: "high" },
      },
    );
    expect(result).toMatchObject({ choice: "sol_high", policyOutcome: "route" });
    expect(result.reasons).toContain("current_model_below_requirements_or_unavailable");
  });

  it("switches when the current model has no available effort meeting the floor", () => {
    expect(
      assess(
        { task_relation: "continuation", correctness: "interacting_invariant" },
        { ...continuing, candidates: continuing.candidates.filter((c) => c.key !== "sol_high") },
      ),
    ).toMatchObject({ choice: "astra_high", policyOutcome: "route" });
  });

  it("does not retain an unavailable model", () => {
    expect(
      assess(
        { task_relation: "continuation" },
        { ...continuing, context: { ...continuing.context, currentModel: "unavailable" } },
      ),
    ).toMatchObject({ choice: "luna_low", policyOutcome: "route" });
  });

  it("does not lower effort during an unresolved failure on the retained model", () => {
    expect(
      assess(
        { task_relation: "continuation" },
        {
          ...continuing,
          context: {
            ...continuing.context,
            failure: {
              unresolved: true,
              model: "gpt-5.6-sol",
              effort: "high",
              signals: ["The same defect remains"],
            },
          },
        },
      ),
    ).toMatchObject({ choice: "sol_high", policyOutcome: "route" });
  });

  it("keeps a reviewable current-model recommendation when task continuity is unclear", () => {
    const result = assess({ task_relation: "unclear" }, continuing);
    expect(result).toMatchObject({
      choice: null,
      recommendedChoice: "sol_medium",
      policyOutcome: "review",
      decisionStable: false,
      uncertaintyAlternatives: { task_relation: ["unclear"] },
    });
    expect(result.reasons).toContain("uncertainty_changes_model_continuity");
    expect(result.reasons).not.toContain("uncertainty_changes_required_capability");
  });

  it.each(["continuation", "new_phase"])(
    "reviews an uncertain %s assessment when the alternative would change models",
    (task_relation) => {
      expect(
        assess({ task_relation }, continuing, {
          task_relation: {
            confidence: 0.3,
            probabilities: { continuation: 0.5, new_phase: 0.5, unclear: 0 },
          },
        }),
      ).toMatchObject({ choice: null, policyOutcome: "review", decisionStable: false });
    },
  );

  it("does not pause over relationship uncertainty when both interpretations select the same model", () => {
    expect(
      assess(
        { task_relation: "unclear" },
        { ...continuing, context: { ...continuing.context, currentModel: "gpt-5.6-luna" } },
      ),
    ).toMatchObject({ choice: "luna_low", policyOutcome: "route", decisionStable: true });
  });

  it("still reviews uncertain effort on the retained model", () => {
    expect(
      assess({ task_relation: "continuation" }, continuing, {
        effort_model_2: { confidence: 0.3, probabilities: { medium: 0.55, high: 0.45 } },
      }),
    ).toMatchObject({ choice: null, recommendedChoice: "sol_medium", policyOutcome: "review" });
  });

  it("does not bypass missing-context safeguards to retain a model", () => {
    expect(
      assess({ task_relation: "continuation", context_status: "missing" }, continuing),
    ).toMatchObject({ choice: null, recommendedChoice: null, policyOutcome: "needs_context" });
  });
});
