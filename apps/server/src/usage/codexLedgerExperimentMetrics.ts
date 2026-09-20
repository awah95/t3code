/** A run is one attempt. Several attempts, including repairs, belong to one case. */
export interface ExperimentAttempt {
  readonly runId: string;
  readonly caseId: string;
  readonly cohort: string;
  readonly status: "planned" | "running" | "accepted" | "failed" | "unknown";
  readonly roots: readonly string[];
  readonly rateSnapshotId: string | null;
  readonly apiSubtotalUsd: string | null;
  readonly apiComplete: boolean;
  readonly unpricedResponseCount: number;
  readonly jevReportedUsd: string | null;
  readonly jevEstimatedUsd: string | null;
  readonly jevCombinedEstimateUsd: string | null;
  readonly jevUnknownCount: number;
  readonly toolCalls: number | null;
  readonly wallTimeMs: number | null;
  readonly humanIntervention: boolean | null;
  readonly qualityAccepted: boolean | null;
  readonly acceptanceEvidencePresent: boolean;
}

export interface ExperimentCaseReport {
  readonly caseId: string;
  readonly cohort: string;
  readonly runIds: readonly string[];
  readonly attemptCount: number;
  readonly failedAttempts: number;
  readonly accepted: boolean | null;
  readonly firstPassAccepted: boolean | null;
  readonly apiSubtotalUsd: string | null;
  readonly apiCompleteUsd: string | null;
  readonly unpricedResponseCount: number;
  readonly jevReportedUsd: string | null;
  readonly jevEstimatedUsd: string | null;
  readonly combinedScenarioUsd: string | null;
  readonly jevUnknownCount: number;
  readonly toolCalls: number | null;
  readonly wallTimeMs: number | null;
  readonly humanIntervention: boolean | null;
  readonly rootCount: number;
  readonly coverageReasons: readonly string[];
}

export interface ExperimentCohortReport {
  readonly cohort: string;
  readonly caseCount: number;
  readonly acceptedCaseCount: number;
  readonly failedCaseCount: number;
  readonly unresolvedCaseCount: number;
  readonly firstPassAcceptedCount: number;
  readonly costPerAcceptedCaseUsd: string | null;
  readonly combinedCostPerAcceptedCaseUsd: string | null;
  readonly apiCompleteUsd: string | null;
  readonly apiSubtotalUsd: string | null;
  readonly unpricedResponseCount: number;
  readonly coverageReasons: readonly string[];
}

