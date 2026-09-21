// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalDateInEffect:off preferSchemaOverJson:off
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";

import {
  CodexLedgerError,
  CodexSettings,
  type CodexLedgerSummary,
  type CodexLedgerSameTokenComparison,
  type CodexLedgerTurn,
  type CodexLedgerTurnDetail,
  type CodexLedgerResponse,
  type CodexLedgerTokens,
  type CodexLedgerValuation,
  type CodexLedgerListTurnsInput,
  type CodexLedgerTurnInput,
  type CodexLedgerFamilyInput,
  type CodexLedgerExportInput,
  type CodexLedgerExperimentInput,
  type CodexLedgerRunInput,
  type CodexLedgerJevReceiptInput,
  type CodexLedgerQuotaInput,
  type CodexLedgerCreateRateSnapshotInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { type CodexLedgerEvent, type CodexLedgerScanState } from "./codexLedgerAccounting.ts";
import {
  CODEX_STANDARD_RATE_SNAPSHOT,
  createCodexRateSnapshot,
  priceCodexResponse,
  sumCodexValuations,
  type CodexResponseValuation,
  type CodexRateSnapshot,
} from "./codexLedgerPricing.ts";
import {
  reportExperiment,
  sumExactUsd,
  type ExperimentAttempt,
} from "./codexLedgerExperimentMetrics.ts";
import {
  hashLedgerId,
  listCodexLedgerFiles,
  readCodexLedgerFile,
  type CodexLedgerFileCursor,
} from "./codexLedgerReader.ts";
import * as ServerSettings from "../serverSettings.ts";
import { expandHomePath } from "../pathExpansion.ts";
import { mergeProviderInstanceEnvironment } from "../provider/ProviderInstanceEnvironment.ts";

type LedgerEffect<A> = Effect.Effect<A, CodexLedgerError>;
type Page<T> = { readonly items: readonly T[]; readonly nextCursor: string | null };
type TurnDetail = CodexLedgerTurnDetail;

export interface CodexLedgerServiceShape {
  readonly getSummary: () => LedgerEffect<CodexLedgerSummary>;
  readonly listTurns: (input: CodexLedgerListTurnsInput) => LedgerEffect<Page<CodexLedgerTurn>>;
  readonly getTurn: (input: CodexLedgerTurnInput) => LedgerEffect<TurnDetail | null>;
  readonly listFamily: (input: CodexLedgerFamilyInput) => LedgerEffect<Page<CodexLedgerTurn>>;
  readonly setCapture: (active: boolean) => LedgerEffect<CodexLedgerSummary>;
  readonly exportJsonl: (
    input: CodexLedgerExportInput,
  ) => LedgerEffect<{ format: "jsonl"; data: string; nextCursor: string | null }>;
  readonly upsertExperiment: (input: CodexLedgerExperimentInput) => LedgerEffect<{
    experimentId: string;
    name: string;
    createdAt: string;
    manifestJson: string;
  }>;
  readonly getExperiment: (experimentId: string) => LedgerEffect<{
    experiment: { experimentId: string; name: string; createdAt: string; manifestJson: string };
    runs: readonly CodexLedgerRunRow[];
    reportJson: string;
  } | null>;
  readonly listExperiments: () => LedgerEffect<{
    items: readonly {
      experimentId: string;
      name: string;
      createdAt: string;
      manifestJson: string;
    }[];
  }>;
  readonly listRateSnapshots: () => LedgerEffect<{
    items: readonly {
      snapshotId: string;
      capturedAt: string;
      sourceUrl: string;
      rulesJson: string;
      calculationVersion: string;
      active: boolean;
    }[];
  }>;
  readonly createRateSnapshot: (input: CodexLedgerCreateRateSnapshotInput) => LedgerEffect<{
    items: readonly {
      snapshotId: string;
      capturedAt: string;
      sourceUrl: string;
      rulesJson: string;
      calculationVersion: string;
      active: boolean;
    }[];
  }>;
  readonly selectRateSnapshot: (snapshotId: string) => LedgerEffect<{
    items: readonly {
      snapshotId: string;
      capturedAt: string;
      sourceUrl: string;
      rulesJson: string;
      calculationVersion: string;
      active: boolean;
    }[];
  }>;
  readonly upsertRun: (input: CodexLedgerRunInput) => LedgerEffect<CodexLedgerRunRow>;
  readonly recordJevReceipt: (
    input: CodexLedgerJevReceiptInput,
  ) => LedgerEffect<{ recorded: boolean }>;
  readonly listQuota: (input: CodexLedgerQuotaInput) => LedgerEffect<Page<CodexLedgerQuotaRow>>;
}
export class CodexLedgerService extends Context.Service<
  CodexLedgerService,
  CodexLedgerServiceShape
>()("t3/usage/CodexLedgerService") {}

interface ResponseRow {
  source_domain: string;
  response_id: string;
  codex_thread_id: string | null;
  codex_turn_id: string | null;
  root_turn_id: string | null;
  occurred_at: string;
  model: string | null;
  model_provenance: string;
  effort: string | null;
  scope: string;
  response_kind: string;
  status: string;
  tokens_json: string;
  observation_count: number;
  valuation_json?: string | null;
  valuation_snapshot_id?: string | null;
}
interface TurnRow {
  source_domain: string;
  codex_thread_id: string;
  codex_turn_id: string;
  root_turn_id: string | null;
  t3_environment_id: string | null;
  t3_project_id: string | null;
  t3_thread_id: string | null;
  t3_turn_id: string | null;
  t3_message_id: string | null;
  started_at: string;
  finished_at: string | null;
  lifecycle: string;
  provisional_tokens_json: string | null;
  provisional_model: string | null;
  turn_checkpoint_json: string | null;
  created_at: string;
}
interface RoutingReceiptRow {
  decision_json: string;
  dispatch_json: string | null;
  identity_json: string;
}
interface RoutingEvidence {
  beforeModel: string | null;
  beforeEffort: string | null;
  dispatchModel: string | null;
  dispatchEffort: string | null;
}
interface SourceRow {
  source_id: string;
  source_domain: string;
  path: string;
  size_bytes: number;
  resume_offset: number;
  guard_hash: string;
  generation: string;
  skipping_oversized_line: number;
  parser_state_json: string;
  malformed_record_count: number;
  state: string;
  last_error: string | null;
  last_captured_at: string | null;
}
interface CodexLedgerRunRow {
  runId: string;
  experimentId: string;
  caseId: string;
  cohort: string;
  rootTurnId: string | null;
  sourceDomain: string | null;
  status: "planned" | "running" | "accepted" | "failed" | "unknown";
  metadataJson: string;
  outcomeJson: string | null;
  createdAt: string;
  updatedAt: string;
}
interface CodexLedgerQuotaRow {
  sourceDomain: string;
  bucketId: string;
  observedAt: string;
  usedPercent: number | null;
  windowDurationMins: number | null;
  resetsAt: string | null;
  plan: string | null;
}

const EMPTY_VALUATION: CodexLedgerValuation = {
  snapshotId: null,
  calculationVersion: null,
  estimateKind: "none",
  pricedSubtotalUsd: null,
  completeEstimateUsd: null,
  unpricedResponseCount: 0,
  missingPriceReasons: ["rateSnapshotUnavailable"],
};
const valuationFromRows = (rows: readonly ResponseRow[]): CodexLedgerValuation => {
  if (rows.length === 0) return EMPTY_VALUATION;
  const reportedRows = rows.filter((row) => row.status === "reported");
  const vals = reportedRows.map((row) => {
    try {
      return row.valuation_json ? (JSON.parse(row.valuation_json) as CodexResponseValuation) : null;
    } catch {
      return null;
    }
  });
  const known = vals.filter((value): value is CodexResponseValuation => value !== null);
  const sum = sumCodexValuations(known);
  const unpriced = rows.length - sum.pricedCount;
  const reasons = [...new Set(known.flatMap((value) => value.missingReasons))];
  if (known.length < reportedRows.length) reasons.push("valuationMissing");
  if (rows.some((row) => row.status !== "reported")) reasons.push("responseConflictOrInvalid");
  const snapshots = [
    ...new Set(
      rows.map((row) => row.valuation_snapshot_id).filter((value): value is string => !!value),
    ),
  ];
  return {
    snapshotId: snapshots.length === 1 ? snapshots[0]! : null,
    calculationVersion: "1",
    estimateKind: "standardApiEquivalent",
    pricedSubtotalUsd: sum.pricedCount > 0 ? sum.subtotalUsd : null,
    completeEstimateUsd: unpriced === 0 && sum.pricedCount > 0 ? sum.subtotalUsd : null,
    unpricedResponseCount: unpriced,
    missingPriceReasons: reasons,
  };
};
const scenarioValuationFromRows = (
  rows: readonly ResponseRow[],
  model: string,
  snapshot: CodexRateSnapshot,
): CodexLedgerValuation => {
  if (rows.length === 0) return EMPTY_VALUATION;
  const values = rows.map((row) => {
    const tokens = parseTokens(row.tokens_json);
    return priceCodexResponse(
      {
        kind: "response",
        sourceId: row.source_domain,
        observationId: row.response_id,
        origin: row.response_kind === "compaction" ? "compacted" : "token_usage_record",
        responseId: row.response_id,
        threadId: row.codex_thread_id,
        turnId: row.codex_turn_id,
        rootTurnId: row.root_turn_id,
        sessionId: null,
        model,
        modelProvenance: "turn_context",
        effort: row.effort,
        timestampMs: Number.isFinite(Date.parse(row.occurred_at))
          ? Date.parse(row.occurred_at)
          : null,
        usage: {
          counters: {
            input_tokens: tokens.inputTokens,
            cached_input_tokens: tokens.cachedInputTokens,
            cache_write_input_tokens: tokens.cacheWriteTokens,
            output_tokens: tokens.outputTokens,
            reasoning_output_tokens: tokens.reasoningTokens,
            total_tokens: tokens.processedTokens,
          },
          invalid: row.status === "reported" ? [] : ["response_not_reported"],
          invalidRaw: {},
        },
        turnCheckpoint: null,
        threadCheckpoint: null,
      },
      snapshot,
    );
  });
  const sum = sumCodexValuations(values);
  const reasons = [...new Set(values.flatMap((value) => value.missingReasons))];
  return {
    snapshotId: snapshot.id,
    calculationVersion: "1",
    estimateKind: "standardApiEquivalent",
    pricedSubtotalUsd: sum.pricedCount > 0 ? sum.subtotalUsd : null,
    completeEstimateUsd: sum.unpricedCount === 0 ? sum.subtotalUsd : null,
    unpricedResponseCount: sum.unpricedCount,
    missingPriceReasons: reasons,
  };
};
const sameTokenComparisonsFromRows = (
  rows: readonly ResponseRow[],
  routing: RoutingEvidence | null,
  usedModel: string | null,
  usedEffort: string | null,
  snapshot: CodexRateSnapshot,
): CodexLedgerSameTokenComparison[] => {
  const inputs: Array<{
    model: string;
    effort: string | null;
    reason: "beforeJev" | "astraMedium";
  }> = [];
  if (routing?.beforeModel)
    inputs.push({
      model: routing.beforeModel,
      effort: routing.beforeEffort,
      reason: "beforeJev",
    });
  if (
    !(routing?.beforeModel === "gpt-6-astra" && routing.beforeEffort === "medium") &&
    !(usedModel === "gpt-6-astra" && usedEffort === "medium")
  )
    inputs.push({ model: "gpt-6-astra", effort: "medium", reason: "astraMedium" });
  return inputs.map((comparison) => ({
    ...comparison,
    valuation: scenarioValuationFromRows(rows, comparison.model, snapshot),
  }));
};
const EMPTY_TOKENS: CodexLedgerTokens = {
  inputTokens: null,
  cachedInputTokens: null,
  cacheWriteTokens: null,
  outputTokens: null,
  reasoningTokens: null,
  processedTokens: null,
};
const now = () => new Date().toISOString();
const iso = (timestamp: number | null): string =>
  timestamp === null ? now() : new Date(timestamp).toISOString();
const sha = (value: string): string => NodeCrypto.createHash("sha256").update(value).digest("hex");
const err = (cause: unknown) => {
  const messages: string[] = [];
  let current: unknown = cause;
  for (let index = 0; index < 5 && current instanceof Error; index += 1) {
    messages.push(current.message);
    current = current.cause;
  }
  return new CodexLedgerError({ message: messages.length ? messages.join(": ") : String(cause) });
};
const guarded = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, CodexLedgerError, R> =>
  effect.pipe(Effect.mapError(err));
const pageLimit = (limit: number | undefined): number => Math.max(1, Math.min(200, limit ?? 50));
type LedgerCursor = {
  kind: "turns" | "export" | "exportJob" | "quota";
  snapshotAt: string;
  last: readonly string[];
  snapshotId?: string;
};
const encodeCursor = (cursor: LedgerCursor): string =>
  Buffer.from(JSON.stringify(cursor)).toString("base64url");
const decodeCursor = (
  encoded: string | undefined,
  kind: LedgerCursor["kind"],
): LedgerCursor | null => {
  if (!encoded) return null;
  try {
    const cursor = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as LedgerCursor;
    return cursor.kind === kind &&
      typeof cursor.snapshotAt === "string" &&
      Array.isArray(cursor.last)
      ? cursor
      : null;
  } catch {
    return null;
  }
};
const asRows = <T>(rows: unknown): T[] => rows as T[];
const parseJsonRecord = (json: string | null | undefined): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(json ?? "{}");
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
const parseTokens = (json: string): CodexLedgerTokens => {
  try {
    const value = JSON.parse(json) as Partial<CodexLedgerTokens>;
    return {
      inputTokens: value.inputTokens ?? null,
      cachedInputTokens: value.cachedInputTokens ?? null,
      cacheWriteTokens: value.cacheWriteTokens ?? null,
      outputTokens: value.outputTokens ?? null,
      reasoningTokens: value.reasoningTokens ?? null,
      processedTokens: value.processedTokens ?? null,
    };
  } catch {
    return EMPTY_TOKENS;
  }
};
const addTokens = (tokens: readonly CodexLedgerTokens[]): CodexLedgerTokens => {
  const sum = (key: keyof CodexLedgerTokens): number | null => {
    if (tokens.length === 0 || tokens.some((row) => row[key] === null)) return null;
    return tokens.reduce((total, row) => total + row[key]!, 0);
  };
  return {
    inputTokens: sum("inputTokens"),
    cachedInputTokens: sum("cachedInputTokens"),
    cacheWriteTokens: sum("cacheWriteTokens"),
    outputTokens: sum("outputTokens"),
    reasoningTokens: sum("reasoningTokens"),
    processedTokens: sum("processedTokens"),
  };
};
const checkpointMatches = (checkpointJson: string | null, tokens: CodexLedgerTokens): boolean => {
  if (!checkpointJson) return false;
  try {
    const checkpoint = JSON.parse(checkpointJson) as Record<string, number | null>;
    const fields: readonly [string, keyof CodexLedgerTokens][] = [
      ["input_tokens", "inputTokens"],
      ["cached_input_tokens", "cachedInputTokens"],
      ["cache_write_input_tokens", "cacheWriteTokens"],
      ["output_tokens", "outputTokens"],
      ["reasoning_output_tokens", "reasoningTokens"],
      ["total_tokens", "processedTokens"],
    ];
    if (
      checkpoint["input_tokens"] === null ||
      checkpoint["output_tokens"] === null ||
      checkpoint["total_tokens"] === null
    )
      return false;
    return fields.every(
      ([source, target]) => checkpoint[source] === null || checkpoint[source] === tokens[target],
    );
  } catch {
    return false;
  }
};
const responseTokens = (
  event: Extract<CodexLedgerEvent, { kind: "response" }>,
): CodexLedgerTokens => {
  const c = event.usage.counters;
  return {
    inputTokens: c.input_tokens,
    cachedInputTokens: c.cached_input_tokens,
    cacheWriteTokens: c.cache_write_input_tokens,
    outputTokens: c.output_tokens,
    reasoningTokens: c.reasoning_output_tokens,
    processedTokens: c.total_tokens,
  };
};
const responseFactHash = (event: Extract<CodexLedgerEvent, { kind: "response" }>): string =>
  sha(
    JSON.stringify({
      responseId: event.responseId,
      threadId: event.threadId,
      turnId: event.turnId,
      rootTurnId: event.rootTurnId,
      tokens: event.usage.counters,
      invalid: event.usage.invalid,
      invalidRaw: event.usage.invalidRaw,
    }),
  );
const responseFromRow = (row: ResponseRow): CodexLedgerResponse => ({
  sourceDomain: row.source_domain,
  responseId: row.response_id,
  codexThreadId: row.codex_thread_id ?? "",
  codexTurnId: row.codex_turn_id ?? "",
  rootTurnId: row.root_turn_id,
  occurredAt: row.occurred_at,
  model: row.model,
  effort: row.effort,
  requestedModel: row.model_provenance === "turn_context" ? row.model : null,
  servedModel: row.model_provenance === "receipt" ? row.model : null,
  requestedTier: null,
  servedTier: null,
  modelProvenance:
    row.model_provenance === "receipt"
      ? "response"
      : row.model_provenance === "turn_context"
        ? "turnContext"
        : "unknown",
  scope:
    row.scope === "main" || row.scope === "child" || row.scope === "guardian"
      ? row.scope
      : "unknown",
  kind: row.response_kind === "compaction" ? "compaction" : "model",
  status:
    row.status === "conflict" ? "conflict" : row.status === "invalid" ? "invalid" : "reported",
  tokens: parseTokens(row.tokens_json),
  valuation: valuationFromRows([row]),
  observationCount: row.observation_count,
});

const make = (resolveHomes: Effect.Effect<readonly string[], CodexLedgerError>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const scanLock = yield* Semaphore.make(1);
    let ownershipReconciled = false;

    yield* sql`INSERT OR IGNORE INTO codex_ledger_rate_snapshots(snapshot_id,captured_at,source_url,rules_json,calculation_version)
    VALUES(${CODEX_STANDARD_RATE_SNAPSHOT.id},${CODEX_STANDARD_RATE_SNAPSHOT.retrievedOn},
    'https://developers.openai.com/api/docs/pricing',${JSON.stringify(CODEX_STANDARD_RATE_SNAPSHOT)},'1')`;
    yield* sql`INSERT OR IGNORE INTO codex_ledger_valuations
    (source_domain,response_id,valuation_id,snapshot_id,estimate_kind,components_json,total_usd,missing_reasons_json,created_at)
    SELECT source_domain,response_id,${`scenario:${CODEX_STANDARD_RATE_SNAPSHOT.id}`},snapshot_id,
      estimate_kind,components_json,total_usd,missing_reasons_json,created_at
    FROM codex_ledger_valuations WHERE valuation_id='capture-v1'`;

    const readCapture = Effect.gen(function* () {
      const rows = asRows<{ capture_active: number }>(
        yield* sql`SELECT capture_active FROM codex_ledger_settings WHERE id = 1`,
      );
      return rows[0]?.capture_active !== 0;
    });
    const activeSnapshotId = Effect.gen(function* () {
      const rows = asRows<{ active_snapshot_id: string }>(
        yield* sql`SELECT active_snapshot_id FROM codex_ledger_settings WHERE id=1`,
      );
      return rows[0]?.active_snapshot_id ?? CODEX_STANDARD_RATE_SNAPSHOT.id;
    });
    const readSnapshot = (snapshotId: string) =>
      Effect.gen(function* () {
        const rows = asRows<{ rules_json: string }>(
          yield* sql`SELECT rules_json FROM codex_ledger_rate_snapshots WHERE snapshot_id=${snapshotId}`,
        );
        if (!rows[0])
          return yield* Effect.fail(new CodexLedgerError({ message: "Rate snapshot not found" }));
        return JSON.parse(rows[0].rules_json) as CodexRateSnapshot;
      });
    const listSnapshotsRaw = Effect.gen(function* () {
      const active = yield* activeSnapshotId;
      const rows = asRows<{
        snapshot_id: string;
        captured_at: string;
        source_url: string;
        rules_json: string;
        calculation_version: string;
      }>(
        yield* sql`SELECT * FROM codex_ledger_rate_snapshots ORDER BY captured_at DESC,snapshot_id DESC LIMIT 100`,
      );
      return {
        items: rows.map((row) => ({
          snapshotId: row.snapshot_id,
          capturedAt: row.captured_at,
          sourceUrl: row.source_url,
          rulesJson: row.rules_json,
          calculationVersion: row.calculation_version,
          active: row.snapshot_id === active,
        })),
      };
    });
    const revalueSnapshot = (snapshot: CodexRateSnapshot) =>
      Effect.gen(function* () {
        let lastDomain = "";
        let lastResponse = "";
        while (true) {
          const batch = asRows<{
            source_domain: string;
            response_id: string;
            model: string | null;
            model_provenance: string;
            effort: string | null;
            payload_json: string | null;
          }>(
            yield* sql`
        SELECT r.source_domain,r.response_id,r.model,r.model_provenance,r.effort,
          (SELECT o.payload_json FROM codex_ledger_observations o
            WHERE o.source_domain=r.source_domain AND o.response_id=r.response_id
              AND o.kind='response' ORDER BY o.source_id,o.observation_id LIMIT 1) AS payload_json
        FROM codex_ledger_responses r
        WHERE (r.source_domain,r.response_id)>(${lastDomain},${lastResponse})
        ORDER BY r.source_domain,r.response_id LIMIT 200`,
          );
          if (batch.length === 0) break;
          yield* sql.withTransaction(
            Effect.gen(function* () {
              for (const row of batch) {
                if (!row.payload_json) continue;
                const observation = JSON.parse(row.payload_json) as Extract<
                  CodexLedgerEvent,
                  { kind: "response" }
                >;
                if (observation.kind !== "response") continue;
                const valuation = priceCodexResponse(
                  {
                    ...observation,
                    model: row.model ?? observation.model,
                    modelProvenance:
                      row.model_provenance === "receipt"
                        ? "receipt"
                        : row.model_provenance === "turn_context"
                          ? "turn_context"
                          : "unknown",
                    effort: row.effort ?? observation.effort,
                  },
                  snapshot,
                );
                yield* sql`INSERT OR IGNORE INTO codex_ledger_valuations
            (source_domain,response_id,valuation_id,snapshot_id,estimate_kind,components_json,total_usd,missing_reasons_json,created_at)
            VALUES(${row.source_domain},${row.response_id},${`scenario:${snapshot.id}`},${snapshot.id},
              'standard_api_scenario',${JSON.stringify(valuation)},${valuation.totalUsd},
              ${JSON.stringify(valuation.missingReasons)},${now()})`;
              }
            }),
          );
          lastDomain = batch.at(-1)!.source_domain;
          lastResponse = batch.at(-1)!.response_id;
        }
      });

    const ingestEvent = (event: CodexLedgerEvent, sourceDomain: string) =>
      Effect.gen(function* () {
        const observedAt = "timestampMs" in event ? iso(event.timestampMs) : now();
        const responseId = event.kind === "response" ? event.responseId : null;
        const payload = JSON.stringify(event);
        const contentHash = sha(payload);
        const observationId = `${event.observationId}:${event.kind}`;
        const inserted = asRows<{ inserted: number }>(
          yield* sql`
      INSERT INTO codex_ledger_observations
        (source_id, observation_id, source_domain, response_id, kind, occurred_at, content_hash, payload_json)
      VALUES (${event.sourceId}, ${observationId}, ${sourceDomain}, ${responseId}, ${event.kind}, ${observedAt}, ${contentHash}, ${payload})
      ON CONFLICT DO NOTHING RETURNING 1 AS inserted
    `,
        );
        if (inserted.length === 0) return;
        if (event.kind === "response") {
          const factHash = responseFactHash(event);
          const canonical = asRows<{
            fact_hash: string;
            model: string | null;
            model_provenance: string;
            response_kind: string;
            status: string;
          }>(
            yield* sql`
        SELECT fact_hash,model,model_provenance,response_kind,status FROM codex_ledger_responses
        WHERE source_domain = ${sourceDomain} AND response_id = ${event.responseId}
      `,
          )[0];
          const modelConflict =
            canonical?.model !== null &&
            canonical?.model !== undefined &&
            event.model !== null &&
            canonical.model !== event.model;
          if (canonical && (canonical.fact_hash !== factHash || modelConflict)) {
            const conflictingHash = modelConflict
              ? sha(JSON.stringify({ factHash, model: event.model }))
              : factHash;
            yield* sql`INSERT OR IGNORE INTO codex_ledger_conflicts
          (source_domain,response_id,source_id,observation_id,canonical_hash,conflicting_hash,created_at)
          VALUES (${sourceDomain},${event.responseId},${event.sourceId},${observationId},${canonical.fact_hash},${conflictingHash},${now()})`;
            yield* sql`UPDATE codex_ledger_responses SET status = 'conflict', observation_count = observation_count + 1,
          response_kind = ${event.origin === "compacted" ? "compaction" : canonical.response_kind}, updated_at = ${now()}
          WHERE source_domain = ${sourceDomain} AND response_id = ${event.responseId}`;
          } else if (canonical) {
            const refinedModel =
              canonical.model === null && event.model !== null && canonical.status === "reported";
            const promotedProvenance =
              event.model !== null &&
              event.modelProvenance === "receipt" &&
              canonical.model_provenance !== "receipt";
            yield* sql`UPDATE codex_ledger_responses SET observation_count = observation_count + 1,
          model = COALESCE(model,${event.model}),
          model_provenance = ${refinedModel ? event.modelProvenance : promotedProvenance ? "receipt" : canonical.model_provenance},
          effort = COALESCE(effort,${event.effort}),
          response_kind = ${event.origin === "compacted" ? "compaction" : canonical.response_kind},
          updated_at = ${now()}
          WHERE source_domain = ${sourceDomain} AND response_id = ${event.responseId}`;
            if (refinedModel) {
              const valued = asRows<{ snapshot_id: string; valuation_id: string }>(
                yield* sql`
            SELECT snapshot_id,valuation_id FROM codex_ledger_valuations
            WHERE source_domain=${sourceDomain} AND response_id=${event.responseId}
              AND valuation_id LIKE 'scenario:%'`,
              );
              for (const prior of valued) {
                const valuation = priceCodexResponse(event, yield* readSnapshot(prior.snapshot_id));
                const historyId = `prior:${prior.snapshot_id}:${sha(observationId).slice(0, 16)}`;
                yield* sql`INSERT OR IGNORE INTO codex_ledger_valuations
              (source_domain,response_id,valuation_id,snapshot_id,estimate_kind,components_json,total_usd,missing_reasons_json,created_at)
              SELECT source_domain,response_id,${historyId},snapshot_id,estimate_kind,components_json,total_usd,missing_reasons_json,created_at
              FROM codex_ledger_valuations WHERE source_domain=${sourceDomain} AND response_id=${event.responseId}
                AND valuation_id=${prior.valuation_id}`;
                yield* sql`UPDATE codex_ledger_valuations SET components_json=${JSON.stringify(valuation)},
              total_usd=${valuation.totalUsd},missing_reasons_json=${JSON.stringify(valuation.missingReasons)}
              WHERE source_domain=${sourceDomain} AND response_id=${event.responseId}
                AND valuation_id=${prior.valuation_id}`;
              }
            }
          } else {
            const tokens = JSON.stringify(responseTokens(event));
            const status = event.usage.invalid.length > 0 ? "invalid" : "reported";
            yield* sql`INSERT INTO codex_ledger_responses
          (source_domain,response_id,codex_thread_id,codex_turn_id,root_turn_id,session_id,occurred_at,model,model_provenance,effort,scope,response_kind,status,tokens_json,fact_hash,created_at,updated_at)
          VALUES (${sourceDomain},${event.responseId},${event.threadId},${event.turnId},${event.rootTurnId},${event.sessionId},${observedAt},${event.model},${event.modelProvenance},${event.effort},
          COALESCE((SELECT scope FROM codex_ledger_threads WHERE source_domain=${sourceDomain} AND codex_thread_id=${event.threadId}),'unknown'),
          ${event.origin === "compacted" ? "compaction" : "model"},${status},${tokens},${factHash},${now()},${now()})`;
            const snapshot = yield* readSnapshot(yield* activeSnapshotId);
            const valuation = priceCodexResponse(event, snapshot);
            yield* sql`INSERT INTO codex_ledger_valuations
          (source_domain,response_id,valuation_id,snapshot_id,estimate_kind,components_json,total_usd,missing_reasons_json,created_at)
          VALUES(${sourceDomain},${event.responseId},${`scenario:${snapshot.id}`},${snapshot.id},
          'standard_api_scenario',${JSON.stringify(valuation)},${valuation.totalUsd},${JSON.stringify(valuation.missingReasons)},${now()})`;
          }
          if (event.threadId && event.turnId)
            yield* sql`
        INSERT INTO codex_ledger_turns (source_domain,codex_thread_id,codex_turn_id,root_turn_id,started_at,turn_checkpoint_json)
        VALUES (${sourceDomain},${event.threadId},${event.turnId},${event.rootTurnId},${observedAt},${event.turnCheckpoint ? JSON.stringify(event.turnCheckpoint.counters) : null})
        ON CONFLICT(source_domain,codex_thread_id,codex_turn_id) DO UPDATE SET
          root_turn_id = COALESCE(excluded.root_turn_id,codex_ledger_turns.root_turn_id),
          started_at = MIN(codex_ledger_turns.started_at,excluded.started_at),
          turn_checkpoint_json=COALESCE(excluded.turn_checkpoint_json,codex_ledger_turns.turn_checkpoint_json)`;
          return;
        }
        if (event.kind === "opening") {
          yield* sql`INSERT INTO codex_ledger_threads
        (source_domain,codex_thread_id,parent_thread_id,forked_from_id,scope,cli_version)
        VALUES(${sourceDomain},${event.threadId},${event.parentThreadId},${event.forkedFromId},${event.scope},${event.cliVersion})
        ON CONFLICT(source_domain,codex_thread_id) DO NOTHING`;
          yield* sql`UPDATE codex_ledger_responses SET scope=${event.scope}
        WHERE source_domain=${sourceDomain} AND codex_thread_id=${event.threadId} AND scope='unknown'`;
        }
        if (event.kind === "started" && event.threadId)
          yield* sql`
      INSERT INTO codex_ledger_turns(source_domain,codex_thread_id,codex_turn_id,started_at,lifecycle)
      VALUES(${sourceDomain},${event.threadId},${event.turnId},${observedAt},'active')
      ON CONFLICT(source_domain,codex_thread_id,codex_turn_id) DO UPDATE SET
        started_at=MIN(codex_ledger_turns.started_at,excluded.started_at),lifecycle='active'`;
        if (event.kind === "context" && event.threadId && event.rootTurnId)
          yield* sql`INSERT INTO codex_ledger_turns
            (source_domain,codex_thread_id,codex_turn_id,root_turn_id,started_at,provisional_model)
            VALUES(${sourceDomain},${event.threadId},${event.turnId},${event.rootTurnId},${observedAt},${event.model})
            ON CONFLICT(source_domain,codex_thread_id,codex_turn_id) DO UPDATE SET
              root_turn_id=COALESCE(excluded.root_turn_id,codex_ledger_turns.root_turn_id),
              provisional_model=COALESCE(excluded.provisional_model,codex_ledger_turns.provisional_model)`;
        else if (event.kind === "context" && event.threadId)
          yield* sql`UPDATE codex_ledger_turns
            SET provisional_model=COALESCE(${event.model},provisional_model)
            WHERE source_domain=${sourceDomain} AND codex_thread_id=${event.threadId}
              AND codex_turn_id=${event.turnId}`;
        if (event.kind === "lifecycle" && event.threadId && event.turnId)
          yield* sql`
      INSERT INTO codex_ledger_turns(source_domain,codex_thread_id,codex_turn_id,started_at,finished_at,lifecycle,copied)
      VALUES(${sourceDomain},${event.threadId},${event.turnId},${observedAt},${observedAt},${event.status},${event.copied ? 1 : 0})
      ON CONFLICT(source_domain,codex_thread_id,codex_turn_id) DO UPDATE SET
        finished_at=excluded.finished_at,lifecycle=excluded.lifecycle,copied=excluded.copied`;
        if (event.kind === "tool")
          yield* sql`
      INSERT INTO codex_ledger_tools(source_domain,call_id,codex_thread_id,codex_turn_id,name,status,output_bytes,occurred_at)
      VALUES(${sourceDomain},${event.callId},${event.threadId},${event.turnId},${event.name},${event.status},${event.outputBytes},${observedAt})
      ON CONFLICT(source_domain,call_id) DO UPDATE SET
        status=COALESCE(excluded.status,codex_ledger_tools.status),
        output_bytes=COALESCE(excluded.output_bytes,codex_ledger_tools.output_bytes)`;
        if (event.kind === "quota") {
          for (const [bucketId, bucket] of [
            [event.limitId ?? "primary", event.primary],
            [event.limitId ? `${event.limitId}:secondary` : "secondary", event.secondary],
          ] as const) {
            if (!bucket) continue;
            yield* sql`INSERT OR IGNORE INTO codex_ledger_quota(source_domain,bucket_id,observed_at,used_percent,window_duration_mins,resets_at,plan,observation_id)
          VALUES(${sourceDomain},${bucketId},${observedAt},${bucket.usedPercent},${bucket.windowMinutes},${bucket.resetsAt === null ? null : new Date(bucket.resetsAt * 1000).toISOString()},${event.planType},${event.observationId})`;
          }
        }
        if (event.kind === "provisional" && event.threadId && event.turnId) {
          const delta: CodexLedgerTokens = {
            inputTokens: event.usage.counters.input_tokens,
            cachedInputTokens: event.usage.counters.cached_input_tokens,
            cacheWriteTokens: event.usage.counters.cache_write_input_tokens,
            outputTokens: event.usage.counters.output_tokens,
            reasoningTokens: event.usage.counters.reasoning_output_tokens,
            processedTokens: event.usage.counters.total_tokens,
          };
          const existing = asRows<{ provisional_tokens_json: string | null }>(
            yield* sql`
        SELECT provisional_tokens_json FROM codex_ledger_turns WHERE source_domain=${sourceDomain}
          AND codex_thread_id=${event.threadId} AND codex_turn_id=${event.turnId}`,
          )[0];
          const previous = existing?.provisional_tokens_json
            ? parseTokens(existing.provisional_tokens_json)
            : EMPTY_TOKENS;
          const tokens = JSON.stringify(
            existing?.provisional_tokens_json ? addTokens([previous, delta]) : delta,
          );
          yield* sql`INSERT INTO codex_ledger_turns(source_domain,codex_thread_id,codex_turn_id,started_at,provisional_tokens_json,provisional_model)
        VALUES(${sourceDomain},${event.threadId},${event.turnId},${observedAt},${tokens},${event.model})
        ON CONFLICT(source_domain,codex_thread_id,codex_turn_id) DO UPDATE SET
          provisional_tokens_json=excluded.provisional_tokens_json,
          provisional_model=COALESCE(excluded.provisional_model,codex_ledger_turns.provisional_model)`;
        }
      });

    const reconcileJevReceipts = (requestId?: string, attemptId?: string) =>
      Effect.gen(function* () {
        type Receipt = {
          request_id: string;
          attempt_id: string;
          root_turn_id: string | null;
          tool_use_id: string | null;
          identity_json: string;
        };
        let cursorRequest: string | null = null;
        let cursorAttempt: string | null = null;
        while (true) {
          const receipts: Receipt[] = asRows<Receipt>(
            yield* sql`SELECT request_id,attempt_id,root_turn_id,tool_use_id,identity_json
            FROM codex_ledger_jev_receipts WHERE
            (${requestId ?? null} IS NULL OR request_id=${requestId ?? null}) AND
            (${attemptId ?? null} IS NULL OR attempt_id=${attemptId ?? null}) AND
            (${cursorRequest} IS NULL OR request_id > ${cursorRequest} OR
              (request_id = ${cursorRequest} AND attempt_id > ${cursorAttempt}))
            ORDER BY request_id,attempt_id LIMIT 500`,
          );
          if (receipts.length === 0) break;
          for (const receipt of receipts) {
            const identity = JSON.parse(receipt.identity_json) as Record<string, unknown>;
            const providerThreadId =
              typeof identity.providerThreadId === "string" ? identity.providerThreadId : null;
            const providerTurnId =
              typeof identity.providerTurnId === "string" ? identity.providerTurnId : null;
            const t3ThreadId = typeof identity.threadId === "string" ? identity.threadId : null;
            const t3TurnId = typeof identity.turnId === "string" ? identity.turnId : null;
            const messageId = typeof identity.messageId === "string" ? identity.messageId : null;
            const candidates = asRows<{
              source_domain: string;
              codex_thread_id: string;
              codex_turn_id: string;
              root_turn_id: string | null;
            }>(
              yield* sql`SELECT source_domain,codex_thread_id,codex_turn_id,root_turn_id FROM codex_ledger_turns WHERE
              (${providerThreadId} IS NOT NULL AND ${providerTurnId} IS NOT NULL AND
                codex_thread_id=${providerThreadId} AND codex_turn_id=${providerTurnId}) OR
              (${t3ThreadId} IS NOT NULL AND ${t3TurnId} IS NOT NULL AND
                t3_thread_id=${t3ThreadId} AND t3_turn_id=${t3TurnId}) OR
              (${t3ThreadId} IS NOT NULL AND ${messageId} IS NOT NULL AND
                t3_thread_id=${t3ThreadId} AND t3_message_id=${messageId}) LIMIT 2`,
            );
            const edges = receipt.tool_use_id
              ? asRows<{
                  source_domain: string;
                  child_thread_id: string;
                  root_turn_id: string | null;
                }>(
                  yield* sql`SELECT source_domain,child_thread_id,root_turn_id FROM codex_ledger_lineage_edges
              WHERE tool_use_id=${receipt.tool_use_id} LIMIT 2`,
                )
              : [];
            const candidate = candidates.length === 1 ? candidates[0] : undefined;
            const edge = edges.length === 1 ? edges[0] : undefined;
            if (!candidate && !edge) continue;
            if (candidate && edge && candidate.source_domain !== edge.source_domain) continue;
            const sourceDomain = edge?.source_domain ?? candidate!.source_domain;
            const rootTurnId =
              edge?.root_turn_id ?? candidate?.root_turn_id ?? candidate?.codex_turn_id ?? null;
            if (!rootTurnId) continue;
            const nextIdentity = JSON.stringify({
              ...identity,
              sourceDomain,
              ...(candidate
                ? {
                    providerThreadId: candidate.codex_thread_id,
                    providerTurnId: candidate.codex_turn_id,
                  }
                : {}),
              ...(edge ? { childProviderThreadId: edge.child_thread_id } : {}),
            });
            if (nextIdentity === receipt.identity_json && rootTurnId === receipt.root_turn_id)
              continue;
            yield* sql`UPDATE codex_ledger_jev_receipts SET root_turn_id=${rootTurnId},identity_json=${nextIdentity}
            WHERE request_id=${receipt.request_id} AND attempt_id=${receipt.attempt_id}`;
          }
          const last: Receipt = receipts[receipts.length - 1]!;
          cursorRequest = last.request_id;
          cursorAttempt = last.attempt_id;
        }
      });

    const scanRaw = Effect.gen(function* () {
      if (!(yield* readCapture)) return;
      const homes = yield* resolveHomes;
      let processed = 0;
      let newOwnershipEvidence = false;
      for (const codexHome of homes) {
        const transcriptRoot = NodePath.join(codexHome, "sessions");
        const physicalHome = yield* Effect.tryPromise({
          try: async () => {
            const path = await NodeFSP.realpath(codexHome);
            const stat = await NodeFSP.stat(path);
            return `${NodeOS.hostname()}:${stat.dev}:${stat.ino}:${path}`;
          },
          catch: err,
        }).pipe(Effect.orElseSucceed(() => `${NodeOS.hostname()}:${NodePath.resolve(codexHome)}`));
        // A physical source fingerprint deduplicates readers of one home while keeping
        // different configured homes separate when the account ID is unavailable.
        const sourceDomain = `source:${hashLedgerId(physicalHome)}`;
        const rootAvailable = yield* Effect.tryPromise({
          try: () => NodeFSP.access(transcriptRoot),
          catch: err,
        }).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
        const listingErrors: string[] = [];
        const recordListingError = (_directory: string, _cause: unknown) => {
          listingErrors.push("A Codex transcript directory could not be read.");
        };
        const paths = yield* Effect.tryPromise({
          try: async () => [
            ...(await listCodexLedgerFiles(transcriptRoot, recordListingError)),
            ...(await listCodexLedgerFiles(
              NodePath.join(codexHome, "archived_sessions"),
              (directory, cause) => {
                // An archive directory is optional; an unreadable existing archive is not.
                if (
                  directory === NodePath.join(codexHome, "archived_sessions") &&
                  cause instanceof Error &&
                  "code" in cause &&
                  cause.code === "ENOENT"
                )
                  return;
                recordListingError(directory, cause);
              },
            )),
          ],
          catch: err,
        });
        yield* sql`INSERT INTO codex_ledger_sources
      (source_id,source_domain,path,parser_state_json,state,last_error)
      VALUES(${`root:${hashLedgerId(transcriptRoot)}`},${sourceDomain},${transcriptRoot},'{}',
        ${!rootAvailable ? "unavailable" : listingErrors.length ? "partial" : "ready"},
        ${!rootAvailable ? "Codex transcript directory unavailable" : (listingErrors[0] ?? null)})
      ON CONFLICT(source_id) DO UPDATE SET source_domain=excluded.source_domain,state=excluded.state,last_error=excluded.last_error`;
        const sourceRows = asRows<SourceRow>(yield* sql`SELECT * FROM codex_ledger_sources`);
        const known = new Map(sourceRows.map((row) => [row.path, row]));
        // Make the backfill backlog visible before the bounded reader reaches each file.
        yield* sql.withTransaction(
          Effect.gen(function* () {
            for (const path of paths) {
              if (known.has(path)) continue;
              yield* sql`INSERT OR IGNORE INTO codex_ledger_sources
          (source_id,source_domain,path,size_bytes,state)
          VALUES(${hashLedgerId(path)},${sourceDomain},${path},1,'pending')`;
            }
          }),
        );
        // Work is bounded per request. Repeated reads make progress through older files.
        for (const path of paths) {
          if (processed >= 24) break;
          const prior = known.get(path);
          const batch = yield* Effect.tryPromise({
            try: () =>
              readCodexLedgerFile(
                path,
                hashLedgerId(path),
                prior && prior.last_captured_at !== null
                  ? ({
                      offset: prior.resume_offset,
                      guardHash: prior.guard_hash,
                      generation: prior.generation,
                      skippingOversizedLine: prior.skipping_oversized_line === 1,
                      state: JSON.parse(prior.parser_state_json) as CodexLedgerScanState,
                    } satisfies CodexLedgerFileCursor)
                  : undefined,
              ),
            catch: err,
          }).pipe(
            Effect.catch((cause) =>
              Effect.gen(function* () {
                yield* sql`UPDATE codex_ledger_sources SET state='unavailable',
          last_error='A Codex transcript file could not be read; retained facts may be incomplete.'
          WHERE source_id=${hashLedgerId(path)}`;
                yield* Effect.logWarning("Codex ledger source read failed", {
                  path,
                  cause: cause.message,
                });
                return null;
              }),
            ),
          );
          if (!batch) continue;
          if (
            prior?.resume_offset === batch.cursor.offset &&
            prior.size_bytes === batch.size &&
            !batch.reset &&
            prior.last_error === null
          )
            continue;
          const sourceId = hashLedgerId(path);
          yield* sql.withTransaction(
            Effect.gen(function* () {
              for (const event of batch.events) yield* ingestEvent(event, sourceDomain);
              for (const hint of batch.lineageHints) {
                if (hint.kind === "spawn")
                  yield* sql`
            INSERT INTO codex_ledger_spawn_hints(source_domain,tool_use_id,task_name,parent_thread_id,parent_turn_id)
            VALUES(${sourceDomain},${hint.toolUseId},${hint.taskName},${hint.parentThreadId},${hint.parentTurnId})
            ON CONFLICT(source_domain,tool_use_id) DO NOTHING`;
                else
                  yield* sql`
            INSERT INTO codex_ledger_child_hints(source_domain,child_thread_id,agent_path,parent_thread_id,root_turn_id)
            VALUES(${sourceDomain},${hint.childThreadId},${hint.agentPath},${hint.parentThreadId},${hint.rootTurnId})
            ON CONFLICT(source_domain,child_thread_id) DO NOTHING`;
              }
              yield* sql`INSERT INTO codex_ledger_sources
          (source_id,source_domain,path,size_bytes,resume_offset,guard_length,guard_hash,generation,skipping_oversized_line,parser_state_json,file_fingerprint,state,malformed_record_count,last_captured_at)
          VALUES(${sourceId},${sourceDomain},${path},${batch.size},${batch.cursor.offset},64,${batch.cursor.guardHash},${batch.cursor.generation},${batch.cursor.skippingOversizedLine ? 1 : 0},${JSON.stringify(batch.cursor.state)},${sourceId},${batch.reset || batch.malformed > 0 || (prior?.malformed_record_count ?? 0) > 0 ? "partial" : "ready"},${(prior?.malformed_record_count ?? 0) + batch.malformed},${now()})
          ON CONFLICT(source_id) DO UPDATE SET size_bytes=excluded.size_bytes,resume_offset=excluded.resume_offset,
            guard_hash=excluded.guard_hash,generation=excluded.generation,skipping_oversized_line=excluded.skipping_oversized_line,
            parser_state_json=excluded.parser_state_json,state=excluded.state,last_error=NULL,
            malformed_record_count=excluded.malformed_record_count,last_captured_at=excluded.last_captured_at`;
            }),
          );
          if (batch.events.some((event) => event.kind === "response" || event.kind === "tool"))
            newOwnershipEvidence = true;
          processed += 1;
        }
      }
      // A fork can replay a parent's tool call before the parent's own file is read.
      // An explicit response owner settles the turn only when it is unique.
      if (!ownershipReconciled || newOwnershipEvidence) {
        yield* sql`UPDATE codex_ledger_tools SET codex_thread_id=(
        SELECT MIN(r.codex_thread_id) FROM codex_ledger_responses r
          INDEXED BY codex_ledger_responses_owner
        WHERE r.source_domain=codex_ledger_tools.source_domain
          AND r.codex_turn_id=codex_ledger_tools.codex_turn_id
          AND r.codex_thread_id IS NOT NULL
      ) WHERE codex_turn_id IS NOT NULL AND (
        SELECT COUNT(DISTINCT r.codex_thread_id) FROM codex_ledger_responses r
          INDEXED BY codex_ledger_responses_owner
        WHERE r.source_domain=codex_ledger_tools.source_domain
          AND r.codex_turn_id=codex_ledger_tools.codex_turn_id
          AND r.codex_thread_id IS NOT NULL
      )=1 AND codex_thread_id IS NOT (
        SELECT MIN(r.codex_thread_id) FROM codex_ledger_responses r
          INDEXED BY codex_ledger_responses_owner
        WHERE r.source_domain=codex_ledger_tools.source_domain
          AND r.codex_turn_id=codex_ledger_tools.codex_turn_id
          AND r.codex_thread_id IS NOT NULL
      )`;
        yield* sql`UPDATE codex_ledger_tools SET codex_thread_id=NULL
      WHERE codex_thread_id IS NOT NULL AND codex_turn_id IS NOT NULL AND (
        SELECT COUNT(DISTINCT r.codex_thread_id) FROM codex_ledger_responses r
          INDEXED BY codex_ledger_responses_owner
        WHERE r.source_domain=codex_ledger_tools.source_domain
          AND r.codex_turn_id=codex_ledger_tools.codex_turn_id
          AND r.codex_thread_id IS NOT NULL
      )>1`;
        yield* sql`UPDATE codex_ledger_spawn_hints SET
        parent_thread_id=(SELECT t.codex_thread_id FROM codex_ledger_tools t
          WHERE t.source_domain=codex_ledger_spawn_hints.source_domain
            AND t.call_id=codex_ledger_spawn_hints.tool_use_id),
        parent_turn_id=(SELECT t.codex_turn_id FROM codex_ledger_tools t
          WHERE t.source_domain=codex_ledger_spawn_hints.source_domain
            AND t.call_id=codex_ledger_spawn_hints.tool_use_id)
      WHERE EXISTS(SELECT 1 FROM codex_ledger_tools t
        WHERE t.source_domain=codex_ledger_spawn_hints.source_domain
          AND t.call_id=codex_ledger_spawn_hints.tool_use_id
          AND t.codex_thread_id IS NOT NULL AND t.codex_turn_id IS NOT NULL
          AND (t.codex_thread_id IS NOT codex_ledger_spawn_hints.parent_thread_id
            OR t.codex_turn_id IS NOT codex_ledger_spawn_hints.parent_turn_id))`;
        yield* sql`DELETE FROM codex_ledger_lineage_edges WHERE EXISTS (
        SELECT 1 FROM codex_ledger_tools t WHERE t.source_domain=codex_ledger_lineage_edges.source_domain
          AND t.call_id=codex_ledger_lineage_edges.tool_use_id
      ) AND NOT EXISTS (
        SELECT 1 FROM codex_ledger_tools t WHERE t.source_domain=codex_ledger_lineage_edges.source_domain
          AND t.call_id=codex_ledger_lineage_edges.tool_use_id
          AND t.codex_thread_id=codex_ledger_lineage_edges.parent_thread_id
          AND t.codex_turn_id=codex_ledger_lineage_edges.parent_turn_id
      )`;
        ownershipReconciled = true;
      }
      // Link only unique full task-path matches under an explicit parent thread and a
      // corresponding spawn_agent tool call. Ambiguous hints remain inspectable, unlinked.
      yield* sql`INSERT OR IGNORE INTO codex_ledger_lineage_edges
      (source_domain,tool_use_id,child_thread_id,parent_thread_id,parent_turn_id,root_turn_id)
      SELECT s.source_domain,s.tool_use_id,c.child_thread_id,s.parent_thread_id,s.parent_turn_id,
        COALESCE(c.root_turn_id,s.parent_turn_id)
      FROM codex_ledger_spawn_hints s JOIN codex_ledger_child_hints c
        ON c.source_domain=s.source_domain AND c.parent_thread_id=s.parent_thread_id
          AND c.agent_path=s.task_name
      JOIN codex_ledger_tools t ON t.source_domain=s.source_domain AND t.call_id=s.tool_use_id
        AND (t.name='spawn_agent' OR t.name LIKE '%.spawn_agent')
        AND t.codex_thread_id=s.parent_thread_id AND t.codex_turn_id=s.parent_turn_id
      WHERE s.parent_thread_id IS NOT NULL
        AND (SELECT COUNT(*) FROM codex_ledger_child_hints c2
          WHERE c2.source_domain=s.source_domain AND c2.parent_thread_id=s.parent_thread_id
            AND c2.agent_path=s.task_name)=1
        AND (SELECT COUNT(*) FROM codex_ledger_spawn_hints s2
          WHERE s2.source_domain=s.source_domain AND s2.parent_thread_id=s.parent_thread_id
            AND s2.task_name=s.task_name)=1`;
      // A spawn edge describes why the child thread exists, not the owner of every
      // later follow-up turn in that thread. Only a turn's own receipt can set its root.
      // Fork transcripts can repeat a parent's lifecycle under the child's file.
      // A response's explicit owner is stronger evidence than the copied lifecycle.
      yield* sql`DELETE FROM codex_ledger_turns WHERE
      NOT EXISTS (SELECT 1 FROM codex_ledger_responses own
        WHERE own.source_domain=codex_ledger_turns.source_domain
          AND own.codex_thread_id=codex_ledger_turns.codex_thread_id
          AND own.codex_turn_id=codex_ledger_turns.codex_turn_id)
      AND EXISTS (SELECT 1 FROM codex_ledger_responses owner
        WHERE owner.source_domain=codex_ledger_turns.source_domain
          AND owner.codex_turn_id=codex_ledger_turns.codex_turn_id
          AND owner.codex_thread_id!=codex_ledger_turns.codex_thread_id)`;
      // Codex's native thread ID survives restarts in the runtime resume cursor.
      // Older projections also have provider_thread_id. Require an exact projected
      // turn and one owner across both sources before attaching a T3 identity.
      yield* sql`WITH thread_candidates AS (
        SELECT thread_id,provider_thread_id AS codex_thread_id
        FROM projection_thread_sessions
        WHERE provider_name='codex' AND provider_thread_id IS NOT NULL
        UNION
        SELECT r.thread_id,
          CASE WHEN json_valid(r.resume_cursor_json)
            THEN json_extract(r.resume_cursor_json,'$.threadId') END AS codex_thread_id
        FROM provider_session_runtime r
        JOIN projection_thread_sessions s ON s.thread_id=r.thread_id AND s.provider_name='codex'
        WHERE r.provider_name='codex'
      ), unique_codex_threads AS (
        SELECT codex_thread_id FROM codex_ledger_turns
        GROUP BY codex_thread_id HAVING COUNT(DISTINCT source_domain)=1
      ), exact_matches AS (
        SELECT l.source_domain,l.codex_thread_id,l.codex_turn_id,
          MIN(t.thread_id) AS t3_thread_id,MIN(t.turn_id) AS t3_turn_id,
          MIN(t.pending_message_id) AS t3_message_id
        FROM codex_ledger_turns l
        JOIN unique_codex_threads u ON u.codex_thread_id=l.codex_thread_id
        JOIN thread_candidates c ON c.codex_thread_id=l.codex_thread_id
        JOIN projection_turns t ON t.thread_id=c.thread_id AND t.turn_id=l.codex_turn_id
        WHERE l.t3_turn_id IS NULL AND l.codex_turn_id IS NOT NULL
        GROUP BY l.source_domain,l.codex_thread_id,l.codex_turn_id
        HAVING COUNT(DISTINCT t.thread_id)=1
      )
      UPDATE codex_ledger_turns AS l SET
        t3_thread_id=m.t3_thread_id,
        t3_turn_id=m.t3_turn_id,
        t3_message_id=m.t3_message_id,
        t3_project_id=(SELECT p.project_id FROM projection_threads p
          WHERE p.thread_id=m.t3_thread_id)
      FROM exact_matches m
      WHERE l.source_domain=m.source_domain
        AND l.codex_thread_id=m.codex_thread_id AND l.codex_turn_id=m.codex_turn_id
        AND (l.t3_thread_id IS NULL OR l.t3_thread_id=m.t3_thread_id)`;
      yield* reconcileJevReceipts();
    });
    const scan = scanLock.withPermits(1)(scanRaw);
    yield* Effect.forkScoped(
      scan.pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Codex ledger background capture failed", { detail: cause.message }),
        ),
        Effect.repeat(Schedule.spaced("15 seconds")),
      ),
    );

    const readResponses = (domain: string, threadId: string, turnId: string) => sql`
    SELECT r.*,v.components_json AS valuation_json,v.snapshot_id AS valuation_snapshot_id
      FROM codex_ledger_responses AS r INDEXED BY codex_ledger_responses_turn
      LEFT JOIN codex_ledger_valuations v ON v.source_domain=r.source_domain AND v.response_id=r.response_id
        AND v.valuation_id='scenario:' || (SELECT active_snapshot_id FROM codex_ledger_settings WHERE id=1)
      WHERE r.source_domain=${domain} AND r.codex_thread_id=${threadId}
      AND r.codex_turn_id=${turnId} ORDER BY r.occurred_at,r.response_id`;
    const materializeTurn = (
      row: TurnRow,
      responses: readonly ResponseRow[],
      childCount = 0,
    ): CodexLedgerTurn => {
      const reported = responses.filter((response) => response.status === "reported");
      const tokens =
        reported.length > 0
          ? addTokens(reported.map((response) => parseTokens(response.tokens_json)))
          : row.provisional_tokens_json
            ? parseTokens(row.provisional_tokens_json)
            : EMPTY_TOKENS;
      const conflicting = responses.some(
        (response) => response.status === "conflict" || response.status === "invalid",
      );
      const fullyKnown = Object.values(tokens).every((value) => value !== null);
      const reconciled =
        reported.length > 0 && fullyKnown && checkpointMatches(row.turn_checkpoint_json, tokens);
      const usageExact = !conflicting && reconciled && row.lifecycle === "completed";
      const reportedValuation = valuationFromRows(responses);
      const valuation = usageExact
        ? reportedValuation
        : {
            ...reportedValuation,
            completeEstimateUsd: null,
            missingPriceReasons: [
              ...new Set([...reportedValuation.missingPriceReasons, "usageIncomplete"]),
            ],
          };
      const models = [
        ...new Set(
          reported
            .map((response) => response.model)
            .filter((model): model is string => model !== null),
        ),
      ];
      const allModelsKnown =
        reported.length > 0 && reported.every((response) => response.model !== null);
      const efforts = [
        ...new Set(
          reported
            .map((response) => response.effort)
            .filter((effort): effort is string => effort !== null),
        ),
      ];
      const scope = [
        ...new Set(
          responses.map((response) => response.scope).filter((value) => value !== "unknown"),
        ),
      ];
      return {
        identity: {
          sourceDomain: row.source_domain,
          codexThreadId: row.codex_thread_id,
          codexTurnId: row.codex_turn_id,
          rootTurnId: row.root_turn_id,
          t3EnvironmentId: row.t3_environment_id,
          t3ProjectId: row.t3_project_id,
          t3ThreadId: row.t3_thread_id,
          t3TurnId: row.t3_turn_id,
          t3MessageId: row.t3_message_id,
        },
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        model:
          allModelsKnown && models.length === 1
            ? models[0]!
            : reported.length === 0
              ? row.provisional_model
              : null,
        effort: efforts.length === 1 ? efforts[0]! : null,
        scope:
          scope.length > 1
            ? "mixed"
            : scope[0] === "main" || scope[0] === "child" || scope[0] === "guardian"
              ? scope[0]
              : "unknown",
        lifecycle:
          row.lifecycle === "completed" || row.lifecycle === "aborted" || row.lifecycle === "active"
            ? row.lifecycle
            : "unknown",
        responseCount: responses.length,
        childTurnCount: childCount,
        tokens,
        valuation,
        coverage: {
          usage: conflicting
            ? "conflict"
            : usageExact
              ? "exact"
              : reported.length > 0
                ? "partial"
                : row.provisional_tokens_json
                  ? "provisional"
                  : "unknown",
          model:
            models.length > 1
              ? "conflict"
              : allModelsKnown && models.length === 1
                ? "observed"
                : reported.length === 0 && row.provisional_model
                  ? "inferred"
                  : "unknown",
          pricing:
            responses.length === 0
              ? "notValued"
              : usageExact && valuation.completeEstimateUsd !== null
                ? "priced"
                : "partial",
          lineage: row.root_turn_id || childCount > 0 ? "partial" : "unknown",
          subscription: "unknown",
        },
      };
    };

    const readChildCount = (row: TurnRow) =>
      Effect.gen(function* () {
        const counts = asRows<{ count: number }>(
          yield* sql`SELECT COUNT(*) AS count FROM codex_ledger_turns
      WHERE source_domain=${row.source_domain} AND root_turn_id=${row.codex_turn_id}
        AND (codex_thread_id!=${row.codex_thread_id} OR codex_turn_id!=${row.codex_turn_id})`,
        );
        return counts[0]?.count ?? 0;
      });

    const routingEvidenceFromReceipt = (receipt: RoutingReceiptRow): RoutingEvidence => {
      const decision = parseJsonRecord(receipt.decision_json);
      const dispatch = parseJsonRecord(receipt.dispatch_json);
      return {
        beforeModel: typeof decision.beforeModel === "string" ? decision.beforeModel : null,
        beforeEffort: typeof decision.beforeEffort === "string" ? decision.beforeEffort : null,
        dispatchModel: typeof dispatch.model === "string" ? dispatch.model : null,
        dispatchEffort: typeof dispatch.effort === "string" ? dispatch.effort : null,
      };
    };

    const readRoutingEvidence = (row: TurnRow) =>
      Effect.gen(function* () {
        const receipts = asRows<RoutingReceiptRow>(
          yield* sql`SELECT decision_json,dispatch_json,identity_json FROM codex_ledger_jev_receipts
          WHERE root_turn_id=${row.root_turn_id ?? row.codex_turn_id} AND
            (json_extract(identity_json,'$.providerTurnId')=${row.codex_turn_id} OR
              (${row.t3_turn_id} IS NOT NULL AND json_extract(identity_json,'$.turnId')=${row.t3_turn_id}))
          ORDER BY created_at DESC LIMIT 1`,
        );
        if (!receipts[0]) return null;
        return routingEvidenceFromReceipt(receipts[0]);
      });

    const listTurnsRaw = (input: CodexLedgerListTurnsInput) =>
      Effect.gen(function* () {
        const limit = pageLimit(input.limit);
        const cursor = decodeCursor(input.cursor, "turns");
        const snapshotAt = cursor?.snapshotAt ?? now();
        const last = cursor?.last ?? [];
        const filters = [sql`created_at <= ${snapshotAt}`];
        if (input.sourceDomain) filters.push(sql`source_domain=${input.sourceDomain}`);
        if (input.codexThreadId) filters.push(sql`codex_thread_id=${input.codexThreadId}`);
        if (input.t3ThreadId) filters.push(sql`t3_thread_id=${input.t3ThreadId}`);
        if (input.t3TurnId) filters.push(sql`t3_turn_id=${input.t3TurnId}`);
        if (input.rootTurnId) filters.push(sql`root_turn_id=${input.rootTurnId}`);
        if (input.from) filters.push(sql`started_at >= ${input.from}`);
        if (input.to) filters.push(sql`started_at <= ${input.to}`);
        if (last[0])
          filters.push(
            sql`(started_at,source_domain,codex_thread_id,codex_turn_id) <
              (${last[0]},${last[1]},${last[2]},${last[3]})`,
          );
        const rows = asRows<TurnRow>(
          yield* sql`
      SELECT * FROM codex_ledger_turns WHERE ${sql.and(filters)}
      ORDER BY started_at DESC,source_domain DESC,codex_thread_id DESC,codex_turn_id DESC
      LIMIT ${limit + 1}`,
        );
        const pageRows = rows.slice(0, limit);
        const requestedJson = JSON.stringify(
          pageRows.map((row) => ({
            sourceDomain: row.source_domain,
            codexThreadId: row.codex_thread_id,
            codexTurnId: row.codex_turn_id,
            rootTurnId: row.root_turn_id ?? row.codex_turn_id,
            t3TurnId: row.t3_turn_id,
          })),
        );
        const responseRows = asRows<ResponseRow & { request_index: number }>(
          pageRows.length === 0
            ? []
            : yield* sql`WITH requested AS (
                SELECT CAST(key AS INTEGER) AS request_index,
                  json_extract(value,'$.sourceDomain') AS source_domain,
                  json_extract(value,'$.codexThreadId') AS codex_thread_id,
                  json_extract(value,'$.codexTurnId') AS codex_turn_id
                FROM json_each(${requestedJson})
              )
              SELECT requested.request_index,r.*,
                v.components_json AS valuation_json,v.snapshot_id AS valuation_snapshot_id
              FROM requested JOIN codex_ledger_responses AS r
                INDEXED BY codex_ledger_responses_turn
                ON r.source_domain=requested.source_domain
                AND r.codex_thread_id=requested.codex_thread_id
                AND r.codex_turn_id=requested.codex_turn_id
              LEFT JOIN codex_ledger_valuations v
                ON v.source_domain=r.source_domain AND v.response_id=r.response_id
                AND v.valuation_id='scenario:' ||
                  (SELECT active_snapshot_id FROM codex_ledger_settings WHERE id=1)
              ORDER BY requested.request_index,r.occurred_at,r.response_id`,
        );
        const childCountRows = asRows<{ request_index: number; count: number }>(
          pageRows.length === 0
            ? []
            : yield* sql`WITH requested AS (
                SELECT CAST(key AS INTEGER) AS request_index,
                  json_extract(value,'$.sourceDomain') AS source_domain,
                  json_extract(value,'$.codexThreadId') AS codex_thread_id,
                  json_extract(value,'$.codexTurnId') AS codex_turn_id
                FROM json_each(${requestedJson})
              )
              SELECT requested.request_index,COUNT(child.codex_turn_id) AS count
              FROM requested LEFT JOIN codex_ledger_turns child
                ON child.source_domain=requested.source_domain
                AND child.root_turn_id=requested.codex_turn_id
                AND (child.codex_thread_id!=requested.codex_thread_id
                  OR child.codex_turn_id!=requested.codex_turn_id)
              GROUP BY requested.request_index`,
        );
        const receiptRows = asRows<RoutingReceiptRow & { request_index: number }>(
          pageRows.length === 0
            ? []
            : yield* sql`WITH requested AS (
                SELECT CAST(key AS INTEGER) AS request_index,
                  json_extract(value,'$.rootTurnId') AS root_turn_id,
                  json_extract(value,'$.codexTurnId') AS codex_turn_id,
                  json_extract(value,'$.t3TurnId') AS t3_turn_id
                FROM json_each(${requestedJson})
              ), matched AS (
                SELECT requested.request_index,receipt.decision_json,
                  receipt.dispatch_json,receipt.identity_json,
                  ROW_NUMBER() OVER (
                    PARTITION BY requested.request_index ORDER BY receipt.created_at DESC
                  ) AS match_rank
                FROM requested JOIN codex_ledger_jev_receipts receipt
                  ON receipt.root_turn_id=requested.root_turn_id
                WHERE json_extract(receipt.identity_json,'$.providerTurnId')=
                    requested.codex_turn_id
                  OR (requested.t3_turn_id IS NOT NULL AND
                    json_extract(receipt.identity_json,'$.turnId')=requested.t3_turn_id)
              )
              SELECT request_index,decision_json,dispatch_json,identity_json
              FROM matched WHERE match_rank=1`,
        );
        const responsesByIndex = new Map<number, ResponseRow[]>();
        for (const response of responseRows) {
          const group = responsesByIndex.get(response.request_index) ?? [];
          group.push(response);
          responsesByIndex.set(response.request_index, group);
        }
        const childCountByIndex = new Map(
          childCountRows.map((entry) => [entry.request_index, entry.count] as const),
        );
        const receiptByIndex = new Map(
          receiptRows.map((receipt) => [receipt.request_index, receipt] as const),
        );
        const comparisonSnapshotId = responseRows.find(
          (response) => response.valuation_snapshot_id,
        )?.valuation_snapshot_id;
        const comparisonSnapshot = comparisonSnapshotId
          ? comparisonSnapshotId === CODEX_STANDARD_RATE_SNAPSHOT.id
            ? CODEX_STANDARD_RATE_SNAPSHOT
            : yield* readSnapshot(comparisonSnapshotId)
          : null;
        const items = pageRows.map((row, index): CodexLedgerTurn => {
          const receipt = receiptByIndex.get(index);
          const evidence = receipt ? routingEvidenceFromReceipt(receipt) : null;
          const responses = responsesByIndex.get(index) ?? [];
          const turn = materializeTurn(row, responses, childCountByIndex.get(index) ?? 0);
          return {
            ...turn,
            routingBefore:
              evidence && (evidence.beforeModel !== null || evidence.beforeEffort !== null)
                ? { model: evidence.beforeModel, effort: evidence.beforeEffort }
                : null,
            sameTokenComparisons: comparisonSnapshot
              ? sameTokenComparisonsFromRows(
                  responses,
                  evidence,
                  turn.model,
                  turn.effort,
                  comparisonSnapshot,
                )
              : [],
          };
        });
        const tail = rows[Math.min(limit, rows.length) - 1];
        return {
          items,
          nextCursor:
            rows.length > limit && tail
              ? encodeCursor({
                  kind: "turns",
                  snapshotAt,
                  last: [
                    tail.started_at,
                    tail.source_domain,
                    tail.codex_thread_id,
                    tail.codex_turn_id,
                  ],
                })
              : null,
        };
      });

    const getSummaryRaw = Effect.gen(function* () {
      yield* scan;
      const captureActive = yield* readCapture;
      const rows = asRows<ResponseRow>(
        yield* sql`SELECT r.*,v.components_json AS valuation_json,v.snapshot_id AS valuation_snapshot_id FROM codex_ledger_responses r
      LEFT JOIN codex_ledger_valuations v ON v.source_domain=r.source_domain AND v.response_id=r.response_id
        AND v.valuation_id='scenario:' || (SELECT active_snapshot_id FROM codex_ledger_settings WHERE id=1)`,
      );
      const turns = asRows<{ count: number; missing: number }>(
        yield* sql`
      SELECT COUNT(*) AS count, SUM(CASE WHEN NOT EXISTS
        (SELECT 1 FROM codex_ledger_responses r WHERE r.source_domain=t.source_domain
        AND r.codex_thread_id=t.codex_thread_id AND r.codex_turn_id=t.codex_turn_id)
        AND t.provisional_tokens_json IS NULL THEN 1 ELSE 0 END) AS missing
      FROM codex_ledger_turns t`,
      );
      const sources = asRows<SourceRow>(
        yield* sql`SELECT * FROM codex_ledger_sources ORDER BY source_domain`,
      );
      const valid = rows.filter((row) => row.status === "reported");
      const tokens = addTokens(valid.map((row) => parseTokens(row.tokens_json)));
      const lastCapturedAt =
        sources
          .map((source) => source.last_captured_at)
          .filter((value): value is string => value !== null)
          .sort()
          .at(-1) ?? null;
      const groupedSources = new Map<string, CodexLedgerSummary["sources"][number]>();
      for (const source of sources) {
        const previous = groupedSources.get(source.source_domain);
        const sourceState = captureActive
          ? source.state === "unavailable"
            ? "unavailable"
            : source.state === "partial" || source.state === "pending"
              ? "partial"
              : "ready"
          : "paused";
        groupedSources.set(source.source_domain, {
          sourceDomain: source.source_domain,
          state:
            previous?.state === "unavailable" || sourceState === "unavailable"
              ? "unavailable"
              : previous?.state === "partial" || sourceState === "partial"
                ? "partial"
                : sourceState,
          lastCapturedAt:
            [previous?.lastCapturedAt, source.last_captured_at]
              .filter((value): value is string => value !== null && value !== undefined)
              .sort()
              .at(-1) ?? null,
          lastError: previous?.lastError ?? source.last_error,
          pendingFileCount:
            (previous?.pendingFileCount ?? 0) + (source.size_bytes > source.resume_offset ? 1 : 0),
          malformedRecordCount:
            (previous?.malformedRecordCount ?? 0) + source.malformed_record_count,
        });
      }
      return {
        captureState: captureActive ? "active" : "paused",
        lastCapturedAt,
        responseCount: rows.length,
        turnCount: turns[0]?.count ?? 0,
        conflictCount: rows.filter((row) => row.status === "conflict" || row.status === "invalid")
          .length,
        missingUsageTurnCount: turns[0]?.missing ?? 0,
        tokens,
        valuation: valuationFromRows(rows),
        coverage: {
          usage:
            rows.some((row) => row.status !== "reported") ||
            sources.some(
              (source) => source.state !== "ready" || source.size_bytes > source.resume_offset,
            ) ||
            (turns[0]?.missing ?? 0) > 0
              ? "partial"
              : rows.length > 0
                ? "partial"
                : "unknown",
          model: rows.some((row) => row.model === null)
            ? "unknown"
            : rows.length > 0
              ? "observed"
              : "unknown",
          pricing:
            rows.length === 0
              ? "notValued"
              : valuationFromRows(rows).unpricedResponseCount > 0
                ? "partial"
                : "priced",
          lineage: "partial",
          subscription: "unknown",
        },
        sources: [...groupedSources.values()],
      } satisfies CodexLedgerSummary;
    });

    const readLiveExportPage = (input: CodexLedgerExportInput) =>
      Effect.gen(function* () {
        const limit = pageLimit(input.limit);
        const cursor = decodeCursor(input.cursor, "export");
        const snapshotAt = cursor?.snapshotAt ?? now();
        const exportSnapshotId = cursor?.snapshotId ?? (yield* activeSnapshotId);
        const last = cursor?.last ?? [];
        const sections = [
          "observations",
          "conflicts",
          "turns",
          "threads",
          "tools",
          "spawnHints",
          "childHints",
          "lineage",
          "quota",
          "jev",
          "experiments",
          "runs",
          "valuations",
          "rates",
          "sources",
        ] as const;
        type Section = (typeof sections)[number];
        const section =
          last[0] && sections.includes(last[0] as Section) ? (last[0] as Section) : "responses";
        if (section !== "responses") {
          const offset = Number(last[1] ?? "0");
          const domain = input.sourceDomain ?? null;
          const from = input.from ?? null;
          const to = input.to ?? null;
          const rows = asRows<Record<string, unknown>>(
            yield* section === "observations"
              ? sql`
          SELECT * FROM codex_ledger_observations WHERE (${domain} IS NULL OR source_domain=${domain})
          AND (${from} IS NULL OR occurred_at>=${from}) AND (${to} IS NULL OR occurred_at<=${to})
          ORDER BY source_id,observation_id LIMIT ${limit + 1} OFFSET ${offset}`
              : section === "conflicts"
                ? sql`SELECT * FROM codex_ledger_conflicts WHERE (${domain} IS NULL OR source_domain=${domain})
            AND created_at<=${snapshotAt} ORDER BY source_domain,response_id,source_id,observation_id LIMIT ${limit + 1} OFFSET ${offset}`
                : section === "turns"
                  ? sql`SELECT * FROM codex_ledger_turns WHERE (${domain} IS NULL OR source_domain=${domain})
            AND created_at<=${snapshotAt} ORDER BY source_domain,codex_thread_id,codex_turn_id LIMIT ${limit + 1} OFFSET ${offset}`
                  : section === "threads"
                    ? sql`SELECT * FROM codex_ledger_threads WHERE (${domain} IS NULL OR source_domain=${domain})
            ORDER BY source_domain,codex_thread_id LIMIT ${limit + 1} OFFSET ${offset}`
                    : section === "tools"
                      ? sql`SELECT * FROM codex_ledger_tools WHERE (${domain} IS NULL OR source_domain=${domain})
            ORDER BY source_domain,call_id LIMIT ${limit + 1} OFFSET ${offset}`
                      : section === "spawnHints"
                        ? sql`SELECT * FROM codex_ledger_spawn_hints WHERE (${domain} IS NULL OR source_domain=${domain})
            ORDER BY source_domain,tool_use_id LIMIT ${limit + 1} OFFSET ${offset}`
                        : section === "childHints"
                          ? sql`SELECT * FROM codex_ledger_child_hints WHERE (${domain} IS NULL OR source_domain=${domain})
            ORDER BY source_domain,child_thread_id LIMIT ${limit + 1} OFFSET ${offset}`
                          : section === "lineage"
                            ? sql`SELECT * FROM codex_ledger_lineage_edges WHERE (${domain} IS NULL OR source_domain=${domain})
            ORDER BY source_domain,tool_use_id,child_thread_id LIMIT ${limit + 1} OFFSET ${offset}`
                            : section === "quota"
                              ? sql`SELECT * FROM codex_ledger_quota WHERE (${domain} IS NULL OR source_domain=${domain})
            AND observed_at<=${snapshotAt} AND (${from} IS NULL OR observed_at>=${from}) AND (${to} IS NULL OR observed_at<=${to})
            ORDER BY source_domain,bucket_id,observation_id LIMIT ${limit + 1} OFFSET ${offset}`
                              : section === "jev"
                                ? sql`SELECT * FROM codex_ledger_jev_receipts WHERE created_at<=${snapshotAt}
            ORDER BY request_id,attempt_id LIMIT ${limit + 1} OFFSET ${offset}`
                                : section === "experiments"
                                  ? sql`SELECT * FROM codex_ledger_experiments WHERE created_at<=${snapshotAt}
            ORDER BY experiment_id LIMIT ${limit + 1} OFFSET ${offset}`
                                  : section === "runs"
                                    ? sql`SELECT * FROM codex_ledger_runs WHERE created_at<=${snapshotAt}
            ORDER BY run_id LIMIT ${limit + 1} OFFSET ${offset}`
                                    : section === "valuations"
                                      ? sql`SELECT * FROM codex_ledger_valuations WHERE (${domain} IS NULL OR source_domain=${domain})
            AND created_at<=${snapshotAt} ORDER BY source_domain,response_id,valuation_id LIMIT ${limit + 1} OFFSET ${offset}`
                                      : section === "rates"
                                        ? sql`SELECT * FROM codex_ledger_rate_snapshots ORDER BY snapshot_id LIMIT ${limit + 1} OFFSET ${offset}`
                                        : sql`SELECT * FROM codex_ledger_sources WHERE (${domain} IS NULL OR source_domain=${domain})
            ORDER BY source_id LIMIT ${limit + 1} OFFSET ${offset}`,
          );
          const index = sections.indexOf(section);
          const nextSection = sections[index + 1];
          const nextCursor =
            rows.length > limit
              ? encodeCursor({
                  kind: "export",
                  snapshotAt,
                  snapshotId: exportSnapshotId,
                  last: [section, String(offset + limit)],
                })
              : nextSection
                ? encodeCursor({
                    kind: "export",
                    snapshotAt,
                    snapshotId: exportSnapshotId,
                    last: [nextSection, "0"],
                  })
                : null;
          return {
            format: "jsonl" as const,
            data:
              rows
                .slice(0, limit)
                .map((row) =>
                  JSON.stringify({
                    type: section,
                    record:
                      section === "sources"
                        ? {
                            sourceId: row["source_id"],
                            sourceDomain: row["source_domain"],
                            state: row["state"],
                            lastError: row["last_error"],
                            lastCapturedAt: row["last_captured_at"],
                            malformedRecordCount: row["malformed_record_count"],
                            sizeBytes: row["size_bytes"],
                            resumeOffset: row["resume_offset"],
                            guardHash: row["guard_hash"],
                            generation: row["generation"],
                            fileFingerprint: row["file_fingerprint"],
                          }
                        : row,
                  }),
                )
                .join("\n") + (rows.length ? "\n" : ""),
            nextCursor,
          };
        }
        const rows = asRows<ResponseRow>(
          yield* sql`SELECT r.*,v.components_json AS valuation_json,v.snapshot_id AS valuation_snapshot_id FROM codex_ledger_responses r
        LEFT JOIN codex_ledger_valuations v ON v.source_domain=r.source_domain AND v.response_id=r.response_id
          AND v.valuation_id=${`scenario:${exportSnapshotId}`}
        WHERE r.created_at <= ${snapshotAt} AND
        (${input.sourceDomain ?? null} IS NULL OR r.source_domain=${input.sourceDomain ?? null}) AND
        (${input.from ?? null} IS NULL OR r.occurred_at>=${input.from ?? null}) AND
        (${input.to ?? null} IS NULL OR r.occurred_at<=${input.to ?? null}) AND
        (${last[1] ?? null} IS NULL OR (r.occurred_at,r.source_domain,r.response_id) >
          (${last[1] ?? null},${last[2] ?? null},${last[3] ?? null}))
        ORDER BY r.occurred_at,r.source_domain,r.response_id LIMIT ${limit + 1}`,
        );
        const tail = rows[Math.min(limit, rows.length) - 1];
        const header = cursor
          ? []
          : [
              JSON.stringify({
                type: "header",
                format: "t3-codex-ledger-jsonl",
                version: 1,
                exportedAt: snapshotAt,
                sourceDomain: input.sourceDomain ?? null,
                from: input.from ?? null,
                to: input.to ?? null,
                activeSnapshotId: exportSnapshotId,
              }),
            ];
        const lines = [
          ...header,
          ...rows
            .slice(0, limit)
            .map((row) =>
              JSON.stringify({ type: "response", record: row, presentation: responseFromRow(row) }),
            ),
        ];
        return {
          format: "jsonl" as const,
          data: lines.join("\n") + "\n",
          nextCursor:
            rows.length > limit && tail
              ? encodeCursor({
                  kind: "export",
                  snapshotAt,
                  snapshotId: exportSnapshotId,
                  last: ["responses", tail.occurred_at, tail.source_domain, tail.response_id],
                })
              : encodeCursor({
                  kind: "export",
                  snapshotAt,
                  snapshotId: exportSnapshotId,
                  last: [sections[0], "0"],
                }),
        };
      });

    return CodexLedgerService.of({
      getSummary: () => guarded(getSummaryRaw),
      listTurns: (input) => guarded(listTurnsRaw(input)),
      getTurn: (input) =>
        guarded(
          Effect.gen(function* () {
            const rows = asRows<TurnRow>(
              yield* sql`SELECT * FROM codex_ledger_turns WHERE
        source_domain=${input.sourceDomain} AND codex_thread_id=${input.codexThreadId} AND codex_turn_id=${input.codexTurnId}`,
            );
            const row = rows[0];
            if (!row) return null;
            const responses = asRows<ResponseRow>(
              yield* readResponses(input.sourceDomain, input.codexThreadId, input.codexTurnId),
            );
            const rootTurnId = row.root_turn_id ?? row.codex_turn_id;
            const root =
              rootTurnId === row.codex_turn_id
                ? row
                : (asRows<TurnRow>(
                    yield* sql`SELECT * FROM codex_ledger_turns
                      INDEXED BY codex_ledger_turns_codex_identity
                      WHERE codex_turn_id=${rootTurnId} AND source_domain=${input.sourceDomain}
                      LIMIT 1`,
                  )[0] ?? null);
            const children = asRows<TurnRow>(
              yield* sql`SELECT * FROM codex_ledger_turns WHERE
        source_domain=${input.sourceDomain} AND root_turn_id=${rootTurnId}
        AND (codex_thread_id!=${root?.codex_thread_id ?? ""} OR codex_turn_id!=${rootTurnId})
        ORDER BY started_at,codex_thread_id,codex_turn_id`,
            );
            const familyRows = root ? [root, ...children] : children.length > 0 ? children : [row];
            const familyResponses = asRows<ResponseRow>(
              yield* sql`
              SELECT r.*,v.components_json AS valuation_json,v.snapshot_id AS valuation_snapshot_id
              FROM codex_ledger_responses AS r INDEXED BY codex_ledger_responses_turn
              JOIN codex_ledger_turns t ON t.source_domain=r.source_domain
                AND t.codex_thread_id=r.codex_thread_id AND t.codex_turn_id=r.codex_turn_id
              LEFT JOIN codex_ledger_valuations v ON v.source_domain=r.source_domain AND v.response_id=r.response_id
                AND v.valuation_id='scenario:' || (SELECT active_snapshot_id FROM codex_ledger_settings WHERE id=1)
              WHERE t.source_domain=${input.sourceDomain} AND
                (t.root_turn_id=${rootTurnId} OR
                  (t.codex_turn_id=${rootTurnId} AND t.codex_thread_id=${root?.codex_thread_id ?? ""}))`,
            );
            const responsesByTurn = new Map<string, ResponseRow[]>();
            for (const response of familyResponses) {
              const key = `${response.codex_thread_id}\u0000${response.codex_turn_id}`;
              const group = responsesByTurn.get(key) ?? [];
              group.push(response);
              responsesByTurn.set(key, group);
            }
            const materialized = familyRows.map((member) =>
              materializeTurn(
                member,
                responsesByTurn.get(`${member.codex_thread_id}\u0000${member.codex_turn_id}`) ?? [],
                root &&
                  member.codex_thread_id === root.codex_thread_id &&
                  member.codex_turn_id === root.codex_turn_id
                  ? children.length
                  : 0,
              ),
            );
            const childTurns = children
              .slice(0, 200)
              .map((child) => materialized[familyRows.indexOf(child)]!);
            const spawnRows = asRows<{ tool_use_id: string; child_thread_id: string | null }>(
              yield* sql`
              SELECT h.tool_use_id,e.child_thread_id FROM codex_ledger_spawn_hints h
              LEFT JOIN codex_ledger_lineage_edges e ON e.source_domain=h.source_domain
                AND e.tool_use_id=h.tool_use_id
              WHERE h.source_domain=${input.sourceDomain} AND
                (h.parent_turn_id=${rootTurnId} OR EXISTS(
                  SELECT 1 FROM codex_ledger_turns parent_turn
                  WHERE parent_turn.source_domain=h.source_domain
                    AND parent_turn.codex_turn_id=h.parent_turn_id
                    AND parent_turn.root_turn_id=${rootTurnId}))`,
            );
            const spawnThreads = new Map<string, Set<string>>();
            for (const spawn of spawnRows) {
              const threads = spawnThreads.get(spawn.tool_use_id) ?? new Set<string>();
              if (spawn.child_thread_id) threads.add(spawn.child_thread_id);
              spawnThreads.set(spawn.tool_use_id, threads);
            }
            let unresolvedChildCount = [...spawnThreads.values()].filter(
              (threads) => threads.size === 0,
            ).length;
            const edgeCountByThread = new Map<string, number>();
            for (const threads of spawnThreads.values())
              for (const threadId of threads)
                edgeCountByThread.set(threadId, (edgeCountByThread.get(threadId) ?? 0) + 1);
            const turnCountByThread = new Map<string, number>();
            for (const child of children)
              turnCountByThread.set(
                child.codex_thread_id,
                (turnCountByThread.get(child.codex_thread_id) ?? 0) + 1,
              );
            for (const [threadId, edgeCount] of edgeCountByThread)
              unresolvedChildCount += Math.max(
                0,
                edgeCount - (turnCountByThread.get(threadId) ?? 0),
              );
            const activeChildTurnCount = children.filter(
              (child) => child.lifecycle === "active" || child.lifecycle === "unknown",
            ).length;
            const sourceRows = asRows<{ count: number; incomplete: number }>(
              yield* sql`SELECT COUNT(*) AS count,
              SUM(CASE WHEN state!='ready' OR size_bytes>resume_offset THEN 1 ELSE 0 END) AS incomplete
              FROM codex_ledger_sources WHERE source_domain=${input.sourceDomain}`,
            );
            const sourceReady =
              (sourceRows[0]?.count ?? 0) > 0 && (sourceRows[0]?.incomplete ?? 0) === 0;
            const rootObserved = root !== null;
            const allExact =
              materialized.length > 0 &&
              materialized.every((member) => member.coverage.usage === "exact");
            const lineageResolved =
              rootObserved &&
              root.lifecycle === "completed" &&
              activeChildTurnCount === 0 &&
              unresolvedChildCount === 0 &&
              sourceReady;
            const familyValuation = valuationFromRows(familyResponses);
            const completeFamilyEstimate =
              allExact && lineageResolved ? familyValuation.completeEstimateUsd : null;
            const familyMissingReasons = [
              ...new Set([
                ...familyValuation.missingPriceReasons,
                ...(!allExact ? ["familyUsageIncomplete"] : []),
                ...(!lineageResolved ? ["childLineageOrCaptureIncomplete"] : []),
              ]),
            ];
            const familyCoverage: CodexLedgerTurn["coverage"] = {
              usage: materialized.some((member) => member.coverage.usage === "conflict")
                ? "conflict"
                : allExact && lineageResolved
                  ? "exact"
                  : "partial",
              model: materialized.some((member) => member.coverage.model === "conflict")
                ? "conflict"
                : materialized.every((member) => member.coverage.model === "observed")
                  ? "observed"
                  : "unknown",
              pricing:
                completeFamilyEstimate !== null
                  ? "priced"
                  : familyResponses.length > 0
                    ? "partial"
                    : "notValued",
              lineage: lineageResolved ? "resolved" : rootObserved ? "partial" : "unknown",
              subscription: "unknown",
            };
            const tools = asRows<{
              call_id: string;
              name: string | null;
              status: string | null;
              output_bytes: number | null;
              occurred_at: string | null;
            }>(
              yield* sql`SELECT call_id,name,status,output_bytes,occurred_at FROM codex_ledger_tools WHERE
          source_domain=${input.sourceDomain} AND codex_thread_id=${input.codexThreadId}
          AND codex_turn_id=${input.codexTurnId} ORDER BY occurred_at,call_id LIMIT 200`,
            );
            const routingEvidence = yield* readRoutingEvidence(row);
            const routingBefore =
              routingEvidence &&
              (routingEvidence.beforeModel !== null || routingEvidence.beforeEffort !== null)
                ? {
                    model: routingEvidence.beforeModel,
                    effort: routingEvidence.beforeEffort,
                  }
                : null;
            const selectedTurn = {
              ...materializeTurn(row, responses, yield* readChildCount(row)),
              routingBefore,
            };
            const routing = routingEvidence
              ? {
                  before: routingBefore,
                  used: {
                    model: selectedTurn.model ?? routingEvidence.dispatchModel,
                    effort: selectedTurn.effort ?? routingEvidence.dispatchEffort,
                  },
                }
              : null;
            const snapshot = yield* readSnapshot(yield* activeSnapshotId);
            const sameTokenComparisons = sameTokenComparisonsFromRows(
              responses,
              routingEvidence,
              selectedTurn.model,
              selectedTurn.effort,
              snapshot,
            );

            const threadMembers = row.t3_thread_id
              ? asRows<TurnRow & { is_linked_root: number }>(
                  yield* sql`WITH linked_roots AS (
                      SELECT source_domain,codex_thread_id,codex_turn_id
                      FROM codex_ledger_turns WHERE t3_thread_id=${row.t3_thread_id} AND
                        (started_at < ${row.started_at} OR
                          (started_at=${row.started_at} AND codex_turn_id<=${row.codex_turn_id}))
                    ), member_ids AS (
                      SELECT source_domain,codex_thread_id,codex_turn_id FROM linked_roots
                      UNION
                      SELECT child.source_domain,child.codex_thread_id,child.codex_turn_id
                      FROM codex_ledger_turns child JOIN linked_roots root
                        ON child.source_domain=root.source_domain
                        AND child.root_turn_id=root.codex_turn_id
                    )
                    SELECT member.*,
                      EXISTS(SELECT 1 FROM linked_roots root
                        WHERE root.source_domain=member.source_domain
                        AND root.codex_thread_id=member.codex_thread_id
                        AND root.codex_turn_id=member.codex_turn_id) AS is_linked_root
                    FROM codex_ledger_turns member JOIN member_ids ids
                      ON ids.source_domain=member.source_domain
                      AND ids.codex_thread_id=member.codex_thread_id
                      AND ids.codex_turn_id=member.codex_turn_id`,
                )
              : [];
            const threadResponses = row.t3_thread_id
              ? asRows<ResponseRow>(
                  yield* sql`WITH linked_roots AS (
                      SELECT source_domain,codex_thread_id,codex_turn_id
                      FROM codex_ledger_turns WHERE t3_thread_id=${row.t3_thread_id} AND
                        (started_at < ${row.started_at} OR
                          (started_at=${row.started_at} AND codex_turn_id<=${row.codex_turn_id}))
                    ), member_ids AS (
                      SELECT source_domain,codex_thread_id,codex_turn_id FROM linked_roots
                      UNION
                      SELECT child.source_domain,child.codex_thread_id,child.codex_turn_id
                      FROM codex_ledger_turns child JOIN linked_roots root
                        ON child.source_domain=root.source_domain
                        AND child.root_turn_id=root.codex_turn_id
                    )
                    SELECT r.*,v.components_json AS valuation_json,
                      v.snapshot_id AS valuation_snapshot_id
                    FROM codex_ledger_responses AS r INDEXED BY codex_ledger_responses_turn
                    JOIN member_ids member
                      ON member.source_domain=r.source_domain
                      AND member.codex_thread_id=r.codex_thread_id
                      AND member.codex_turn_id=r.codex_turn_id
                    LEFT JOIN codex_ledger_valuations v ON v.source_domain=r.source_domain
                      AND v.response_id=r.response_id AND
                      v.valuation_id='scenario:' ||
                        (SELECT active_snapshot_id FROM codex_ledger_settings WHERE id=1)`,
                )
              : [];
            const threadResponsesByTurn = new Map<string, ResponseRow[]>();
            for (const response of threadResponses) {
              const key = `${response.source_domain}\u0000${response.codex_thread_id}\u0000${response.codex_turn_id}`;
              const group = threadResponsesByTurn.get(key) ?? [];
              group.push(response);
              threadResponsesByTurn.set(key, group);
            }
            const threadMaterialized = threadMembers.map((member) =>
              materializeTurn(
                member,
                threadResponsesByTurn.get(
                  `${member.source_domain}\u0000${member.codex_thread_id}\u0000${member.codex_turn_id}`,
                ) ?? [],
              ),
            );
            const threadValuation = valuationFromRows(threadResponses);
            const threadUsageExact =
              threadMaterialized.length > 0 &&
              threadMaterialized.every((member) => member.coverage.usage === "exact");
            const threadThroughTurn = row.t3_thread_id
              ? {
                  includedTurnCount: threadMembers.filter((member) => member.is_linked_root).length,
                  tokens: addTokens(threadMaterialized.map((member) => member.tokens)),
                  valuation: {
                    ...threadValuation,
                    completeEstimateUsd: threadUsageExact
                      ? threadValuation.completeEstimateUsd
                      : null,
                    missingPriceReasons: [
                      ...new Set([
                        ...threadValuation.missingPriceReasons,
                        ...(!threadUsageExact ? ["threadUsageIncomplete"] : []),
                      ]),
                    ],
                  },
                  coverage: {
                    usage: threadMaterialized.some((member) => member.coverage.usage === "conflict")
                      ? ("conflict" as const)
                      : threadUsageExact
                        ? ("exact" as const)
                        : ("partial" as const),
                    model: threadMaterialized.some((member) => member.coverage.model === "conflict")
                      ? ("conflict" as const)
                      : threadMaterialized.every((member) => member.coverage.model === "observed")
                        ? ("observed" as const)
                        : ("unknown" as const),
                    pricing:
                      threadResponses.length === 0
                        ? ("notValued" as const)
                        : threadValuation.unpricedResponseCount === 0
                          ? ("priced" as const)
                          : ("partial" as const),
                    lineage: "partial" as const,
                    subscription: "unknown" as const,
                  },
                }
              : null;
            return {
              turn: { ...selectedTurn, sameTokenComparisons },
              responses: responses.map(responseFromRow),
              routing,
              sameTokenComparisons,
              threadThroughTurn,
              family: {
                rootTurnId,
                includedTurnCount: familyRows.length,
                childTurnCount: children.length,
                unresolvedChildCount,
                activeChildTurnCount,
                childPreviewTruncated: children.length > 200,
                tokens: addTokens(materialized.map((member) => member.tokens)),
                valuation: {
                  ...familyValuation,
                  completeEstimateUsd: completeFamilyEstimate,
                  missingPriceReasons: familyMissingReasons,
                },
                coverage: familyCoverage,
              },
              childTurns,
              tools: tools.map((tool) => ({
                callId: tool.call_id,
                name: tool.name,
                status: tool.status,
                outputBytes: tool.output_bytes,
                occurredAt: tool.occurred_at,
              })),
            };
          }),
        ),
      listFamily: (input) =>
        guarded(
          listTurnsRaw({
            sourceDomain: input.sourceDomain,
            rootTurnId: input.rootTurnId,
            cursor: input.cursor,
            limit: input.limit,
          }),
        ),
      setCapture: (active) =>
        guarded(
          Effect.gen(function* () {
            yield* sql`UPDATE codex_ledger_settings SET capture_active=${active ? 1 : 0},updated_at=${now()} WHERE id=1`;
            return yield* getSummaryRaw;
          }),
        ),
      exportJsonl: (input) =>
        guarded(
          Effect.gen(function* () {
            const limit = pageLimit(input.limit);
            const current = now();
            yield* sql`DELETE FROM codex_ledger_export_rows WHERE export_id IN
        (SELECT export_id FROM codex_ledger_export_jobs WHERE expires_at < ${current})`;
            yield* sql`DELETE FROM codex_ledger_export_jobs WHERE expires_at < ${current}`;
            const cursor = decodeCursor(input.cursor, "exportJob");
            if (input.cursor && !cursor)
              return yield* Effect.fail(
                new CodexLedgerError({ message: "Invalid or expired export cursor" }),
              );
            let exportId = cursor?.last[0];
            let offset = Number(cursor?.last[1] ?? "0");
            if (!exportId) {
              exportId = NodeCrypto.randomUUID();
              offset = 0;
              const createdAt = now();
              const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
              const jobId = exportId;
              yield* sql.withTransaction(
                Effect.gen(function* () {
                  yield* sql`INSERT INTO codex_ledger_export_jobs(export_id,created_at,expires_at,row_count,snapshot_id)
            VALUES(${jobId},${createdAt},${expiresAt},0,${yield* activeSnapshotId})`;
                  let liveCursor: string | null = null;
                  let ordinal = 0;
                  let bytes = 0;
                  do {
                    const page: { format: "jsonl"; data: string; nextCursor: string | null } =
                      yield* readLiveExportPage({
                        ...input,
                        limit: 200,
                        ...(liveCursor ? { cursor: liveCursor } : { cursor: undefined }),
                      });
                    for (const line of page.data.split("\n")) {
                      if (!line) continue;
                      bytes += Buffer.byteLength(line, "utf8") + 1;
                      if (ordinal >= 250_000 || bytes > 128 * 1024 * 1024)
                        return yield* Effect.fail(
                          new CodexLedgerError({
                            message:
                              "Export exceeds 250,000 rows or 128 MiB; choose a narrower date range",
                          }),
                        );
                      yield* sql`INSERT INTO codex_ledger_export_rows(export_id,ordinal,jsonl)
                VALUES(${jobId},${ordinal},${line})`;
                      ordinal++;
                    }
                    liveCursor = page.nextCursor;
                  } while (liveCursor);
                  yield* sql`UPDATE codex_ledger_export_jobs SET row_count=${ordinal} WHERE export_id=${jobId}`;
                }),
              );
            }
            if (!Number.isSafeInteger(offset) || offset < 0)
              return yield* Effect.fail(new CodexLedgerError({ message: "Invalid export offset" }));
            const job = asRows<{ row_count: number; expires_at: string }>(
              yield* sql`
        SELECT row_count,expires_at FROM codex_ledger_export_jobs WHERE export_id=${exportId}`,
            )[0];
            if (!job || job.expires_at < now())
              return yield* Effect.fail(
                new CodexLedgerError({ message: "Export expired; start a new export" }),
              );
            const rows = asRows<{ jsonl: string }>(
              yield* sql`SELECT jsonl FROM codex_ledger_export_rows
        WHERE export_id=${exportId} AND ordinal>=${offset} ORDER BY ordinal LIMIT ${limit}`,
            );
            const next =
              offset + rows.length < job.row_count
                ? encodeCursor({
                    kind: "exportJob",
                    snapshotAt: current,
                    last: [exportId, String(offset + rows.length)],
                  })
                : null;
            return {
              format: "jsonl" as const,
              data: rows.map((row) => row.jsonl).join("\n") + (rows.length ? "\n" : ""),
              nextCursor: next,
            };
          }),
        ),
      upsertExperiment: (input) =>
        guarded(
          Effect.gen(function* () {
            JSON.parse(input.manifestJson);
            const existing = asRows<{ created_at: string; manifest_json: string }>(
              yield* sql`SELECT created_at,manifest_json FROM codex_ledger_experiments WHERE experiment_id=${input.experimentId}`,
            )[0];
            if (existing && existing.manifest_json !== input.manifestJson) {
              const runCount =
                asRows<{ count: number }>(
                  yield* sql`SELECT COUNT(*) AS count FROM codex_ledger_runs WHERE experiment_id=${input.experimentId}`,
                )[0]?.count ?? 0;
              if (runCount > 0)
                return yield* Effect.fail(
                  new CodexLedgerError({
                    message:
                      "Experiment plan is frozen after the first run; create a new experiment for revised checks",
                  }),
                );
            }
            const createdAt = existing?.created_at ?? now();
            yield* sql`INSERT INTO codex_ledger_experiments(experiment_id,name,manifest_json,created_at)
        VALUES(${input.experimentId},${input.name},${input.manifestJson},${createdAt})
        ON CONFLICT(experiment_id) DO UPDATE SET name=excluded.name,manifest_json=excluded.manifest_json`;
            return { ...input, createdAt };
          }),
        ),
      getExperiment: (experimentId) =>
        guarded(
          Effect.gen(function* () {
            yield* scan;
            yield* reconcileJevReceipts();
            const experiment = asRows<{
              experiment_id: string;
              name: string;
              manifest_json: string;
              created_at: string;
            }>(
              yield* sql`SELECT * FROM codex_ledger_experiments WHERE experiment_id=${experimentId}`,
            )[0];
            if (!experiment) return null;
            const runs = asRows<Record<string, unknown>>(
              yield* sql`SELECT * FROM codex_ledger_runs WHERE experiment_id=${experimentId} ORDER BY created_at`,
            );
            const declared = JSON.parse(experiment.manifest_json) as Record<string, unknown>;
            const rateSnapshotId =
              typeof declared.rateSnapshotId === "string" ? declared.rateSnapshotId : null;
            const attempts: ExperimentAttempt[] = [];
            for (const raw of runs) {
              const run = runFromRow(raw);
              const metadata = JSON.parse(run.metadataJson) as Record<string, unknown>;
              const outcome = run.outcomeJson
                ? (JSON.parse(run.outcomeJson) as Record<string, unknown>)
                : {};
              const rootLinks = Array.isArray(metadata.rootTurns)
                ? metadata.rootTurns.filter(
                    (value): value is { sourceDomain: string; rootTurnId: string } =>
                      !!value &&
                      typeof value === "object" &&
                      typeof value.sourceDomain === "string" &&
                      typeof value.rootTurnId === "string",
                  )
                : [];
              if (
                run.sourceDomain &&
                run.rootTurnId &&
                !rootLinks.some(
                  (link) =>
                    link.sourceDomain === run.sourceDomain && link.rootTurnId === run.rootTurnId,
                )
              )
                rootLinks.unshift({ sourceDomain: run.sourceDomain, rootTurnId: run.rootTurnId });
              const uniqueLinks = [
                ...new Map(
                  rootLinks.map((link) => [`${link.sourceDomain}:${link.rootTurnId}`, link]),
                ).values(),
              ];
              const values = new Map<string, CodexResponseValuation>();
              const responseKeys = new Set<string>();
              const toolKeys = new Set<string>();
              const receiptKeys = new Set<string>();
              const storageGapKeys = new Set<string>();
              const receipts: {
                reported_cost_usd: string | null;
                estimated_cost_usd: string | null;
                identity_json: string;
              }[] = [];
              let ambiguousReceiptCount = 0;
              let workComplete = uniqueLinks.length > 0;
              for (const link of uniqueLinks) {
                const responseRows = asRows<{
                  source_domain: string;
                  response_id: string;
                  status: string;
                  components_json: string | null;
                }>(
                  yield* sql`
            SELECT r.source_domain,r.response_id,r.status,v.components_json FROM codex_ledger_responses r
            LEFT JOIN codex_ledger_valuations v ON v.source_domain=r.source_domain AND v.response_id=r.response_id
              AND v.snapshot_id=${rateSnapshotId ?? ""} AND v.valuation_id=${`scenario:${rateSnapshotId ?? ""}`}
            WHERE r.source_domain=${link.sourceDomain} AND
              (r.root_turn_id=${link.rootTurnId} OR r.codex_turn_id=${link.rootTurnId})`,
                );
                for (const row of responseRows) {
                  const key = `${row.source_domain}:${row.response_id}`;
                  responseKeys.add(key);
                  if (row.status !== "reported") workComplete = false;
                  if (row.components_json)
                    values.set(key, JSON.parse(row.components_json) as CodexResponseValuation);
                }
                const turnRows = asRows<TurnRow>(
                  yield* sql`SELECT * FROM codex_ledger_turns
            WHERE source_domain=${link.sourceDomain} AND (root_turn_id=${link.rootTurnId} OR codex_turn_id=${link.rootTurnId})`,
                );
                if (turnRows.length === 0) workComplete = false;
                const childWithoutTurn = asRows<{ count: number }>(
                  yield* sql`SELECT COUNT(*) AS count FROM codex_ledger_lineage_edges e
                    WHERE e.source_domain=${link.sourceDomain} AND e.root_turn_id=${link.rootTurnId}
                      AND e.child_thread_id IS NOT NULL
                      AND NOT EXISTS (
                        SELECT 1 FROM codex_ledger_turns child
                        WHERE child.source_domain=e.source_domain
                          AND child.codex_thread_id=e.child_thread_id
                          AND child.root_turn_id=${link.rootTurnId}
                      )`,
                );
                if ((childWithoutTurn[0]?.count ?? 0) > 0) workComplete = false;
                for (const turn of turnRows) {
                  const turnResponses = asRows<ResponseRow>(
                    yield* readResponses(
                      turn.source_domain,
                      turn.codex_thread_id,
                      turn.codex_turn_id,
                    ),
                  );
                  if (materializeTurn(turn, turnResponses).coverage.usage !== "exact")
                    workComplete = false;
                  const unresolvedSpawns = asRows<{ count: number }>(
                    yield* sql`SELECT COUNT(*) AS count FROM codex_ledger_spawn_hints h
              WHERE h.source_domain=${link.sourceDomain} AND h.parent_turn_id=${turn.codex_turn_id}
                AND NOT EXISTS(SELECT 1 FROM codex_ledger_lineage_edges e WHERE e.source_domain=h.source_domain
                  AND e.tool_use_id=h.tool_use_id)`,
                  );
                  if ((unresolvedSpawns[0]?.count ?? 0) > 0) workComplete = false;
                }
                const sourceRows = asRows<{
                  state: string;
                  size_bytes: number;
                  resume_offset: number;
                }>(
                  yield* sql`
            SELECT state,size_bytes,resume_offset FROM codex_ledger_sources WHERE source_domain=${link.sourceDomain}`,
                );
                if (
                  sourceRows.length === 0 ||
                  sourceRows.some(
                    (source) =>
                      source.state !== "ready" || source.size_bytes > source.resume_offset,
                  )
                )
                  workComplete = false;
                const toolRows = asRows<{ source_domain: string; call_id: string }>(
                  yield* sql`SELECT t.source_domain,t.call_id FROM codex_ledger_tools t
            LEFT JOIN codex_ledger_turns tr ON tr.source_domain=t.source_domain AND tr.codex_thread_id=t.codex_thread_id
              AND tr.codex_turn_id=t.codex_turn_id
            WHERE t.source_domain=${link.sourceDomain} AND
              (tr.root_turn_id=${link.rootTurnId} OR t.codex_turn_id=${link.rootTurnId})`,
                );
                for (const tool of toolRows) toolKeys.add(`${tool.source_domain}:${tool.call_id}`);
                const linkedReceipts = asRows<{
                  request_id: string;
                  attempt_id: string;
                  reported_cost_usd: string | null;
                  estimated_cost_usd: string | null;
                  identity_json: string;
                }>(
                  yield* sql`
            SELECT request_id,attempt_id,reported_cost_usd,estimated_cost_usd,identity_json FROM codex_ledger_jev_receipts
            WHERE root_turn_id=${link.rootTurnId}`,
                );
                for (const receipt of linkedReceipts) {
                  const identity = JSON.parse(receipt.identity_json) as {
                    sourceDomain?: string;
                    providerThreadId?: string;
                    providerTurnId?: string;
                    t3ThreadId?: string;
                  };
                  if (identity.sourceDomain && identity.sourceDomain !== link.sourceDomain)
                    continue;
                  if (!identity.sourceDomain) {
                    const matches =
                      identity.providerThreadId && identity.providerTurnId
                        ? asRows<{ source_domain: string }>(
                            yield* sql`SELECT DISTINCT source_domain FROM codex_ledger_turns
                  WHERE codex_thread_id=${identity.providerThreadId} AND codex_turn_id=${identity.providerTurnId}`,
                          )
                        : [];
                    if (matches.length !== 1 || matches[0]?.source_domain !== link.sourceDomain) {
                      ambiguousReceiptCount++;
                      continue;
                    }
                  }
                  const key = `${receipt.request_id}:${receipt.attempt_id}`;
                  if (receiptKeys.has(key)) continue;
                  receiptKeys.add(key);
                  receipts.push(receipt);
                }
                const unlinkedStorageGaps = asRows<{ request_id: string; attempt_id: string }>(
                  yield* sql`SELECT r.request_id,r.attempt_id FROM codex_ledger_jev_receipts r
                    WHERE r.root_turn_id IS NULL
                      AND json_extract(r.identity_json,'$.receiptStorageError') = 1
                      AND EXISTS (
                        SELECT 1 FROM codex_ledger_turns t
                        WHERE t.source_domain=${link.sourceDomain}
                          AND (t.root_turn_id=${link.rootTurnId} OR t.codex_turn_id=${link.rootTurnId})
                          AND (
                            (json_extract(r.identity_json,'$.threadId') IS NOT NULL
                              AND t.t3_thread_id=json_extract(r.identity_json,'$.threadId')) OR
                            (json_extract(r.identity_json,'$.environmentId') IS NOT NULL
                              AND t.t3_environment_id=json_extract(r.identity_json,'$.environmentId')) OR
                            (json_extract(r.identity_json,'$.providerThreadId') IS NOT NULL
                              AND t.codex_thread_id=json_extract(r.identity_json,'$.providerThreadId'))
                          )
                      )`,
                );
                for (const gap of unlinkedStorageGaps)
                  storageGapKeys.add(`${gap.request_id}:${gap.attempt_id}`);
              }
              const costs = sumCodexValuations([...values.values()]);
              const reported = receipts
                .map((receipt) => receipt.reported_cost_usd)
                .filter((value): value is string => value !== null);
              const estimated = receipts
                .map((receipt) => receipt.estimated_cost_usd)
                .filter((value): value is string => value !== null);
              const combined = receipts.map(
                (receipt) => receipt.reported_cost_usd ?? receipt.estimated_cost_usd,
              );
              const jevUnknownCount =
                receipts.filter(
                  (receipt) =>
                    (receipt.reported_cost_usd === null && receipt.estimated_cost_usd === null) ||
                    (JSON.parse(receipt.identity_json) as { receiptStorageError?: boolean })
                      .receiptStorageError === true,
                ).length +
                ambiguousReceiptCount +
                storageGapKeys.size +
                (receipts.length === 0 && metadata.jevEnabled !== false ? 1 : 0);
              attempts.push({
                runId: run.runId,
                caseId: run.caseId,
                cohort: run.cohort,
                status: run.status,
                roots: uniqueLinks.map((link) => `${link.sourceDomain}:${link.rootTurnId}`),
                rateSnapshotId,
                apiSubtotalUsd: responseKeys.size ? costs.subtotalUsd : null,
                apiComplete:
                  workComplete &&
                  responseKeys.size > 0 &&
                  costs.unpricedCount === 0 &&
                  values.size === responseKeys.size,
                unpricedResponseCount: responseKeys.size - costs.pricedCount,
                jevReportedUsd: reported.length
                  ? sumExactUsd(reported)
                  : metadata.jevEnabled === false
                    ? "0"
                    : null,
                jevEstimatedUsd: estimated.length
                  ? sumExactUsd(estimated)
                  : metadata.jevEnabled === false
                    ? "0"
                    : null,
                jevCombinedEstimateUsd:
                  combined.every((value) => value !== null) &&
                  (combined.length > 0 || metadata.jevEnabled === false)
                    ? sumExactUsd(combined as string[])
                    : null,
                jevUnknownCount,
                toolCalls: uniqueLinks.length ? toolKeys.size : null,
                wallTimeMs: typeof metadata.wallTimeMs === "number" ? metadata.wallTimeMs : null,
                humanIntervention:
                  typeof outcome.humanIntervention === "boolean" ? outcome.humanIntervention : null,
                qualityAccepted:
                  typeof outcome.qualityAccepted === "boolean" ? outcome.qualityAccepted : null,
                acceptanceEvidencePresent:
                  typeof outcome.acceptanceEvidence === "string" &&
                  outcome.acceptanceEvidence.trim().length > 0,
              });
            }
            return {
              experiment: {
                experimentId: experiment.experiment_id,
                name: experiment.name,
                manifestJson: experiment.manifest_json,
                createdAt: experiment.created_at,
              },
              runs: runs.map(runFromRow),
              reportJson: JSON.stringify(
                reportExperiment(attempts, rateSnapshotId, {
                  corpusDeclared:
                    typeof declared.taskCorpus === "string" && declared.taskCorpus.length > 0,
                  acceptanceDeclared:
                    Array.isArray(declared.acceptanceChecks) &&
                    declared.acceptanceChecks.length > 0,
                  harnessDeclared:
                    typeof declared.harnessVersion === "string" &&
                    declared.harnessVersion.length > 0,
                }),
              ),
            };
          }),
        ),
      listExperiments: () =>
        guarded(
          Effect.gen(function* () {
            const rows = asRows<{
              experiment_id: string;
              name: string;
              manifest_json: string;
              created_at: string;
            }>(
              yield* sql`SELECT * FROM codex_ledger_experiments ORDER BY created_at DESC LIMIT 200`,
            );
            return {
              items: rows.map((row) => ({
                experimentId: row.experiment_id,
                name: row.name,
                manifestJson: row.manifest_json,
                createdAt: row.created_at,
              })),
            };
          }),
        ),
      listRateSnapshots: () => guarded(listSnapshotsRaw),
      createRateSnapshot: (input) =>
        guarded(
          Effect.gen(function* () {
            const snapshot = yield* Effect.try({
              try: () => createCodexRateSnapshot(JSON.parse(input.rulesJson) as CodexRateSnapshot),
              catch: err,
            });
            if (snapshot.id !== input.snapshotId)
              return yield* Effect.fail(
                new CodexLedgerError({ message: "Snapshot ID and rules disagree" }),
              );
            const existing = asRows<{ rules_json: string }>(
              yield* sql`SELECT rules_json FROM codex_ledger_rate_snapshots WHERE snapshot_id=${input.snapshotId}`,
            )[0];
            if (existing)
              return yield* Effect.fail(
                new CodexLedgerError({
                  message: "Rate snapshot ID already exists; create a new ID for an override",
                }),
              );
            yield* sql`INSERT INTO codex_ledger_rate_snapshots(snapshot_id,captured_at,source_url,rules_json,calculation_version)
        VALUES(${snapshot.id},${snapshot.retrievedOn},${Object.values(snapshot.models)[0]?.source ?? ""},${JSON.stringify(snapshot)},'1')`;
            yield* revalueSnapshot(snapshot);
            return yield* listSnapshotsRaw;
          }),
        ),
      selectRateSnapshot: (snapshotId) =>
        guarded(
          Effect.gen(function* () {
            const snapshot = yield* readSnapshot(snapshotId);
            yield* revalueSnapshot(snapshot);
            yield* sql`UPDATE codex_ledger_settings SET active_snapshot_id=${snapshotId},updated_at=${now()} WHERE id=1`;
            return yield* listSnapshotsRaw;
          }),
        ),
      upsertRun: (input) =>
        guarded(
          Effect.gen(function* () {
            JSON.parse(input.metadataJson);
            if (input.outcomeJson !== null) JSON.parse(input.outcomeJson);
            const existing = asRows<{ created_at: string }>(
              yield* sql`SELECT created_at FROM codex_ledger_runs WHERE run_id=${input.runId}`,
            )[0];
            const createdAt = existing?.created_at ?? now(),
              updatedAt = now();
            yield* sql`INSERT INTO codex_ledger_runs(run_id,experiment_id,case_id,cohort,source_domain,root_turn_id,status,metadata_json,outcome_json,created_at,updated_at)
        VALUES(${input.runId},${input.experimentId},${input.caseId},${input.cohort},${input.sourceDomain},${input.rootTurnId},${input.status},${input.metadataJson},${input.outcomeJson},${createdAt},${updatedAt})
        ON CONFLICT(run_id) DO UPDATE SET experiment_id=excluded.experiment_id,
          case_id=excluded.case_id,cohort=excluded.cohort,source_domain=excluded.source_domain,
          root_turn_id=excluded.root_turn_id,status=excluded.status,metadata_json=excluded.metadata_json,
          outcome_json=excluded.outcome_json,updated_at=excluded.updated_at`;
            return { ...input, createdAt, updatedAt };
          }),
        ),
      recordJevReceipt: (input) =>
        guarded(
          Effect.gen(function* () {
            yield* Effect.try({ try: () => JSON.parse(input.decisionJson), catch: err });
            if (input.dispatchJson !== null)
              yield* Effect.try({ try: () => JSON.parse(input.dispatchJson!), catch: err });
            const edgeRows = input.toolUseId
              ? asRows<{
                  source_domain: string;
                  child_thread_id: string;
                  root_turn_id: string | null;
                }>(
                  yield* sql`SELECT source_domain,child_thread_id,root_turn_id FROM codex_ledger_lineage_edges
          WHERE tool_use_id=${input.toolUseId} LIMIT 2`,
                )
              : [];
            const edge = edgeRows.length === 1 ? edgeRows[0] : undefined;
            const identity = {
              environmentId: input.environmentId,
              projectId: input.projectId,
              threadId: input.threadId,
              messageId: input.messageId,
              turnId: input.turnId,
              providerThreadId: input.providerThreadId,
              providerTurnId: input.providerTurnId,
              childProviderThreadId: input.childProviderThreadId ?? edge?.child_thread_id ?? null,
              parentProviderTurnId: input.parentProviderTurnId,
              dispatchId: input.dispatchId,
              observedModel: input.observedModel,
              sourceScope: input.sourceScope,
              sourceDomain: edge?.source_domain ?? null,
              receiptStorageError: input.receiptStorageError ?? false,
            };
            const prior = asRows<{
              status: string;
              reported_cost_usd: string | null;
              estimated_cost_usd: string | null;
              identity_json: string;
              decision_json: string;
              dispatch_json: string | null;
              root_turn_id: string | null;
              tool_use_id: string | null;
            }>(
              yield* sql`
        SELECT * FROM codex_ledger_jev_receipts
        WHERE request_id=${input.requestId} AND attempt_id=${input.attemptId}`,
            )[0];
            if (
              prior?.reported_cost_usd !== null &&
              prior?.reported_cost_usd !== undefined &&
              input.reportedCostUsd !== null &&
              prior.reported_cost_usd !== input.reportedCostUsd
            ) {
              return yield* Effect.fail(
                new CodexLedgerError({
                  message: "Conflicting Jev reported charge for one request attempt",
                }),
              );
            }
            const priorIdentity = prior
              ? (JSON.parse(prior.identity_json) as Record<string, unknown>)
              : {};
            const identityJson = JSON.stringify({
              ...priorIdentity,
              ...Object.fromEntries(
                Object.entries(identity).filter(
                  ([, value]) => value !== null && value !== undefined,
                ),
              ),
              receiptStorageError:
                priorIdentity.receiptStorageError === true || input.receiptStorageError === true,
            });
            // "completed" is the router decision receipt. Dispatch can finish later.
            const stage = (status: string) =>
              status === "proposed"
                ? 0
                : status === "completed"
                  ? 1
                  : status === "dispatched"
                    ? 2
                    : 3;
            const status =
              prior && stage(prior.status) >= stage(input.status) ? prior.status : input.status;
            const decisionJson =
              prior && stage(prior.status) >= stage(input.status)
                ? prior.decision_json
                : input.decisionJson;
            const dispatchJson = input.dispatchJson ?? prior?.dispatch_json ?? null;
            const reportedCostUsd = prior?.reported_cost_usd ?? input.reportedCostUsd;
            const estimatedCostUsd = prior?.estimated_cost_usd ?? input.estimatedCostUsd;
            const rootTurnId =
              input.rootTurnId ?? edge?.root_turn_id ?? prior?.root_turn_id ?? null;
            const toolUseId = input.toolUseId ?? prior?.tool_use_id ?? null;
            const unchanged =
              prior?.status === status &&
              prior.reported_cost_usd === reportedCostUsd &&
              prior.estimated_cost_usd === estimatedCostUsd &&
              prior.identity_json === identityJson &&
              prior.dispatch_json === dispatchJson;
            yield* sql`INSERT INTO codex_ledger_jev_receipts
        (request_id,attempt_id,root_turn_id,tool_use_id,identity_json,decision_json,dispatch_json,reported_cost_usd,estimated_cost_usd,status,created_at)
        VALUES(${input.requestId},${input.attemptId},${rootTurnId},${toolUseId},${identityJson},${decisionJson},${dispatchJson},${reportedCostUsd},${estimatedCostUsd},${status},${now()})
        ON CONFLICT(request_id,attempt_id) DO UPDATE SET
          root_turn_id=excluded.root_turn_id,
          tool_use_id=excluded.tool_use_id,
          identity_json=excluded.identity_json,
          decision_json=excluded.decision_json,
          dispatch_json=excluded.dispatch_json,
          reported_cost_usd=excluded.reported_cost_usd,
          estimated_cost_usd=excluded.estimated_cost_usd,
          status=excluded.status`;
            yield* reconcileJevReceipts(input.requestId, input.attemptId);
            return { recorded: !unchanged };
          }),
        ),
      listQuota: (input) =>
        guarded(
          Effect.gen(function* () {
            const limit = pageLimit(input.limit);
            const cursor = decodeCursor(input.cursor, "quota");
            const snapshotAt = cursor?.snapshotAt ?? now();
            const last = cursor?.last ?? [];
            const rows = asRows<{
              source_domain: string;
              bucket_id: string;
              observed_at: string;
              used_percent: number | null;
              window_duration_mins: number | null;
              resets_at: string | null;
              plan: string | null;
            }>(
              yield* sql`SELECT * FROM codex_ledger_quota WHERE observed_at <= ${snapshotAt} AND
          (${input.sourceDomain ?? null} IS NULL OR source_domain=${input.sourceDomain ?? null})
          AND (${last[0] ?? null} IS NULL OR (observed_at,source_domain,bucket_id) <
            (${last[0] ?? null},${last[1] ?? null},${last[2] ?? null}))
          ORDER BY observed_at DESC,source_domain DESC,bucket_id DESC LIMIT ${limit + 1}`,
            );
            const tail = rows[Math.min(limit, rows.length) - 1];
            return {
              items: rows.slice(0, limit).map((row) => ({
                sourceDomain: row.source_domain,
                bucketId: row.bucket_id,
                observedAt: row.observed_at,
                usedPercent: row.used_percent,
                windowDurationMins: row.window_duration_mins,
                resetsAt: row.resets_at,
                plan: row.plan,
              })),
              nextCursor:
                rows.length > limit && tail
                  ? encodeCursor({
                      kind: "quota",
                      snapshotAt,
                      last: [tail.observed_at, tail.source_domain, tail.bucket_id],
                    })
                  : null,
            };
          }),
        ),
    });
  });

