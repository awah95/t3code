// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../persistence/Migrations.ts";
import { CodexLedgerService, layerForHome } from "./CodexLedgerService.ts";

const at = "2026-09-21T00:00:00.000Z";
const row = (type: string, payload: object) =>
  JSON.stringify({ type, timestamp: at, payload }) + "\n";
const transcript = (threadId: string, turnIds: readonly string[]) =>
  row("session_meta", { id: threadId }) +
  turnIds
    .map(
      (turnId) =>
        row("event_msg", { type: "task_started", turn_id: turnId }) +
        row("turn_context", { turn_id: turnId, root_turn_id: turnId, model: "gpt-5.6-sol" }) +
        row("token_usage_record", {
          response_id: `${threadId}:${turnId}`,
          thread_id: threadId,
          turn_id: turnId,
          root_turn_id: turnId,
          usage: {
            input_tokens: 10,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: 1,
            reasoning_output_tokens: 0,
            total_tokens: 11,
          },
        }),
    )
    .join("");

it.effect("links exact Codex runtime cursors and turns, retaining ambiguity across restarts", () =>
  Effect.gen(function* () {
    const home = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codex-ledger-identity-")),
    );
    try {
      const sessions = NodePath.join(home, "sessions");
      yield* Effect.promise(() => NodeFSP.mkdir(sessions));
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          NodePath.join(sessions, "native.jsonl"),
          transcript("native-thread", [
            "linked-turn",
            "ambiguous-turn",
            "missing-turn",
            "wrong-provider-turn",
          ]),
        ),
      );
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          NodePath.join(sessions, "legacy.jsonl"),
          transcript("legacy-thread", ["legacy-turn"]),
        ),
      );
      const dbLayer = NodeSqliteClient.layer({ filename: NodePath.join(home, "state.sqlite") });
      yield* runMigrations().pipe(Effect.provide(dbLayer));
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        for (const threadId of ["t3-main", "t3-copy", "t3-legacy", "t3-other"]) {
          const provider = threadId === "t3-other" ? "claude" : "codex";
          const native = threadId === "t3-legacy" ? "legacy-thread" : null;
          yield* sql`INSERT INTO projection_thread_sessions
            (thread_id,status,provider_name,provider_thread_id,runtime_mode,updated_at)
            VALUES(${threadId},'ready',${provider},${native},'full-access',${at})`;
        }
        for (const threadId of ["t3-main", "t3-copy", "t3-other"]) {
          const provider = threadId === "t3-other" ? "claude" : "codex";
          yield* sql`INSERT INTO provider_session_runtime
            (thread_id,provider_name,adapter_key,runtime_mode,status,last_seen_at,resume_cursor_json)
            VALUES(${threadId},${provider},${provider},'full-access','ready',${at},
              ${JSON.stringify({ threadId: "native-thread" })})`;
        }
        for (const [threadId, turnId] of [
          ["t3-main", "linked-turn"],
          ["t3-main", "ambiguous-turn"],
          ["t3-copy", "ambiguous-turn"],
          ["t3-other", "wrong-provider-turn"],
          ["t3-legacy", "legacy-turn"],
        ])
          yield* sql`INSERT INTO projection_turns
            (thread_id,turn_id,pending_message_id,state,requested_at,checkpoint_files_json)
            VALUES(${threadId},${turnId},${`${threadId}:${turnId}`},'completed',${at},'[]')`;
      }).pipe(Effect.provide(dbLayer));

      const readLinks = () =>
        Effect.gen(function* () {
          const ledger = yield* CodexLedgerService;
          yield* ledger.getSummary();
          const turns = yield* ledger.listTurns({ limit: 20 });
          return new Map(turns.items.map((turn) => [turn.identity.codexTurnId, turn.identity]));
        }).pipe(Effect.provide(layerForHome(home).pipe(Layer.provideMerge(dbLayer))));
      for (let pass = 0; pass < 2; pass++) {
        const links = yield* readLinks();
        assert.equal(links.get("linked-turn")?.t3ThreadId, "t3-main");
        assert.equal(links.get("linked-turn")?.t3TurnId, "linked-turn");
        assert.equal(links.get("linked-turn")?.t3MessageId, "t3-main:linked-turn");
        assert.equal(links.get("legacy-turn")?.t3ThreadId, "t3-legacy");
        for (const turnId of ["ambiguous-turn", "wrong-provider-turn"])
          assert.equal(links.get(turnId)?.t3TurnId, null);
        assert.equal(links.get("missing-turn")?.t3TurnId, pass === 0 ? null : "missing-turn");
        if (pass === 0)
          yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`INSERT INTO projection_turns
              (thread_id,turn_id,pending_message_id,state,requested_at,checkpoint_files_json)
              VALUES('t3-main','missing-turn','t3-main:missing-turn','completed',${at},'[]')`;
          }).pipe(Effect.provide(dbLayer));
      }
    } finally {
      yield* Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true }));
    }
  }),
);
