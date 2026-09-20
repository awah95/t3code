import { useState } from "react";
import { randomUUID } from "../lib/utils";
import { create } from "zustand";
import * as Schema from "effect/Schema";
import { JevRoutingContext, type JevRouteResult } from "@t3tools/contracts";
import {
  JEV_MODEL_PROFILES,
  JEV_EFFORTS,
  JEV_POLICY_VERSION,
  describeJevCandidate,
  isJevCandidateAllowed,
  sanitizeJevContext,
  sanitizeJevText,
} from "@t3tools/shared/jevRouting";
import { Button } from "../components/ui/button";

type Pair = { model: string; effort: string };
type EvaluationCase = {
  id: string;
  prompt: string;
  context: JevRoutingContext;
  expected: {
    preferred: Pair;
    acceptable: readonly Pair[];
    decision?: string;
    minimumCapabilityRank?: number;
  };
  category?: string;
  split?: string;
};
type Row = {
  id: string;
  arm: "baseline-v3" | "baseline-v4.1" | "current";
  context: JevRoutingContext;
  candidates: readonly { key: string; model: string; effort: string; description: string }[];
  category?: string;
  split?: string;
  prompt: string;
  expected: EvaluationCase["expected"];
  recommended: Pair | null;
  automaticSelection: Pair | null;
  matchesPreferred: boolean;
  matchesAcceptable: boolean | null;
  matchesDecision: boolean | null;
  result: JevRouteResult;
};
const pair = Schema.Struct({ model: Schema.String, effort: Schema.String });
const corpusSchema = Schema.Struct({
  cases: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      prompt: Schema.String,
      context: JevRoutingContext,
      expected: Schema.Struct({
        preferred: pair,
        acceptable: Schema.Array(pair),
        decision: Schema.optionalKey(Schema.String),
        minimumCapabilityRank: Schema.optionalKey(Schema.Number),
      }),
      category: Schema.optionalKey(Schema.String),
      split: Schema.optionalKey(Schema.String),
    }),
  ),
});
const same = (a: Pair | null, b: Pair) => a?.model === b.model && a.effort === b.effort;

