import type { CodexResponseObservation } from "./codexLedgerAccounting.ts";

export interface CodexModelRates {
  readonly ordinaryInput: string;
  readonly cachedInput: string;
  readonly cacheWriteInput: string | null;
  readonly output: string;
  readonly longContextInputMultiplier: string;
  readonly longContextOutputMultiplier: string;
  readonly longContextScope: "request" | "session";
  readonly longContextThresholdInputTokens: number;
  readonly source: string;
}
export interface CodexRateSnapshot {
  readonly id: string;
  readonly retrievedOn: string;
  readonly currency: "USD";
  readonly serviceTierAssumption: "standard";
  readonly valuationBasis: string;
  readonly models: Readonly<Record<string, CodexModelRates>>;
}

/** Historical scenario, not a served-tier receipt, invoice, or subscription debit. */
export const CODEX_STANDARD_RATE_SNAPSHOT: CodexRateSnapshot = Object.freeze({
  id: "openai-standard-scenario-2026-09-22-v2",
  retrievedOn: "2026-09-22",
  currency: "USD",
  serviceTierAssumption: "standard",
  valuationBasis:
    "Current-rate Standard API scenario, not historical invoice or observed subscription debit",
  models: Object.freeze({
    "gpt-5.5": Object.freeze({
      ordinaryInput: "5",
      cachedInput: "0.5",
      cacheWriteInput: null,
      output: "30",
      longContextInputMultiplier: "2",
      longContextOutputMultiplier: "1.5",
      longContextScope: "session",
      longContextThresholdInputTokens: 272000,
      source: "https://developers.openai.com/api/docs/models/gpt-5.5",
    }),
    "gpt-5.6-luna": Object.freeze({
      ordinaryInput: "0.2",
      cachedInput: "0.02",
      cacheWriteInput: "0.25",
      output: "1.2",
      longContextInputMultiplier: "2",
      longContextOutputMultiplier: "1.5",
      longContextScope: "request",
      longContextThresholdInputTokens: 272000,
      source: "https://developers.openai.com/api/docs/models/gpt-5.6-luna",
    }),
    "gpt-5.6-sol": Object.freeze({
      ordinaryInput: "4",
      cachedInput: "0.4",
      cacheWriteInput: "5",
      output: "20",
      longContextInputMultiplier: "2",
      longContextOutputMultiplier: "1.5",
      longContextScope: "request",
      longContextThresholdInputTokens: 272000,
      source: "https://developers.openai.com/api/docs/models/gpt-5.6-sol",
    }),
    "gpt-5.6-terra": Object.freeze({
      ordinaryInput: "2",
      cachedInput: "0.2",
      cacheWriteInput: "2.5",
      output: "12",
      longContextInputMultiplier: "2",
      longContextOutputMultiplier: "1.5",
      longContextScope: "request",
      longContextThresholdInputTokens: 272000,
      source: "https://developers.openai.com/api/docs/models/gpt-5.6-terra",
    }),
    "gpt-6-astra": Object.freeze({
      ordinaryInput: "10",
      cachedInput: "1",
      cacheWriteInput: "12.5",
      output: "50",
      longContextInputMultiplier: "2",
      longContextOutputMultiplier: "1.5",
      longContextScope: "request",
      longContextThresholdInputTokens: 272000,
      source: "https://developers.openai.com/api/docs/models/gpt-6-astra",
    }),
    "gpt-6-luna": Object.freeze({
      ordinaryInput: "0.1",
      cachedInput: "0.01",
      cacheWriteInput: "0.125",
      output: "0.5",
      longContextInputMultiplier: "2",
      longContextOutputMultiplier: "1.5",
      longContextScope: "request",
      longContextThresholdInputTokens: 272000,
      source: "https://developers.openai.com/api/docs/models/gpt-6-luna",
    }),
    "gpt-6-sol": Object.freeze({
      ordinaryInput: "2",
      cachedInput: "0.2",
      cacheWriteInput: "2.5",
      output: "10",
      longContextInputMultiplier: "2",
      longContextOutputMultiplier: "1.5",
      longContextScope: "request",
      longContextThresholdInputTokens: 272000,
      source: "https://developers.openai.com/api/docs/models/gpt-6-sol",
    }),
  }),
});

