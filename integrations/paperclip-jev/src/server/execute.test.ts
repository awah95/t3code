import assert from "node:assert/strict";
import { watch } from "node:fs";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";
import { execute, isTaskArtifactFolder } from "./execute.js";
import { createServerAdapter } from "./index.js";

const dirs: string[] = [];
async function fixture(status: string, exitCode = 0) {
  const dir = await mkdtemp(join(tmpdir(), "paperclip-jev-test-"));
  dirs.push(dir);
  const executable = join(dir, "t3jev");
  await writeFile(
    executable,
    `#!/bin/sh\nprintf '%s\\n' "$@" > '${dir}/args.txt'\nfor arg in "$@"; do if [ "$prev" = "--input-file" ]; then cp "$arg" '${dir}/captured.json'; fi; prev="$arg"; done\nprintf '%s\\n' '${JSON.stringify({ status, requestId: "run-stable", reviewId: "review-1", options: [{ id: "recommended", label: "Use model A" }], model: "model-a", execution: { finalMessage: "Done" } })}'\nexit ${exitCode}\n`,
    { mode: 0o700 },
  );
  return { dir, executable };
}
function context(executable: string, overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-stable",
    agent: {
      id: "agent",
      companyId: "company",
      name: "Jev",
      adapterType: "t3jev",
      adapterConfig: {},
    },
    runtime: { sessionId: null, sessionParams: null },
    config: {
      executable,
      workspace: "/tmp",
      artifactFolder: "/tmp/paperclip-task-artifacts",
      artifactTaskId: "issue-1",
      currentModel: "model-current",
      currentEffort: "medium",
      sandbox: "read-only",
      candidatesJson: JSON.stringify([{ model: "model-a", efforts: ["high"] }]),
      ...overrides,
    },
    context: { paperclipTaskMarkdown: "# PAP-1\n\nImplement feature", taskId: "issue-1" },
    onLog: async () => {},
  } as unknown as AdapterExecutionContext;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("environment probe rejects artifact traversal before a run", async () => {
  assert.equal(isTaskArtifactFolder("/tmp/work", "/tmp/work/../outside"), false);
  const adapter = createServerAdapter();
  const result = await adapter.testEnvironment({
    companyId: "company",
    adapterType: "t3jev",
    config: {
      executable: "/tmp/t3jev",
      workspace: "/tmp/work",
      artifactFolder: "/tmp/work/../outside",
      artifactTaskId: "issue-1",
      sandbox: "read-only",
      mode: "pinned",
    },
  });
  assert.equal(result.status, "fail");
});

test("completed only succeeds with zero process exit and uses the Paperclip run ID", async () => {
  const { dir, executable } = await fixture("completed");
  const result = await execute(context(executable, { requestId: "stale-agent-setting" }));
  assert.equal(result.exitCode, 0);
  assert.equal(result.resultJson?.status, "completed");
  const captured = JSON.parse(await readFile(join(dir, "captured.json"), "utf8"));
  assert.equal(captured.requestId, "run-stable");
  assert.equal(
    captured.prompt,
    "# PAP-1\n\nImplement feature\n\nCanonical artifact folder: /tmp/paperclip-task-artifacts",
  );
});

test("pinned mode passes read-only policy without candidates and never bills an estimate", async () => {
  const { dir, executable } = await fixture("completed");
  const result = await execute(context(executable, { mode: "pinned", candidatesJson: undefined }));
  const captured = JSON.parse(await readFile(join(dir, "captured.json"), "utf8"));
  assert.equal(captured.mode, "pinned");
  assert.deepEqual(captured.policy, { sandbox: "read-only", approval: "never", allowedWrites: [] });
  assert.deepEqual(captured.candidates, [{ model: "model-current", efforts: ["medium"] }]);
  assert.equal(result.costUsd, undefined);
});

test("missing Paperclip task markdown does not dispatch a generic task identifier", async () => {
  const { dir, executable } = await fixture("completed");
  const ctx = context(executable);
  ctx.context = { taskId: "issue-1", issueTitle: "Fallback title" };
  await assert.rejects(execute(ctx), /paperclipTaskMarkdown/);
  await assert.rejects(readFile(join(dir, "captured.json")), /ENOENT/);
});

test("task prompt includes the current Paperclip wake comment", async () => {
  const { dir, executable } = await fixture("completed");
  const ctx = context(executable);
  ctx.context.paperclipWake = {
    reason: "issue_commented",
    issue: {
      id: "issue-1",
      identifier: "PAP-1",
      title: "Implement feature",
      status: "in_progress",
    },
    comments: [
      {
        id: "comment-1",
        issueId: "issue-1",
        body: "Include the regression case",
        author: { type: "user", id: "user-1" },
      },
    ],
    commentWindow: { requestedCount: 1, includedCount: 1, missingCount: 0 },
  };
  const result = await execute(ctx);
  assert.equal(result.exitCode, 0);
  const captured = JSON.parse(await readFile(join(dir, "captured.json"), "utf8"));
  assert.match(captured.prompt, /Implement feature/);
  assert.match(captured.prompt, /Include the regression case/);
});

