// @effect-diagnostics nodeBuiltinImport:off - exercises OpenCode's SQLite format.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { expect, it } from "@effect/vitest";

import { readOpenCodeUsage } from "./openCodeUsageReader.ts";

it("reads OpenCode assistant usage without double counting cache or reasoning", () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "opencode-usage-"));
  try {
    const databasePath = NodePath.join(directory, "opencode.db");
    const database = new NodeSqlite.DatabaseSync(databasePath);
    database.exec(
      "CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)",
    );
    const insert = database.prepare("INSERT INTO message VALUES (?, ?, ?, ?)");
    insert.run(
      "msg-1",
      "child-session",
      1_000,
      JSON.stringify({
        role: "assistant",
        providerID: "opencode",
        modelID: "jev-1.13-free",
        cost: 0,
        tokens: {
          input: 100,
          output: 20,
          reasoning: 7,
          cache: { read: 40, write: 5 },
        },
      }),
    );
    insert.run("msg-2", "child-session", 1_000, "{bad json");
    insert.run("msg-3", "child-session", 500, JSON.stringify({ role: "user" }));
    database.close();

    const result = readOpenCodeUsage(databasePath, 900);
    expect(result?.records).toEqual([
      {
        provider: "opencode",
        timestampMs: 1_000,
        model: "opencode/jev-1.13-free",
        sessionId: "child-session",
        totals: {
          uncachedInputTokens: 100,
          cachedInputTokens: 40,
          cacheCreationTokens: 5,
          outputTokens: 27,
          reasoningTokens: 7,
        },
        reportedCostUsd: 0,
        dedupeKey: "opencode-message:msg-1",
      },
    ]);
    expect(result?.malformedRecords).toBe(1);
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});
