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

const at = "2026-09-20T10:00:00.000Z";
const row = (type: string, payload: object) =>
  `${JSON.stringify({ type, timestamp: at, payload })}\n`;
const usage = (input: number, output: number) => ({
  input_tokens: input,
  cached_input_tokens: 0,
  cache_write_input_tokens: 0,
  output_tokens: output,
  reasoning_output_tokens: 0,
  total_tokens: input + output,
});
const receipt = (
  id: string,
  thread: string,
  turn: string,
  root: string,
  input: number,
  output: number,
) =>
  row("token_usage_record", {
    response_id: id,
    thread_id: thread,
    turn_id: turn,
    root_turn_id: root,
    usage: usage(input, output),
    turn_token_usage: usage(input, output),
  });

it.effect(
  "summarizes root and late child work while exposing active and capped child coverage",
  () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codex-ledger-family-")),
      );
      try {
        const dir = NodePath.join(home, "sessions", "2026", "09", "20");
        yield* Effect.promise(() => NodeFSP.mkdir(dir, { recursive: true }));
        const parentPath = NodePath.join(dir, "parent.jsonl");
        const childPath = NodePath.join(dir, "child.jsonl");
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            parentPath,
            row("session_meta", { id: "parent-thread", thread_source: "user" }) +
              row("event_msg", { type: "task_started", turn_id: "root-turn" }) +
              row("turn_context", {
                turn_id: "root-turn",
                root_turn_id: "root-turn",
                model: "gpt-5.6-luna",
              }) +
              receipt("parent-response", "parent-thread", "root-turn", "root-turn", 10, 2) +
              row("event_msg", { type: "task_complete", turn_id: "root-turn" }),
          ),
        );
        const db = NodePath.join(home, "state.sqlite");
        const dbLayer = NodeSqliteClient.layer({ filename: db });
        yield* runMigrations().pipe(Effect.provide(dbLayer));
        const serviceLayer = layerForHome(home).pipe(Layer.provideMerge(dbLayer));
        const initial = yield* Effect.gen(function* () {
          const ledger = yield* CodexLedgerService;
          yield* ledger.getSummary();
          const turns = yield* ledger.listTurns({ limit: 10 });
          const sourceDomain = turns.items[0]!.identity.sourceDomain;
          const detail = yield* ledger.getTurn({
            sourceDomain,
            codexThreadId: "parent-thread",
            codexTurnId: "root-turn",
          });
          return { sourceDomain, detail };
        }).pipe(Effect.provide(serviceLayer));
        assert.equal(initial.detail?.turn.tokens.processedTokens, 12);
        assert.equal(initial.detail?.family.tokens.processedTokens, 12);
        assert.equal(initial.detail?.family.childTurnCount, 0);
        assert.equal(initial.detail?.family.coverage.usage, "exact");
        assert.notEqual(initial.detail?.family.valuation.completeEstimateUsd, null);

        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            childPath,
            row("session_meta", {
              id: "child-thread",
              parent_thread_id: "parent-thread",
              thread_source: "subagent",
            }),
          ),
        );
        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO codex_ledger_spawn_hints
        (source_domain,tool_use_id,task_name,parent_thread_id,parent_turn_id)
        VALUES(${initial.sourceDomain},'spawn-child','/root/child','parent-thread','root-turn')`;
          yield* sql`INSERT INTO codex_ledger_lineage_edges
        (source_domain,tool_use_id,child_thread_id,parent_thread_id,parent_turn_id,root_turn_id)
        VALUES(${initial.sourceDomain},'spawn-child','child-thread','parent-thread','root-turn','root-turn')`;
        }).pipe(Effect.provide(dbLayer));
        const awaitingChild = yield* Effect.gen(function* () {
          const ledger = yield* CodexLedgerService;
          yield* ledger.getSummary();
          return yield* ledger.getTurn({
            sourceDomain: initial.sourceDomain,
            codexThreadId: "parent-thread",
            codexTurnId: "root-turn",
          });
        }).pipe(Effect.provide(serviceLayer));
        assert.equal(awaitingChild?.family.childTurnCount, 0);
        assert.equal(awaitingChild?.family.unresolvedChildCount, 1);
        assert.equal(awaitingChild?.family.valuation.completeEstimateUsd, null);

        yield* Effect.promise(() =>
          NodeFSP.appendFile(
            childPath,
            row("event_msg", { type: "task_started", turn_id: "child-turn" }) +
              row("turn_context", {
                turn_id: "child-turn",
                root_turn_id: "root-turn",
                model: "gpt-5.6-luna",
              }) +
              receipt("child-response", "child-thread", "child-turn", "root-turn", 5, 1) +
              row("event_msg", { type: "task_complete", turn_id: "child-turn" }),
          ),
        );
        const withChild = yield* Effect.gen(function* () {
          const ledger = yield* CodexLedgerService;
          yield* ledger.getSummary();
          return yield* ledger.getTurn({
            sourceDomain: initial.sourceDomain,
            codexThreadId: "parent-thread",
            codexTurnId: "root-turn",
          });
        }).pipe(Effect.provide(serviceLayer));
        assert.equal(withChild?.turn.tokens.processedTokens, 12);
        assert.equal(withChild?.family.tokens.processedTokens, 18);
        assert.equal(withChild?.family.childTurnCount, 1);
        assert.equal(withChild?.family.unresolvedChildCount, 0);
        assert.equal(withChild?.family.includedTurnCount, 2);
        assert.notEqual(
          withChild?.family.valuation.completeEstimateUsd,
          initial.detail?.family.valuation.completeEstimateUsd,
        );

        yield* Effect.promise(() =>
          NodeFSP.appendFile(
            childPath,
            row("event_msg", { type: "task_started", turn_id: "followup-turn" }) +
              row("turn_context", {
                turn_id: "followup-turn",
                root_turn_id: "other-root",
                model: "gpt-5.6-luna",
              }) +
              receipt("followup-response", "child-thread", "followup-turn", "other-root", 9, 1) +
              row("event_msg", { type: "task_complete", turn_id: "followup-turn" }) +
              row("event_msg", { type: "task_started", turn_id: "late-child" }) +
              row("turn_context", {
                turn_id: "late-child",
                root_turn_id: "root-turn",
                model: "gpt-5.6-luna",
              }),
          ),
        );
        const pending = yield* Effect.gen(function* () {
          const ledger = yield* CodexLedgerService;
          yield* ledger.getSummary();
          return yield* ledger.getTurn({
            sourceDomain: initial.sourceDomain,
            codexThreadId: "parent-thread",
            codexTurnId: "root-turn",
          });
        }).pipe(Effect.provide(serviceLayer));
        assert.equal(pending?.family.childTurnCount, 2);
        assert.equal(pending?.family.activeChildTurnCount, 1);
        assert.equal(pending?.family.tokens.processedTokens, null);
        assert.equal(pending?.family.valuation.completeEstimateUsd, null);
        assert.equal(pending?.family.coverage.usage, "partial");

        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<201)
        INSERT INTO codex_ledger_turns(source_domain,codex_thread_id,codex_turn_id,root_turn_id,started_at,lifecycle)
        SELECT ${initial.sourceDomain},'bulk-child-' || n,'bulk-turn-' || n,'root-turn',${at},'active' FROM seq`;
        }).pipe(Effect.provide(dbLayer));
        const capped = yield* Effect.gen(function* () {
          const ledger = yield* CodexLedgerService;
          return yield* ledger.getTurn({
            sourceDomain: initial.sourceDomain,
            codexThreadId: "parent-thread",
            codexTurnId: "root-turn",
          });
        }).pipe(Effect.provide(serviceLayer));
        assert.equal(capped?.family.childTurnCount, 203);
        assert.equal(capped?.family.includedTurnCount, 204);
        assert.equal(capped?.childTurns.length, 200);
        assert.equal(capped?.family.childPreviewTruncated, true);
        assert.equal(capped?.family.valuation.completeEstimateUsd, null);
      } finally {
        yield* Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true }));
      }
    }),
);

