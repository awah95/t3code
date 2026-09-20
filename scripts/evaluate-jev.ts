/** Evaluate routing decisions only. Expected labels never enter the Jev request. */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodePerfHooks from "node:perf_hooks";
import type { JevRoutingContext } from "@t3tools/contracts";
import {
  JEV_MODEL_PROFILES,
  JEV_EFFORTS,
  describeJevCandidate,
  isJevCandidateAllowed,
} from "../packages/shared/src/jevRouting.ts";
import {
  requestJevDecision,
  buildJevDecisionBody,
  JEV_TIMEOUT_MS,
  jevEvaluationPolicyVersion,
} from "../apps/desktop/src/jev/decision.ts";

type Pair = { model: string; effort: string };
type Case = {
  id: string;
  category: string;
  split?: string;
  prompt: string;
  context: JevRoutingContext;
  expected: { preferred: Pair; acceptable: Pair[]; rationale: string; decision?: string };
};
const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : (args[i + 1] ?? fallback);
};
const corpusPath = NodePath.resolve(arg("--cases", "JEV_ROUTING_EVALUATION.json"));
const baselineV3 = args.includes("--baseline-v3");
const baselineV41 = args.includes("--baseline-v4.1");
if (baselineV3 && baselineV41)
  throw new Error("Choose only one baseline: --baseline-v3 or --baseline-v4.1.");
const evaluationPolicy = baselineV3
  ? ("baseline-v3" as const)
  : baselineV41
    ? ("baseline-v4.1" as const)
    : undefined;
const baselineCommit = baselineV41
  ? "3cee8857375a88260ad08435324663395770ed4c"
  : baselineV3
    ? "ffacb6f782dc7b9772a4c31e924a303a4b2181d9"
    : null;
const output = NodePath.resolve(
  arg(
    "--output",
    evaluationPolicy
      ? `JEV_ROUTING_RESULTS_V5_${evaluationPolicy}.json`
      : "JEV_ROUTING_RESULTS_V5.json",
  ),
);
const limit = Number(arg("--max-calls", "56"));
const budget = Number(arg("--budget-usd", "0.25"));
const dry = args.includes("--dry-run");
if (
  !Number.isInteger(limit) ||
  limit < 1 ||
  limit > 100 ||
  !Number.isFinite(budget) ||
  budget <= 0 ||
  budget > 1
)
  throw new Error("Use 1–100 calls and a budget between $0 and $1.");
const corpus = JSON.parse(await NodeFSP.readFile(corpusPath, "utf8")) as { cases: Case[] };
if (!Array.isArray(corpus.cases) || corpus.cases.length === 0)
  throw new Error("No evaluation cases.");
const cases = corpus.cases.slice(0, limit);
const allCandidates = JEV_MODEL_PROFILES.flatMap((profile) =>
  JEV_EFFORTS.map((effort) => ({
    key: `${profile.model.replaceAll(".", "_").replaceAll("-", "_")}_${effort}`,
    model: profile.model,
    effort,
    description: describeJevCandidate(profile.model, effort),
  })),
);
const requests = cases.map((entry) => {
  if (typeof entry.prompt !== "string" || !entry.context || typeof entry.id !== "string")
    throw new Error("Invalid evaluation case.");
  return {
    requestId: `jev-eval-${NodeCrypto.randomUUID()}`,
    ...(evaluationPolicy ? { evaluationPolicy } : {}),
    prompt: entry.prompt,
    context: entry.context,
    candidates: allCandidates.filter((candidate) =>
      isJevCandidateAllowed(candidate, entry.context),
    ),
  };
});
if (dry) {
  console.log(
    JSON.stringify({
      dryRun: true,
      cases: cases.length,
      maxPayloadChars: Math.max(
        ...requests.map((request) => JSON.stringify(buildJevDecisionBody(request)).length),
      ),
      policy: jevEvaluationPolicyVersion(requests[0]!),
      baselineCommit,
      candidateCounts: [...new Set(requests.map((r) => r.candidates.length))],
      expectedLabelsSent: false,
    }),
  );
  process.exit(0);
}
let apiKey = process.env.OPENROUTER_API_KEY;
if (args.includes("--key-stdin")) {
  let input = "";
  for await (const chunk of process.stdin) input += chunk.toString();
  apiKey = input.trim();
}
if (!apiKey)
  throw new Error("Provide OPENROUTER_API_KEY or --key-stdin. Keys are never written to results.");
