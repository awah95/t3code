import { describe, expect, it } from "vite-plus/test";
import { extractCodexLedgerLineageHints } from "./codexLedgerLineage.ts";

describe("Codex lineage hints", () => {
  it("extracts canonical spawn output without retaining task input", () => {
    expect(
      extractCodexLedgerLineageHints({
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-1",
          output: JSON.stringify({ task_name: "/root/review" }),
        },
      }),
    ).toEqual([
      {
        kind: "spawn",
        toolUseId: "call-1",
        parentThreadId: null,
        parentTurnId: null,
        taskName: "/root/review",
      },
    ]);
    expect(
      extractCodexLedgerLineageHints({
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call-1",
          output: JSON.stringify({ task_name: "/root/review", prompt: "do not retain" }),
        },
      }),
    ).toEqual([]);
  });

  it("extracts child identity from session metadata, and skips missing identities", () => {
    const row = {
      type: "session_meta",
      payload: {
        id: "child-thread",
        source: {
          subagent: {
            thread_spawn: {
              parent_thread_id: "parent-thread",
              agent_path: "/root/review",
            },
          },
        },
      },
    };
    expect(extractCodexLedgerLineageHints(row)).toEqual([
      {
        kind: "child",
        childThreadId: "child-thread",
        parentThreadId: "parent-thread",
        agentPath: "/root/review",
        rootTurnId: null,
      },
    ]);
    expect(
      extractCodexLedgerLineageHints({ ...row, payload: { ...row.payload, id: null } }),
    ).toEqual([]);
  });
});