interface Decimal {
  readonly units: bigint;
  readonly scale: number;
}
function parseDecimal(value: string): Decimal {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))
    throw new Error(`Invalid nonnegative decimal rate: ${value}`);
  const parts = value.split(".");
  return { units: BigInt(parts.join("")), scale: parts[1]?.length ?? 0 };
}
export function validateCodexRateSnapshot(snapshot: CodexRateSnapshot): readonly string[] {
  const errors: string[] = [];
  if (
    !snapshot.id ||
    !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.retrievedOn) ||
    !Number.isFinite(Date.parse(snapshot.retrievedOn))
  )
    errors.push("snapshot_identity_invalid");
  if (snapshot.currency !== "USD" || snapshot.serviceTierAssumption !== "standard")
    errors.push("snapshot_basis_invalid");
  if (!snapshot.valuationBasis.trim() || Object.keys(snapshot.models).length === 0)
    errors.push("snapshot_rules_missing");
  for (const [model, rate] of Object.entries(snapshot.models)) {
    if (!model || !rate.source.startsWith("https://")) errors.push(`${model}:source_invalid`);
    if (
      !Number.isSafeInteger(rate.longContextThresholdInputTokens) ||
      rate.longContextThresholdInputTokens < 0
    )
      errors.push(`${model}:threshold_invalid`);
    if (rate.longContextScope !== "request" && rate.longContextScope !== "session")
      errors.push(`${model}:scope_invalid`);
    for (const [name, value] of Object.entries({
      ordinaryInput: rate.ordinaryInput,
      cachedInput: rate.cachedInput,
      output: rate.output,
      longContextInputMultiplier: rate.longContextInputMultiplier,
      longContextOutputMultiplier: rate.longContextOutputMultiplier,
      ...(rate.cacheWriteInput === null ? {} : { cacheWriteInput: rate.cacheWriteInput }),
    })) {
      if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) errors.push(`${model}:${name}_invalid`);
    }
    if (rate.longContextInputMultiplier === "0" || rate.longContextOutputMultiplier === "0")
      errors.push(`${model}:multiplier_invalid`);
  }
  return errors;
}

/** Clone and freeze an override with its own ID; earlier snapshots remain untouched. */
export function createCodexRateSnapshot(snapshot: CodexRateSnapshot): CodexRateSnapshot {
  const errors = validateCodexRateSnapshot(snapshot);
  if (errors.length) throw new Error(`Invalid Codex rate snapshot: ${errors.join(", ")}`);
  return Object.freeze({
    ...snapshot,
    models: Object.freeze(
      Object.fromEntries(
        Object.entries(snapshot.models).map(([model, rates]) => [
          model,
          Object.freeze({ ...rates }),
        ]),
      ),
    ),
  });
}
function add(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);
  return {
    units: a.units * 10n ** BigInt(scale - a.scale) + b.units * 10n ** BigInt(scale - b.scale),
    scale,
  };
}
function multiply(a: Decimal, b: Decimal): Decimal {
  return { units: a.units * b.units, scale: a.scale + b.scale };
}
function format(value: Decimal): string {
  const negative = value.units < 0n;
  let digits = (negative ? -value.units : value.units).toString().padStart(value.scale + 1, "0");
  if (value.scale) digits = `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`;
  digits = digits.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return `${negative ? "-" : ""}${digits}`;
}
function dollars(tokens: number, rate: string, multiplier: string): Decimal {
  return multiply(
    multiply({ units: BigInt(tokens), scale: 6 }, parseDecimal(rate)),
    parseDecimal(multiplier),
  );
}

export interface CodexResponseValuation {
  readonly responseId: string;
  readonly rateSnapshotId: string;
  readonly model: string | null;
  readonly estimateKind: "standard_api_scenario";
  readonly priced: boolean;
  readonly missingReasons: readonly string[];
  readonly longContextApplied: boolean | null;
  readonly ordinaryInputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly outputTokens: number | null;
  readonly ordinaryInputUsd: string | null;
  readonly cachedInputUsd: string | null;
  readonly cacheWriteUsd: string | null;
  readonly outputUsd: string | null;
  readonly totalUsd: string | null;
}

