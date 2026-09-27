// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- This CLI owns process and JSONL IO.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { JevEffort, JevRouteRequest, ModelSelection } from "@t3tools/contracts";
import { buildJevContext } from "@t3tools/jev/context";
import { buildJevRouteRequest, eligibleJevModels } from "@t3tools/jev/routing";
import { JEV_MODEL_PROFILES } from "@t3tools/shared/jevRouting";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/unstable/cli";
import { resolveBaseDir } from "../os-jank.ts";
import { baseDirFlag } from "./config.ts";
import type { JevCliOutcome } from "./jev.ts";

export interface JevCodexExecution {
  readonly exitCode: number;
  readonly signal: NodeJS.Signals | null;
  readonly threadId: string | null;
  readonly finalMessage: string | null;
  readonly turnCompleted: boolean;
  readonly error: string | null;
  readonly stderr: string;
}

export interface JevCodexTurn {
  readonly prompt: string;
  readonly workspace: string;
  readonly model: string;
  readonly effort: JevEffort;
  readonly signal?: AbortSignal;
}

type Spawn = typeof NodeChildProcess.spawn;

const MAX_STDERR_CHARS = 32_000;
const MAX_EVENT_LINE_CHARS = 2_000_000;

/** Run one independent Codex turn with its normal user configuration and permission policy. */
export async function executeJevCodexTurn(
  input: JevCodexTurn,
  spawn: Spawn = NodeChildProcess.spawn,
): Promise<JevCodexExecution> {
  if (!JEV_MODEL_PROFILES.some((profile) => profile.model === input.model)) {
    throw new Error("Jev selected a model that is not available for new routing.");
  }
  if (!["low", "medium", "high", "xhigh"].includes(input.effort)) {
    throw new Error("Jev selected an unsupported reasoning effort.");
  }
  if (!input.prompt.trim()) throw new Error("The task prompt is empty.");
  if (!input.workspace.trim()) throw new Error("The workspace path is empty.");

  // Keep permission and sandbox policy in the user's Codex configuration. In
  // particular, do not add the noninteractive bypass flags used by some CLIs.
  const child = spawn(
    "codex",
    [
      "exec",
      "--json",
      "--model",
      input.model,
      "--config",
      `model_reasoning_effort="${input.effort}"`,
      "--cd",
      input.workspace,
      "-",
    ],
    { cwd: input.workspace, stdio: ["pipe", "pipe", "pipe"], signal: input.signal },
  );

  let threadId: string | null = null;
  let finalMessage: string | null = null;
  let turnCompleted = false;
  let error: string | null = null;
  let stderr = "";
  let pending = "";

  const readEvent = (line: string) => {
    if (!line.trim()) return;
    if (line.length > MAX_EVENT_LINE_CHARS) {
      error = "Codex emitted an oversized JSON event.";
      return;
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (event.type === "thread.started" && typeof event.thread_id === "string") {
      threadId = event.thread_id;
    }
    if (event.type === "error" && typeof event.message === "string") {
      error = event.message;
    }
    if (event.type === "turn.completed") turnCompleted = true;
    if (event.type === "turn.failed") error = "Codex reported that the turn failed.";
    if (event.type === "item.completed" && event.item && typeof event.item === "object") {
      const item = event.item as Record<string, unknown>;
      if (item.type === "agent_message" && typeof item.text === "string") {
        finalMessage = item.text;
      }
    }
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    pending += chunk;
    if (pending.length > MAX_EVENT_LINE_CHARS && !pending.includes("\n")) {
      error = "Codex emitted an oversized JSON event.";
      pending = pending.slice(-MAX_EVENT_LINE_CHARS);
    }
    for (;;) {
      const newline = pending.indexOf("\n");
      if (newline < 0) break;
      readEvent(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-MAX_STDERR_CHARS);
  });
  child.stdin.on("error", (cause: NodeJS.ErrnoException) => {
    if (cause.code !== "EPIPE") error = cause.message;
  });
  child.stdin.end(input.prompt);

  return await new Promise<JevCodexExecution>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      readEvent(pending);
      resolve({
        exitCode: code ?? 1,
        signal,
        threadId,
        finalMessage,
        turnCompleted,
        error,
        stderr,
      });
    });
  });
}

type ExecInput = {
  prompt: string;
  workspace: string;
  requestId: string;
  mode?: "guided" | "auto";
  current: { model: string; effort: JevEffort };
  candidates: { model: string; efforts: JevEffort[] }[];
  history?: { role: "user" | "assistant"; text: string; model?: string; effort?: string }[];
};

