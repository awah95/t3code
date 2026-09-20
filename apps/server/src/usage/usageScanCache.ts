/**
 * Durable per-file scan cache.
 *
 * Transcripts are append-only and a file that has not changed can never yield
 * different usage, so parsed records are keyed by `(size, mtime)` and reused.
 * Without this every server restart re-parses the whole window: roughly 3.5s
 * for a 30-day scan here, against ~11ms to reload this cache.
 *
 * Caching *per file* rather than per day is deliberate. It is timezone
 * independent, so changing the reporting zone does not invalidate anything, and
 * it keeps cross-file de-duplication exact: cached entries are de-duplicated
 * within their own file only, and the aggregator still applies the global
 * dedupe pass over the small surviving key set.
 *
 * @module usageScanCache
 */
import type { UsageProviderKind } from "@t3tools/contracts";

import { GUARD_LENGTH, type TranscriptParsePosition } from "./usageTranscriptReader.ts";
import type { CodexScanState, UsageRecord } from "./usageTranscripts.ts";

// v2: Codex fork-copy suppression changed what a file parses to, so v1
// entries would keep serving double-counted records forever.
// v3: entries carry the parse position and reducer state so a grown file
// re-parses only its appended bytes instead of starting over.
// v4: Codex exact-response precedence and cumulative fallback state.
const USAGE_SCAN_CACHE_VERSION = 4 as const;

export interface CachedFile {
  readonly size: number;
  readonly mtimeMs: number;
  readonly provider: UsageProviderKind;
  /** Records from newline-terminated lines, up to `position.resumeOffset`. */
  readonly records: readonly UsageRecord[];
  /**
   * Records from a trailing segment the writer had not newline-terminated at
   * parse time. Kept apart from `records` because an incremental parse
   * re-reads that segment and would otherwise double count it.
   */
  readonly tailRecords: readonly UsageRecord[];
  readonly position: TranscriptParsePosition;
}

export type ScanCache = Map<string, CachedFile>;

/**
 * Row layout for the serialised form. Positional and interned rather than
 * object-per-record: on a 30-day window that is the difference between a file
 * measured in tens of megabytes and one under six.
 */
type SerializedRecord = readonly [
  timestampMs: number,
  modelIndex: number,
  sessionIndex: number,
  uncachedInputTokens: number,
  cachedInputTokens: number,
  cacheCreationTokens: number,
  outputTokens: number,
  reasoningTokens: number,
  dedupeKey: string | null,
  reportedCostUsd: number | null,
  codexSource: "exact" | "compacted" | "legacy" | null,
  codexTurnId: string | null,
  codexTurnCheckpoint: readonly [number, number, number, number, number] | null,
];

interface SerializedFile {
  readonly s: number;
  readonly m: number;
  readonly p: UsageProviderKind;
  readonly r: readonly SerializedRecord[];
  /** Tail records; see `CachedFile.tailRecords`. */
  readonly t: readonly SerializedRecord[];
  /** Parse position: resume offset, guard length, guard hash. */
  readonly o: number;
  readonly gl: number;
  readonly gh: number;
  /** Codex reducer state at `o`; `null` for stateless providers. */
  readonly cs: CodexScanState | null;
}

interface SerializedCache {
  readonly version: number;
  readonly models: readonly string[];
  readonly sessions: readonly string[];
  readonly files: Readonly<Record<string, SerializedFile>>;
}

/** Serialises the cache, interning the repeated model and session strings. */
export function encodeScanCache(cache: ScanCache): SerializedCache {
  const models: string[] = [];
  const sessions: string[] = [];
  const modelIndex = new Map<string, number>();
  const sessionIndex = new Map<string, number>();

  const intern = (table: string[], index: Map<string, number>, value: string): number => {
    const existing = index.get(value);
    if (existing !== undefined) return existing;
    const next = table.length;
    table.push(value);
    index.set(value, next);
    return next;
  };

  const serializeRecord = (record: UsageRecord): SerializedRecord => [
    record.timestampMs,
    intern(models, modelIndex, record.model),
    intern(sessions, sessionIndex, record.sessionId),
    record.totals.uncachedInputTokens,
    record.totals.cachedInputTokens,
    record.totals.cacheCreationTokens,
    record.totals.outputTokens,
    record.totals.reasoningTokens,
    record.dedupeKey,
    record.reportedCostUsd,
    record.codexSource ?? null,
    record.codexTurnId ?? null,
    record.codexTurnCheckpoint
      ? [
          record.codexTurnCheckpoint.uncachedInputTokens,
          record.codexTurnCheckpoint.cachedInputTokens,
          record.codexTurnCheckpoint.cacheCreationTokens,
          record.codexTurnCheckpoint.outputTokens,
          record.codexTurnCheckpoint.reasoningTokens,
        ]
      : null,
  ];

  const files: Record<string, SerializedFile> = {};
  for (const [path, entry] of cache) {
    files[path] = {
      s: entry.size,
      m: entry.mtimeMs,
      p: entry.provider,
      r: entry.records.map(serializeRecord),
      t: entry.tailRecords.map(serializeRecord),
      o: entry.position.resumeOffset,
      gl: entry.position.guardLength,
      gh: entry.position.guardHash,
      cs: entry.position.codexState,
    };
  }

  return { version: USAGE_SCAN_CACHE_VERSION, models, sessions, files };
}

function isRecordArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/**
 * Rebuilds the cache from a parsed document.
 *
 * Anything malformed yields an empty cache rather than an error: a corrupt
 * cache should cost one cold scan, never a broken page.
 */
export function decodeScanCache(document: unknown): ScanCache {
  const cache: ScanCache = new Map();
  if (typeof document !== "object" || document === null) return cache;

  const root = document as Partial<SerializedCache>;
  if (root.version !== USAGE_SCAN_CACHE_VERSION) return cache;
  if (!isRecordArray(root.models) || !isRecordArray(root.sessions)) return cache;
  if (typeof root.files !== "object" || root.files === null) return cache;

  // The intern tables must be all strings: a numeric entry would pass the
  // undefined guard below, land in a record's model, and crash the aggregate
  // at lookupRate. A corrupt table rejects the whole cache.
  if (!root.models.every((value) => typeof value === "string")) return cache;
  if (!root.sessions.every((value) => typeof value === "string")) return cache;
  const models = root.models as readonly string[];
  const sessions = root.sessions as readonly string[];

  // Any corrupt row disqualifies the whole entry. Keeping the survivors
  // under the original (size, mtime) would read as a valid warm hit and the
  // file would never be re-parsed, silently losing the dropped rows' usage.
  const decodeRecords = (
    rows: readonly unknown[],
    provider: UsageProviderKind,
  ): UsageRecord[] | null => {
    const records: UsageRecord[] = [];
    for (const row of rows) {
      if (!isRecordArray(row) || row.length !== 13) return null;
      const [
        timestampMs,
        modelIndex,
        sessionIndex,
        uncached,
        cached,
        cacheCreation,
        output,
        reasoning,
        dedupeKey,
        reportedCostUsd,
        codexSource,
        codexTurnId,
        codexTurnCheckpoint,
      ] = row as SerializedRecord;

      const model = typeof modelIndex === "number" ? models[modelIndex] : undefined;
      if (
        typeof timestampMs !== "number" ||
        !Number.isFinite(timestampMs) ||
        model === undefined ||
        !Number.isFinite(uncached) ||
        !Number.isFinite(cached) ||
        !Number.isFinite(cacheCreation) ||
        !Number.isFinite(output) ||
        !Number.isFinite(reasoning) ||
        (codexSource !== null &&
          codexSource !== "exact" &&
          codexSource !== "compacted" &&
          codexSource !== "legacy") ||
        (codexTurnId !== null && typeof codexTurnId !== "string") ||
        (codexTurnCheckpoint !== null &&
          (!isRecordArray(codexTurnCheckpoint) ||
            codexTurnCheckpoint.length !== 5 ||
            !codexTurnCheckpoint.every(
              (value) => typeof value === "number" && Number.isFinite(value),
            )))
      ) {
        return null;
      }

      records.push({
        provider,
        timestampMs,
        model,
        sessionId: (typeof sessionIndex === "number" ? sessions[sessionIndex] : undefined) ?? "",
        totals: {
          uncachedInputTokens: uncached,
          cachedInputTokens: cached,
          cacheCreationTokens: cacheCreation,
          outputTokens: output,
          reasoningTokens: reasoning,
        },
        reportedCostUsd: typeof reportedCostUsd === "number" ? reportedCostUsd : null,
        dedupeKey: typeof dedupeKey === "string" ? dedupeKey : null,
        ...(codexSource === null ? {} : { codexSource }),
        ...(codexTurnId === null ? {} : { codexTurnId }),
        ...(codexTurnCheckpoint === null
          ? {}
          : {
              codexTurnCheckpoint: {
                uncachedInputTokens: codexTurnCheckpoint[0],
                cachedInputTokens: codexTurnCheckpoint[1],
                cacheCreationTokens: codexTurnCheckpoint[2],
                outputTokens: codexTurnCheckpoint[3],
                reasoningTokens: codexTurnCheckpoint[4],
              },
            }),
      });
    }
    return records;
  };

  for (const [path, raw] of Object.entries(root.files)) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Partial<SerializedFile>;
    if (typeof entry.s !== "number" || typeof entry.m !== "number") continue;
    if (entry.p !== "claude" && entry.p !== "codex" && entry.p !== "grok") continue;
    if (!isRecordArray(entry.r) || !isRecordArray(entry.t)) continue;
    // Position fields feed byte offsets and a Buffer allocation in the reader,
    // so anything outside their real ranges must reject the entry: a bogus
    // guard length would otherwise fail every parse of the file, silently
    // dropping its usage instead of costing the documented cold re-parse.
    if (
      typeof entry.o !== "number" ||
      !Number.isSafeInteger(entry.o) ||
      entry.o < 0 ||
      typeof entry.gl !== "number" ||
      !Number.isSafeInteger(entry.gl) ||
      entry.gl < 0 ||
      entry.gl > GUARD_LENGTH ||
      entry.gl > entry.o ||
      typeof entry.gh !== "number" ||
      !Number.isFinite(entry.gh)
    ) {
      continue;
    }
    const codexState = decodeCodexState(entry.cs);
    if (codexState === undefined) continue;

    const provider: UsageProviderKind = entry.p;
    const records = decodeRecords(entry.r, provider);
    const tailRecords = decodeRecords(entry.t, provider);
    if (records === null || tailRecords === null) continue;

    cache.set(path, {
      size: entry.s,
      mtimeMs: entry.m,
      provider,
      records,
      tailRecords,
      position: {
        resumeOffset: entry.o,
        guardLength: entry.gl,
        guardHash: entry.gh,
        codexState,
      },
    });
  }

  return cache;
}