test("pre-aborted run does not spawn Jev and acknowledges cancellation", async () => {
  const { dir, executable } = await fixture("completed");
  const controller = new AbortController();
  controller.abort();
  const ctx = context(executable);
  ctx.signal = controller.signal;
  let ready = false;
  ctx.onCancellationReady = async () => {
    ready = true;
  };
  const result = await execute(ctx);
  assert.equal(ready, true);
  assert.equal(result.errorCode, "cancelled");
  await assert.rejects(readFile(join(dir, "captured.json")), /ENOENT/);
});

test(
  "cancellation stops the Jev process group, including its child",
  { skip: process.platform === "win32" },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "paperclip-jev-cancel-test-"));
    dirs.push(dir);
    const executable = join(dir, "t3jev");
    const started = join(dir, "child-started");
    const stopped = join(dir, "child-stopped");
    const childCode = `const fs = require("node:fs"); process.on("SIGTERM", () => { fs.writeFileSync(${JSON.stringify(stopped)}, "stopped"); process.exit(0); }); fs.writeFileSync(${JSON.stringify(started)}, "ready"); setInterval(() => {}, 1000);`;
    await writeFile(
      executable,
      `#!/usr/bin/env node\nconst { spawn } = require("node:child_process"); spawn(process.execPath, ["-e", ${JSON.stringify(childCode)}], { stdio: "inherit" }); setInterval(() => {}, 1000);\n`,
      { mode: 0o700 },
    );
    const controller = new AbortController();
    const ctx = context(executable);
    ctx.signal = controller.signal;
    let spawnMeta: { pid: number; processGroupId: number | null } | undefined;
    let ready = false;
    ctx.onCancellationReady = async () => {
      ready = true;
    };
    ctx.onSpawn = async (meta) => {
      spawnMeta = meta;
      await new Promise<void>((resolve) => {
        const watcher = watch(dir, () => {
          void readFile(started)
            .then(() => {
              watcher.close();
              controller.abort();
              resolve();
            })
            .catch(() => {});
        });
        void readFile(started)
          .then(() => {
            watcher.close();
            controller.abort();
            resolve();
          })
          .catch(() => {});
      });
    };
    const result = await execute(ctx);
    assert.equal(ready, true);
    assert.equal(spawnMeta?.processGroupId, spawnMeta?.pid);
    assert.equal(result.errorCode, "cancelled");
    assert.equal(await readFile(stopped, "utf8"), "stopped");
  },
);

test(
  "cancellation force kills a Jev process that ignores SIGTERM",
  { skip: process.platform === "win32" },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "paperclip-jev-force-test-"));
    dirs.push(dir);
    const executable = join(dir, "t3jev");
    const started = join(dir, "started");
    await writeFile(
      executable,
      `#!/usr/bin/env node\nprocess.on("SIGTERM", () => {}); require("node:fs").writeFileSync(${JSON.stringify(started)}, "ready"); setInterval(() => {}, 1000);\n`,
      { mode: 0o700 },
    );
    const controller = new AbortController();
    const ctx = context(executable);
    ctx.signal = controller.signal;
    ctx.onSpawn = async () => {
      await new Promise<void>((resolve) => {
        const watcher = watch(dir, () => {
          void readFile(started)
            .then(() => {
              watcher.close();
              controller.abort();
              resolve();
            })
            .catch(() => {});
        });
        void readFile(started)
          .then(() => {
            watcher.close();
            controller.abort();
            resolve();
          })
          .catch(() => {});
      });
    };
    const result = await execute(ctx);
    assert.equal(result.errorCode, "cancelled");
    assert.equal(result.signal, "SIGKILL");
  },
);

test(
  "cancellation kills a silent Codex child after the Jev wrapper closes",
  { skip: process.platform === "win32" },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "paperclip-jev-silent-child-test-"));
    dirs.push(dir);
    const executable = join(dir, "t3jev");
    const childPidFile = join(dir, "child-pid");
    const childCode = `process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(${JSON.stringify(childPidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
    await writeFile(
      executable,
      `#!/usr/bin/env node\nconst { spawn } = require("node:child_process"); spawn(process.execPath, ["-e", ${JSON.stringify(childCode)}], { stdio: "ignore" }); process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000);\n`,
      { mode: 0o700 },
    );
    const controller = new AbortController();
    const ctx = context(executable);
    ctx.signal = controller.signal;
    ctx.onSpawn = async () => {
      await new Promise<void>((resolve) => {
        const watcher = watch(dir, () => {
          void readFile(childPidFile)
            .then(() => {
              watcher.close();
              controller.abort();
              resolve();
            })
            .catch(() => {});
        });
        void readFile(childPidFile)
          .then(() => {
            watcher.close();
            controller.abort();
            resolve();
          })
          .catch(() => {});
      });
    };
    const result = await execute(ctx);
    assert.equal(result.errorCode, "cancelled");
    assert.notEqual(result.exitCode, 0);
    const childPid = Number(await readFile(childPidFile, "utf8"));
    assert.ok(Number.isInteger(childPid) && childPid > 0);
    assert.throws(() => process.kill(childPid, 0), { code: "ESRCH" });
  },
);