function parseExecInput(value: unknown): ExecInput {
  if (!value || typeof value !== "object") throw new Error("Invalid Jev exec input.");
  const input = value as Partial<ExecInput>;
  const validEffort = (effort: unknown): effort is JevEffort =>
    typeof effort === "string" && ["low", "medium", "high", "xhigh"].includes(effort);
  if (
    typeof input.prompt !== "string" ||
    !input.prompt.trim() ||
    typeof input.workspace !== "string" ||
    !NodePath.isAbsolute(input.workspace) ||
    !input.current ||
    typeof input.current.model !== "string" ||
    !JEV_MODEL_PROFILES.some((profile) => profile.model === input.current?.model) ||
    !validEffort(input.current.effort) ||
    !Array.isArray(input.candidates) ||
    input.candidates.length === 0 ||
    input.candidates.some(
      (candidate) =>
        typeof candidate?.model !== "string" ||
        !Array.isArray(candidate.efforts) ||
        !JEV_MODEL_PROFILES.some((profile) => profile.model === candidate.model) ||
        candidate.efforts.length === 0 ||
        candidate.efforts.some((effort) => !validEffort(effort)) ||
        new Set(candidate.efforts).size !== candidate.efforts.length,
    ) ||
    new Set(input.candidates.map((candidate) => candidate.model)).size !==
      input.candidates.length ||
    (input.mode !== undefined && input.mode !== "guided" && input.mode !== "auto") ||
    typeof input.requestId !== "string" ||
    !input.requestId.trim() ||
    (input.history !== undefined &&
      (!Array.isArray(input.history) ||
        input.history.some(
          (message) =>
            (message.role !== "user" && message.role !== "assistant") ||
            typeof message.text !== "string",
        )))
  )
    throw new Error("Invalid Jev exec input.");
  return input as ExecInput;
}

const executionRecordPath = (directory: string, requestId: string) =>
  NodePath.join(
    directory,
    `exec-${NodeCrypto.createHash("sha256").update(requestId).digest("hex")}`,
  );

export async function writeJevExecutionOutcome(
  directory: string,
  requestId: string,
  outcome: unknown,
) {
  const record = executionRecordPath(directory, requestId);
  const temporary = NodePath.join(record, `${NodeCrypto.randomUUID()}.tmp`);
  await NodeFSP.writeFile(temporary, JSON.stringify(outcome), { flag: "wx", mode: 0o600 });
  await NodeFSP.rename(temporary, NodePath.join(record, "outcome.json"));
}

export async function claimNewJevExecution(
  directory: string,
  requestId: string,
  inputFingerprint: string,
) {
  await NodeFSP.mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await NodeFSP.mkdir(executionRecordPath(directory, requestId), { mode: 0o700 });
    await NodeFSP.writeFile(
      NodePath.join(executionRecordPath(directory, requestId), "input.sha256"),
      inputFingerprint,
      { flag: "wx", mode: 0o600 },
    );
    return null;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
    try {
      const priorFingerprint = await NodeFSP.readFile(
        NodePath.join(executionRecordPath(directory, requestId), "input.sha256"),
        "utf8",
      );
      if (priorFingerprint !== inputFingerprint)
        throw new Error("This Jev request ID was used for a different task or configuration.", {
          cause,
        });
    } catch (readCause) {
      if ((readCause as NodeJS.ErrnoException).code !== "ENOENT") throw readCause;
      return {
        status: "execution_unknown",
        requestId,
        reason: "A prior invocation claimed this request; its input record is incomplete.",
      };
    }
    try {
      return JSON.parse(
        await NodeFSP.readFile(
          NodePath.join(executionRecordPath(directory, requestId), "outcome.json"),
          "utf8",
        ),
      ) as unknown;
    } catch (readCause) {
      if ((readCause as NodeJS.ErrnoException).code !== "ENOENT") throw readCause;
      return {
        status: "execution_unknown",
        requestId,
        reason:
          "A prior invocation claimed this request; its result is not recorded. Start a new request only after inspecting the workspace.",
      };
    }
  }
}