/**
 * Validates a persisted Codex reducer state. Returns `undefined` for a corrupt
 * value, which disqualifies the entry: resuming with a bad state would attach
 * appended usage to the wrong model or replay fork-copied history.
 */
function decodeCodexState(value: unknown): CodexScanState | null | undefined {
  if (value === null) return null;
  if (typeof value !== "object") return undefined;
  const state = value as Partial<CodexScanState>;
  const ledger = state.ledgerState;
  if (
    typeof state.model !== "string" ||
    typeof state.sessionId !== "string" ||
    (state.lastUsageSignature !== null && typeof state.lastUsageSignature !== "string") ||
    typeof state.sawSessionMeta !== "boolean" ||
    typeof state.suppressingForkCopies !== "boolean" ||
    typeof state.forkCopyAnchorMs !== "number" ||
    !Number.isFinite(state.forkCopyAnchorMs) ||
    typeof state.sawExactResponse !== "boolean" ||
    typeof state.legacyTurnOrdinal !== "number" ||
    !Number.isSafeInteger(state.legacyTurnOrdinal) ||
    (state.activeLegacyTurnId !== null && typeof state.activeLegacyTurnId !== "string") ||
    typeof state.incompleteReceiptCount !== "number" ||
    !Number.isSafeInteger(state.incompleteReceiptCount) ||
    state.incompleteReceiptCount < 0 ||
    typeof ledger !== "object" ||
    ledger === null ||
    typeof ledger.ownMetaSeen !== "boolean" ||
    (ledger.sessionId !== null && typeof ledger.sessionId !== "string") ||
    (ledger.threadId !== null && typeof ledger.threadId !== "string") ||
    (ledger.activeTurnId !== null && typeof ledger.activeTurnId !== "string") ||
    typeof ledger.modelByTurn !== "object" ||
    ledger.modelByTurn === null ||
    Array.isArray(ledger.modelByTurn) ||
    (ledger.lastCumulativeSignature !== null &&
      typeof ledger.lastCumulativeSignature !== "string") ||
    (ledger.previousCumulative !== null &&
      (typeof ledger.previousCumulative !== "object" || Array.isArray(ledger.previousCumulative)))
  ) {
    return undefined;
  }
  return {
    model: state.model,
    sessionId: state.sessionId,
    lastUsageSignature: state.lastUsageSignature ?? null,
    sawSessionMeta: state.sawSessionMeta,
    suppressingForkCopies: state.suppressingForkCopies,
    forkCopyAnchorMs: state.forkCopyAnchorMs,
    ledgerState: ledger,
    sawExactResponse: state.sawExactResponse,
    legacyTurnOrdinal: state.legacyTurnOrdinal,
    activeLegacyTurnId: state.activeLegacyTurnId,
    incompleteReceiptCount: state.incompleteReceiptCount,
  };
}