it.effect("does not create a turn from unbound context before task start", () =>
  Effect.gen(function* () {
    const home = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codex-ledger-context-")),
    );
    try {
      const dir = NodePath.join(home, "sessions", "2026", "09", "20");
      yield* Effect.promise(() => NodeFSP.mkdir(dir, { recursive: true }));
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          NodePath.join(dir, "context-before-start.jsonl"),
          row("session_meta", { id: "context-thread", thread_source: "user" }) +
            row("turn_context", { turn_id: "auto-compact-0", model: "gpt-5.6-sol" }) +
            row("thread_settings_applied", { model: "gpt-5.6-sol" }) +
            row("event_msg", { type: "task_started", turn_id: "actual-turn" }),
        ),
      );
      const dbLayer = NodeSqliteClient.layer({ filename: NodePath.join(home, "state.sqlite") });
      yield* runMigrations().pipe(Effect.provide(dbLayer));
      const turns = yield* Effect.gen(function* () {
        const ledger = yield* CodexLedgerService;
        yield* ledger.getSummary();
        return yield* ledger.listTurns({ limit: 10 });
      }).pipe(Effect.provide(layerForHome(home).pipe(Layer.provideMerge(dbLayer))));
      assert.deepEqual(
        turns.items.map((turn) => turn.identity.codexTurnId),
        ["actual-turn"],
      );
    } finally {
      yield* Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true }));
    }
  }),
);