/** Convert a headless task input into the same Jev request built by the clients. */
export function makeJevExecRequest(input: ExecInput): JevRouteRequest {
  const instanceId = "jev-cli-codex" as ModelSelection["instanceId"];
  const current: ModelSelection = {
    instanceId,
    model: input.current.model,
    options: [{ id: "reasoningEffort", value: input.current.effort }],
  };
  const provider = {
    instanceId,
    driverKind: "codex",
    enabled: true,
    isAvailable: true,
    status: "ready",
    requiresNewThreadForModelChange: false,
    candidateModels: input.candidates.map(({ model, efforts }) => ({
      slug: model,
      isUnavailable: false,
      efforts,
    })),
  };
  const candidates = eligibleJevModels({
    providers: [provider],
    current,
    sessionInstanceId: null,
    hasStartedSession: false,
  });
  if (candidates.length === 0)
    throw new Error("No supported Jev model and effort pairs were supplied.");
  return buildJevRouteRequest({
    requestId: input.requestId,
    prompt: input.prompt,
    context: buildJevContext({
      messages: input.history ?? [],
      prompt: input.prompt,
      current,
      existingSession: (input.history?.length ?? 0) > 0,
      interactionMode: "default",
      historyCompleteness: "complete",
    }),
    candidates,
  });
}

type ReviewDependencies = {
  reviewDirectory: (baseDir: string) => string;
  route: (
    request: JevRouteRequest,
    key: string | undefined,
    mode: "guided" | "auto",
  ) => Promise<JevCliOutcome>;
  persist: (
    directory: string,
    request: JevRouteRequest,
    outcome: Extract<JevCliOutcome, { status: "review_required" }>,
  ) => Promise<Extract<JevCliOutcome, { status: "review_required" }>>;
  resume: (directory: string, reviewId: string, optionId: string) => Promise<JevCliOutcome>;
  loadResolved: (
    directory: string,
    reviewId: string,
  ) => Promise<{ request: JevRouteRequest; outcome: JevCliOutcome }>;
  claim: (directory: string, reviewId: string) => Promise<void>;
  promptForReview: (
    request: JevRouteRequest,
    pending: Extract<JevCliOutcome, { status: "review_required" }>,
  ) => Promise<Extract<JevCliOutcome, { status: "selected" | "cancelled" }>>;
};