const rows: Record<string, unknown>[] = [];
let billed = 0;
let estimated = 0;
let unknown = 0;
const start = NodePerfHooks.performance.now();
const same = (a: Pair | null, b: Pair) => a?.model === b.model && a.effort === b.effort;
const meta = () => ({
  policy: jevEvaluationPolicyVersion(requests[0]!),
  baselineCommit,
  evaluatedAt: new Date().toISOString(),
  corpus: corpusPath,
  maximumCalls: limit,
  budgetStopUsd: budget,
  elapsedMs: Math.round(NodePerfHooks.performance.now() - start),
  billedUsd: billed,
  estimatedUsd: estimated,
  unknownCostCalls: unknown,
  expectedLabelsSent: false,
  taskExecutions: 0,
  note: "Budget checked between calls; last call can exceed the stop amount. Label agreement is not execution success, weekly savings, or calibrated confidence.",
  rows,
});
await NodeFSP.mkdir(NodePath.dirname(output), { recursive: true });
for (const [index, entry] of cases.entries()) {
  if (billed + estimated >= budget || unknown > 0) break;
  const request = requests[index]!;
  const result =
    request.candidates.length === 0
      ? null
      : await requestJevDecision(request, apiKey, AbortSignal.timeout(JEV_TIMEOUT_MS));
  if (result?.costKind === "billed") billed += result.costUsd ?? 0;
  else if (result?.costKind === "estimated") estimated += result.costUsd ?? 0;
  else if (result) unknown++;
  const recommended = request.candidates.find(
    (candidate) => candidate.key === (result?.recommendedChoice ?? result?.choice),
  );
  const pair = recommended ? { model: recommended.model, effort: recommended.effort } : null;
  const automatic = request.candidates.find((candidate) => candidate.key === result?.choice);
  const autoPair = automatic
    ? { model: automatic.model, effort: automatic.effort }
    : result?.policyOutcome
      ? null
      : entry.context.currentModel && entry.context.currentEffort
        ? { model: entry.context.currentModel, effort: entry.context.currentEffort }
        : null;
  rows.push({
    id: entry.id,
    category: entry.category,
    split: entry.split,
    prompt: entry.prompt,
    expected: entry.expected,
    recommended: pair,
    automaticSelection: autoPair,
    matchesPreferred: same(pair, entry.expected.preferred),
    matchesAcceptable:
      entry.expected.decision === "needs_context"
        ? null
        : entry.expected.acceptable.some((expected) => same(pair, expected)),
    matchesDecision: entry.expected.decision
      ? (result?.policyOutcome ?? (result?.choice ? "route" : "fallback")) ===
        entry.expected.decision
      : null,
    context: request.context,
    candidates: request.candidates,
    arm: evaluationPolicy ?? "current",
    candidateCount: request.candidates.length,
    result,
  });
  await NodeFSP.writeFile(output, JSON.stringify(meta(), null, 2));
  console.log(
    `${index + 1}/${cases.length} ${entry.id}: ${pair ? pair.model + "/" + pair.effort : "no recommendation"}; confidence=${result?.confidence ?? "unknown"}; acceptable=${entry.expected.acceptable.some((expected) => same(pair, expected))}`,
  );
}
await NodeFSP.writeFile(output, JSON.stringify(meta(), null, 2));
console.log(
  JSON.stringify({
    completed: rows.length,
    billedUsd: billed,
    estimatedUsd: estimated,
    unknownCostCalls: unknown,
    output,
  }),
);
