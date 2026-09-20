import { describe, expect, it } from "@effect/vitest";
import {
  createCodexLedgerScanState,
  ingestCodexLedgerRecord,
  type CodexResponseObservation,
} from "./codexLedgerAccounting.ts";
import {
  CODEX_STANDARD_RATE_SNAPSHOT,
  createCodexRateSnapshot,
  priceCodexResponse,
  sumCodexValuations,
} from "./codexLedgerPricing.ts";

function response(
  model: string | null,
  usage: Record<string, unknown>,
  id = "r",
): CodexResponseObservation {
  const state = createCodexLedgerScanState();
  const scan = (type: string, payload: Record<string, unknown>) =>
    ingestCodexLedgerRecord(
      state,
      { type, payload, timestamp: "2026-09-20T00:00:00Z" },
      { sourceId: "account", observationId: `${type}:${id}` },
    );
  if (model) scan("turn_context", { turn_id: "t", model });
  return scan("token_usage_record", {
    response_id: id,
    thread_id: "thread",
    turn_id: "t",
    usage,
  })[0] as CodexResponseObservation;
}
const usage = (input: number, cached: number, write: number, output: number, reasoning = 0) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  cache_write_input_tokens: write,
  output_tokens: output,
  reasoning_output_tokens: reasoning,
  total_tokens: input + output,
});

describe("Codex Standard API scenario pricing", () => {
  it("uses exact decimal dollars and treats reasoning as a subset of output", () => {
    const priced = priceCodexResponse(response("gpt-5.6-sol", usage(100, 40, 10, 20, 7)));
    expect(priced).toMatchObject({
      priced: true,
      ordinaryInputTokens: 50,
      cachedInputTokens: 40,
      cacheWriteTokens: 10,
      outputTokens: 20,
      ordinaryInputUsd: "0.0002",
      cachedInputUsd: "0.000016",
      cacheWriteUsd: "0.00005",
      outputUsd: "0.0004",
      totalUsd: "0.000666",
      estimateKind: "standard_api_scenario",
      longContextApplied: false,
    });
    expect(priced.rateSnapshotId).toBe("openai-standard-scenario-2026-09-20-v1");
  });

  it("uses each response's model and measured cache after a switch", () => {
    const sol = priceCodexResponse(response("gpt-5.6-sol", usage(100, 0, 0, 10), "sol"));
    const luna = priceCodexResponse(response("gpt-5.6-luna", usage(100, 50, 0, 10), "luna"));
    expect(sol.totalUsd).toBe("0.0006");
    expect(luna.totalUsd).toBe("0.000023");
    expect(sumCodexValuations([sol, luna])).toEqual({
      subtotalUsd: "0.000623",
      pricedCount: 2,
      unpricedCount: 0,
    });
  });

  it("applies 5.6 request long-context rates only above 272000 input tokens", () => {
    const at = priceCodexResponse(response("gpt-5.6-sol", usage(272000, 0, 0, 10)));
    const over = priceCodexResponse(response("gpt-5.6-sol", usage(272001, 0, 0, 10)));
    expect(at.longContextApplied).toBe(false);
    expect(over.longContextApplied).toBe(true);
    expect(at.totalUsd).toBe("1.0882");
    expect(over.totalUsd).toBe("2.176308");
  });

  it("requires an explicit session basis for GPT-5.5 and a known cache-write rate for positive writes", () => {
    const plain = response("gpt-5.5", usage(100, 0, 0, 10));
    expect(priceCodexResponse(plain).missingReasons).toContain("long_context_basis_unknown");
    expect(
      priceCodexResponse(plain, CODEX_STANDARD_RATE_SNAPSHOT, { sessionLongContext: false })
        .totalUsd,
    ).toBe("0.0008");
    expect(
      priceCodexResponse(plain, CODEX_STANDARD_RATE_SNAPSHOT, { sessionLongContext: true })
        .totalUsd,
    ).toBe("0.00145");
    const writes = priceCodexResponse(
      response("gpt-5.5", usage(100, 0, 10, 10)),
      CODEX_STANDARD_RATE_SNAPSHOT,
      { sessionLongContext: false },
    );
    expect(writes.priced).toBe(false);
    expect(writes.missingReasons).toContain("cache_write_rate_unknown");
  });

  it("keeps unknown, missing, and malformed usage visibly unpriced", () => {
    expect(priceCodexResponse(response(null, usage(10, 0, 0, 1))).missingReasons).toContain(
      "model_unknown",
    );
    expect(
      priceCodexResponse(response("codex-auto-review", usage(10, 0, 0, 1))).missingReasons,
    ).toContain("model_unpriced");
    const missing = priceCodexResponse(
      response("gpt-5.6-sol", { input_tokens: 10, cached_input_tokens: 0, output_tokens: 1 }),
    );
    expect(missing.priced).toBe(false);
    expect(missing.missingReasons).toContain("token_category_missing");
    expect(missing.totalUsd).toBeNull();
    const invalid = priceCodexResponse(response("gpt-5.6-sol", usage(10, 11, 0, 1)));
    expect(invalid.missingReasons).toContain("invalid_usage");
    expect(sumCodexValuations([missing, invalid])).toEqual({
      subtotalUsd: "0",
      pricedCount: 0,
      unpricedCount: 2,
    });
  });

  it("keeps a repricing revision separate from the captured rate snapshot", () => {
    const revision = createCodexRateSnapshot({
      ...CODEX_STANDARD_RATE_SNAPSHOT,
      id: "new-standard-scenario",
      models: {
        ...CODEX_STANDARD_RATE_SNAPSHOT.models,
        "gpt-5.6-sol": {
          ...CODEX_STANDARD_RATE_SNAPSHOT.models["gpt-5.6-sol"]!,
          ordinaryInput: "5",
        },
      },
    });
    const observed = response("gpt-5.6-sol", usage(100, 0, 0, 0));
    expect(priceCodexResponse(observed).totalUsd).toBe("0.0004");
    expect(priceCodexResponse(observed, revision).totalUsd).toBe("0.0005");
    expect(Object.isFrozen(revision.models["gpt-5.6-sol"])).toBe(true);
    expect(() =>
      createCodexRateSnapshot({
        ...revision,
        id: "invalid",
        models: {
          ...revision.models,
          "gpt-5.6-sol": { ...revision.models["gpt-5.6-sol"]!, ordinaryInput: "-1" },
        },
      }),
    ).toThrow();
  });
});
