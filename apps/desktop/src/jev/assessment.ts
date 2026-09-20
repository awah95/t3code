import type { JevRouteRequest, JevRouteResult, JevEffort } from "@t3tools/contracts";
import {
  getJevModelProfile,
  isJevCandidateAllowed,
  JEV_EFFORT_GUIDANCE,
  JEV_EFFORTS,
  JEV_ROUTING_CORE,
} from "@t3tools/shared/jevRouting";

type ChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> };
const question = (instructions: string, criteria: Record<string, string>): ChoiceQuestion => ({
  type: "choice",
  instructions: `${JEV_ROUTING_CORE}\n${instructions}`,
  criteria,
});

export function assessmentModels(request: JevRouteRequest) {
  return [...new Set(request.candidates.map((candidate) => candidate.model))]
    .filter((model): model is string => typeof model === "string")
    .map((model, index) => ({
      key: `model_${index}`,
      model,
      efforts: [
        ...new Set(request.candidates.filter((c) => c.model === model).map((c) => c.effort)),
      ].filter((effort): effort is JevEffort => effort !== undefined),
    }));
}

/** Atomic demands are consumed by the reducer, not merely displayed as an explanation. */
export function buildAssessmentQuestions(
  request: JevRouteRequest,
): Record<string, ChoiceQuestion> | null {
  if (request.candidates.some((candidate) => !candidate.model || !candidate.effort)) return null;
  const models = assessmentModels(request);
  const questions: Record<string, ChoiceQuestion> = {
    context_status: question(
      "Is the intended action and its scope identifiable enough to assess its reasoning demands? Do NOT require the evidence needed to SOLVE the task to be pasted into this packet. An executor can inspect the current repository, dirty review files, records, or named systems as part of an explicit investigation. Such requests are assessable even before reading those sources. Missing means the intended action or scope itself cannot be identified: an unspecified next step, an absent screenshot with no described issue, or an unavailable agreement defining what to implement. Do not assume missing context just because concrete source paths or file contents are absent.",
      {
        sufficient:
          "The intended action, scope and referenced requirements are identifiable; investigation can proceed from named available sources.",
        missing:
          "The intended action or material referenced requirements cannot be determined from the packet; clarification or recovery is needed before selecting a worker.",
      },
    ),
    procedure: question(
      "Is the method for completing the entire action already established by the supplied evidence? Classify the method for the current deliverable, not for solving every issue mentioned in its sources. Reading reports and noting their disagreements is a known procedure when no independent adjudication or fix is requested. A familiar tool alone does not establish the method. Reconstructing a disputed history or diagnosing an unproven cause requires discovery.",
      {
        established:
          "Explicit procedure/solution or conventional direct lookup with unambiguous source and check.",
        local_choices:
          "Approach is understood but some contained implementation or interpretation choices remain.",
        discovery:
          "Approach, causal explanation, attribution or resolution must be investigated rather than executed from a known recipe.",
      },
    ),
    evidence_work: question(
      "What must be done with the evidence to complete the requested action? Classify necessary reasoning, not merely the fact that documents will be read. Reading one supplied coherent note and acknowledging it is extraction, even if that note discusses a difficult investigation. Reporting that accounts disagree without deciding which is true is synthesis; independently establishing the truth is reconciliation.",
      {
        extraction:
          "Retrieve, copy, transform or summarize directly stated facts without integrating a work state or resolving competing accounts.",
        synthesis:
          "Integrate requirements, findings or progress from multiple sources into a coherent current understanding; no conflicting claims need resolution yet.",
        reconciliation:
          "Resolve conflicting, rewritten, incomplete or competing accounts to establish attribution, ordering, cause or which claims hold.",
      },
    ),
    correctness: question(
      "What kind of reasoning is needed to justify the requested conclusion or change? An interacting invariant is a property of actual system behavior that must hold across components or transitions; accurate ordering or factual reconciliation alone is not such an invariant. Assessing which existing findings remain open does not require proving the underlying software correct. A claim that behavior never occurs may require multiple interacting states even if read-only. A fully supplied test matrix is a bounded check; designing coverage for an unproven invariant is different.",
      {
        direct_check:
          "Correctness follows from a direct observable result or complete supplied checklist, without discovering interacting cases.",
        local_reasoning:
          "Some interpretation or designing contained checks is needed within a bounded behavior.",
        interacting_invariant:
          "Correctness depends on interacting components, state transitions, concurrency, or proving a negative/universal claim across relevant cases without an established complete check.",
      },
    ),
    verification: question(
      "Is a sufficient way to verify the result already known for this particular request? A summary or acknowledgement is checked against its source material, not by reproducing every reported defect. A customary Git status query or exact text replacement has a direct check. Verifying an unproven cross-layer behavior requires designing evidence/coverage.",
      {
        available:
          "A known direct observable check or sufficient supplied acceptance procedure exists.",
        must_design:
          "The executor must determine which evidence or tests justify the requested conclusion.",
      },
    ),
    consequence: question(
      "What is the consequence of getting this requested action wrong? Evaluate this action, not the general importance of the project. Ordinary investigation or reversible edits are material, not automatically high stakes.",
      {
        minor:
          "Quickly apparent and easily corrected extraction, cosmetic edit or known bounded operation.",
        material:
          "Misleading findings, incorrect implementation or a wrong diagnosis would cause meaningful rework or missed defects.",
        high: "A wrong action or conclusion risks significant data loss, security exposure, irreversible damage or critical persistent-state corruption.",
      },
    ),
    model: question(
      "Propose a model whose described capability fits the full task. The application will enforce task-demand constraints separately. Do not predict unmeasured token usage, completion time or subscription multipliers. Use a small model when the procedure and direct check are established; use greater capability for discovery, evidence reconciliation and interacting correctness. Missing context does not imply a small model is sufficient.",
      Object.fromEntries(
        models.map(({ key, model }) => {
          const profile = getJevModelProfile(model);
          return [
            key,
            `${model}: ${profile?.summary ?? "Unknown capability"} Fits: ${profile?.goodFor.join("; ")}. Limitations: ${profile?.avoidFor.join("; ")}.`,
          ];
        }),
      ),
    ),
  };
  for (const { key, model, efforts } of models) {
    questions[`effort_${key}`] = question(
      `Assume ${model} executes the full action. Choose the lowest sufficient effort from the available options. Low fits established procedures with direct checks; synthesis/local judgment often needs medium; interacting invariants or difficult causal diagnosis may need high. Additional effort cannot repair insufficient model capability. Do not inherit the parent's effort for an independent child.`,
      Object.fromEntries(efforts.map((effort) => [effort, JEV_EFFORT_GUIDANCE[effort]])),
    );
  }
  return questions;
}

