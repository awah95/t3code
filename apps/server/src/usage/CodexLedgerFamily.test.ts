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

it.effect("builds routing comparisons and cumulative thread totals for a linked turn", () =>
  Effect.gen(function* () {
    const home = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codex-ledger-turn-receipt-")),
    );
    try {
      const dir = NodePath.join(home, "sessions", "2026", "09", "20");
      yield* Effect.promise(() => NodeFSP.mkdir(dir, { recursive: true }));
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          NodePath.join(dir, "thread.jsonl"),
          row("session_meta", { id: "codex-thread", thread_source: "user" }) +
            row("event_msg", { type: "task_started", turn_id: "turn-1" }) +
            row("turn_context", {
              turn_id: "turn-1",
              root_turn_id: "turn-1",
              model: "gpt-5.6-luna",
              effort: "low",
            }) +
            receipt("response-1", "codex-thread", "turn-1", "turn-1", 10, 2) +
            row("event_msg", { type: "task_complete", turn_id: "turn-1" }) +
            row("event_msg", { type: "task_started", turn_id: "turn-2" }) +
            row("turn_context", {
              turn_id: "turn-2",
              root_turn_id: "turn-2",
              model: "gpt-5.6-luna",
              effort: "low",
            }) +
            receipt("response-2", "codex-thread", "turn-2", "turn-2", 20, 3) +
            row("event_msg", { type: "task_complete", turn_id: "turn-2" }),
        ),
      );
      const dbLayer = NodeSqliteClient.layer({ filename: NodePath.join(home, "state.sqlite") });
      yield* runMigrations().pipe(Effect.provide(dbLayer));
      const serviceLayer = layerForHome(home).pipe(Layer.provideMerge(dbLayer));
      const sourceDomain = yield* Effect.gen(function* () {
        const ledger = yield* CodexLedgerService;
        yield* ledger.getSummary();
        return (yield* ledger.listTurns({ limit: 1 })).items[0]!.identity.sourceDomain;
      }).pipe(Effect.provide(serviceLayer));
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE codex_ledger_turns SET t3_thread_id='t3-thread',
          t3_turn_id=codex_turn_id WHERE source_domain=${sourceDomain}`;
      }).pipe(Effect.provide(dbLayer));
      const result = yield* Effect.gen(function* () {
        const ledger = yield* CodexLedgerService;
        yield* ledger.recordJevReceipt({
          requestId: "route-turn-2",
          attemptId: "route",
          rootTurnId: "turn-2",
          toolUseId: null,
          environmentId: null,
          projectId: null,
          threadId: "t3-thread",
          messageId: null,
          turnId: "turn-2",
          providerThreadId: "codex-thread",
          providerTurnId: "turn-2",
          childProviderThreadId: null,
          parentProviderTurnId: null,
          dispatchId: null,
          observedModel: "gpt-5.6-luna",
          sourceScope: "turn",
          decisionJson: JSON.stringify({
            beforeModel: "gpt-6-astra",
            beforeEffort: "medium",
          }),
          dispatchJson: JSON.stringify({ model: "gpt-5.6-luna", effort: "low" }),
          reportedCostUsd: null,
          estimatedCostUsd: null,
          status: "dispatched",
        });
        const detail = yield* ledger.getTurn({
          sourceDomain,
          codexThreadId: "codex-thread",
          codexTurnId: "turn-2",
        });
        const turns = yield* ledger.listTurns({
          t3ThreadId: "t3-thread",
          t3TurnId: "turn-2",
          limit: 1,
        });
        return { detail, turns };
      }).pipe(Effect.provide(serviceLayer));
      const { detail } = result;
      assert.deepEqual(result.turns.items[0]?.routingBefore, {
        model: "gpt-6-astra",
        effort: "medium",
      });
      assert.equal(result.turns.items[0]?.sameTokenComparisons?.length, 1);
      assert.equal(result.turns.items[0]?.sameTokenComparisons?.[0]?.reason, "beforeJev");
      assert.deepEqual(detail?.routing?.before, {
        model: "gpt-6-astra",
        effort: "medium",
      });
      assert.deepEqual(detail?.routing?.used, {
        model: "gpt-5.6-luna",
        effort: "low",
      });
      assert.equal(detail?.sameTokenComparisons.length, 1);
      assert.equal(detail?.sameTokenComparisons[0]?.reason, "beforeJev");
      assert.notEqual(detail?.sameTokenComparisons[0]?.valuation.completeEstimateUsd, null);
      assert.equal(detail?.threadThroughTurn?.includedTurnCount, 2);
      assert.equal(detail?.threadThroughTurn?.tokens.processedTokens, 35);
    } finally {
      yield* Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true }));
    }
  }),
);
