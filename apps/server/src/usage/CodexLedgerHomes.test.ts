// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { assert, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { runMigrations } from "../persistence/Migrations.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { CodexLedgerService, layer } from "./CodexLedgerService.ts";

const fixture = vi.hoisted(() => ({ home: "" }));
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => fixture.home,
}));

for (const scenario of [
  {
    name: "managed ignores ambient CODEX_HOME",
    setupMode: "managed",
    shadow: false,
    expected: "shared",
  },
  {
    name: "existing login honors ambient CODEX_HOME",
    setupMode: "existing",
    shadow: false,
    expected: "ambient",
  },
  {
    name: "shadow login reads shared transcripts",
    setupMode: "existing",
    shadow: true,
    expected: "shared",
  },
] as const) {
  it.effect(scenario.name, () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => NodeFSP.mkdtemp("/tmp/codex-ledger-homes-"));
      fixture.home = directory;
      const shared = NodePath.join(directory, ".codex");
      const ambient = NodePath.join(directory, "ambient");
      const previousHome = process.env.CODEX_HOME;
      process.env.CODEX_HOME = ambient;
      try {
        for (const [home, id] of [
          [shared, "shared"],
          [ambient, "ambient"],
        ] as const) {
          yield* Effect.promise(() =>
            NodeFSP.mkdir(NodePath.join(home, "sessions"), { recursive: true }),
          );
          const row = (type: string, payload: object) =>
            JSON.stringify({ type, timestamp: "2026-09-30T00:00:00Z", payload }) + "\n";
          yield* Effect.promise(() =>
            NodeFSP.writeFile(
              NodePath.join(home, "sessions", "rollout.jsonl"),
              row("session_meta", { id }) +
                row("event_msg", { type: "task_started", turn_id: "turn" }) +
                row("turn_context", { turn_id: "turn", model: "gpt-6.1-sol" }) +
                row("token_usage_record", {
                  response_id: id,
                  thread_id: id,
                  turn_id: "turn",
                  model: "gpt-6.1-sol",
                  usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 },
                }),
            ),
          );
        }
        const database = NodeSqliteClient.layer({
          filename: NodePath.join(directory, "ledger.sqlite"),
        });
        yield* runMigrations().pipe(Effect.provide(database));
        const settings = ServerSettingsService.layerTest({
          providers: {
            codex: {
              setupMode: scenario.setupMode,
              homePath: "",
              shadowHomePath: scenario.shadow ? NodePath.join(directory, "shadow") : "",
            },
          },
        });
        yield* Effect.gen(function* () {
          const ledger = yield* CodexLedgerService;
          const summary = yield* ledger.getSummary();
          const responses = yield* ledger.listTurns({ limit: 10 });
          assert.equal(summary.responseCount, 1);
          assert.equal(responses.items[0]?.identity.codexThreadId, scenario.expected);
        }).pipe(
          Effect.provide(layer.pipe(Layer.provideMerge(settings), Layer.provideMerge(database))),
        );
      } finally {
        if (previousHome === undefined) delete process.env.CODEX_HOME;
        else process.env.CODEX_HOME = previousHome;
        yield* Effect.promise(() => NodeFSP.rm(directory, { recursive: true, force: true }));
      }
    }),
  );
}