/** Uses the existing desktop credential bridge; no key is exposed to this evaluation UI. */
const useEvaluation = create<{
  cases: readonly EvaluationCase[];
  rows: Row[];
  running: boolean;
  message: string;
}>(() => ({ cases: [], rows: [], running: false, message: "" }));
let active: string | null = null;
let stopped = false;
export function JevEvaluation() {
  const [comparison, setComparison] = useState(false);
  const [baselineArm, setBaselineArm] = useState<"baseline-v3" | "baseline-v4.1">("baseline-v4.1");
  const { cases, rows, running, message } = useEvaluation();
  const setCases = (cases: readonly EvaluationCase[]) => useEvaluation.setState({ cases });
  const setRows = (rows: Row[]) => useEvaluation.setState({ rows });
  const setRunning = (running: boolean) => useEvaluation.setState({ running });
  const setMessage = (message: string | ((current: string) => string)) =>
    useEvaluation.setState((state) => ({
      message: typeof message === "string" ? message : message(state.message),
    }));
  const costs = rows.reduce((sum, row) => sum + (row.result.costUsd ?? 0), 0);
  const download = () => {
    const report = {
      policy: JEV_POLICY_VERSION,
      baselineCommit: rows.some((row) => row.arm === "baseline-v4.1")
        ? "3cee8857375a88260ad08435324663395770ed4c"
        : rows.some((row) => row.arm === "baseline-v3")
          ? "ffacb6f782dc7b9772a4c31e924a303a4b2181d9"
          : null,
      baselinePolicy: rows.find((row) => row.arm !== "current")?.result.policyVersion ?? null,
      comparison: rows.some((row) => row.arm !== "current"),
      evaluatedAt: new Date().toISOString(),
      rows,
      billedUsd: rows
        .filter((r) => r.result.costKind === "billed")
        .reduce((sum, r) => sum + (r.result.costUsd ?? 0), 0),
      estimatedUsd: rows
        .filter((r) => r.result.costKind === "estimated")
        .reduce((sum, r) => sum + (r.result.costUsd ?? 0), 0),
      expectedLabelsSent: false,
      taskExecutions: 0,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = rows.some((row) => row.arm !== "current")
      ? "JEV_ROUTING_COMPARISON_V5.json"
      : "JEV_ROUTING_RESULTS_V5.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const run = async () => {
    if (useEvaluation.getState().running || !window.desktopBridge?.decideJevRoute) return;
    setRunning(true);
    stopped = false;
    setRows([]);
    setMessage("");
    const completed: Row[] = [];
    let cost = 0;
    const candidates = JEV_MODEL_PROFILES.flatMap((profile) =>
      JEV_EFFORTS.map((effort) => ({
        key: `${profile.model.replaceAll(".", "_").replaceAll("-", "_")}_${effort}`,
        model: profile.model,
        effort,
        description: describeJevCandidate(profile.model, effort),
      })),
    );
    try {
      const jobs = cases
        .slice(0, comparison ? 24 : 56)
        .flatMap((item) =>
          (comparison ? ([baselineArm, "current"] as const) : (["current"] as const)).map(
            (arm) => ({ item, arm }),
          ),
        );
      for (const { item, arm } of jobs) {
        if (stopped || cost >= 0.25) break;
        const requestId = `jev-eval-${randomUUID()}`;
        active = requestId;
        // Deliberately construct the payload, never spread corpus fields (which contain expected labels).
        const allowed = candidates.filter((candidate) =>
          isJevCandidateAllowed(candidate, item.context),
        );
        const result = await window.desktopBridge.decideJevRoute({
          requestId,
          prompt: sanitizeJevText(item.prompt),
          context: sanitizeJevContext(item.context),
          ...(arm !== "current" ? { evaluationPolicy: arm } : {}),
          candidates: allowed,
        });
        const chosen = allowed.find(
          (candidate) => candidate.key === (result.recommendedChoice ?? result.choice),
        );
        const automatic = allowed.find((candidate) => candidate.key === result.choice);
        const recommended = chosen ? { model: chosen.model, effort: chosen.effort } : null;
        const automaticSelection = automatic
          ? { model: automatic.model, effort: automatic.effort }
          : result.policyOutcome
            ? null
            : item.context.currentModel && item.context.currentEffort
              ? { model: item.context.currentModel, effort: item.context.currentEffort }
              : null;
        completed.push({
          id: item.id,
          arm,
          context: sanitizeJevContext(item.context),
          candidates: allowed,
          ...(item.category ? { category: item.category } : {}),
          ...(item.split ? { split: item.split } : {}),
          prompt: item.prompt,
          expected: item.expected,
          recommended,
          automaticSelection,
          matchesPreferred: same(recommended, item.expected.preferred),
          matchesAcceptable:
            item.expected.decision === "needs_context"
              ? null
              : item.expected.acceptable.some((entry) => same(recommended, entry)),
          matchesDecision: item.expected.decision
            ? (result.policyOutcome ?? (result.choice ? "route" : "fallback")) ===
              item.expected.decision
            : null,
          result,
        });
        cost += result.costUsd ?? 0;
        setRows([...completed]);
        if (result.costKind === "unknown") {
          setMessage(
            "Stopped because request cost is unknown; inspect the result before retrying.",
          );
          break;
        }
      }
      setMessage(
        (current) =>
          current ||
          (stopped
            ? "Evaluation stopped."
            : cost >= 0.25
              ? "Stopped at the cost budget."
              : "Evaluation complete. Download results for review."),
      );
    } catch {
      setMessage("Evaluation stopped after a transport error. Completed results are available.");
    } finally {
      active = null;
      setRunning(false);
    }
  };
  return (
    <details className="space-y-2 text-xs">
      <summary>Evaluate a prompt set</summary>
      <p>
        Choose the evaluation JSON companion. This sends up to 56 cases to Jev through your saved
        key and executes no coding tasks. Expected labels stay local. Stops between calls at $0.25;
        the last call can exceed that amount. Evaluation costs are tracked here separately from the
        chat log.
      </p>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={comparison}
          disabled={running}
          onChange={(event) => setComparison(event.target.checked)}
        />
        Compare committed baseline with current policy (24 cases, 48 calls maximum)
      </label>
      <label className="flex items-center gap-2">
        Comparison baseline
        <select
          value={baselineArm}
          disabled={running}
          onChange={(event) =>
            setBaselineArm(event.target.value as "baseline-v3" | "baseline-v4.1")
          }
        >
          <option value="baseline-v4.1">v4.1 · 3cee88573</option>
          <option value="baseline-v3">v3 · ffacb6f78</option>
        </select>
      </label>
      <input
        aria-label="Evaluation prompt file"
        type="file"
        accept=".json,application/json"
        disabled={running}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          try {
            const data: unknown = JSON.parse(await file.text());
            if (
              !Schema.is(corpusSchema)(data) ||
              data.cases.length === 0 ||
              data.cases.length > 100
            )
              throw new Error();
            setCases(data.cases);
            setRows([]);
            setMessage(`${data.cases.length} cases loaded.`);
          } catch {
            setCases([]);
            setMessage(
              "Choose a valid evaluation JSON with 1–100 cases and expected model/effort labels.",
            );
          }
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={running || cases.length === 0} onClick={() => void run()}>
          Run evaluation
        </Button>
        {running && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              stopped = true;
              if (active) void window.desktopBridge?.cancelJevRoute?.(active);
            }}
          >
            Stop evaluation
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={rows.length === 0 || running}
          onClick={download}
        >
          Download results
        </Button>
      </div>
      <p role="status">
        {message} {rows.length}/
        {Math.min(cases.length, comparison ? 24 : 56) * (comparison ? 2 : 1)} evaluated · $
        {costs.toFixed(6)} billed/estimated · {rows.filter((r) => r.matchesAcceptable).length}{" "}
        within expected pair range (missing-context cases excluded).
      </p>
    </details>
  );
}
