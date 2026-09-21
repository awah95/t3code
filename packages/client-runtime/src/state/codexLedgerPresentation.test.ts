import { describe, expect, it } from "vite-plus/test";
import {
  ledgerCacheFraction,
  ledgerCompactEstimate,
  ledgerEstimate,
  ledgerTokenCount,
} from "./codexLedgerPresentation.ts";

describe("Codex ledger presentation", () => {
  it("keeps absent usage distinct from a measured zero", () => {
    expect(ledgerTokenCount(null)).toBe("Unknown");
    expect(ledgerTokenCount(0)).toBe("0");
    expect(
      ledgerCacheFraction({
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: null,
        outputTokens: 0,
        reasoningTokens: 0,
        processedTokens: 0,
      }),
    ).toBe("Unknown");
    expect(
      ledgerCacheFraction({
        inputTokens: 100,
        cachedInputTokens: 25,
        cacheWriteTokens: null,
        outputTokens: 0,
        reasoningTokens: 0,
        processedTokens: 100,
      }),
    ).toBe("25.00%");
    expect(
      ledgerCacheFraction({
        inputTokens: 100_000,
        cachedInputTokens: 99_999,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        processedTokens: 100_000,
      }),
    ).toBe("<100%");
  });

  it("labels incomplete valuation as a subtotal", () => {
    const valuation = {
      snapshotId: "snapshot",
      calculationVersion: "1",
      estimateKind: "standardApiEquivalent" as const,
      pricedSubtotalUsd: "0.00125",
      completeEstimateUsd: null,
      unpricedResponseCount: 1,
      missingPriceReasons: ["unknown model"],
    };
    expect(ledgerEstimate(valuation)).toContain("priced subtotal");
    expect(
      ledgerEstimate({ ...valuation, completeEstimateUsd: "0.00125", unpricedResponseCount: 0 }),
    ).not.toContain("subtotal");
    expect(ledgerEstimate({ ...valuation, completeEstimateUsd: "0.00000001" })).toBe("$0.00000001");
  });

  it("formats compact chat estimates to three significant digits", () => {
    const valuation = {
      snapshotId: "snapshot",
      calculationVersion: "1",
      estimateKind: "standardApiEquivalent" as const,
      pricedSubtotalUsd: "0.0637128",
      completeEstimateUsd: "0.0637128",
      unpricedResponseCount: 0,
      missingPriceReasons: [],
    };

    expect(ledgerCompactEstimate(valuation)).toBe("$0.0637");
    expect(ledgerCompactEstimate({ ...valuation, completeEstimateUsd: "12.3456" })).toBe("$12.3");
    expect(
      ledgerCompactEstimate({
        ...valuation,
        completeEstimateUsd: null,
        pricedSubtotalUsd: null,
      }),
    ).toBe("Unknown");
  });
});
