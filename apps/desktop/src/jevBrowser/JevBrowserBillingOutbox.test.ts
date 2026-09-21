// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createJevBrowserBillingOutbox } from "./JevBrowserBillingOutbox.ts";

const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-jev-browser-billing-"));
const filePath = NodePath.join(directory, "billing.json");

afterEach(() => NodeFS.rmSync(filePath, { force: true }));

describe("Jev browser billing outbox", () => {
  it("persists a reservation before replacing it with sanitized accounting", () => {
    const outbox = createJevBrowserBillingOutbox(filePath);
    const id = outbox.reserve("run-1", 7);
    expect(JSON.parse(NodeFS.readFileSync(filePath, "utf8"))).toEqual([
      { id, runId: "run-1", iteration: 7, pending: true },
    ]);

    outbox.complete(id, {
      decision: { outcome: "act", candidateId: "candidate-1" },
      accounting: {
        inputTokens: 10,
        outputTokens: 2,
        costUsd: 0.001,
        responseModel: "jev-test",
      },
    });

    const raw = NodeFS.readFileSync(filePath, "utf8");
    expect(JSON.parse(raw)).toEqual([
      {
        id,
        runId: "run-1",
        iteration: 7,
        pending: false,
        result: {
          decision: { outcome: "act", candidateId: "candidate-1" },
          accounting: {
            inputTokens: 10,
            outputTokens: 2,
            costUsd: 0.001,
            responseModel: "jev-test",
          },
        },
      },
    ]);
    expect(raw).not.toContain("task");
    expect(raw).not.toContain("observation");
  });

  it("refuses to complete an unknown reservation", () => {
    expect(() =>
      createJevBrowserBillingOutbox(filePath).complete("missing", {
        decision: { outcome: "done" },
        accounting: { inputTokens: null, outputTokens: null, costUsd: null },
      }),
    ).toThrow("reserved Jev browser billing receipt");
  });

  it("refuses pending and completed iteration replays", () => {
    const outbox = createJevBrowserBillingOutbox(filePath);
    const id = outbox.reserve("run-1", 3);
    expect(() => outbox.reserve("run-1", 3)).toThrow("already reserved");
    outbox.complete(id, {
      decision: { outcome: "done" },
      accounting: { inputTokens: 1, outputTokens: 1, costUsd: 0.001 },
    });
    expect(() => outbox.reserve("run-1", 3)).toThrow("already reserved");
  });
});
