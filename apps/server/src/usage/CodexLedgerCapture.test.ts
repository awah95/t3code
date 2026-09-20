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
  JSON.stringify({ type, timestamp: at, payload }) + "\n";
const opening = (thread: string, turn: string) =>
  row("session_meta", { id: thread }) +
  row("event_msg", { type: "task_started", turn_id: turn }) +
  row("turn_context", { turn_id: turn, root_turn_id: turn, model: "gpt-5.6-sol" });
const receipt = (thread: string, turn: string, id: string) =>
  row("token_usage_record", {
    thread_id: thread,
    turn_id: turn,
    root_turn_id: turn,
    response_id: id,
    usage: {
      input_tokens: 10,
      cached_input_tokens: 0,
      cache_write_input_tokens: 0,
      output_tokens: 1,
      reasoning_output_tokens: 0,
      total_tokens: 11,
    },
  });

it.effect("unchanged partial files leave scan capacity for later and newly appended facts", () =>
  Effect.gen(function* () {
    const home = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codex-ledger-partial-")),
    );
    try {
      const sessions = NodePath.join(home, "sessions");
      yield* Effect.promise(() => NodeFSP.mkdir(sessions));
      for (let index = 0; index < 24; index++)
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(sessions, `${String(index).padStart(2, "0")}.jsonl`),
            "{bad json}\n",
          ),
        );
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          NodePath.join(sessions, "zz-later.jsonl"),
          opening("later-thread", "later-turn") + receipt("later-thread", "later-turn", "later"),
        ),
      );
      const dbLayer = NodeSqliteClient.layer({ filename: NodePath.join(home, "state.sqlite") });
      yield* runMigrations().pipe(Effect.provide(dbLayer));
      const serviceLayer = layerForHome(home).pipe(Layer.provideMerge(dbLayer));
      yield* Effect.gen(function* () {
        const ledger = yield* CodexLedgerService;
        const sql = yield* SqlClient.SqlClient;
        yield* ledger.getSummary();
        const afterNextScan = yield* ledger.getSummary();
        assert.equal(afterNextScan.responseCount, 1);
        const partial = sourceByName(
          "00.jsonl",
          yield* sql`SELECT path,state,malformed_record_count FROM codex_ledger_sources`,
        );
        assert.equal(partial?.state, "partial");
        assert.equal(partial?.malformed_record_count, 1);

        yield* Effect.promise(() =>
          NodeFSP.appendFile(
            NodePath.join(sessions, "00.jsonl"),
            opening("recovered-thread", "recovered-turn") +
              receipt("recovered-thread", "recovered-turn", "recovered"),
          ),
        );
        const afterAppend = yield* ledger.getSummary();
        assert.equal(afterAppend.responseCount, 2);
        const retained = sourceByName(
          "00.jsonl",
          yield* sql`SELECT path,state,malformed_record_count FROM codex_ledger_sources`,
        );
        assert.equal(retained?.state, "partial");
        assert.equal(retained?.malformed_record_count, 1);

        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(sessions, "zz-new.jsonl"),
            opening("new-thread", "new-turn") + receipt("new-thread", "new-turn", "new"),
          ),
        );
        assert.equal((yield* ledger.getSummary()).responseCount, 3);
      }).pipe(Effect.provide(serviceLayer));
    } finally {
      yield* Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true }));
    }
  }),
);

const sourceByName = (name: string, rows: unknown) =>
  (rows as readonly { path: string; state: string; malformed_record_count: number }[]).find(
    (source) => source.path.endsWith(name),
  );