/** Compose with the routing command's review store without a module import cycle. */
export function makeJevExecCommand(deps: ReviewDependencies) {
  return Command.make("exec", {
    baseDir: baseDirFlag,
    inputFile: Flag.String("input-file").pipe(
      Flag.withDescription("JSON task and candidate models."),
      Flag.optional,
    ),
    reviewId: Flag.String("review-id").pipe(
      Flag.withDescription("Approved review to execute."),
      Flag.optional,
    ),
    option: Flag.String("option").pipe(
      Flag.withDescription("Review option ID to select and execute."),
      Flag.optional,
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDescription("Emit one machine-readable JSON result."),
      Flag.withDefault(false),
    ),
  }).pipe(
    Command.withDescription("Route a task through Jev and run one headless Codex turn."),
    Command.withHandler(({ baseDir, inputFile, reviewId, option, json }) =>
      Effect.gen(function* () {
        const envHome = yield* Config.String("T3CODE_HOME").pipe(Config.option);
        const resolvedBaseDir = yield* resolveBaseDir(
          Option.getOrUndefined(baseDir) ?? Option.getOrUndefined(envHome),
        );
        yield* Effect.promise(async () => {
          const directory = deps.reviewDirectory(resolvedBaseDir);
          let storedReviewId = Option.getOrUndefined(reviewId);
          let request: JevRouteRequest;
          let workspace: string;
          let prompt: string;
          let outcome: JevCliOutcome;
          if (storedReviewId) {
            const selectedOption = Option.getOrUndefined(option);
            if (selectedOption) await deps.resume(directory, storedReviewId, selectedOption);
            const saved = await deps.loadResolved(directory, storedReviewId);
            const sidecar = JSON.parse(
              await NodeFSP.readFile(
                NodePath.join(directory, `${storedReviewId}.exec.json`),
                "utf8",
              ),
            ) as { requestId: string; workspace: string; prompt: string };
            if (
              sidecar.requestId !== saved.request.requestId ||
              !NodePath.isAbsolute(sidecar.workspace) ||
              !sidecar.prompt.trim()
            )
              throw new Error("Invalid pending Jev execution.");
            request = saved.request;
            workspace = sidecar.workspace;
            prompt = sidecar.prompt;
            outcome = saved.outcome;
          } else {
            const file = Option.getOrUndefined(inputFile);
            if (!file) throw new Error("Provide --input-file or --review-id.");
            const input = parseExecInput(JSON.parse(await NodeFSP.readFile(file, "utf8")));
            request = makeJevExecRequest(input);
            workspace = input.workspace;
            prompt = input.prompt;
            const fingerprint = NodeCrypto.createHash("sha256")
              .update(JSON.stringify(input))
              .digest("hex");
            const prior = await claimNewJevExecution(directory, request.requestId, fingerprint);
            if (prior) {
              process.stdout.write(`${JSON.stringify(prior)}\n`);
              const status = (prior as { status?: string; execution?: { exitCode?: number } })
                .status;
              if (status === "execution_unknown") process.exitCode = 3;
              else if (status === "review_required") process.exitCode = 2;
              else if (status === "cancelled") process.exitCode = 4;
              else if (status === "execution_failed")
                process.exitCode =
                  (prior as { execution?: { exitCode?: number } }).execution?.exitCode || 1;
              return;
            }
            outcome = await deps.route(
              request,
              process.env.OPENROUTER_API_KEY,
              input.mode ?? "guided",
            );
            if (outcome.status === "review_required") {
              const pending = await deps.persist(directory, request, outcome);
              await NodeFSP.writeFile(
                NodePath.join(directory, `${pending.reviewId}.exec.json`),
                JSON.stringify({ requestId: request.requestId, workspace, prompt: input.prompt }),
                { flag: "wx", mode: 0o600 },
              );
              await writeJevExecutionOutcome(directory, request.requestId, pending);
              if (json || !process.stdin.isTTY) {
                process.stdout.write(`${JSON.stringify(pending)}\n`);
                process.exitCode = 2;
                return;
              }
              const selection = await deps.promptForReview(request, pending);
              const optionId =
                selection.status === "cancelled"
                  ? "cancel"
                  : pending.options.find(
                      (entry) => entry.id !== "cancel" && entry.choice === selection.choice,
                    )?.id;
              if (!optionId) throw new Error("The selected Jev option is unavailable.");
              outcome = await deps.resume(directory, pending.reviewId, optionId);
              storedReviewId = pending.reviewId;
            }
          }
          if (outcome.status === "cancelled") {
            await writeJevExecutionOutcome(directory, request.requestId, outcome);
            process.stdout.write(`${JSON.stringify(outcome)}\n`);
            process.exitCode = 4;
            return;
          }
          if (outcome.status !== "routed" && outcome.status !== "selected")
            throw new Error("Jev review is not resolved.");
          const candidate = request.candidates.find((entry) => entry.key === outcome.choice);
          const model = candidate?.model ?? request.context.currentModel;
          const effort = candidate?.effort ?? request.context.currentEffort;
          if (!model || !effort || !["low", "medium", "high", "xhigh"].includes(effort))
            throw new Error("The selected Jev model and effort are unavailable.");
          if (storedReviewId) await deps.claim(directory, storedReviewId);
          const execution = await executeJevCodexTurn({
            prompt,
            workspace,
            model,
            effort: effort as JevEffort,
          });
          const succeeded =
            execution.exitCode === 0 &&
            execution.turnCompleted &&
            execution.finalMessage !== null &&
            execution.error === null;
          const completed = {
            status: succeeded ? "completed" : "execution_failed",
            requestId: request.requestId,
            choice: outcome.choice,
            model,
            effort,
            execution,
            routing: {
              policyOutcome: outcome.result.policyOutcome,
              reasons: outcome.result.reasons,
              confidence: outcome.result.confidence,
              latencyMs: outcome.result.latencyMs,
              inputTokens: outcome.result.inputTokens,
              outputTokens: outcome.result.outputTokens,
              costUsd: outcome.result.costUsd,
              costKind: outcome.result.costKind,
              requestFingerprint: outcome.result.requestFingerprint,
            },
          };
          await writeJevExecutionOutcome(directory, request.requestId, completed);
          if (json) process.stdout.write(`${JSON.stringify(completed)}\n`);
          else {
            if (execution.finalMessage) process.stdout.write(`${execution.finalMessage}\n`);
            else process.stdout.write(`${JSON.stringify(completed)}\n`);
            if (execution.stderr) process.stderr.write(execution.stderr);
          }
          if (!succeeded) process.exitCode = execution.exitCode || 1;
        });
      }),
    ),
  );
}