const demandKeys = [
  "context_status",
  "procedure",
  "evidence_work",
  "correctness",
  "verification",
  "consequence",
] as const;

type DemandKey = (typeof demandKeys)[number];
type Demand = Record<DemandKey, string>;

// Provisional requirements, not measured success rates or subscription costs.
function requirements(values: Demand) {
  const demand = (key: DemandKey) => values[key];
  let rank = 1;
  let effort: JevEffort = "low";
  const reasons: string[] = [];
  const require = (nextRank: number, nextEffort: JevEffort, reason: string) => {
    rank = Math.max(rank, nextRank);
    if (JEV_EFFORTS.indexOf(nextEffort) > JEV_EFFORTS.indexOf(effort)) effort = nextEffort;
    reasons.push(reason);
  };
  if (demand("procedure") === "local_choices") require(2, "medium", "local_judgment");
  if (demand("procedure") === "discovery") require(3, "medium", "approach_requires_discovery");
  if (demand("evidence_work") === "synthesis") require(2, "medium", "evidence_synthesis");
  if (demand("evidence_work") === "reconciliation") require(3, "medium", "conflicting_evidence");
  if (demand("correctness") === "local_reasoning")
    require(2, "medium", "local_correctness_reasoning");
  if (demand("correctness") === "interacting_invariant")
    require(3, "high", "interacting_correctness_invariant");
  if (demand("verification") === "must_design")
    require(2, "medium", "verification_must_be_designed");
  if (demand("consequence") === "high")
    require(demand("correctness") === "interacting_invariant" ? 4 : 3, "high", "high_consequence");
  if (reasons.length === 0) reasons.push("established_procedure_and_direct_check");
  return { rank, effort, reasons };
}

// Jev's scores are uncalibrated. This defines the alternatives checked by the pilot,
// not a probability of task success. Missing context remains conservative.
const ALTERNATIVE_SCORE_FLOOR = 0.2;

