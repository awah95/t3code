// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { JevSubagentDecision } from "@t3tools/contracts";
import { createJevSubagentReceiptOutbox } from "./JevSubagentReceiptOutbox.ts";

const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-jev-receipts-"));
afterEach(() => {
  NodeFS.rmSync(NodePath.join(directory, "receipts.json"), { force: true });
  NodeFS.rmSync(NodePath.join(directory, "receipts.json.gap"), { force: true });
});

const event: JevSubagentDecision = {
  threadId: "t3-thread",
  providerInstanceId: "codex",
  toolUseId: "tool-1",
  attemptId: "tool-1",
  ledgerContext: {
    environmentId: "environment",
    projectId: "project",
    threadId: "t3-thread",
    sourceScope: "subagent",
  },
  request: {
    requestId: "route-1",
    prompt: "secret task",
    candidates: [{ key: "a", description: "sensitive detail" }],
    context: { existingSession: false, hasAttachments: false, interactionMode: "subagent" },
  },
  result: {
    choice: "a",
    confidence: 0.9,
    probabilities: { a: 0.9 },
    latencyMs: 5,
    error: null,
    inputTokens: 10,
    outputTokens: 2,
    costUsd: 0.001,
    costKind: "billed",
    evaluationPayload: "private evaluation",
  },
};

describe("Jev desktop receipt outbox", () => {
  it("persists terminal accounting without task or evaluation text and replays until acknowledged", () => {
    const filePath = NodePath.join(directory, "receipts.json");
    const outbox = createJevSubagentReceiptOutbox(filePath);
    expect(outbox.record(event)).toBe(true);
    expect(outbox.record(event)).toBe(true);
    const restarted = createJevSubagentReceiptOutbox(filePath);
    expect(restarted.list()).toHaveLength(1);
    expect(restarted.list()[0]?.result?.costUsd).toBe(0.001);
    expect(restarted.list()[0]?.ledgerContext?.sourceScope).toBe("subagent");
    const raw = NodeFS.readFileSync(filePath, "utf8");
    expect(raw).not.toContain("secret task");
    expect(raw).not.toContain("sensitive detail");
    expect(raw).not.toContain("private evaluation");
    restarted.acknowledge({ requestId: "route-1", attemptId: "tool-1" });
    expect(outbox.list()).toEqual([]);
  });
  it("retains the latest gap until its own acknowledgement across restarts", () => {
    const filePath = NodePath.join(directory, "receipts.json");
    const outbox = createJevSubagentReceiptOutbox(filePath);
    outbox.markGap("t3-thread", event.ledgerContext);
    const first = createJevSubagentReceiptOutbox(filePath).list()[0]!;
    outbox.markGap("t3-thread");
    const restarted = createJevSubagentReceiptOutbox(filePath);
    expect(restarted.list()).toMatchObject([
      {
        threadId: "t3-thread",
        receiptStorageError: true,
        result: null,
        ledgerContext: { sourceScope: "subagent", environmentId: "environment" },
      },
    ]);
    const second = restarted.list()[0]!;
    expect(first.request.requestId).not.toBe(second.request.requestId);
    restarted.acknowledge({
      requestId: first.request.requestId,
      attemptId: first.request.requestId,
    });
    expect(
      createJevSubagentReceiptOutbox(filePath)
        .list()
        .map((entry) => entry.request.requestId),
    ).toEqual([second.request.requestId]);
    restarted.acknowledge({
      requestId: second.request.requestId,
      attemptId: second.request.requestId,
    });
    expect(outbox.list()).toEqual([]);
  });
});
