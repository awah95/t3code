import { describe, expect, it } from "@effect/vitest";
import {
  createCodexLedgerScanState,
  ingestCodexLedgerRecord,
  readCodexUsage,
  reconcileCodexCheckpoints,
  reconcileCodexResponses,
  type CodexResponseObservation,
} from "./codexLedgerAccounting.ts";

const usage = (input: number, cached: number, output = 10, write = 0) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  cache_write_input_tokens: write,
  output_tokens: output,
  reasoning_output_tokens: 3,
  total_tokens: input + output,
});
const row = (
  type: string,
  payload: Record<string, unknown>,
  timestamp = "2026-09-20T12:00:00Z",
) => ({ type, payload, timestamp });

function scanner() {
  const state = createCodexLedgerScanState();
  let offset = 0;
  const scan = (record: unknown) =>
    ingestCodexLedgerRecord(state, record, {
      sourceId: "account:one",
      observationId: `file:${++offset}`,
    });
  scan(row("session_meta", { id: "thread-1", session_id: "session-1", cli_version: "0.155.1" }));
  return { state, scan };
}

describe("Codex response accounting", () => {
  it("keeps missing counters distinct from measured zero and exposes invalid evidence", () => {
    expect(
      readCodexUsage({ input_tokens: 2, cached_input_tokens: 0 }).counters.cache_write_input_tokens,
    ).toBeNull();
    expect(readCodexUsage(usage(2, 0)).counters.cache_write_input_tokens).toBe(0);
    const bad = readCodexUsage({
      ...usage(2, 1, 4, 2),
      reasoning_output_tokens: 5,
      total_tokens: 3,
    });
    expect(bad.invalid).toEqual([
      "cache_exceeds_input",
      "reasoning_exceeds_output",
      "total_mismatch",
    ]);
    expect(bad.counters).toMatchObject({
      input_tokens: 2,
      cached_input_tokens: 1,
      cache_write_input_tokens: 2,
    });
  });

  it("attributes responses to their own turn context across model switches and preserved cache", () => {
    const { scan } = scanner();
    scan(
      row("turn_context", {
        turn_id: "t1",
        root_turn_id: "root",
        model: "gpt-5.6-luna",
        effort: "low",
      }),
    );
    const a = scan(
      row("token_usage_record", {
        response_id: "a",
        thread_id: "thread-1",
        turn_id: "t1",
        root_turn_id: "root",
        usage: usage(100, 80),
      }),
    )[0] as CodexResponseObservation;
    scan(row("turn_context", { turn_id: "t2", root_turn_id: "root", model: "gpt-5.6-sol" }));
    const b = scan(
      row("token_usage_record", {
        response_id: "b",
        thread_id: "thread-1",
        turn_id: "t2",
        root_turn_id: "root",
        usage: usage(120, 0),
      }),
    )[0] as CodexResponseObservation;
    scan(row("turn_context", { turn_id: "t3", root_turn_id: "root", model: "gpt-5.6-luna" }));
    const c = scan(
      row("token_usage_record", {
        response_id: "c",
        thread_id: "thread-1",
        turn_id: "t3",
        root_turn_id: "root",
        usage: usage(110, 55),
      }),
    )[0] as CodexResponseObservation;
    expect([a.model, b.model, c.model]).toEqual(["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-luna"]);
    expect([
      a.usage.counters.cached_input_tokens,
      b.usage.counters.cached_input_tokens,
      c.usage.counters.cached_input_tokens,
    ]).toEqual([80, 0, 55]);
    expect(c.rootTurnId).toBe("root");
  });

  it("counts compaction once while retaining equal vectors with distinct response IDs", () => {
    const { scan } = scanner();
    scan(row("turn_context", { turn_id: "t", model: "gpt-5.6-sol" }));
    const payload = {
      response_id: "compact",
      thread_id: "thread-1",
      turn_id: "t",
      usage: usage(200, 100),
    };
    const exact = scan(row("token_usage_record", payload))[0] as CodexResponseObservation;
    const embedded = scan(
      row("compacted", { latest_token_usage_record: payload }),
    )[0] as CodexResponseObservation;
    const sameVector = scan(
      row("token_usage_record", { ...payload, response_id: "other" }),
    )[0] as CodexResponseObservation;
    const result = reconcileCodexResponses([exact, embedded, sameVector]);
    expect(result.responses.map((item) => item.responseId)).toEqual(["compact", "other"]);
    expect(result.duplicateObservations).toBe(1);
    expect(result.responses[0]?.origin).toBe("token_usage_record");
  });

  it("quarantines conflicting response IDs including conflicting owners", () => {
    const { scan } = scanner();
    const first = scan(
      row("token_usage_record", { response_id: "one", turn_id: "t1", usage: usage(100, 0) }),
    )[0] as CodexResponseObservation;
    const changed = scan(
      row("token_usage_record", { response_id: "one", turn_id: "t1", usage: usage(101, 0) }),
    )[0] as CodexResponseObservation;
    const copied = scan(
      row("token_usage_record", { response_id: "one", turn_id: "t2", usage: usage(100, 0) }),
    )[0] as CodexResponseObservation;
    const result = reconcileCodexResponses([first, changed, copied]);
    expect(result.responses).toEqual([]);
    expect(Object.values(result.conflicts)[0]).toHaveLength(3);
  });

  it("enriches an unknown model but quarantines incompatible model evidence", () => {
    const { scan } = scanner();
    const unknown = scan(
      row("token_usage_record", { response_id: "one", turn_id: "t", usage: usage(100, 0) }),
    )[0] as CodexResponseObservation;
    scan(row("turn_context", { turn_id: "t", model: "gpt-5.6-sol" }));
    const known = scan(
      row("token_usage_record", { response_id: "one", turn_id: "t", usage: usage(100, 0) }),
    )[0] as CodexResponseObservation;
    expect(reconcileCodexResponses([unknown, known]).responses[0]?.model).toBe("gpt-5.6-sol");
    const other = scan(
      row("token_usage_record", {
        response_id: "one",
        turn_id: "t",
        model: "gpt-5.6-luna",
        usage: usage(100, 0),
      }),
    )[0] as CodexResponseObservation;
    expect(reconcileCodexResponses([known, other]).responses).toHaveLength(0);
  });

  it("preserves fork ownership, copied lifecycle, and an inherited thread opening balance", () => {
    const state = createCodexLedgerScanState();
    const feed = (record: unknown) =>
      ingestCodexLedgerRecord(state, record, { sourceId: "account:one", observationId: "offset" });
    const [opening] = feed(
      row("session_meta", {
        id: "child",
        forked_from_id: "parent",
        source: { subagent: { thread_spawn: { parent_thread_id: "parent" } } },
      }),
    );
    expect(opening).toMatchObject({
      kind: "opening",
      threadId: "child",
      forkedFromId: "parent",
      parentThreadId: "parent",
    });
    feed(row("session_meta", { id: "parent" }));
    expect(state.threadId).toBe("child");
    expect(
      feed(row("event_msg", { type: "task_complete", turn_id: "parent-turn" }))[0],
    ).toMatchObject({ kind: "lifecycle", copied: true });
    feed(
      row("turn_context", {
        turn_id: "child-turn",
        root_turn_id: "parent-root",
        model: "gpt-5.6-sol",
      }),
    );
    const response = feed(
      row("token_usage_record", {
        response_id: "r",
        thread_id: "child",
        turn_id: "child-turn",
        session_id: "parent-session",
        usage: usage(100, 20),
        thread_token_usage: usage(1100, 820),
      }),
    )[0] as CodexResponseObservation;
    expect(response).toMatchObject({
      threadId: "child",
      sessionId: "parent-session",
      rootTurnId: "parent-root",
    });
    expect(response.threadCheckpoint?.counters.input_tokens).toBe(1100);
  });

  it("emits distinct cumulative fallback deltas, ignores repeat notifications, and flags reset", () => {
    const { state, scan } = scanner();
    scan(row("turn_context", { turn_id: "t", model: "gpt-5.6-sol" }));
    const token = (last: ReturnType<typeof usage>, total: ReturnType<typeof usage>) =>
      row("event_msg", {
        type: "token_count",
        info: { last_token_usage: last, total_token_usage: total },
      });
    const a = scan(token(usage(100, 0), usage(100, 0))).find((item) => item.kind === "provisional");
    expect(a).toMatchObject({ kind: "provisional", turnId: "t", reset: false });
    expect(
      scan(token(usage(100, 0), usage(100, 0))).filter((item) => item.kind === "provisional"),
    ).toHaveLength(0);
    const b = scan(token(usage(100, 0), usage(200, 0))).find((item) => item.kind === "provisional");
    expect(b?.kind === "provisional" && b.usage.counters.input_tokens).toBe(100);
    const reset = scan(token(usage(20, 0), usage(20, 0))).find(
      (item) => item.kind === "provisional",
    );
    expect(reset).toMatchObject({ kind: "provisional", reset: true });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it("retains tool and quota observations without tool contents or inferred charges", () => {
    const { scan } = scanner();
    scan(row("turn_context", { turn_id: "t", model: "gpt-5.6-sol" }));
    const tool = scan(
      row("response_item", {
        type: "custom_tool_call_output",
        call_id: "call-1",
        output_utf8_bytes: 123,
        output: "private content",
      }),
    )[0];
    expect(tool).toMatchObject({ kind: "tool", callId: "call-1", outputBytes: 123 });
    expect(JSON.stringify(tool)).not.toContain("private content");
    const realOutput = scan(
      row("response_item", { type: "function_call_output", call_id: "call-2", output: "hé" }),
    )[0];
    expect(realOutput).toMatchObject({ kind: "tool", outputBytes: 3, status: "completed" });
    const quota = scan(
      row("event_msg", {
        type: "token_count",
        rate_limits: {
          limit_id: "codex",
          primary: { used_percent: 70, window_minutes: 10080, resets_at: 100 },
        },
      }),
    )[0];
    expect(quota).toMatchObject({
      kind: "quota",
      limitId: "codex",
      primary: { windowMinutes: 10080 },
    });
  });

  it("reconciles a fork opening separately from new response work", () => {
    const { scan } = scanner();
    scan(row("turn_context", { turn_id: "t", model: "gpt-5.6-sol" }));
    const a = scan(
      row("token_usage_record", {
        response_id: "a",
        thread_id: "thread-1",
        turn_id: "t",
        usage: usage(100, 20),
        turn_token_usage: usage(100, 20),
        thread_token_usage: usage(1100, 820),
      }),
    )[0] as CodexResponseObservation;
    const b = scan(
      row("token_usage_record", {
        response_id: "b",
        thread_id: "thread-1",
        turn_id: "t",
        usage: usage(100, 20),
        turn_token_usage: { ...usage(200, 40, 20), reasoning_output_tokens: 6 },
        thread_token_usage: { ...usage(1200, 840, 20), reasoning_output_tokens: 6 },
      }),
    )[0] as CodexResponseObservation;
    const key = "account:one\u0000thread-1";
    const result = reconcileCodexCheckpoints([a, b], new Set([key]));
    expect(result.openingByThread[key]).toMatchObject({
      input_tokens: 1000,
      cached_input_tokens: 800,
    });
    expect(result.openingStatusByThread[key]).toBe("confirmed_inherited");
    expect(
      result.checkpoints.every(
        (item) => item.turnMismatches.length === 0 && item.threadMismatches.length === 0,
      ),
    ).toBe(true);
  });
});
