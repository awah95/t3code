// @effect-diagnostics nodeBuiltinImport:off - this boundary runs a local JSON CLI.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import {
  DiviWorkspaceError,
  type DiviWorkspaceRunInput,
  type DiviWorkspaceRunResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const execFileAsync = NodeUtil.promisify(NodeChildProcess.execFile);
const helperPath = () =>
  process.env.DIVI_WORKSPACE_HELPER_PATH ??
  NodePath.join(NodeOS.homedir(), "Github/divi-workspace-runtime/helper/divi_workspace.py");
const stateRoot = () =>
  process.env.DIVI_WORKSPACE_ROOT ??
  NodePath.join(NodeOS.homedir(), ".local/share/divi-workspaces");

const needsManifest = new Set(["validate", "create"]);
const needsWorkspace = new Set([
  "doctor",
  "inspect",
  "destroy",
  "status",
  "start",
  "stop",
  "restart",
  "watcher-start",
  "watcher-stop",
  "watcher-restart",
  "watcher-log",
  "test",
  "transfer-preview",
  "transfer-apply",
  "review-record",
  "cleanup-review",
]);
const readOnly = new Set([
  "list",
  "identify",
  "main-info",
  "validate",
  "status",
  "inspect",
  "doctor",
  "watcher-log",
]);

const siteOperations = new Set(["start", "stop", "restart"]);

async function identifyProject(projectPath: string | undefined): Promise<DiviWorkspaceRunResult> {
  const unavailable: DiviWorkspaceRunResult = {
    schemaVersion: 1,
    helperVersion: "local",
    operation: "identify",
    status: "ready",
    available: false,
  };
  if (!projectPath || projectPath.length > 4096 || !NodePath.isAbsolute(projectPath))
    return unavailable;
  try {
    const [root, project] = await Promise.all([
      NodeFSP.realpath(stateRoot()),
      NodeFSP.realpath(projectPath),
    ]);
    const workspaceBase = NodePath.join(root, "workspaces");
    const parts = NodePath.relative(workspaceBase, project).split(NodePath.sep);
    const workspaceId = parts[0];
    if (!workspaceId || !/^[a-z][a-z0-9_-]{0,62}$/.test(workspaceId) || parts.length < 2)
      return unavailable;
    const workspacePath = NodePath.join(workspaceBase, workspaceId);
    const manifest: unknown = JSON.parse(
      await NodeFSP.readFile(NodePath.join(workspacePath, "manifest.json"), "utf8"),
    );
    const state: unknown = JSON.parse(
      await NodeFSP.readFile(NodePath.join(workspacePath, "state.json"), "utf8"),
    );
    if (
      !manifest ||
      typeof manifest !== "object" ||
      !("workspaceId" in manifest) ||
      manifest.workspaceId !== workspaceId ||
      !state ||
      typeof state !== "object" ||
      !("repositories" in state) ||
      !state.repositories ||
      typeof state.repositories !== "object"
    )
      return unavailable;
    const paths = Object.values(state.repositories)
      .filter((value): value is { taskPath: string } =>
        Boolean(
          value &&
          typeof value === "object" &&
          "taskPath" in value &&
          typeof value.taskPath === "string",
        ),
      )
      .map((record) => record.taskPath);
    paths.push(NodePath.join(workspacePath, "site"));
    const allowed = await Promise.all(
      paths.map((path) => NodeFSP.realpath(path).catch(() => null)),
    );
    return allowed.includes(project)
      ? { ...unavailable, available: true, workspaceId }
      : unavailable;
  } catch {
    return unavailable;
  }
}

function argumentsFor(input: DiviWorkspaceRunInput): string[] {
  if (
    (input.workspaceId && input.workspaceId.length > 128) ||
    (input.mainId && input.mainId.length > 128) ||
    (input.planId && input.planId.length > 128) ||
    (input.profileId && input.profileId.length > 128) ||
    (input.projectPath && input.projectPath.length > 4096) ||
    (input.manifestPath && input.manifestPath.length > 4096) ||
    (input.reviewFile && input.reviewFile.length > 4096)
  ) {
    throw new Error("Workspace input exceeds the supported length.");
  }
  if (needsManifest.has(input.operation) && !input.manifestPath && !input.preset) {
    throw new Error(`${input.operation} requires a manifest or preset.`);
  }
  if (input.operation === "create" && !input.workspaceId) {
    throw new Error("create requires a workspace ID.");
  }
  if (["main-create", "main-repair"].includes(input.operation) && !input.mainId) {
    throw new Error(`${input.operation} requires a main checkout ID.`);
  }
  if (input.workspaceId && !/^[a-z][a-z0-9_-]{0,62}$/.test(input.workspaceId)) {
    throw new Error(
      "Workspace ID must start with a lowercase letter and contain only lowercase letters, numbers, hyphens or underscores (max 63 characters).",
    );
  }
  if (input.mainId && !/^[a-z][a-z0-9_-]{0,62}$/.test(input.mainId)) {
    throw new Error(
      "Main checkout ID must start with a lowercase letter and contain only lowercase letters, numbers, hyphens or underscores (max 63 characters).",
    );
  }
  if (needsWorkspace.has(input.operation) && !input.workspaceId) {
    throw new Error(`${input.operation} requires a workspace ID.`);
  }
  if (input.operation === "transfer-apply" && !input.planId) {
    throw new Error("transfer-apply requires a reviewed plan ID.");
  }
  if (input.operation === "destroy" && input.confirmWorkspaceId !== input.workspaceId) {
    throw new Error("Destroy requires the exact workspace ID as confirmation.");
  }
  if (input.operation === "review-record" && (!input.planId || !input.reviewFile)) {
    throw new Error("review-record requires a transferred plan ID and review evidence file.");
  }
  if (
    ["watcher-start", "watcher-stop", "watcher-restart", "watcher-log", "test"].includes(
      input.operation,
    ) &&
    !input.profileId
  ) {
    throw new Error(`${input.operation} requires a selected profile.`);
  }
  if (input.manifestPath && !NodePath.isAbsolute(input.manifestPath)) {
    throw new Error("Manifest path must be absolute on the T3 server host.");
  }
  if (input.reviewFile && !NodePath.isAbsolute(input.reviewFile)) {
    throw new Error("Review evidence path must be absolute on the T3 server host.");
  }
  const args = [helperPath(), "--root", stateRoot(), input.operation];
  const manifestPath = input.preset
    ? NodePath.join(
        NodePath.dirname(helperPath()),
        input.preset === "divi" ? "../profiles/divi.json" : "../profiles/fluent-forms.pilot.json",
      )
    : input.manifestPath;
  if (manifestPath) args.push("--manifest", manifestPath);
  if (input.workspaceId) args.push("--workspace-id", input.workspaceId);
  if (input.mainId) args.push("--main-id", input.mainId);
  if (input.planId) args.push("--plan-id", input.planId);
  if (input.profileId) args.push("--profile-id", input.profileId);
  if (input.reviewFile) args.push("--review-file", input.reviewFile);
  if (input.confirmWorkspaceId) args.push("--confirm-id", input.confirmWorkspaceId);
  if (input.discardChanges) args.push("--discard-changes");
  if (input.operation === "inspect" && input.includeDiskUsage) args.push("--disk-usage");
  return args;
}