it.effect(
  "copied parent tools and spawn hints reconcile after the parent arrives and on restart",
  () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codex-ledger-tools-")),
      );
      try {
        const sessions = NodePath.join(home, "sessions");
        const archive = NodePath.join(home, "archived_sessions");
        yield* Effect.promise(() => NodeFSP.mkdir(sessions));
        yield* Effect.promise(() => NodeFSP.mkdir(archive));
        const parentTool = row("response_item", {
          type: "function_call",
          call_id: "spawn-parent",
          name: "functions.collaboration.spawn_agent",
        });
        const parentOutput = row("response_item", {
          type: "function_call_output",
          call_id: "spawn-parent",
          output: '{"task_name":"/root/child"}',
        });
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(sessions, "child.jsonl"),
            row("session_meta", {
              id: "child",
              forked_from_id: "parent",
              source: {
                subagent: {
                  thread_spawn: { parent_thread_id: "parent", agent_path: "/root/child" },
                },
              },
            }) +
              row("event_msg", { type: "task_started", turn_id: "parent-turn" }) +
              row("turn_context", { turn_id: "parent-turn", root_turn_id: "parent-turn" }) +
              parentTool +
              parentOutput +
              receipt("parent", "parent-turn", "parent-response") +
              row("event_msg", { type: "task_started", turn_id: "child-turn" }) +
              row("turn_context", { turn_id: "child-turn", root_turn_id: "child-turn" }) +
              row("response_item", {
                type: "function_call",
                call_id: "child-tool",
                name: "exec_command",
              }) +
              receipt("child", "child-turn", "child-response"),
          ),
        );
        const dbLayer = NodeSqliteClient.layer({ filename: NodePath.join(home, "state.sqlite") });
        yield* runMigrations().pipe(Effect.provide(dbLayer));
        const serviceLayer = layerForHome(home).pipe(Layer.provideMerge(dbLayer));
        yield* Effect.gen(function* () {
          const ledger = yield* CodexLedgerService;
          yield* ledger.getSummary();
        }).pipe(Effect.provide(serviceLayer));
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(archive, "parent.jsonl"),
            opening("parent", "parent-turn") +
              parentTool +
              parentOutput +
              receipt("parent", "parent-turn", "parent-response"),
          ),
        );
        const rows = yield* Effect.gen(function* () {
          const ledger = yield* CodexLedgerService;
          const sql = yield* SqlClient.SqlClient;
          yield* ledger.getSummary();
          return yield* sql`SELECT call_id,codex_thread_id,codex_turn_id FROM codex_ledger_tools ORDER BY call_id`;
        }).pipe(Effect.provide(layerForHome(home).pipe(Layer.provideMerge(dbLayer))));
        assert.deepEqual(rows, [
          { call_id: "child-tool", codex_thread_id: "child", codex_turn_id: "child-turn" },
          { call_id: "spawn-parent", codex_thread_id: "parent", codex_turn_id: "parent-turn" },
        ]);
        const hint = yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const hints =
            yield* sql`SELECT parent_thread_id,parent_turn_id FROM codex_ledger_spawn_hints WHERE tool_use_id='spawn-parent'`;
          const edges =
            yield* sql`SELECT parent_thread_id,child_thread_id FROM codex_ledger_lineage_edges WHERE tool_use_id='spawn-parent'`;
          return { hints, edges };
        }).pipe(Effect.provide(dbLayer));
        assert.deepEqual(hint.hints, [
          { parent_thread_id: "parent", parent_turn_id: "parent-turn" },
        ]);
        assert.deepEqual(hint.edges, [{ parent_thread_id: "parent", child_thread_id: "child" }]);
      } finally {
        yield* Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true }));
      }
    }),
);

it.effect("ambiguous response owners leave tool ownership unassigned", () =>
  Effect.gen(function* () {
    const home = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codex-ledger-ambiguous-tool-")),
    );
    try {
      const sessions = NodePath.join(home, "sessions");
      yield* Effect.promise(() => NodeFSP.mkdir(sessions));
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          NodePath.join(sessions, "a.jsonl"),
          opening("thread-a", "shared-turn") +
            row("response_item", {
              type: "function_call",
              call_id: "ambiguous-call",
              name: "exec_command",
            }) +
            receipt("thread-a", "shared-turn", "response-a"),
        ),
      );
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          NodePath.join(sessions, "b.jsonl"),
          opening("thread-b", "shared-turn") + receipt("thread-b", "shared-turn", "response-b"),
        ),
      );
      const dbLayer = NodeSqliteClient.layer({ filename: NodePath.join(home, "state.sqlite") });
      yield* runMigrations().pipe(Effect.provide(dbLayer));
      const tools = yield* Effect.gen(function* () {
        const ledger = yield* CodexLedgerService;
        const sql = yield* SqlClient.SqlClient;
        yield* ledger.getSummary();
        return yield* sql`SELECT codex_thread_id FROM codex_ledger_tools WHERE call_id='ambiguous-call'`;
      }).pipe(Effect.provide(layerForHome(home).pipe(Layer.provideMerge(dbLayer))));
      assert.deepEqual(tools, [{ codex_thread_id: null }]);
    } finally {
      yield* Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true }));
    }
  }),
);

it.effect("a same-size replacement is reread even when the old source was partial", () =>
  Effect.gen(function* () {
    const home = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codex-ledger-replaced-")),
    );
    try {
      const sessions = NodePath.join(home, "sessions");
      yield* Effect.promise(() => NodeFSP.mkdir(sessions));
      const path = NodePath.join(sessions, "rollout.jsonl");
      const content = (id: string) =>
        "{bad json}\n" +
        opening("replaced-thread", "replaced-turn") +
        row("token_usage_record", {
          thread_id: "replaced-thread",
          turn_id: "replaced-turn",
          usage: {
            input_tokens: 10,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: 1,
            reasoning_output_tokens: 0,
            total_tokens: 11,
          },
          response_id: id,
        });
      yield* Effect.promise(() => NodeFSP.writeFile(path, content("response-a")));
      const dbLayer = NodeSqliteClient.layer({ filename: NodePath.join(home, "state.sqlite") });
      yield* runMigrations().pipe(Effect.provide(dbLayer));
      const state = yield* Effect.gen(function* () {
        const ledger = yield* CodexLedgerService;
        const sql = yield* SqlClient.SqlClient;
        assert.equal((yield* ledger.getSummary()).responseCount, 1);
        yield* Effect.promise(() => NodeFSP.writeFile(path, content("response-b")));
        const summary = yield* ledger.getSummary();
        const sources =
          yield* sql`SELECT path,state,malformed_record_count FROM codex_ledger_sources`;
        return { summary, sources };
      }).pipe(Effect.provide(layerForHome(home).pipe(Layer.provideMerge(dbLayer))));
      assert.equal(state.summary.responseCount, 2);
      assert.equal(sourceByName("rollout.jsonl", state.sources)?.state, "partial");
      assert.ok((sourceByName("rollout.jsonl", state.sources)?.malformed_record_count ?? 0) > 0);
    } finally {
      yield* Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true }));
    }
  }),
);