const runFromRow = (row: Record<string, unknown>): CodexLedgerRunRow => ({
  runId: String(row["run_id"]),
  experimentId: String(row["experiment_id"]),
  caseId: String(row["case_id"]),
  cohort: String(row["cohort"]),
  rootTurnId: row["root_turn_id"] as string | null,
  sourceDomain: row["source_domain"] as string | null,
  status: row["status"] as CodexLedgerRunRow["status"],
  metadataJson: String(row["metadata_json"]),
  outcomeJson: row["outcome_json"] as string | null,
  createdAt: String(row["created_at"]),
  updatedAt: String(row["updated_at"]),
});

export const layerForHome = (codexHome: string) =>
  Layer.effect(CodexLedgerService, make(Effect.succeed([codexHome])));
const decodeCodexSettings = Schema.decodeUnknownOption(CodexSettings);
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const settingsService = yield* ServerSettings.ServerSettingsService;
    const resolveHomes = settingsService.getSettings.pipe(
      Effect.map((settings) => {
        const homes = new Set<string>();
        const instances: {
          config?: unknown;
          environment?: Parameters<typeof mergeProviderInstanceEnvironment>[0];
        }[] = Object.values(settings.providerInstances)
          .filter((instance) => instance.driver === "codex")
          .map((instance) => ({ config: instance.config, environment: instance.environment }));
        if (!Object.hasOwn(settings.providerInstances, "codex")) {
          instances.push({ config: settings.providers.codex });
        }
        for (const instance of instances) {
          const decoded = decodeCodexSettings(instance.config ?? {});
          if (Option.isNone(decoded)) continue;
          const environment = mergeProviderInstanceEnvironment(instance.environment);
          const home =
            decoded.value.homePath.trim() ||
            environment.CODEX_HOME?.trim() ||
            NodePath.join(NodeOS.homedir(), ".codex");
          homes.add(NodePath.resolve(expandHomePath(home)));
        }
        return [...homes];
      }),
      Effect.mapError(err),
    );
    return Layer.effect(CodexLedgerService, make(resolveHomes));
  }),
);