/** Keeps saved usage after transcript cleanup, until the reporting retention expires. */
export function pruneScanCache(cache: ScanCache, retentionCutoffMs: number): number {
  let removed = 0;
  for (const [path, entry] of cache) {
    if (entry.mtimeMs < retentionCutoffMs) {
      cache.delete(path);
      removed += 1;
    }
  }
  return removed;
}

/**
 * Within-file de-duplication, applied before an entry is cached.
 *
 * Callers stitching an incremental parse together pass one `seen` set across
 * the line and tail record batches so the whole file stays deduplicated as a
 * unit; the set is mutated in place.
 */
export function dedupeWithinFile(
  records: readonly UsageRecord[],
  seen: Set<string> = new Set(),
): readonly UsageRecord[] {
  const kept: UsageRecord[] = [];
  const byKey = new Map<string, number>();
  for (const record of records) {
    if (record.dedupeKey !== null) {
      if (seen.has(record.dedupeKey)) {
        const index = byKey.get(record.dedupeKey);
        const previous = index === undefined ? undefined : kept[index];
        if (previous && codexRecordsConflict(previous, record)) {
          // Keep both observations so the source-level pass can quarantine them.
          kept.push(record);
          continue;
        }
        // Enrich unknown model evidence and prefer an explicit receipt.
        if (
          index !== undefined &&
          previous &&
          record.provider === "codex" &&
          ((previous.model.length === 0 && record.model.length > 0) ||
            (previous.codexSource === "compacted" && record.codexSource === "exact"))
        )
          kept[index] = record;
        continue;
      }
      seen.add(record.dedupeKey);
      byKey.set(record.dedupeKey, kept.length);
    }
    kept.push(record);
  }
  return kept;
}

const codexRecordsConflict = (a: UsageRecord, b: UsageRecord): boolean =>
  a.provider === "codex" &&
  b.provider === "codex" &&
  !!a.dedupeKey &&
  a.dedupeKey === b.dedupeKey &&
  ((a.model.length > 0 && b.model.length > 0 && a.model !== b.model) ||
    (!!a.codexTurnId && !!b.codexTurnId && a.codexTurnId !== b.codexTurnId) ||
    a.sessionId !== b.sessionId ||
    a.totals.uncachedInputTokens !== b.totals.uncachedInputTokens ||
    a.totals.cachedInputTokens !== b.totals.cachedInputTokens ||
    a.totals.cacheCreationTokens !== b.totals.cacheCreationTokens ||
    a.totals.outputTokens !== b.totals.outputTokens ||
    a.totals.reasoningTokens !== b.totals.reasoningTokens);

/** Same-ID disagreements are excluded from trusted aggregate totals. */
export function conflictingCodexResponseKeys(records: readonly UsageRecord[]): ReadonlySet<string> {
  const firstByKey = new Map<string, UsageRecord>();
  const conflicts = new Set<string>();
  for (const record of records) {
    if (record.provider !== "codex" || !record.dedupeKey?.startsWith("codex-response:")) continue;
    const first = firstByKey.get(record.dedupeKey);
    if (!first) firstByKey.set(record.dedupeKey, record);
    else if (codexRecordsConflict(first, record)) conflicts.add(record.dedupeKey);
  }
  return conflicts;
}

/** Remove legacy estimates only when exact checkpoints prove they cover the whole turn. */
export function reconcileCodexAggregateRecords(
  records: readonly UsageRecord[],
): readonly UsageRecord[] {
  const exactRunning = new Map<string, UsageRecord["totals"]>();
  const coveredTurns = new Set<string>();
  const keys = [
    "uncachedInputTokens",
    "cachedInputTokens",
    "cacheCreationTokens",
    "outputTokens",
    "reasoningTokens",
  ] as const;
  for (const record of records) {
    if (
      record.provider !== "codex" ||
      (record.codexSource !== "exact" && record.codexSource !== "compacted") ||
      !record.codexTurnId
    )
      continue;
    const key = `${record.sessionId}\u0000${record.codexTurnId}`;
    const prior = exactRunning.get(key);
    const total = Object.fromEntries(
      keys.map((field) => [field, (prior?.[field] ?? 0) + record.totals[field]]),
    ) as unknown as UsageRecord["totals"];
    exactRunning.set(key, total);
    if (
      record.codexTurnCheckpoint &&
      keys.every((field) => record.codexTurnCheckpoint?.[field] === total[field])
    )
      coveredTurns.add(key);
  }
  return records.filter(
    (record) =>
      record.codexSource !== "legacy" ||
      !record.codexTurnId ||
      !coveredTurns.has(`${record.sessionId}\u0000${record.codexTurnId}`),
  );
}
