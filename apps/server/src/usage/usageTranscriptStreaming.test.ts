// @effect-diagnostics nodeBuiltinImport:off - exercise the real byte reader.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";

import {
  readTranscriptRecords as readWithDefaultThreshold,
  type TranscriptParsePosition,
} from "./usageTranscriptReader.ts";

// Exercise the same transition with compact fixtures. UsageService tests and
// external 65/517 MiB fixtures also exercise the production threshold.
const readTranscriptRecords = (
  path: string,
  provider: "claude" | "codex" | "grok",
  position?: TranscriptParsePosition,
) => readWithDefaultThreshold(path, provider, position, { streamingThresholdBytes: 256 * 1024 });

let dir: string;
beforeEach(async () => {
  dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "usage-stream-"));
});
afterEach(async () => {
  await NodeFSP.rm(dir, { recursive: true, force: true });
});

const timestamp = "2026-08-01T10:00:00Z";
const content = '工具 output \\" usage token_count '.repeat(40_000);
const claude = (id = "m1", output = 99) => ({
  type: "assistant",
  timestamp,
  sessionId: "s1",
  requestId: `r-${id}`,
  costUSD: 0.25,
  message: {
    content: [{ type: "tool_use", input: { text: content } }],
    id,
    model: "claude-fable-5",
    usage: {
      input_tokens: 100,
      output_tokens: output,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 5,
      speed: "fast",
    },
  },
});
const codex = [
  { type: "session_meta", timestamp, payload: { id: "s1" } },
  { type: "turn_context", timestamp, payload: { model: "gpt-5.6-sol" } },
  {
    type: "event_msg",
    timestamp,
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: 100,
          output_tokens: 99,
          cached_input_tokens: 20,
          cache_write_input_tokens: 5,
          reasoning_output_tokens: 10,
        },
      },
    },
  },
];
const grok = {
  timestamp: 1785578400,
  params: {
    sessionId: "s1",
    _meta: { agentTimestampMs: 1785578400123 },
    update: {
      sessionUpdate: "turn_completed",
      prompt_id: "p1",
      usage: {
        inputTokens: 100,
        outputTokens: 99,
        costUsdTicks: 2500000000,
        modelUsage: {
          "grok-4.5-build": {
            inputTokens: 100,
            outputTokens: 99,
            cachedReadTokens: 20,
            cacheCreationTokens: 5,
            reasoningTokens: 10,
          },
        },
      },
    },
  },
};

