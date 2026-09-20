import { buildAssessmentQuestions, parseAssessmentDecision } from "./assessment.ts";
import type { JevRouteRequest, JevRouteResult } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import {
  getJevModelProfile,
  isJevCandidateAllowed,
  JEV_EFFORT_GUIDANCE,
  JEV_MAX_REQUEST_CHARS,
  JEV_MODEL_PROFILES,
  JEV_POLICY_VERSION,
  JEV_ROUTING_INSTRUCTIONS,
  JEV_WORKLOAD_PROFILE,
  sanitizeJevContext,
  sanitizeJevText,
} from "@t3tools/shared/jevRouting";

export const JEV_MODEL = "typesafe/jev-1.13";
export const JEV_INPUT_USD_PER_MILLION = 0.042;
export const JEV_TIMEOUT_MS = 12_000;

export function failedJevDecision(error: string, latencyMs = 0): JevRouteResult {
  return {
    choice: null,
    confidence: null,
    probabilities: {},
    latencyMs,
    error,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    costKind: "unknown",
    policyVersion: JEV_POLICY_VERSION,
  };
}

// @effect-diagnostics-next-line globalDate:off -- Payload construction is a plain async transport boundary; tests supply the clock.
export function buildJevDecisionBody(request: JevRouteRequest, now = Date.now()) {
  const context = sanitizeJevContext(request.context);
  const budgetTime = context.budget ? Date.parse(context.budget.checkedAt) : Number.NaN;
  const budgetFresh =
    Number.isFinite(budgetTime) && now >= budgetTime && now - budgetTime <= 300_000;
  return {
    model: JEV_MODEL,
    state: {
      task: sanitizeJevText(request.prompt),
      ...context,
      budgetStatus:
        !context.budget || context.budget.unavailableReason
          ? "unavailable"
          : budgetFresh
            ? "fresh"
            : "stale; do not assume these are current limits",
      routingPolicy: {
        version: JEV_POLICY_VERSION,
        sourcesCheckedAt: "2026-09-20",
        workload: JEV_WORKLOAD_PROFILE,
        profiles: JEV_MODEL_PROFILES.filter((profile) =>
          request.candidates.some((candidate) => candidate.model === profile.model),
        ),
        effortGuidance: JEV_EFFORT_GUIDANCE,
        calibration:
          "Not yet measured: first-attempt success, task completion latency, tokens per second, and actual allowance use by task. Do not invent these numbers.",
        priceBasis:
          "Standard short-context API USD per million tokens, for comparison only. Not subscription billing or a remaining dollar balance. Larger models can finish with fewer steps and tokens.",
        sources: [
          "https://learn.chatgpt.com/docs/models",
          "https://learn.chatgpt.com/docs/pricing",
        ],
      },
    },
    questions: buildAssessmentQuestions(request) ?? {
      route: {
        type: "choice",
        instructions: JEV_ROUTING_INSTRUCTIONS,
        criteria: Object.fromEntries(
          request.candidates.map(({ key, description }) => [key, sanitizeJevText(description)]),
        ),
      },
    },
  };
}

const nonnegativeNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const probability = (value: unknown): value is number => nonnegativeNumber(value) && value <= 1;
const isJsonObject = Schema.is(Schema.Record(Schema.String, Schema.Unknown));

