/** Evaluate routing decisions only. Expected labels never enter the Jev request. */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodePerfHooks from "node:perf_hooks";
import type { JevRoutingContext } from "@t3tools/contracts";
import {
  JEV_MODEL_PROFILES,
  JEV_EFFORTS,
  JEV_POLICY_VERSION,
  describeJevCandidate,
  isJevCandidateAllowed,
} from "../packages/shared/src/jevRouting.ts";
import {
  requestJevDecision,
  buildJevDecisionBody,
  JEV_TIMEOUT_MS,
} from "../apps/desktop/src/jev/decision.ts";

type Pair = { model: string; effort: string };
type Case = {
  id: string;
  category: string;
  split?: string;
  prompt: string;
  context: JevRoutingContext;
  expected: { preferred: Pair; acceptable: Pair[]; rationale: string };
};
const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : (args[i + 1] ?? fallback);
};
const corpusPath = NodePath.resolve(arg("--cases", "JEV_ROUTING_EVALUATION.json"));
const output = NodePath.resolve(arg("--output", "JEV_ROUTING_RESULTS.json"));
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
    requestId: NodeCrypto.randomUUID(),
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
      policy: JEV_POLICY_VERSION,
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
  policy: JEV_POLICY_VERSION,
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
    matchesAcceptable: entry.expected.acceptable.some((expected) => same(pair, expected)),
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
