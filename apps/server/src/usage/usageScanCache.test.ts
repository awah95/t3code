import { describe, expect, it } from "@effect/vitest";

import {
  decodeScanCache,
  dedupeWithinFile,
  conflictingCodexResponseKeys,
  encodeScanCache,
  pruneScanCache,
  reconcileCodexAggregateRecords,
  type CachedFile,
  type ScanCache,
} from "./usageScanCache.ts";
import type { UsageRecord } from "./usageTranscripts.ts";
import { createCodexLedgerScanState } from "./codexLedgerAccounting.ts";

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    provider: "claude",
    timestampMs: 1_786_000_000_000,
    model: "claude-fable-5",
    sessionId: "session-a",
    totals: {
      uncachedInputTokens: 2,
      cachedInputTokens: 1000,
      cacheCreationTokens: 10,
      outputTokens: 50,
      reasoningTokens: 0,
    },
    reportedCostUsd: null,
    dedupeKey: "msg_1:",
    ...overrides,
  };
}

function position(overrides: Partial<CachedFile["position"]> = {}): CachedFile["position"] {
  return {
    resumeOffset: 120,
    guardLength: 64,
    guardHash: 0xdeadbeef,
    codexState: null,
    ...overrides,
  };
}

function cacheWith(entries: readonly [string, number, readonly UsageRecord[]][]): ScanCache {
  const cache: ScanCache = new Map();
  for (const [path, mtimeMs, records] of entries) {
    cache.set(path, {
      size: records.length * 10,
      mtimeMs,
      provider: "claude",
      records,
      tailRecords: [],
      position: position(),
    });
  }
  return cache;
}

