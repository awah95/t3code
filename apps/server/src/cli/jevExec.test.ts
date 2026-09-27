// @effect-diagnostics nodeBuiltinImport:off -- Child process streams are faked in these tests.
import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeStream from "node:stream";

import { assert, expect, it } from "@effect/vitest";

import {
  claimNewJevExecution,
  executeJevCodexTurn,
  makeJevExecRequest,
  writeJevExecutionOutcome,
} from "./jevExec.ts";

const turn = {
  prompt: "Fix the failing test.",
  workspace: "/tmp/jev-example",
  model: "gpt-6-sol",
  effort: "high" as const,
};

it("runs a routed Codex turn through stdin and reads its JSON completion", async () => {
  const stdin = new NodeStream.PassThrough();
  const stdout = new NodeStream.PassThrough();
  const stderr = new NodeStream.PassThrough();
  const child = Object.assign(new NodeEvents.EventEmitter(), { stdin, stdout, stderr });
  let receivedPrompt = "";
  let command = "";
  let args: string[] = [];
  let cwd = "";
  stdin.setEncoding("utf8");
  stdin.on("data", (chunk: string) => {
    receivedPrompt += chunk;
  });
  const spawn = ((binary: string, flags: string[], options: NodeChildProcess.SpawnOptions) => {
    command = binary;
    args = flags;
    cwd = options.cwd as string;
    queueMicrotask(() => {
      stdout.write('{"type":"thread.started","thread_id":"thread-1"}\n');
      stdout.write('{"type":"item.completed","item":{"type":"agent_message","text":"Done."}}\n');
      stdout.end('{"type":"turn.completed"}\n');
      child.emit("close", 0, null);
    });
    return child as unknown as NodeChildProcess.ChildProcess;
  }) as typeof NodeChildProcess.spawn;

  const result = await executeJevCodexTurn(turn, spawn);
  assert.equal(command, "codex");
  assert.deepEqual(args, [
    "exec",
    "--json",
    "--model",
    "gpt-6-sol",
    "--config",
    'model_reasoning_effort="high"',
    "--cd",
    turn.workspace,
    "-",
  ]);
  assert.equal(cwd, turn.workspace);
  assert.equal(receivedPrompt, turn.prompt);
  assert.deepEqual(result, {
    exitCode: 0,
    signal: null,
    threadId: "thread-1",
    finalMessage: "Done.",
    turnCompleted: true,
    error: null,
    stderr: "",
  });
});

it("reports a failed Codex turn without treating its answer as success", async () => {
  const child = Object.assign(new NodeEvents.EventEmitter(), {
    stdin: new NodeStream.PassThrough(),
    stdout: new NodeStream.PassThrough(),
    stderr: new NodeStream.PassThrough(),
  });
  const spawn = (() => {
    queueMicrotask(() => {
      child.stdout.end('{"type":"error","message":"approval unavailable"}\n');
      child.stderr.end("Codex could not proceed");
      child.emit("close", 1, null);
    });
    return child as unknown as NodeChildProcess.ChildProcess;
  }) as typeof NodeChildProcess.spawn;
  const result = await executeJevCodexTurn(turn, spawn);
  assert.equal(result.exitCode, 1);
  assert.equal(result.error, "approval unavailable");
  assert.equal(result.stderr, "Codex could not proceed");
  assert.equal(result.finalMessage, null);
});

it("rejects a model outside Jev's current candidate catalog before spawning", async () => {
  let spawned = false;
  const spawn = (() => {
    spawned = true;
    throw new Error("should not spawn");
  }) as typeof NodeChildProcess.spawn;
  await expect(executeJevCodexTurn({ ...turn, model: "arbitrary-model" }, spawn)).rejects.toThrow();
  assert.equal(spawned, false);
});

it("returns a durable result for repeated requests and never grants a second claim", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "jev-exec-"));
  try {
    const first = await claimNewJevExecution(directory, "request-1", "fingerprint-a");
    assert.equal(first, null);
    const ambiguous = await claimNewJevExecution(directory, "request-1", "fingerprint-a");
    assert.deepEqual((ambiguous as { status: string }).status, "execution_unknown");
    const receipt = { status: "completed", requestId: "request-1" };
    await writeJevExecutionOutcome(directory, "request-1", receipt);
    assert.deepEqual(await claimNewJevExecution(directory, "request-1", "fingerprint-a"), receipt);
    await expect(claimNewJevExecution(directory, "request-1", "fingerprint-b")).rejects.toThrow(
      "different task",
    );
  } finally {
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});

it("uses shared Jev eligibility when building a headless request", () => {
  const request = makeJevExecRequest({
    requestId: "request-2",
    prompt: "Fix the regression",
    workspace: "/tmp/project",
    current: { model: "gpt-6-sol", effort: "medium" },
    candidates: [
      { model: "gpt-6-sol", efforts: ["medium", "high"] },
      { model: "unsupported-model", efforts: ["high"] },
    ],
    history: [{ role: "user", text: "The first fix did not work." }],
  });
  assert.equal(request.requestId, "request-2");
  assert.deepEqual(
    request.candidates.map(({ model, effort }) => ({ model, effort })),
    [
      { model: "gpt-6-sol", effort: "medium" },
      { model: "gpt-6-sol", effort: "high" },
    ],
  );
  assert.equal(request.context.currentModel, "gpt-6-sol");
  assert.equal(request.context.historyCompleteness, "complete");
});