test("review_required returns a blocked result with options and resume instruction", async () => {
  const { executable } = await fixture("review_required", 2);
  const result = await execute(context(executable));
  assert.equal(result.exitCode, 2);
  assert.match(result.errorMessage ?? "", /recommended: Use model A/);
  assert.match(
    result.errorMessage ?? "",
    /--review-id review-1 --expected-request-id run-stable --option <option-id>/,
  );
});

test("execution failure and malformed output never map to success", async () => {
  const { executable } = await fixture("execution_failed");
  const failed = await execute(context(executable));
  assert.notEqual(failed.exitCode, 0);
  const malformed = await fixture("not-json");
  await writeFile(malformed.executable, "#!/bin/sh\nprintf 'not-json\\n'\n", { mode: 0o700 });
  const invalid = await execute(context(malformed.executable));
  assert.notEqual(invalid.exitCode, 0);
  assert.match(invalid.errorMessage ?? "", /invalid JSON/);
});

test("review resume requires its task and run IDs before dispatch", async () => {
  const { dir, executable } = await fixture("completed");
  const result = await execute(
    context(executable, {
      reviewId: "review-1",
      option: "recommended",
      reviewTaskId: "issue-1",
      reviewRunId: "run-stable",
      currentModel: "",
      currentEffort: "",
      candidatesJson: "",
    }),
  );
  assert.equal(result.exitCode, 0);
  const args = await readFile(join(dir, "args.txt"), "utf8");
  assert.match(args, /--expected-request-id\nrun-stable\n/);
  assert.deepEqual(result.sessionParams?.consumedJevReview, {
    reviewId: "review-1",
    taskId: "issue-1",
    runId: "run-stable",
  });
});

test("stale review config does not resume on a later task", async () => {
  const { dir, executable } = await fixture("completed");
  const ctx = context(executable, {
    reviewId: "review-1",
    option: "recommended",
    reviewTaskId: "issue-1",
    reviewRunId: "run-stable",
  });
  ctx.context = { taskId: "issue-2", paperclipTaskMarkdown: "# PAP-2\n\nFix the next task" };
  await assert.rejects(execute(ctx), /Bind artifactTaskId/);
  await assert.rejects(readFile(join(dir, "captured.json")), /ENOENT/);
});

test("issueId can scope a review when taskId is absent", async () => {
  const { dir, executable } = await fixture("completed");
  const ctx = context(executable, {
    reviewId: "review-1",
    option: "recommended",
    reviewTaskId: "issue-1",
    reviewRunId: "run-stable",
    currentModel: "",
    currentEffort: "",
    candidatesJson: "",
  });
  ctx.context = { issueId: "issue-1", paperclipTaskMarkdown: "# PAP-1" };
  const result = await execute(ctx);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.sessionParams?.consumedJevReview, {
    reviewId: "review-1",
    taskId: "issue-1",
    runId: "run-stable",
  });
  await assert.rejects(readFile(join(dir, "captured.json")), /ENOENT/);
});

test("a consumed review does not resume again on the same task", async () => {
  const { dir, executable } = await fixture("completed");
  const config = {
    reviewId: "review-1",
    option: "recommended",
    reviewTaskId: "issue-1",
    reviewRunId: "run-stable",
  };
  const first = await execute(context(executable, config));
  assert.equal(first.exitCode, 0);
  const next = context(executable, config);
  next.runtime.sessionParams = first.sessionParams ?? null;
  const repeated = await execute(next);
  assert.equal(repeated.exitCode, 0);
  assert.deepEqual(repeated.sessionParams?.consumedJevReview, {
    reviewId: "review-1",
    taskId: "issue-1",
    runId: "run-stable",
  });
  const third = context(executable, config);
  third.runtime.sessionParams = repeated.sessionParams ?? null;
  assert.equal((await execute(third)).exitCode, 0);
  const captured = JSON.parse(await readFile(join(dir, "captured.json"), "utf8"));
  assert.equal(
    captured.prompt,
    "# PAP-1\n\nImplement feature\n\nCanonical artifact folder: /tmp/paperclip-task-artifacts",
  );
});
