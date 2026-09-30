// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off
import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { runDiviWorkspace } from "./Helper.ts";

const previousHelper = process.env.DIVI_WORKSPACE_HELPER_PATH;
const previousRoot = process.env.DIVI_WORKSPACE_ROOT;
const temporary: string[] = [];

async function fixture(script: string) {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "divi-workspace-rpc-"));
  temporary.push(directory);
  const helper = NodePath.join(directory, "helper.py");
  await NodeFSP.writeFile(helper, script);
  process.env.DIVI_WORKSPACE_HELPER_PATH = helper;
  process.env.DIVI_WORKSPACE_ROOT = directory;
  return { directory, helper };
}

afterEach(async () => {
  if (previousHelper === undefined) delete process.env.DIVI_WORKSPACE_HELPER_PATH;
  else process.env.DIVI_WORKSPACE_HELPER_PATH = previousHelper;
  if (previousRoot === undefined) delete process.env.DIVI_WORKSPACE_ROOT;
  else process.env.DIVI_WORKSPACE_ROOT = previousRoot;
  await Promise.all(
    temporary.splice(0).map((path) => NodeFSP.rm(path, { recursive: true, force: true })),
  );
});

it.effect("requires a main checkout ID before attempting repair", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(runDiviWorkspace({ operation: "main-repair" }));
    NodeAssert.equal(exit._tag, "Failure");
    NodeAssert.match(JSON.stringify(exit), /main-repair requires a main checkout ID/);
  }),
);

it.effect("forwards only typed helper operations and their selected arguments", () =>
  Effect.gen(function* () {
    const { directory } = yield* Effect.promise(() =>
      fixture(
        'import json,sys\nprint(json.dumps({"schemaVersion":1,"helperVersion":"test","operation":sys.argv[3],"status":"ready","resources":{"argv":sys.argv[1:]}}))\n',
      ),
    );
    const cases = [
      {
        input: { operation: "status", workspaceId: "pilot-b" } as const,
        argv: ["status", "--workspace-id", "pilot-b"],
      },
      {
        input: { operation: "main-site-start", mainId: "module-a" } as const,
        argv: ["main-site-start", "--main-id", "module-a"],
      },
      {
        input: { operation: "main-site-stop", mainId: "original" } as const,
        argv: ["main-site-stop", "--main-id", "original"],
      },
      {
        input: { operation: "main-site-status", mainId: "module-a" } as const,
        argv: ["main-site-status", "--main-id", "module-a"],
      },
      {
        input: { operation: "main-info" } as const,
        argv: ["main-info"],
      },
      {
        input: { operation: "main-create", mainId: "module-a" } as const,
        argv: ["main-create", "--main-id", "module-a"],
      },
      {
        input: { operation: "main-repair", mainId: "module-a" } as const,
        argv: ["main-repair", "--main-id", "module-a"],
      },
      {
        input: {
          operation: "create",
          preset: "divi",
          workspaceId: "task-a",
          mainId: "module-a",
        } as const,
        argv: [
          "create",
          "--manifest",
          NodePath.join(directory, "../profiles/divi.json"),
          "--workspace-id",
          "task-a",
          "--main-id",
          "module-a",
        ],
      },
      {
        input: {
          operation: "create",
          preset: "fluent-forms",
          workspaceId: "pilot-b",
          mainId: "module-a",
        } as const,
        argv: [
          "create",
          "--manifest",
          NodePath.join(directory, "../profiles/fluent-forms.pilot.json"),
          "--workspace-id",
          "pilot-b",
          "--main-id",
          "module-a",
        ],
      },
      {
        input: { operation: "inspect", workspaceId: "pilot-b", includeDiskUsage: true } as const,
        argv: ["inspect", "--workspace-id", "pilot-b", "--disk-usage"],
      },
      {
        input: {
          operation: "destroy",
          workspaceId: "pilot-b",
          confirmWorkspaceId: "pilot-b",
          discardChanges: true,
        } as const,
        argv: [
          "destroy",
          "--workspace-id",
          "pilot-b",
          "--confirm-id",
          "pilot-b",
          "--discard-changes",
        ],
      },
      {
        input: { operation: "create", preset: "fluent-forms", workspaceId: "pilot-b" } as const,
        argv: [
          "create",
          "--manifest",
          NodePath.join(directory, "../profiles/fluent-forms.pilot.json"),
          "--workspace-id",
          "pilot-b",
        ],
      },
      {
        input: { operation: "test", workspaceId: "pilot-b", profileId: "fluent-jest" } as const,
        argv: ["test", "--workspace-id", "pilot-b", "--profile-id", "fluent-jest"],
      },
      {
        input: {
          operation: "watcher-restart",
          workspaceId: "pilot-b",
          profileId: "builder-5",
        } as const,
        argv: ["watcher-restart", "--workspace-id", "pilot-b", "--profile-id", "builder-5"],
      },
      {
        input: {
          operation: "watcher-log",
          workspaceId: "pilot-b",
          profileId: "builder-5",
        } as const,
        argv: ["watcher-log", "--workspace-id", "pilot-b", "--profile-id", "builder-5"],
      },
      {
        input: {
          operation: "review-record",
          workspaceId: "pilot-b",
          planId: "a".repeat(32),
          reviewFile: NodePath.join(directory, "combined-review.json"),
        } as const,
        argv: [
          "review-record",
          "--workspace-id",
          "pilot-b",
          "--plan-id",
          "a".repeat(32),
          "--review-file",
          NodePath.join(directory, "combined-review.json"),
        ],
      },
    ];
    for (const testCase of cases) {
      const result = yield* runDiviWorkspace(testCase.input);
      NodeAssert.deepEqual((result.resources as { argv: string[] }).argv, [
        "--root",
        directory,
        ...testCase.argv,
      ]);
    }
  }),
);

