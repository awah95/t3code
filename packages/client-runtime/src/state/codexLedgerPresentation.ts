import type {
  CodexLedgerTokens,
  CodexLedgerValuation,
  CodexLedgerCoverage,
} from "@t3tools/contracts";

export function ledgerTokenCount(value: number | null): string {
  return value === null ? "Unknown" : new Intl.NumberFormat().format(value);
}

export function ledgerCacheFraction(tokens: CodexLedgerTokens): string {
  if (
    tokens.inputTokens === null ||
    tokens.cachedInputTokens === null ||
    tokens.inputTokens === 0
  ) {
    return "Unknown";
  }
  const fraction = tokens.cachedInputTokens / tokens.inputTokens;
  if (fraction > 0 && fraction < 0.00005) return "<0.01%";
  if (fraction < 1 && fraction > 0.99995) return "<100%";
  return `${(fraction * 100).toFixed(2)}%`;
}

export function ledgerEstimate(valuation: CodexLedgerValuation): string {
  const amount = valuation.completeEstimateUsd ?? valuation.pricedSubtotalUsd;
  if (amount === null) return "Unknown";
  const formatted = `$${amount}`;
  return valuation.completeEstimateUsd === null ? `${formatted} priced subtotal` : formatted;
}

export function ledgerCoverageLabel(coverage: CodexLedgerCoverage): string {
  const gaps = [
    coverage.usage !== "exact" && `${coverage.usage} usage`,
    coverage.model !== "observed" && `${coverage.model} model`,
    coverage.pricing !== "priced" && `${coverage.pricing} pricing`,
    coverage.lineage !== "resolved" && `${coverage.lineage} child linkage`,
  ].filter((part): part is string => typeof part === "string");
  return gaps.length === 0 ? "Reported usage with resolved pricing and lineage" : gaps.join(" · ");
}
