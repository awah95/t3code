import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";
import upstreamMigration54 from "./054_ProjectionThreadsAutoSettleDisabledAt.ts";

const histories = ["fresh", "jev-59", "upstream-54"] as const;

for (const history of histories) {
  it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))(
    `migration branch reconciliation (${history})`,
    (it) => {
      it.effect(`preserves schema and records from ${history}`, () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          if (history === "fresh") {
            yield* runMigrations({ toMigrationInclusive: 53 });
          } else if (history === "jev-59") {
            yield* runMigrations({ toMigrationInclusive: 59 });
            yield* sql`UPDATE codex_ledger_settings SET active_snapshot_id = 'preserved' WHERE id = 1`;
            yield* sql`INSERT INTO codex_ledger_jev_receipts
              (request_id, attempt_id, identity_json, decision_json, status, created_at)
              VALUES ('request-1', 'attempt-1', '{}', '{}', 'complete', '2026-09-26')`;
          } else if (history === "upstream-54") {
            yield* runMigrations({ toMigrationInclusive: 53 });
            yield* upstreamMigration54;
            yield* sql`INSERT INTO effect_sql_migrations (migration_id, name)
              VALUES (54, 'ProjectionThreadsAutoSettleDisabledAt')`;
          }

          yield* sql`INSERT INTO projection_threads
            (thread_id, project_id, title, created_at, updated_at)
            VALUES ('existing-thread', 'project-1', 'Original title', '2026-09-26', '2026-09-26')`;
          if (history === "upstream-54") {
            yield* sql`UPDATE projection_threads SET auto_settle_disabled_at = '2026-09-26'
              WHERE thread_id = 'existing-thread'`;
          }
          yield* runMigrations();
          const firstPass = yield* sql<{ readonly migration_id: number; readonly name: string }>`
            SELECT migration_id, name FROM effect_sql_migrations
            WHERE migration_id >= 54 ORDER BY migration_id`;
          assert.equal(firstPass.length, 7);
          assert.equal(
            firstPass[0]?.name,
            history === "upstream-54"
              ? "ProjectionThreadsAutoSettleDisabledAt"
              : "CodexUsageLedger",
          );
          assert.equal(firstPass[6]?.name, "EnsureProjectionThreadsAutoSettleDisabledAt");

          const tables = yield* sql<{ readonly name: string }>`
            SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'codex_ledger_jev_receipts'`;
          assert.equal(tables.length, 1);
          const columns = yield* sql<{
            readonly name: string;
          }>`PRAGMA table_info(projection_threads)`;
          for (const name of [
            "auto_settle_disabled_at",
            "parent_thread_id",
            "side_chat_mode",
            "side_chat_owns_worktree",
          ]) {
            assert.ok(
              columns.some((column) => column.name === name),
              `${history}: ${name}`,
            );
          }
          const [thread] = yield* sql<{ readonly title: string }>`
            SELECT title FROM projection_threads WHERE thread_id = 'existing-thread'`;
          assert.equal(thread?.title, "Original title");
          if (history === "upstream-54") {
            const [preserved] = yield* sql<{ readonly auto_settle_disabled_at: string | null }>`
              SELECT auto_settle_disabled_at FROM projection_threads WHERE thread_id = 'existing-thread'`;
            assert.equal(preserved?.auto_settle_disabled_at, "2026-09-26");
          }
          if (history === "jev-59") {
            const [setting] = yield* sql<{ readonly active_snapshot_id: string }>`
              SELECT active_snapshot_id FROM codex_ledger_settings WHERE id = 1`;
            assert.equal(setting?.active_snapshot_id, "preserved");
            const [receipt] = yield* sql<{ readonly status: string }>`
              SELECT status FROM codex_ledger_jev_receipts
              WHERE request_id = 'request-1' AND attempt_id = 'attempt-1'`;
            assert.equal(receipt?.status, "complete");
          }
          assert.deepEqual(yield* runMigrations(), []);
          const secondPass = yield* sql<{ readonly migration_id: number }>`
            SELECT migration_id FROM effect_sql_migrations WHERE migration_id >= 54`;
          assert.equal(secondPass.length, 7);
        }),
      );
    },
  );
}