it.effect("identifies only helper-recorded project paths", () =>
  Effect.gen(function* () {
    const { directory } = yield* Effect.promise(() => fixture(""));
    const workspace = NodePath.join(directory, "workspaces", "pilot-b");
    const task = NodePath.join(workspace, "repositories", "builder-5");
    const nested = NodePath.join(task, "nested");
    const unrelated = NodePath.join(workspace, "repositories", "other");
    yield* Effect.promise(async () => {
      await NodeFSP.mkdir(nested, { recursive: true });
      await NodeFSP.mkdir(unrelated, { recursive: true });
      await NodeFSP.writeFile(
        NodePath.join(workspace, "manifest.json"),
        JSON.stringify({ workspaceId: "pilot-b" }),
      );
      await NodeFSP.writeFile(
        NodePath.join(workspace, "state.json"),
        JSON.stringify({ repositories: { "builder-5": { taskPath: task } } }),
      );
    });
    const found = yield* runDiviWorkspace({ operation: "identify", projectPath: task });
    const missing = yield* runDiviWorkspace({ operation: "identify", projectPath: unrelated });
    const nestedResult = yield* runDiviWorkspace({ operation: "identify", projectPath: nested });
    NodeAssert.equal(found.available, true);
    NodeAssert.equal(found.workspaceId, "pilot-b");
    NodeAssert.equal(missing.available, false);
    NodeAssert.equal(nestedResult.available, false);
  }),
);

it.effect("rejects a bound workspace action when the project does not match", () =>
  Effect.gen(function* () {
    const { directory } = yield* Effect.promise(() =>
      fixture('raise RuntimeError("helper must not run")\n'),
    );
    const projectPath = NodePath.join(directory, "other-project");
    yield* Effect.promise(() => NodeFSP.mkdir(projectPath));
    const exit = yield* Effect.exit(
      runDiviWorkspace({ operation: "stop", workspaceId: "pilot-b", projectPath }),
    );
    NodeAssert.equal(exit._tag, "Failure");
    NodeAssert.match(JSON.stringify(exit), /no longer belongs/);
  }),
);

it.effect("restarts the site in order and does not start it when stop fails", () =>
  Effect.gen(function* () {
    const { directory } = yield* Effect.promise(() =>
      fixture(`import json, pathlib, sys
root = pathlib.Path(sys.argv[2])
command = sys.argv[3]
with (root / "calls.txt").open("a") as calls:
    calls.write(command + "\\n")
if (root / ("fail-" + command)).exists():
    print(json.dumps({"schemaVersion":1,"helperVersion":"test","operation":command,"status":"blocked","error":command + " failed"}))
    sys.exit(2)
print(json.dumps({"schemaVersion":1,"helperVersion":"test","operation":command,"status":"ready"}))
`),
    );
    const result = yield* runDiviWorkspace({ operation: "restart", workspaceId: "pilot-b" });
    NodeAssert.equal(result.operation, "restart");
    NodeAssert.equal(
      yield* Effect.promise(() => NodeFSP.readFile(NodePath.join(directory, "calls.txt"), "utf8")),
      "stop\nstart\n",
    );
    yield* Effect.promise(() => NodeFSP.writeFile(NodePath.join(directory, "fail-stop"), ""));
    const exit = yield* Effect.exit(
      runDiviWorkspace({ operation: "restart", workspaceId: "pilot-b" }),
    );
    NodeAssert.equal(exit._tag, "Failure");
    NodeAssert.match(JSON.stringify(exit), /stop failed/);
    NodeAssert.equal(
      yield* Effect.promise(() => NodeFSP.readFile(NodePath.join(directory, "calls.txt"), "utf8")),
      "stop\nstart\nstop\n",
    );
    yield* Effect.promise(() => NodeFSP.rm(NodePath.join(directory, "fail-stop")));
    yield* Effect.promise(() => NodeFSP.writeFile(NodePath.join(directory, "fail-start"), ""));
    const startExit = yield* Effect.exit(
      runDiviWorkspace({ operation: "restart", workspaceId: "pilot-b" }),
    );
    NodeAssert.equal(startExit._tag, "Failure");
    NodeAssert.match(JSON.stringify(startExit), /start failed/);
    NodeAssert.equal(
      yield* Effect.promise(() => NodeFSP.readFile(NodePath.join(directory, "calls.txt"), "utf8")),
      "stop\nstart\nstop\nstop\nstart\n",
    );
  }),
);

it.effect("rejects transfer apply without a reviewed plan", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(
      runDiviWorkspace({ operation: "transfer-apply", workspaceId: "task-a" }),
    );
    NodeAssert.equal(exit._tag, "Failure");
  }),
);

it.effect("preserves a blocked helper receipt in the typed error", () =>
  Effect.gen(function* () {
    yield* Effect.promise(() =>
      fixture(
        'import json,sys\nprint(json.dumps({"schemaVersion":1,"helperVersion":"test","operation":"status","status":"blocked","error":"workspace missing"}))\nsys.exit(2)\n',
      ),
    );
    const exit = yield* Effect.exit(
      runDiviWorkspace({ operation: "status", workspaceId: "missing" }),
    );
    NodeAssert.equal(exit._tag, "Failure");
    NodeAssert.match(JSON.stringify(exit), /workspace missing/);
  }),
);