/** Price one response. Model/tier uncertainty and missing counts never become a zero-dollar result. */
export function priceCodexResponse(
  response: CodexResponseObservation,
  snapshot: CodexRateSnapshot = CODEX_STANDARD_RATE_SNAPSHOT,
  options: { sessionLongContext?: boolean } = {},
): CodexResponseValuation {
  const counters = response.usage.counters;
  const input = counters.input_tokens;
  const cached = counters.cached_input_tokens;
  const write = counters.cache_write_input_tokens;
  const output = counters.output_tokens;
  const ordinary =
    input !== null && cached !== null && write !== null ? input - cached - write : null;
  const rate = response.model ? snapshot.models[response.model] : undefined;
  const reasons: string[] = [];
  if (!response.model) reasons.push("model_unknown");
  else if (!rate) reasons.push("model_unpriced");
  if (response.usage.invalid.length) reasons.push("invalid_usage");
  if (input === null || cached === null || write === null || output === null)
    reasons.push("token_category_missing");
  if (ordinary !== null && ordinary < 0) reasons.push("cache_exceeds_input");
  let longContext: boolean | null = null;
  if (rate) {
    if (rate.longContextScope === "request")
      longContext = input === null ? null : input > rate.longContextThresholdInputTokens;
    else longContext = options.sessionLongContext ?? null;
    if (longContext === null) reasons.push("long_context_basis_unknown");
    if (write !== null && write > 0 && rate.cacheWriteInput === null)
      reasons.push("cache_write_rate_unknown");
  }
  if (
    reasons.length ||
    !rate ||
    ordinary === null ||
    cached === null ||
    write === null ||
    output === null ||
    longContext === null
  ) {
    return {
      responseId: response.responseId,
      rateSnapshotId: snapshot.id,
      model: response.model,
      estimateKind: "standard_api_scenario",
      priced: false,
      missingReasons: reasons,
      longContextApplied: longContext,
      ordinaryInputTokens: ordinary,
      cachedInputTokens: cached,
      cacheWriteTokens: write,
      outputTokens: output,
      ordinaryInputUsd: null,
      cachedInputUsd: null,
      cacheWriteUsd: null,
      outputUsd: null,
      totalUsd: null,
    };
  }
  const inputMultiplier = longContext ? rate.longContextInputMultiplier : "1";
  const outputMultiplier = longContext ? rate.longContextOutputMultiplier : "1";
  const ordinaryCost = dollars(ordinary, rate.ordinaryInput, inputMultiplier);
  const cachedCost = dollars(cached, rate.cachedInput, inputMultiplier);
  const writeCost =
    write === 0 ? dollars(0, "0", "1") : dollars(write, rate.cacheWriteInput!, inputMultiplier);
  const outputCost = dollars(output, rate.output, outputMultiplier);
  const total = [ordinaryCost, cachedCost, writeCost, outputCost].reduce(add);
  return {
    responseId: response.responseId,
    rateSnapshotId: snapshot.id,
    model: response.model,
    estimateKind: "standard_api_scenario",
    priced: true,
    missingReasons: [],
    longContextApplied: longContext,
    ordinaryInputTokens: ordinary,
    cachedInputTokens: cached,
    cacheWriteTokens: write,
    outputTokens: output,
    ordinaryInputUsd: format(ordinaryCost),
    cachedInputUsd: format(cachedCost),
    cacheWriteUsd: format(writeCost),
    outputUsd: format(outputCost),
    totalUsd: format(total),
  };
}

/** A priced subtotal accompanied by the count that could not be valued. */
export function sumCodexValuations(values: readonly CodexResponseValuation[]): {
  subtotalUsd: string;
  pricedCount: number;
  unpricedCount: number;
} {
  let subtotal: Decimal = { units: 0n, scale: 0 };
  let pricedCount = 0;
  for (const value of values) {
    if (!value.priced || value.totalUsd === null) continue;
    subtotal = add(subtotal, parseDecimal(value.totalUsd));
    pricedCount++;
  }
  return { subtotalUsd: format(subtotal), pricedCount, unpricedCount: values.length - pricedCount };
}