/** Only allowlisted response fields cross IPC; provider error bodies can echo secrets. */
export function parseJevDecision(
  raw: unknown,
  candidates: readonly string[],
  latencyMs: number,
): JevRouteResult {
  const usage = isJsonObject(raw) && isJsonObject(raw.usage) ? raw.usage : {};
  const inputTokens =
    nonnegativeNumber(usage.input_tokens) && Number.isSafeInteger(usage.input_tokens)
      ? usage.input_tokens
      : null;
  const outputTokens =
    nonnegativeNumber(usage.output_tokens) && Number.isSafeInteger(usage.output_tokens)
      ? usage.output_tokens
      : null;
  const billed = nonnegativeNumber(usage.cost) ? usage.cost : null;
  const accounting = {
    inputTokens,
    outputTokens,
    costUsd:
      billed ??
      (inputTokens === null ? null : (inputTokens * JEV_INPUT_USD_PER_MILLION) / 1_000_000),
    costKind:
      billed !== null
        ? ("billed" as const)
        : inputTokens !== null
          ? ("estimated" as const)
          : ("unknown" as const),
  };
  // A rejected routing answer can still incur a charge. Keep usage independently.
  const invalid = {
    ...failedJevDecision("Jev returned an invalid decision; using the selected model.", latencyMs),
    ...accounting,
  };
  // OpenRouter can return the underlying version (e.g. jev-1.13.0), rather than
  // echoing its namespaced request alias. The request itself pins the model.
  if (
    !isJsonObject(raw) ||
    typeof raw.model !== "string" ||
    !raw.model.trim() ||
    !isJsonObject(raw.answers)
  )
    return invalid;
  const route = raw.answers.route;
  if (
    !isJsonObject(route) ||
    route.type !== "choice" ||
    typeof route.choice !== "string" ||
    !candidates.includes(route.choice) ||
    !probability(route.confidence) ||
    !isJsonObject(route.probabilities)
  )
    return invalid;
  const entries: [string, number][] = [];
  for (const [key, value] of Object.entries(route.probabilities)) {
    if (!candidates.includes(key) || !probability(value)) return invalid;
    entries.push([key, value]);
  }
  const probabilities = Object.fromEntries(entries);
  const chosenProbability = probabilities[route.choice];
  if (
    candidates.length === 0 ||
    entries.length !== new Set(candidates).size ||
    chosenProbability === undefined ||
    Math.abs(entries.reduce((sum, [, value]) => sum + value, 0) - 1) > 0.02 ||
    entries.some(([, value]) => value > chosenProbability + 0.000001)
  )
    return invalid;
  // This is a routing guard, not a claim that confidence is calibrated probability.
  const uncertain = route.confidence < 0.5;
  return {
    choice: uncertain ? null : route.choice,
    recommendedChoice: route.choice,
    confidence: route.confidence,
    probabilities,
    latencyMs,
    error: uncertain ? "Jev's decision was uncertain; using the selected model." : null,
    ...accounting,
  };
}

export async function requestJevDecision(
  request: JevRouteRequest,
  key: string,
  signal: AbortSignal,
  transport: typeof fetch = fetch,
): Promise<JevRouteResult> {
  const started = performance.now();
  try {
    if (signal.aborted)
      return failedJevDecision("Jev request cancelled; using the selected model.");
    const payload = JSON.stringify(buildJevDecisionBody(request));
    if (payload.length > JEV_MAX_REQUEST_CHARS)
      return failedJevDecision(
        "Routing context exceeds the request limit. No task text was silently truncated; using the selected model.",
      );
    const response = await transport("https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal,
      body: payload,
    });
    if (!response.ok)
      return failedJevDecision(
        `Jev request failed (HTTP ${response.status}); using the selected model.`,
        Math.round(performance.now() - started),
      );
    const body = await response.text();
    if (body.length > 100_000)
      return failedJevDecision(
        "Jev response exceeded the size limit; using the selected model.",
        Math.round(performance.now() - started),
      );
    const raw: unknown = JSON.parse(body);
    const latency = Math.round(performance.now() - started);
    const result = buildAssessmentQuestions(request)
      ? parseAssessmentDecision(raw, request, latency, parseJevDecision)
      : parseJevDecision(
          raw,
          request.candidates.map((candidate) => candidate.key),
          latency,
        );
    const selected = request.candidates.find(
      (candidate) => candidate.key === (result.recommendedChoice ?? result.choice),
    );
    if (selected && !isJevCandidateAllowed(selected, request.context))
      return {
        ...result,
        policyVersion: JEV_POLICY_VERSION,
        choice: null,
        recommendedChoice: null,
        error:
          "Jev selected an unsupported pair or a downgrade during unresolved failure; retaining the selected model and effort.",
      };
    const profile = selected?.model ? getJevModelProfile(selected.model) : undefined;
    return {
      ...result,
      policyVersion: JEV_POLICY_VERSION,
      ...(!result.explanation && selected?.model
        ? {
            explanation: `Selected ${selected.model} / ${selected.effort}. Profile guidance: ${profile?.summary ?? "Unknown"}${request.context.failure?.unresolved ? " Unresolved user feedback supplied; no-downgrade guard applied." : ""} This is policy context, not a measured success prediction or a free-form rationale from Jev.`,
          }
        : {}),
    };
  } catch {
    return failedJevDecision(
      signal.aborted
        ? "Jev request cancelled or timed out; using the selected model."
        : "Jev could not be reached; using the selected model.",
      Math.round(performance.now() - started),
    );
  }
}