async function scan(
  lines: readonly unknown[],
  provider: "claude" | "codex" | "grok",
  name = "history",
) {
  const path = NodePath.join(dir, `${name}.jsonl`);
  await NodeFSP.writeFile(path, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  const result = await readTranscriptRecords(path, provider);
  expect(result).not.toBeNull();
  return result!;
}

describe("large usage records", () => {
  it("keeps usage after large Claude tool input, including fast-mode cost and dedupe metadata", async () => {
    const result = await scan([claude()], "claude");
    expect(result.records).toEqual([
      {
        provider: "claude",
        timestampMs: Date.parse(timestamp),
        sessionId: "s1",
        model: "claude-fable-5",
        totals: {
          uncachedInputTokens: 100,
          outputTokens: 99,
          cachedInputTokens: 20,
          cacheCreationTokens: 5,
          reasoningTokens: 0,
        },
        reportedCostUsd: 0.25,
        fast: true,
        dedupeKey: "m1:r-m1",
      },
    ]);
  });

  it.each(["claude", "codex", "grok"] as const)(
    "matches ordinary %s records with large irrelevant fields in either order",
    async (provider) => {
      const small =
        provider === "codex"
          ? codex
          : provider === "grok"
            ? [grok]
            : [{ ...claude(), message: { ...claude().message, content: [] } }];
      const expected = await scan(small, provider, "small");
      for (const first of [true, false]) {
        const large = small.map((record) =>
          first ? { padding: content, ...record } : { ...record, padding: content },
        );
        const actual = await scan(large, provider);
        expect(actual.records).toEqual(expected.records);
        expect(actual.position.codexState).toEqual(expected.position.codexState);
      }
    },
  );

  it("preserves Grok model allocation, precise timestamp and prompt identity", async () => {
    const result = await scan([{ padding: content, ...grok }], "grok");
    expect(result.records[0]).toMatchObject({
      timestampMs: 1785578400123,
      model: "grok-4.5-build",
      sessionId: "s1",
      totals: {
        uncachedInputTokens: 75,
        cachedInputTokens: 20,
        cacheCreationTokens: 5,
        outputTokens: 99,
        reasoningTokens: 10,
      },
      dedupeKey: "s1:p1:grok-4.5-build",
      reportedCostUsd: 0.25,
    });
  });

  it("does not count usage-looking text or nested objects inside tool output", async () => {
    const result = await scan(
      [
        { type: "user", padding: content, toolOutput: claude() },
        { padding: content, message: { content: JSON.stringify(claude()) } },
        { type: "assistant", timestamp, message: { model: "claude-fable-5", content: [claude()] } },
      ],
      "claude",
    );
    expect(result.records).toEqual([]);
  });

  it("replays partial UTF-8 and JSON tails, commits exact CRLF offsets, and replaces the tail once", async () => {
    const path = NodePath.join(dir, "tail.jsonl");
    const first = JSON.stringify(claude("first", 5)) + "\r\n";
    const second = Buffer.from(JSON.stringify(claude("second", 7)));
    const split = second.lastIndexOf(Buffer.from("工具")) + 1;
    await NodeFSP.writeFile(path, Buffer.concat([Buffer.from(first), second.subarray(0, split)]));
    const partial = await readTranscriptRecords(path, "claude");
    expect(partial?.records.map((r) => r.totals.outputTokens)).toEqual([5]);
    expect(partial?.tailRecords).toEqual([]);
    expect(partial?.position.resumeOffset).toBe(Buffer.byteLength(first));
    await NodeFSP.appendFile(path, second.subarray(split));
    const complete = await readTranscriptRecords(path, "claude", partial!.position);
    expect(complete?.resumed).toBe(true);
    expect(complete?.records).toEqual([]);
    expect(complete?.tailRecords.map((r) => r.totals.outputTokens)).toEqual([7]);
    expect(complete?.position.resumeOffset).toBe(Buffer.byteLength(first));
    await NodeFSP.appendFile(path, "\r\n" + JSON.stringify(claude("third", 11)) + "\n");
    const appended = await readTranscriptRecords(path, "claude", complete!.position);
    expect(appended?.records.map((r) => r.totals.outputTokens)).toEqual([7, 11]);
    expect(appended?.tailRecords).toEqual([]);
    expect(appended?.position.resumeOffset).toBe((await NodeFSP.stat(path)).size);
    const full = await readTranscriptRecords(path, "claude");
    expect([...partial!.records, ...appended!.records]).toEqual(full?.records);
  });

  it("preserves Codex model switches and duplicate suppression across streaming resumes", async () => {
    const path = NodePath.join(dir, "history.jsonl");
    const first = await scan(
      codex.map((record) => ({ padding: content, ...record })),
      "codex",
    );
    await NodeFSP.appendFile(
      path,
      [
        { padding: content, ...codex[2] },
        { type: "turn_context", payload: { padding: content, model: "gpt-6" } },
        {
          type: "event_msg",
          timestamp,
          payload: {
            type: "token_count",
            padding: content,
            info: { last_token_usage: { input_tokens: 200, output_tokens: 101 } },
          },
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n") + "\n",
    );
    const result = await readTranscriptRecords(path, "codex", first.position);
    expect(result?.resumed).toBe(true);
    expect(result?.records).toHaveLength(1);
    expect(result?.records[0]).toMatchObject({
      model: "gpt-6",
      sessionId: "s1",
      totals: { outputTokens: 101 },
    });
    const full = await readTranscriptRecords(path, "codex");
    expect([...first.records, ...result!.records]).toEqual(full?.records);
  });

  it("keeps exact and compacted Codex receipts through large records and resume", async () => {
    const path = NodePath.join(dir, "codex-ledger.jsonl");
    const usage = (output: number) => ({
      input_tokens: 100,
      cached_input_tokens: 20,
      cache_write_input_tokens: 5,
      output_tokens: output,
      reasoning_output_tokens: 10,
      total_tokens: 100 + output,
    });
    const lines = [
      { type: "session_meta", timestamp, payload: { id: "s1" } },
      { type: "turn_context", timestamp, payload: { turn_id: "turn-1", model: "gpt-6-sol" } },
      {
        type: "token_usage_record",
        timestamp,
        payload: {
          response_id: "response-1",
          thread_id: "s1",
          turn_id: "turn-1",
          usage: usage(30),
          turn_token_usage: usage(30),
        },
      },
      {
        type: "compacted",
        timestamp,
        payload: {
          latest_token_usage_record: {
            response_id: "response-2",
            thread_id: "s1",
            turn_id: "turn-1",
            usage: usage(40),
            turn_token_usage: usage(70),
          },
        },
      },
    ];
    const expected = await scan(lines, "codex", "codex-ledger-small");
    await NodeFSP.writeFile(
      path,
      lines
        .slice(0, 3)
        .map((line) => JSON.stringify({ padding: content, ...line }))
        .join("\n") + "\n",
    );
    const first = await readTranscriptRecords(path, "codex");
    expect(first?.records).toEqual(expected.records.slice(0, 1));
    await NodeFSP.appendFile(path, JSON.stringify({ padding: content, ...lines[3] }));
    const tail = await readTranscriptRecords(path, "codex", first!.position);
    expect(tail?.tailRecords).toEqual(expected.records.slice(1));
    expect(tail?.position.codexState).toEqual(first?.position.codexState);
    await NodeFSP.appendFile(path, "\n");
    const resumed = await readTranscriptRecords(path, "codex", tail!.position);
    expect(resumed?.resumed).toBe(true);
    expect([...first!.records, ...resumed!.records]).toEqual(expected.records);
    expect(resumed?.position.codexState).toEqual(expected.position.codexState);
  });

  it("keeps Codex cumulative counters when projecting large legacy notifications", async () => {
    const usage = { input_tokens: 100, output_tokens: 30 };
    const lines = [
      { type: "session_meta", timestamp, payload: { id: "s1" } },
      { type: "turn_context", timestamp, payload: { turn_id: "turn-1", model: "gpt-6-sol" } },
      ...[1, 2].map((multiple) => ({
        type: "event_msg",
        timestamp,
        payload: {
          type: "token_count",
          info: {
            last_token_usage: usage,
            total_token_usage: {
              input_tokens: usage.input_tokens * multiple,
              output_tokens: usage.output_tokens * multiple,
            },
          },
        },
      })),
    ];
    const expected = await scan(lines, "codex", "codex-cumulative-small");
    const actual = await scan(
      lines.map((line) => ({ padding: content, ...line })),
      "codex",
      "codex-cumulative-large",
    );
    expect(actual.records).toEqual(expected.records);
    expect(actual.records.map((record) => record.totals.outputTokens)).toEqual([30, 30]);
  });

  it.each(["forked_from_id", "source"])(
    "preserves Codex fork-copy suppression from %s",
    async (field) => {
      const fork =
        field === "source"
          ? { source: { subagent: { thread_spawn: { parent_thread_id: "parent" } } } }
          : { forked_from_id: "parent" };
      const lines = [
        { type: "session_meta", timestamp, payload: { padding: content, id: "child", ...fork } },
        codex[1],
        codex[2],
        {
          ...codex[2],
          timestamp: "2026-08-01T10:00:05Z",
          payload: {
            type: "token_count",
            info: { last_token_usage: { input_tokens: 100, output_tokens: 101 } },
          },
        },
      ];
      const result = await scan(lines, "codex");
      expect(result.records).toHaveLength(1);
      expect(result.records[0]).toMatchObject({
        sessionId: "child",
        totals: { outputTokens: 101 },
      });
    },
  );

  it("rejects malformed large lines without accepting partial usage or losing following lines", async () => {
    const valid = JSON.stringify(claude());
    const path = NodePath.join(dir, "broken.jsonl");
    await NodeFSP.writeFile(
      path,
      [valid + " junk", valid.slice(0, -1), valid + valid, JSON.stringify(claude("good", 7))].join(
        "\n",
      ) + "\n",
    );
    const result = await readTranscriptRecords(path, "claude");
    expect(result?.records.map((r) => r.totals.outputTokens)).toEqual([7]);
  });

  it("matches JSON.parse for reordered and escaped keys, duplicate fields, arrays and unknown key names", async () => {
    const path = NodePath.join(dir, "odd.jsonl");
    const small = JSON.stringify({ ...claude(), message: { ...claude().message, content: [] } });
    const variants = [
      small.replace('"message":', '"mess\\u0061ge":'),
      small.replace('"costUSD":0.25', '"costUSD":5,"costUSD":0.25'),
      small.replace('"type":"assistant"', '"type":"user","type":"assistant"'),
      small.replace('"message":', '"__proto__":{"type":"user"},"message":'),
      small.replace('"message":', '"message.usage":{"output_tokens":1234},"message":'),
    ];
    for (const line of variants) {
      await NodeFSP.writeFile(path, line + "\n");
      const expected = await readTranscriptRecords(path, "claude");
      await NodeFSP.writeFile(
        path,
        '{"padding":' + JSON.stringify(content) + "," + line.slice(1) + "\n",
      );
      const actual = await readTranscriptRecords(path, "claude");
      expect(actual?.records).toEqual(expected?.records);
    }
  });
  it("reads usage after deeply nested discarded tool content", async () => {
    const path = NodePath.join(dir, "deep.jsonl");
    const record = JSON.stringify(claude());
    const nested = "[".repeat(300) + "0" + "]".repeat(300);
    await NodeFSP.writeFile(path, '{"toolOutput":' + nested + "," + record.slice(1) + "\n");
    const result = await readTranscriptRecords(path, "claude");
    expect(result?.records[0]?.totals.outputTokens).toBe(99);
  });

  it("keeps JSON number semantics for non-finite values without serializing them into null", async () => {
    const path = NodePath.join(dir, "numbers.jsonl");
    const record = JSON.stringify(claude()).replace('"costUSD":0.25', '"costUSD":1e400');
    await NodeFSP.writeFile(path, record + "\n");
    const result = await readTranscriptRecords(path, "claude");
    expect(result?.records[0]?.reportedCostUsd).toBeNull();
    expect(result?.records[0]?.totals.outputTokens).toBe(99);
  });
});