export function parseAssessmentDecision(
  raw: unknown,
  request: JevRouteRequest,
  latencyMs: number,
  parseChoice: (raw: unknown, keys: readonly string[], latency: number) => JevRouteResult,
): JevRouteResult {
  const questions = buildAssessmentQuestions(request)!;
  const object = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const answers =
    typeof object.answers === "object" && object.answers !== null
      ? (object.answers as Record<string, unknown>)
      : {};
  const decoded = Object.fromEntries(
    Object.entries(questions).map(([key, q]) => [
      key,
      parseChoice(
        { ...object, answers: { route: answers[key] } },
        Object.keys(q.criteria),
        latencyMs,
      ),
    ]),
  );
  const base = decoded.model!;
  const assessments: Record<
    string,
    { choice: string; confidence: number; probabilities: Readonly<Record<string, number>> }
  > = Object.fromEntries(
    Object.entries(decoded).flatMap(([key, value]) =>
      value.recommendedChoice && value.confidence !== null
        ? [
            [
              key,
              {
                choice: value.recommendedChoice,
                confidence: value.confidence,
                probabilities: value.probabilities,
              },
            ],
          ]
        : [],
    ),
  );
  const models = assessmentModels(request);
  const proposedModel = models.find((entry) => entry.key === base.recommendedChoice);
  const proposedEffort = proposedModel ? decoded[`effort_${proposedModel.key}`] : undefined;
  const proposal = request.candidates.find(
    (c) => c.model === proposedModel?.model && c.effort === proposedEffort?.recommendedChoice,
  );
  if (assessments.model && proposedModel)
    assessments.model = {
      ...assessments.model,
      choice: proposedModel.model,
      probabilities: Object.fromEntries(
        models.map((m) => [m.model, base.probabilities[m.key] ?? 0]),
      ),
    };
  const common = {
    ...base,
    choice: null,
    recommendedChoice: null,
    proposedChoice: proposal?.key ?? null,
    probabilities: {},
    assessments,
    modelConfidence: base.confidence,
    effortConfidence: proposedEffort?.confidence ?? null,
  };
  if (Object.keys(assessments).length !== Object.keys(questions).length || !proposal) {
    return {
      ...common,
      policyOutcome: "review",
      admissibleCandidateKeys: [],
      reasons: ["invalid_assessment"],
      error: "Incomplete assessment. Review the model before sending.",
    };
  }
  const demand = (key: (typeof demandKeys)[number]) => assessments[key]!.choice;
  if (demand("context_status") === "missing" && decoded.context_status!.confidence! >= 0.5) {
    return {
      ...common,
      policyOutcome: "needs_context",
      confidence: decoded.context_status!.confidence,
      admissibleCandidateKeys: [],
      reasons: ["missing_material_context", ...(request.context.missingContext ?? [])],
      error: "Recover the missing task context or explicitly choose a model before sending.",
      explanation:
        "Jev could not identify enough of the requested task to recommend a worker. No automatic model selection was made.",
    };
  }
  const values = Object.fromEntries(demandKeys.map((key) => [key, demand(key)])) as Demand;
  const { rank, effort, reasons } = requirements(values);
  const allowed = request.candidates.filter(
    (candidate) =>
      isJevCandidateAllowed(candidate, request.context) &&
      (getJevModelProfile(candidate.model ?? "")?.capabilityRank ?? 0) >= rank &&
      candidate.effort !== undefined &&
      JEV_EFFORTS.indexOf(candidate.effort) >= JEV_EFFORTS.indexOf(effort),
  );
  // Select the least provisioned admissible default. Model identity is a deterministic tie break,
  // so reordering provider catalogs cannot silently change the policy recommendation.
  const sorted = [...allowed].sort(
    (a, b) =>
      getJevModelProfile(a.model!)!.capabilityRank - getJevModelProfile(b.model!)!.capabilityRank ||
      JEV_EFFORTS.indexOf(a.effort!) - JEV_EFFORTS.indexOf(b.effort!) ||
      a.key.localeCompare(b.key),
  );
  // A raw stronger proposal is not evidence that its extra capacity is necessary.
  // Keep it visible and review large disagreements instead of silently overspending.
  const minimum = sorted[0];
  const selectedModel = models.find((model) => model.model === minimum?.model);
  const effortAssessment = selectedModel ? decoded[`effort_${selectedModel.key}`] : undefined;
  const conditionalEffort =
    selectedModel && effortAssessment
      ? {
          model: selectedModel.model,
          effort: effortAssessment.recommendedChoice as JevEffort,
          confidence: effortAssessment.confidence!,
        }
      : undefined;
  // Model-specific effort judgments carry information beyond the coarse task floors.
  // Economize model capability without discarding the effort needed by that model.
  const minimumEffort = Math.max(
    JEV_EFFORTS.indexOf(minimum?.effort ?? "low"),
    JEV_EFFORTS.indexOf(conditionalEffort?.effort ?? "low"),
  );
  const selected = sorted.find(
    (candidate) =>
      candidate.model === minimum?.model && JEV_EFFORTS.indexOf(candidate.effort!) >= minimumEffort,
  );
  if (!selected)
    return {
      ...common,
      policyOutcome: "review",
      reasons: [...reasons, "no_admissible_pair"],
      admissibleCandidateKeys: [],
      error: "No available pair meets the task requirements. Choose explicitly before sending.",
    };
  if (selected.key !== proposal.key) reasons.push("proposal_adjusted_by_capability_policy");
  const demandConfidence = Math.min(...demandKeys.map((key) => decoded[key]!.confidence ?? 0));
  const uncertaintyAlternatives: Record<string, string[]> = {};
  let scenarios: Demand[] = [values];
  for (const key of demandKeys) {
    const assessment = assessments[key]!;
    if (assessment.confidence >= 0.5) continue;
    const alternatives = Object.entries(assessment.probabilities)
      .filter(
        ([label, score]) =>
          label === assessment.choice ||
          score >= ALTERNATIVE_SCORE_FLOOR ||
          (key === "context_status" && label === "missing" && score > 0),
      )
      .map(([label]) => label);
    uncertaintyAlternatives[key] = alternatives;
    // Check combined alternatives too: e.g. high consequence plus an invariant.
    scenarios = scenarios.flatMap((scenario) =>
      alternatives.map((label) => ({ ...scenario, [key]: label })),
    );
  }
  const selectedRank = getJevModelProfile(selected.model!)!.capabilityRank;
  const selectedEffort = JEV_EFFORTS.indexOf(selected.effort!);
  const demandsStable = scenarios.every((scenario) => {
    if (scenario.context_status === "missing") return false;
    const alternative = requirements(scenario);
    return (
      selectedRank >= alternative.rank && selectedEffort >= JEV_EFFORTS.indexOf(alternative.effort)
    );
  });
  const effortAlternatives =
    effortAssessment!.confidence! < 0.5
      ? Object.entries(effortAssessment!.probabilities)
          .filter(
            ([label, score]) =>
              label === conditionalEffort!.effort || score >= ALTERNATIVE_SCORE_FLOOR,
          )
          .map(([label]) => label)
      : [conditionalEffort!.effort];
  if (effortAssessment!.confidence! < 0.5)
    uncertaintyAlternatives[`effort_${selectedModel!.key}`] = effortAlternatives;
  const effortStable = effortAlternatives.every(
    (alternative) => selectedEffort >= JEV_EFFORTS.indexOf(alternative as JevEffort),
  );
  const decisionStable = demandsStable && effortStable;
  const proposalRank = getJevModelProfile(proposal.model!)?.capabilityRank ?? 0;
  const substantialDisagreement = base.confidence! >= 0.5 && proposalRank >= selectedRank + 2;
  const unresolvedAttribution =
    request.context.failure?.unresolved && !request.context.failure.model;
  const incompleteEvidence = (request.context.missingContext?.length ?? 0) > 0;
  const needsReview =
    !decisionStable || substantialDisagreement || unresolvedAttribution || incompleteEvidence;
  if (!decisionStable) reasons.push("uncertainty_changes_required_capability");
  else if (demandConfidence < 0.5) reasons.push("uncertainty_within_selected_capability");
  if (substantialDisagreement) reasons.push("model_demand_disagreement");
  if (unresolvedAttribution) reasons.push("failed_attempt_model_unknown");
  if (incompleteEvidence) reasons.push("context_omissions_require_review");
  return {
    ...common,
    choice: needsReview ? null : selected.key,
    recommendedChoice: selected.key,
    confidence: demandConfidence,
    decisionStable,
    uncertaintyAlternatives,
    effortConfidence: proposedEffort!.confidence,
    ...(conditionalEffort ? { conditionalEffort } : {}),
    policyOutcome: needsReview ? "review" : "route",
    reasons,
    admissibleCandidateKeys: allowed.map((candidate) => candidate.key),
    error: needsReview ? "Review the task assessment and recommended pair before sending." : null,
    explanation: `Capability policy requires tier ${rank} or higher and ${effort} effort or higher: ${reasons.join(", ")}. This uses the least provisioned compatible model meeting those requirements, with at least its proposed effort and the policy effort floor; it is not measured expected cost or success. Low-confidence alternatives scoring at least 0.20 (and any scored missing-context alternative) were checked jointly; stability means only that they fit this pair. Raw assessment confidence is unchanged.`,
  };
}
