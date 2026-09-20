// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";
import { readCodexLedgerFile } from "./codexLedgerReader.ts";

const line = (id: string) =>
  JSON.stringify({
    type: "token_usage_record",
    timestamp: "2026-09-20T10:00:00Z",
    payload: {
      response_id: id,
      thread_id: "thread",
      turn_id: "turn",
      usage: {
        input_tokens: 10,
        cached_input_tokens: 2,
        cache_write_input_tokens: 0,
        output_tokens: 3,
        reasoning_output_tokens: 1,
        total_tokens: 13,
      },
    },
  });

it("resumes complete appended records and resets on replacement", async () => {
  const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codex-ledger-reader-"));
  try {
    const path = NodePath.join(home, "rollout.jsonl");
    const first = `${line("one")}\n`;
    await NodeFSP.writeFile(path, first + line("unfinished"));
    const a = await readCodexLedgerFile(path, "source");
    assert.equal(a.events.filter((event) => event.kind === "response").length, 1);
    assert.equal(a.cursor.offset, Buffer.byteLength(first));
    await NodeFSP.appendFile(path, "\n" + line("two") + "\n");
    const b = await readCodexLedgerFile(path, "source", a.cursor);
    assert.deepEqual(
      b.events
        .filter((event) => event.kind === "response")
        .map((event) => (event.kind === "response" ? event.responseId : "")),
      ["unfinished", "two"],
    );
    assert.equal(b.reset, false);
    await NodeFSP.writeFile(path, `${line("replacement")}\n`);
    const c = await readCodexLedgerFile(path, "source", b.cursor);
    assert.equal(c.reset, true);
    assert.notEqual(c.cursor.generation, b.cursor.generation);
    assert.equal(c.events.filter((event) => event.kind === "response").length, 1);
  } finally {
    await NodeFSP.rm(home, { recursive: true, force: true });
  }
});

it("advances past an oversized line without buffering it or losing the next receipt", async () => {
  const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codex-ledger-reader-"));
  try {
    const path = NodePath.join(home, "rollout.jsonl");
    await NodeFSP.writeFile(path, "x".repeat(4 * 1024 * 1024 + 20) + "\n" + line("kept") + "\n");
    const a = await readCodexLedgerFile(path, "source");
    assert.equal(a.malformed, 1);
    assert.equal(a.cursor.skippingOversizedLine, true);
    const b = await readCodexLedgerFile(path, "source", a.cursor);
    assert.equal(b.events.filter((event) => event.kind === "response").length, 1);
    assert.equal(b.cursor.skippingOversizedLine, false);
  } finally {
    await NodeFSP.rm(home, { recursive: true, force: true });
  }
});
