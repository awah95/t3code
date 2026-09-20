import { describe, expect, it } from "@effect/vitest";
import { reportExperiment, type ExperimentAttempt } from "./codexLedgerExperimentMetrics.ts";

const attempt = (overrides: Partial<ExperimentAttempt>): ExperimentAttempt => ({
  runId: "a1",
  caseId: "case-a",
  cohort: "baseline",
  status: "failed",
  roots: ["source:root-a1"],
  rateSnapshotId: "rates-v1",
  apiSubtotalUsd: "0.10",
  apiComplete: true,
  unpricedResponseCount: 0,
  jevReportedUsd: "0",
  jevEstimatedUsd: "0",
  jevUnknownCount: 0,
  jevCombinedEstimateUsd: "0",
  toolCalls: 2,
  wallTimeMs: 1000,
  humanIntervention: false,
  qualityAccepted: false,
  acceptanceEvidencePresent: true,
  ...overrides,
});

describe("experiment cost per accepted case", () => {
  it("includes failed attempts and repair under the case, keeping Jev charges separate", () => {
    const report = reportExperiment(
      [
        attempt({}),
        attempt({
          runId: "a2",
          roots: ["source:root-a2"],
          status: "accepted",
          qualityAccepted: true,
          apiSubtotalUsd: "0.25",
          jevReportedUsd: "0.02",
          jevEstimatedUsd: "0.03",
          jevCombinedEstimateUsd: "0.05",
          toolCalls: 3,
        }),
        attempt({
          runId: "b1",
          cohort: "candidate",
          roots: ["source:root-b1"],
          status: "accepted",
          qualityAccepted: true,
          apiSubtotalUsd: "0.20",
        }),
      ],
      "rates-v1",
    );
    expect(report.comparable).toBe(true);
    expect(report.pairedCaseCount).toBe(1);
    expect(report.cases[0]!).toMatchObject({
      attemptCount: 2,
      failedAttempts: 1,
      accepted: true,
      firstPassAccepted: false,
      apiCompleteUsd: "0.35",
      jevReportedUsd: "0.02",
      jevEstimatedUsd: "0.03",
      toolCalls: 5,
    });
    expect(report.cohorts[0]!.costPerAcceptedCaseUsd).toBe("0.35");
    expect(report.cohorts[0]!.combinedCostPerAcceptedCaseUsd).toBe("0.4");
  });

  it("withholds a savings comparison when price, roots, quality, or pairing is missing", () => {
    const report = reportExperiment(
      [
        attempt({ apiComplete: false, unpricedResponseCount: 1, roots: [] }),
        attempt({
          runId: "b1",
          cohort: "candidate",
          caseId: "different-case",
          roots: ["source:root-b1"],
          status: "accepted",
          qualityAccepted: null,
          rateSnapshotId: "other-rate",
        }),
      ],
      "rates-v1",
    );
    expect(report.comparable).toBe(false);
    expect(report.cohorts[0]!.costPerAcceptedCaseUsd).toBeNull();
    expect(report.comparisonReasons).toContain("cases_not_paired");
    expect(report.cases[0]!.coverageReasons).toContain("root_turn_unlinked");
  });

  it("does not count a shared root twice across attempts", () => {
    const report = reportExperiment(
      [attempt({}), attempt({ runId: "a2", status: "accepted", qualityAccepted: true })],
      "rates-v1",
    );
    expect(report.cases[0]!.apiCompleteUsd).toBeNull();
    expect(report.cases[0]!.coverageReasons).toContain("root_turn_reused");
  });
});
