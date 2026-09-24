// @effect-diagnostics nodeBuiltinImport:off - OpenCode owns this SQLite database.
import * as NodeSqlite from "node:sqlite";

import * as Schema from "effect/Schema";

import type { UsageRecord } from "./usageTranscripts.ts";

const NonNegativeTokens = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const NonNegativeCost = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
const OpenCodeAssistant = Schema.Struct({
  role: Schema.Literal("assistant"),
  providerID: Schema.String,
  modelID: Schema.String,
  cost: Schema.optional(NonNegativeCost),
  tokens: Schema.Struct({
    input: NonNegativeTokens,
    output: NonNegativeTokens,
    reasoning: NonNegativeTokens,
    cache: Schema.Struct({ read: NonNegativeTokens, write: NonNegativeTokens }),
  }),
});
const decodeAssistant = Schema.decodeUnknownOption(Schema.fromJsonString(OpenCodeAssistant));

interface OpenCodeMessageRow {
  readonly id: string;
  readonly session_id: string;
  readonly time_created: number;
  readonly data: string;
}

/** Read only the fields needed for accounting from OpenCode's own history. */
export function readOpenCodeUsage(
  databasePath: string,
  sinceMs: number,
): { readonly records: readonly UsageRecord[]; readonly malformedRecords: number } | null {
  let database: NodeSqlite.DatabaseSync;
  try {
    database = new NodeSqlite.DatabaseSync(databasePath, { readOnly: true });
  } catch {
    return null;
  }

  try {
    const rows = database
      .prepare(
        "SELECT id, session_id, time_created, data FROM message " +
          "WHERE time_created >= ? AND CASE WHEN json_valid(data) " +
          "THEN json_extract(data, '$.role') END = 'assistant'",
      )
      .all(sinceMs) as unknown as OpenCodeMessageRow[];
    const malformed = database
      .prepare(
        "SELECT count(*) AS count FROM message WHERE time_created >= ? AND NOT json_valid(data)",
      )
      .get(sinceMs) as { readonly count: number };
    const records: UsageRecord[] = [];
    let malformedRecords = malformed.count;
    for (const row of rows) {
      const decoded = decodeAssistant(row.data);
      if (decoded._tag === "None" || !Number.isFinite(row.time_created)) {
        malformedRecords += 1;
        continue;
      }
      const assistant = decoded.value;
      if (!assistant.modelID.trim() || !assistant.providerID.trim()) {
        malformedRecords += 1;
        continue;
      }
      const { input, output, reasoning, cache } = assistant.tokens;
      if (input + output + reasoning + cache.read + cache.write === 0 && !assistant.cost) continue;
      records.push({
        provider: "opencode",
        timestampMs: row.time_created,
        model: `${assistant.providerID}/${assistant.modelID}`,
        sessionId: row.session_id,
        totals: {
          uncachedInputTokens: input,
          cachedInputTokens: cache.read,
          cacheCreationTokens: cache.write,
          outputTokens: output + reasoning,
          reasoningTokens: reasoning,
        },
        reportedCostUsd: assistant.cost ?? null,
        dedupeKey: `opencode-message:${row.id}`,
      });
    }
    return { records, malformedRecords };
  } catch {
    return null;
  } finally {
    database.close();
  }
}