describe("scan cache round trip", () => {
  it("restores records unchanged", () => {
    const original = cacheWith([
      ["/a.jsonl", 100, [record(), record({ dedupeKey: "msg_2:", model: "claude-opus-5" })]],
      ["/b.jsonl", 200, [record({ sessionId: "session-b", reportedCostUsd: 1.5 })]],
    ]);
    original.set("/grok.jsonl", {
      size: 40,
      mtimeMs: 300,
      provider: "grok",
      records: [
        record({ provider: "grok", model: "grok-4.5-build", dedupeKey: "s:p:grok-4.5-build" }),
      ],
      tailRecords: [record({ provider: "grok", model: "grok-4.5-build", dedupeKey: null })],
      position: position({ resumeOffset: 30, guardLength: 30, guardHash: 123 }),
    });
    original.set("/codex.jsonl", {
      size: 80,
      mtimeMs: 400,
      provider: "codex",
      records: [record({ provider: "codex", model: "gpt-5.2-codex", dedupeKey: null })],
      tailRecords: [],
      position: position({
        codexState: {
          model: "gpt-5.2-codex",
          sessionId: "session-c",
          lastUsageSignature: '{"input_tokens":1}',
          sawSessionMeta: true,
          suppressingForkCopies: false,
          forkCopyAnchorMs: 0,
          ledgerState: createCodexLedgerScanState(),
          sawExactResponse: false,
          legacyTurnOrdinal: 0,
          activeLegacyTurnId: null,
          incompleteReceiptCount: 0,
        },
      }),
    });

    const restored = decodeScanCache(JSON.parse(JSON.stringify(encodeScanCache(original))));

    expect(restored.size).toBe(4);
    expect(restored.get("/a.jsonl")).toEqual(original.get("/a.jsonl"));
    expect(restored.get("/b.jsonl")).toEqual(original.get("/b.jsonl"));
    expect(restored.get("/grok.jsonl")).toEqual(original.get("/grok.jsonl"));
    expect(restored.get("/codex.jsonl")).toEqual(original.get("/codex.jsonl"));
  });

  it("replaces a compaction embedding with its later exact receipt", () => {
    const embedded = record({
      provider: "codex",
      codexSource: "compacted",
      dedupeKey: "codex-response:r",
      model: "",
      codexTurnId: "turn",
    });
    const exact = record({
      provider: "codex",
      codexSource: "exact",
      dedupeKey: "codex-response:r",
      model: "gpt-5.6-sol",
      codexTurnId: "turn",
    });
    expect(dedupeWithinFile([embedded, exact])).toEqual([exact]);
  });

  it("quarantines a reused response ID with incompatible counters or model", () => {
    const first = record({
      provider: "codex",
      codexSource: "exact",
      dedupeKey: "codex-response:r",
      sessionId: "thread",
      codexTurnId: "turn",
      model: "gpt-5.6-sol",
    });
    const changed = record({ ...first, totals: { ...first.totals, outputTokens: 51 } });
    const modelConflict = record({ ...first, model: "gpt-5.6-luna" });
    expect(dedupeWithinFile([first, changed])).toEqual([first, changed]);
    expect(conflictingCodexResponseKeys([first, changed])).toEqual(new Set(["codex-response:r"]));
    expect(conflictingCodexResponseKeys([first, modelConflict])).toEqual(
      new Set(["codex-response:r"]),
    );
    const unknownModel = record({ ...first, model: "" });
    expect(dedupeWithinFile([unknownModel, first])).toEqual([first]);
    expect(conflictingCodexResponseKeys([unknownModel, first])).toEqual(new Set());
  });

  it("removes legacy fallback only when an exact turn checkpoint covers it", () => {
    const legacy = record({
      provider: "codex",
      codexSource: "legacy",
      dedupeKey: null,
      sessionId: "thread",
      codexTurnId: "turn",
    });
    const exact = record({
      provider: "codex",
      codexSource: "exact",
      dedupeKey: "codex-response:r",
      sessionId: "thread",
      codexTurnId: "turn",
      codexTurnCheckpoint: legacy.totals,
    });
    expect(reconcileCodexAggregateRecords([legacy, exact])).toEqual([exact]);
    const extra = record({ ...exact, codexTurnCheckpoint: { ...exact.totals, outputTokens: 100 } });
    expect(reconcileCodexAggregateRecords([legacy, extra])).toEqual([legacy, extra]);
  });

  it("drops an entry whose persisted parse state is corrupt", () => {
    // Resuming with a bad reducer state would attach appended usage to the
    // wrong model or replay fork-copied history; that entry must cold parse.
    const encoded = encodeScanCache(cacheWith([["/a.jsonl", 100, [record()]]]));
    const poisoned = {
      ...encoded,
      files: {
        "/a.jsonl": { ...encoded.files["/a.jsonl"]!, cs: { model: 42 } },
      },
    };

    expect(decodeScanCache(JSON.parse(JSON.stringify(poisoned))).has("/a.jsonl")).toBe(false);
  });

  it("drops a Codex entry with a corrupt nested cumulative cursor", () => {
    const state = {
      model: "gpt-5.6-sol",
      sessionId: "thread",
      lastUsageSignature: null,
      sawSessionMeta: true,
      suppressingForkCopies: false,
      forkCopyAnchorMs: 0,
      ledgerState: createCodexLedgerScanState(),
      sawExactResponse: true,
      legacyTurnOrdinal: 1,
      activeLegacyTurnId: "turn",
      incompleteReceiptCount: 0,
    };
    const cache = cacheWith([["/a.jsonl", 100, [record({ provider: "codex" })]]]);
    cache.set("/a.jsonl", {
      ...cache.get("/a.jsonl")!,
      provider: "codex",
      position: position({ codexState: state }),
    });
    const encoded = encodeScanCache(cache);
    const poisoned = {
      ...encoded,
      files: {
        "/a.jsonl": {
          ...encoded.files["/a.jsonl"]!,
          cs: { ...state, ledgerState: { ownMetaSeen: true } },
        },
      },
    };
    expect(decodeScanCache(poisoned).has("/a.jsonl")).toBe(false);
  });

  it("drops an entry whose guard length is outside the supported range", () => {
    // The guard length sizes a Buffer in the reader; a bogus value would make
    // every parse of that file fail and silently drop its usage.
    const encoded = encodeScanCache(cacheWith([["/a.jsonl", 100, [record()]]]));
    const poisoned = {
      ...encoded,
      files: { "/a.jsonl": { ...encoded.files["/a.jsonl"]!, gl: 1e20 } },
    };

    expect(decodeScanCache(JSON.parse(JSON.stringify(poisoned))).has("/a.jsonl")).toBe(false);
  });

  it("rejects a document from the previous cache version", () => {
    const encoded = encodeScanCache(cacheWith([["/a.jsonl", 100, [record()]]]));
    const previous = { ...encoded, version: 2 };

    expect(decodeScanCache(JSON.parse(JSON.stringify(previous))).size).toBe(0);
  });

  it("interns repeated model and session strings", () => {
    const encoded = encodeScanCache(
      cacheWith([["/a.jsonl", 100, [record(), record({ dedupeKey: "msg_2:" }), record()]]]),
    );

    expect(encoded.models).toEqual(["claude-fable-5"]);
    expect(encoded.sessions).toEqual(["session-a"]);
  });

  it("treats a corrupt or foreign document as an empty cache", () => {
    // A bad cache should cost one cold scan, never a broken page.
    expect(decodeScanCache(null).size).toBe(0);
    expect(decodeScanCache("nonsense").size).toBe(0);
    expect(decodeScanCache({ version: 999, models: [], sessions: [], files: {} }).size).toBe(0);
  });

  it("skips malformed file entries but keeps good ones", () => {
    const encoded = encodeScanCache(cacheWith([["/good.jsonl", 100, [record()]]]));
    const withJunk = {
      ...encoded,
      files: { ...encoded.files, "/bad.jsonl": { s: "nope", m: 1, p: "claude", r: [] } },
    };

    const restored = decodeScanCache(JSON.parse(JSON.stringify(withJunk)));
    expect([...restored.keys()]).toEqual(["/good.jsonl"]);
  });

  it("rejects the whole cache when an intern table holds a non-string", () => {
    // models: [1] would pass the undefined guard, put a number in a record's
    // model, and crash lookupRate at aggregate time.
    const encoded = encodeScanCache(cacheWith([["/a.jsonl", 100, [record()]]]));
    const poisoned = { ...encoded, models: [1] };

    expect(decodeScanCache(JSON.parse(JSON.stringify(poisoned))).size).toBe(0);
  });

  it("drops the whole entry when any row is corrupt, forcing a cold re-parse", () => {
    // Keeping the surviving rows under the original (size, mtime) would read
    // as a valid warm hit and the file would never be re-parsed.
    const encoded = encodeScanCache(
      cacheWith([["/a.jsonl", 100, [record(), record({ dedupeKey: "msg_2:" })]]]),
    );
    const rows = encoded.files["/a.jsonl"]!.r;
    const poisoned = {
      ...encoded,
      files: {
        "/a.jsonl": {
          ...encoded.files["/a.jsonl"]!,
          r: [rows[0]!, [...rows[1]!.slice(0, 3), "not-a-number", ...rows[1]!.slice(4)]],
        },
      },
    };

    const restored = decodeScanCache(JSON.parse(JSON.stringify(poisoned)));
    expect(restored.has("/a.jsonl")).toBe(false);
  });
});

describe("pruneScanCache", () => {
  const retentionCutoffMs = 1000;

  it("drops entries older than retention", () => {
    const cache = cacheWith([["/old.jsonl", 500, [record()]]]);

    const removed = pruneScanCache(cache, retentionCutoffMs);

    expect(removed).toBe(1);
    expect(cache.size).toBe(0);
  });

  it("keeps entries whose file has disappeared", () => {
    const cache = cacheWith([["/gone.jsonl", 5000, [record()]]]);

    pruneScanCache(cache, retentionCutoffMs);

    expect(cache.size).toBe(1);
  });
});

describe("dedupeWithinFile", () => {
  it("keeps the first record per dedupe key", () => {
    const kept = dedupeWithinFile([
      record({ totals: { ...record().totals, outputTokens: 1 } }),
      record({ totals: { ...record().totals, outputTokens: 999 } }),
      record({ dedupeKey: "msg_2:" }),
    ]);

    expect(kept).toHaveLength(2);
    expect(kept[0]?.totals.outputTokens).toBe(1);
  });

  it("keeps every record that has no dedupe key", () => {
    expect(
      dedupeWithinFile([record({ dedupeKey: null }), record({ dedupeKey: null })]),
    ).toHaveLength(2);
  });
});
