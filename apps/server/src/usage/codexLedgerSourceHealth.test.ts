// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { runMigrations } from "../persistence/Migrations.ts";
import { CodexLedgerService, layerForHome } from "./CodexLedgerService.ts";

it.effect(
  "retains unavailable source health across restart and recovers without erasing captured facts",
  () =>
    Effect.gen(function* () {
      const home = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codex-ledger-health-")),
      );
      try {
        const filename = NodePath.join(home, "state.sqlite");
        yield* Effect.scoped(
          runMigrations().pipe(Effect.provide(NodeSqliteClient.layer({ filename }))),
        );
        const read = () =>
          Effect.scoped(
            Effect.gen(function* () {
              return yield* (yield* CodexLedgerService).getSummary();
            }).pipe(
              Effect.provide(
                layerForHome(home).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename }))),
              ),
            ),
          );

        const unavailable = yield* read();
        assert.equal(unavailable.sources[0]?.state, "unavailable");
        assert.ok(unavailable.sources[0]?.lastError);
        assert.notEqual(unavailable.coverage.usage, "exact");
        assert.equal((yield* read()).sources[0]?.state, "unavailable");

        const sessions = NodePath.join(home, "sessions");
        yield* Effect.promise(() => NodeFSP.mkdir(sessions));
        const record = (type: string, payload: object) =>
          JSON.stringify({ type, timestamp: "2026-09-20T10:00:00Z", payload });
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(sessions, "rollout.jsonl"),
            [
              record("session_meta", { id: "health-thread" }),
              record("token_usage_record", {
                response_id: "health-response",
                thread_id: "health-thread",
                turn_id: "health-turn",
                usage: {
                  input_tokens: 10,
                  cached_input_tokens: 0,
                  cache_write_input_tokens: 0,
                  output_tokens: 1,
                  reasoning_output_tokens: 0,
                  total_tokens: 11,
                },
              }),
            ].join("\n") + "\n",
          ),
        );
        const recovered = yield* read();
        assert.equal(recovered.responseCount, 1);
        assert.equal(recovered.sources[0]?.state, "ready");
        assert.equal(recovered.sources[0]?.lastError, null);

        // An archive path that exists but cannot be listed must not look like no history.
        yield* Effect.promise(() =>
          NodeFSP.writeFile(NodePath.join(home, "archived_sessions"), "not a directory"),
        );
        const partial = yield* read();
        assert.equal(partial.responseCount, 1);
        assert.equal(partial.sources[0]?.state, "partial");
        assert.ok(partial.sources[0]?.lastError);
        yield* Effect.promise(() => NodeFSP.rm(NodePath.join(home, "archived_sessions")));
        assert.equal((yield* read()).sources[0]?.state, "ready");
      } finally {
        yield* Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true }));
      }
    }),
);