export interface ExperimentReport {
  readonly rateSnapshotId: string | null;
  readonly cases: readonly ExperimentCaseReport[];
  readonly cohorts: readonly ExperimentCohortReport[];
  readonly comparable: boolean;
  readonly pairedCaseCount: number;
  readonly comparisonReasons: readonly string[];
}

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
type Decimal = { units: bigint; scale: number };
function parse(value: string): Decimal {
  if (!DECIMAL.test(value)) throw new Error(`Invalid USD decimal: ${value}`);
  const [whole, fraction = ""] = value.split(".");
  return { units: BigInt(whole + fraction), scale: fraction.length };
}
function sum(values: readonly string[]): string {
  if (values.length === 0) return "0";
  const decimals = values.map(parse);
  const scale = Math.max(...decimals.map((value) => value.scale));
  const units = decimals.reduce(
    (total, value) => total + value.units * 10n ** BigInt(scale - value.scale),
    0n,
  );
  const digits = units.toString().padStart(scale + 1, "0");
  return (scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}
export const sumExactUsd = sum;
function divide(value: string, count: number): string {
  const decimal = parse(value);
  const precision = 8;
  const scaled = decimal.units * 10n ** BigInt(precision);
  const divisor = BigInt(count);
  const rounded = (scaled + divisor / 2n) / divisor;
  const digits = rounded.toString().padStart(decimal.scale + precision + 1, "0");
  return `${digits.slice(0, -(decimal.scale + precision))}.${digits.slice(-(decimal.scale + precision))}`
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}
const knownSum = (values: readonly (string | null)[]): string | null =>
  values.every((value) => value !== null) ? sum(values as string[]) : null;
const knownSubtotal = (values: readonly (string | null)[]): string | null => {
  const known = values.filter((value): value is string => value !== null);
  return known.length ? sum(known) : null;
};
const numericSum = (values: readonly (number | null)[]): number | null =>
  values.every((value) => value !== null) ? (values as number[]).reduce((a, b) => a + b, 0) : null;

/** No savings verdict is emitted when coverage, pairing, or the fixed price basis is incomplete. */
export function reportExperiment(
  attempts: readonly ExperimentAttempt[],
  declaredRateSnapshotId: string | null,
  plan: { corpusDeclared?: boolean; acceptanceDeclared?: boolean; harnessDeclared?: boolean } = {},
): ExperimentReport {
  const groups = new Map<string, ExperimentAttempt[]>();
  for (const attempt of attempts) {
    const key = JSON.stringify([attempt.cohort, attempt.caseId]);
    groups.set(key, [...(groups.get(key) ?? []), attempt]);
  }
  const rootOwners = new Map<string, string>();
  const duplicateRoots = new Set<string>();
  for (const attempt of attempts)
    for (const root of attempt.roots) {
      const owner = rootOwners.get(root);
      if (owner && owner !== attempt.runId) duplicateRoots.add(root);
      else rootOwners.set(root, attempt.runId);
    }
  const cases = [...groups.values()].map((runs): ExperimentCaseReport => {
    const first = runs[0]!;
    const priced = runs.map((run) => run.apiSubtotalUsd);
    const reasons: string[] = [];
    if (runs.some((run) => !run.apiComplete || run.apiSubtotalUsd === null))
      reasons.push("api_valuation_incomplete");
    if (
      runs.some((run) => run.rateSnapshotId !== declaredRateSnapshotId) ||
      !declaredRateSnapshotId
    )
      reasons.push("rate_snapshot_mismatch");
    if (runs.some((run) => run.roots.length === 0)) reasons.push("root_turn_unlinked");
    if (runs.some((run) => run.roots.some((root) => duplicateRoots.has(root))))
      reasons.push("root_turn_reused");
    if (runs.some((run) => run.qualityAccepted === null)) reasons.push("quality_unknown");
    if (
      runs.some(
        (run) =>
          (run.status === "accepted" || run.status === "failed") && !run.acceptanceEvidencePresent,
      )
    )
      reasons.push("validation_evidence_missing");
    if (runs.some((run) => run.jevUnknownCount > 0 || run.jevCombinedEstimateUsd === null))
      reasons.push("jev_overhead_unknown");
    const accepted = runs.some((run) => run.status === "accepted" && run.qualityAccepted === true)
      ? true
      : runs.every((run) => run.status === "failed")
        ? false
        : null;
    const firstPassAccepted = first.status === "accepted" && first.qualityAccepted === true;
    const apiSubtotalUsd = reasons.includes("root_turn_reused") ? null : knownSum(priced);
    return {
      caseId: first.caseId,
      cohort: first.cohort,
      runIds: runs.map((run) => run.runId),
      attemptCount: runs.length,
      failedAttempts: runs.filter((run) => run.status === "failed").length,
      accepted,
      firstPassAccepted,
      apiSubtotalUsd,
      apiCompleteUsd:
        reasons.includes("api_valuation_incomplete") ||
        reasons.includes("rate_snapshot_mismatch") ||
        reasons.includes("root_turn_unlinked") ||
        reasons.includes("root_turn_reused")
          ? null
          : apiSubtotalUsd,
      unpricedResponseCount: runs.reduce((count, run) => count + run.unpricedResponseCount, 0),
      jevReportedUsd: knownSubtotal(runs.map((run) => run.jevReportedUsd)),
      jevEstimatedUsd: knownSubtotal(runs.map((run) => run.jevEstimatedUsd)),
      combinedScenarioUsd:
        reasons.includes("jev_overhead_unknown") ||
        apiSubtotalUsd === null ||
        reasons.includes("api_valuation_incomplete") ||
        reasons.includes("root_turn_reused") ||
        reasons.includes("root_turn_unlinked")
          ? null
          : sum([apiSubtotalUsd, knownSum(runs.map((run) => run.jevCombinedEstimateUsd))!]),
      jevUnknownCount: runs.reduce((count, run) => count + run.jevUnknownCount, 0),
      toolCalls: numericSum(runs.map((run) => run.toolCalls)),
      wallTimeMs: numericSum(runs.map((run) => run.wallTimeMs)),
      humanIntervention: runs.some((run) => run.humanIntervention === true)
        ? true
        : runs.every((run) => run.humanIntervention === false)
          ? false
          : null,
      rootCount: new Set(runs.flatMap((run) => run.roots)).size,
      coverageReasons: reasons,
    };
  });
  const byCohort = new Map<string, ExperimentCaseReport[]>();
  for (const item of cases) byCohort.set(item.cohort, [...(byCohort.get(item.cohort) ?? []), item]);
  const cohorts = [...byCohort].map(([cohort, items]): ExperimentCohortReport => {
    const reasons = [...new Set(items.flatMap((item) => item.coverageReasons))];
    if (items.some((item) => item.accepted === null)) reasons.push("outcome_unresolved");
    const apiSubtotalUsd = knownSum(items.map((item) => item.apiSubtotalUsd));
    const apiCompleteUsd = knownSum(items.map((item) => item.apiCompleteUsd));
    const combinedScenarioUsd =
      reasons.length === 0 ? knownSum(items.map((item) => item.combinedScenarioUsd)) : null;
    const acceptedCaseCount = items.filter((item) => item.accepted === true).length;
    return {
      cohort,
      caseCount: items.length,
      acceptedCaseCount,
      failedCaseCount: items.filter((item) => item.accepted === false).length,
      unresolvedCaseCount: items.filter((item) => item.accepted === null).length,
      firstPassAcceptedCount: items.filter((item) => item.firstPassAccepted === true).length,
      costPerAcceptedCaseUsd:
        apiCompleteUsd !== null && acceptedCaseCount > 0
          ? divide(apiCompleteUsd, acceptedCaseCount)
          : null,
      combinedCostPerAcceptedCaseUsd:
        combinedScenarioUsd !== null && acceptedCaseCount > 0
          ? divide(combinedScenarioUsd, acceptedCaseCount)
          : null,
      apiCompleteUsd,
      apiSubtotalUsd,
      unpricedResponseCount: items.reduce((count, item) => count + item.unpricedResponseCount, 0),
      coverageReasons: reasons,
    };
  });
  const comparisonReasons: string[] = [];
  if (!declaredRateSnapshotId) comparisonReasons.push("rate_snapshot_not_declared");
  if (plan.corpusDeclared === false) comparisonReasons.push("corpus_not_declared");
  if (plan.acceptanceDeclared === false) comparisonReasons.push("acceptance_not_declared");
  if (plan.harnessDeclared === false) comparisonReasons.push("harness_not_declared");
  if (cohorts.length !== 2) comparisonReasons.push("two_cohorts_required");
  if (cohorts.some((cohort) => cohort.combinedCostPerAcceptedCaseUsd === null))
    comparisonReasons.push("cohort_incomplete");
  const caseSets = [...byCohort.values()].map((items) => new Set(items.map((item) => item.caseId)));
  const pairedCaseCount =
    caseSets.length === 2 ? [...caseSets[0]!].filter((id) => caseSets[1]!.has(id)).length : 0;
  if (
    caseSets.length === 2 &&
    (caseSets[0]!.size !== pairedCaseCount || caseSets[1]!.size !== pairedCaseCount)
  )
    comparisonReasons.push("cases_not_paired");
  return {
    rateSnapshotId: declaredRateSnapshotId,
    cases,
    cohorts,
    comparable: comparisonReasons.length === 0,
    pairedCaseCount,
    comparisonReasons,
  };
}