const EMPTY_SUMMARY: CodexLedgerSummary = {
  captureState: "active",
  lastCapturedAt: null,
  responseCount: 0,
  turnCount: 0,
  conflictCount: 0,
  missingUsageTurnCount: 0,
  tokens: EMPTY_TOKENS,
  valuation: EMPTY_VALUATION,
  coverage: {
    usage: "unknown",
    model: "unknown",
    pricing: "notValued",
    lineage: "unknown",
    subscription: "unknown",
  },
  sources: [],
};
export const layerTest = Layer.succeed(
  CodexLedgerService,
  CodexLedgerService.of({
    getSummary: () => Effect.succeed(EMPTY_SUMMARY),
    listTurns: () => Effect.succeed({ items: [], nextCursor: null }),
    getTurn: () => Effect.succeed(null),
    listFamily: () => Effect.succeed({ items: [], nextCursor: null }),
    setCapture: (active) =>
      Effect.succeed({ ...EMPTY_SUMMARY, captureState: active ? "active" : "paused" }),
    exportJsonl: () => Effect.succeed({ format: "jsonl", data: "", nextCursor: null }),
    upsertExperiment: (input) =>
      Effect.succeed({ ...input, createdAt: "1970-01-01T00:00:00.000Z" }),
    getExperiment: () => Effect.succeed(null),
    listExperiments: () => Effect.succeed({ items: [] }),
    listRateSnapshots: () => Effect.succeed({ items: [] }),
    createRateSnapshot: () => Effect.succeed({ items: [] }),
    selectRateSnapshot: () => Effect.succeed({ items: [] }),
    upsertRun: (input) =>
      Effect.succeed({
        ...input,
        createdAt: "1970-01-01T00:00:00.000Z",
        updatedAt: "1970-01-01T00:00:00.000Z",
      }),
    recordJevReceipt: () => Effect.succeed({ recorded: true }),
    listQuota: () => Effect.succeed({ items: [], nextCursor: null }),
  }),
);