// Mutations on one workspace must not race one another; transfer's own journal
// handles contention between distinct workspaces targeting the same main repo.
const pending = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = pending.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(run);
  pending.set(key, current);
  void current
    .finally(() => {
      if (pending.get(key) === current) pending.delete(key);
    })
    .catch(() => undefined);
  return current;
}

function parseResult(stdout: string): DiviWorkspaceRunResult {
  const parsed: unknown = JSON.parse(stdout);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Helper returned an invalid JSON object.");
  }
  const result = parsed as Record<string, unknown>;
  if (
    result.schemaVersion !== 1 ||
    typeof result.helperVersion !== "string" ||
    typeof result.operation !== "string" ||
    typeof result.status !== "string"
  ) {
    throw new Error("Helper returned an unsupported result schema.");
  }
  return result as DiviWorkspaceRunResult;
}

export const runDiviWorkspace = Effect.fn("DiviWorkspace.run")(function* (
  input: DiviWorkspaceRunInput,
) {
  return yield* Effect.tryPromise({
    try: () => {
      const execute = async () => {
        if (input.operation === "identify") return identifyProject(input.projectPath);
        if (input.projectPath) {
          const identity = await identifyProject(input.projectPath);
          if (!identity.available || identity.workspaceId !== input.workspaceId) {
            throw new DiviWorkspaceError({
              message:
                "This project no longer belongs to the selected Divi workspace. Refresh the chat.",
            });
          }
        }
        let args: string[];
        try {
          args = argumentsFor(
            input.operation === "restart" ? { ...input, operation: "stop" } : input,
          );
        } catch (error) {
          throw new DiviWorkspaceError({ message: String(error) });
        }
        try {
          await NodeFSP.access(helperPath());
        } catch {
          throw new DiviWorkspaceError({
            message: `Divi workspace helper is unavailable at ${helperPath()}.`,
          });
        }
        try {
          const invoke = async (invocationArgs: string[]) => {
            const { stdout } = await execFileAsync("python3", invocationArgs, {
              timeout: 10 * 60_000,
              maxBuffer: 4 * 1024 * 1024,
              env: process.env,
            });
            const result = parseResult(stdout);
            if (result.status === "error" || result.status === "blocked") {
              throw new DiviWorkspaceError({
                message:
                  typeof result.error === "string"
                    ? result.error
                    : `Helper reported ${result.status}.`,
                result,
              });
            }
            return result;
          };
          if (input.operation !== "restart") return await invoke(args);
          await invoke(args);
          const started = await invoke(argumentsFor({ ...input, operation: "start" }));
          return { ...started, operation: "restart" };
        } catch (error) {
          if (Schema.is(DiviWorkspaceError)(error)) throw error;
          const output =
            error && typeof error === "object" && "stdout" in error ? String(error.stdout) : "";
          let result: DiviWorkspaceRunResult | undefined;
          try {
            result = parseResult(output);
          } catch {
            /* Process failure without a JSON receipt. */
          }
          throw new DiviWorkspaceError({
            message: result
              ? typeof result.error === "string"
                ? result.error
                : `Helper reported ${result.status}.`
              : error instanceof Error
                ? error.message
                : "Divi workspace helper failed.",
            ...(result ? { result } : {}),
          });
        }
      };
      return readOnly.has(input.operation)
        ? execute()
        : serialize(
            input.workspaceId && siteOperations.has(input.operation)
              ? `${input.workspaceId}:site`
              : input.workspaceId && input.operation.startsWith("watcher-") && input.profileId
                ? `${input.workspaceId}:watcher:${input.profileId}`
                : (input.workspaceId ?? input.manifestPath ?? "list"),
            execute,
          );
    },
    catch: (error) =>
      Schema.is(DiviWorkspaceError)(error)
        ? error
        : new DiviWorkspaceError({ message: String(error) }),
  });
});
