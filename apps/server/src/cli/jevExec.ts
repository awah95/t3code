// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- This CLI owns process and JSONL IO.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type {
  JevEffort,
  JevRouteRequest,
  JevRouteResult,
  ModelSelection,
} from "@t3tools/contracts";
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
import { CODEX_STANDARD_RATE_SNAPSHOT, priceCodexResponse } from "../usage/codexLedgerPricing.ts";

export interface JevCodexExecution {
  readonly exitCode: number;
  readonly signal: NodeJS.Signals | null;
  readonly threadId: string | null;
  readonly runId: string | null;
  readonly finalMessage: string | null;
  readonly turnCompleted: boolean;
  readonly error: string | null;
  readonly stderr: string;
  readonly elapsedMs: number;
  readonly usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
    reasoningOutputTokens?: number;
  } | null;
  readonly policy: JevExecutionPolicy | null;
}

export function estimateJevCodexRun(
  model: string,
  usage: JevCodexExecution["usage"],
  requestId: string,
) {
  const rate = CODEX_STANDARD_RATE_SNAPSHOT.models[model];
  const thresholdMayBeCrossed = Boolean(
    usage && rate && usage.inputTokens > rate.longContextThresholdInputTokens,
  );
  const counters = {
    input_tokens: usage?.inputTokens ?? null,
    cached_input_tokens: usage?.cachedInputTokens ?? null,
    cache_write_input_tokens: usage ? 0 : null,
    output_tokens: usage?.outputTokens ?? null,
    reasoning_output_tokens: usage?.reasoningOutputTokens ?? null,
    total_tokens: usage ? usage.inputTokens + usage.outputTokens : null,
  };
  const observation = {
    responseId: requestId,
    model,
    usage: { counters, invalid: [], invalidRaw: {} },
  };
  // Codex reports turn totals, not individual priced requests or cache-write counts.
  const valuation = priceCodexResponse(observation, CODEX_STANDARD_RATE_SNAPSHOT, {
    requestLongContext: false,
    sessionLongContext: false,
  });
  const upperCounters = { ...counters };
  if (
    usage?.cachedInputTokens !== undefined &&
    rate?.cacheWriteInput !== null &&
    rate?.cacheWriteInput !== undefined
  ) {
    upperCounters.cache_write_input_tokens = usage.inputTokens - usage.cachedInputTokens;
  }
  const upper =
    rate?.cacheWriteInput === null
      ? null
      : priceCodexResponse(
          { ...observation, usage: { ...observation.usage, counters: upperCounters } },
          CODEX_STANDARD_RATE_SNAPSHOT,
          {
            requestLongContext: thresholdMayBeCrossed,
            sessionLongContext: thresholdMayBeCrossed,
          },
        );
  return {
    ...valuation,
    cacheWriteTokens: null,
    cacheWriteUsd: null,
    assumedCacheWriteTokensForPointEstimate: 0,
    possibleRangeUsd: { lower: valuation.totalUsd, upper: upper?.totalUsd ?? null },
    assumptions: [
      "Unreported cache writes priced as ordinary input in the point estimate",
      ...(thresholdMayBeCrossed
        ? ["No per-request context sizes; point estimate uses standard context rates"]
        : []),
    ],
    rateSource: rate?.source ?? null,
    rateRetrievedOn: CODEX_STANDARD_RATE_SNAPSHOT.retrievedOn,
    tokenCoverage: !usage
      ? "usage_unknown"
      : usage.cachedInputTokens === undefined
        ? "cached_input_unknown"
        : "turn_totals_only_cache_write_unknown",
  };
}

export type JevExecutionPolicy = {
  sandbox: "read-only" | "workspace-write";
  approval: "never";
  allowedWrites: string[];
};

export interface JevCodexTurn {
  readonly prompt: string;
  readonly workspace: string;
  readonly model: string;
  readonly effort: JevEffort;
  readonly signal?: AbortSignal;
  readonly policy?: JevExecutionPolicy;
}

type Spawn = typeof NodeChildProcess.spawn;

const MAX_STDERR_CHARS = 32_000;
const MAX_EVENT_LINE_CHARS = 2_000_000;

/** Run one Codex turn, preserving user configuration unless an explicit policy is supplied. */
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

  const policy = input.policy;
  if (
    policy &&
    (Object.keys(policy).some((key) => !["sandbox", "approval", "allowedWrites"].includes(key)) ||
      policy.approval !== "never" ||
      !["read-only", "workspace-write"].includes(policy.sandbox) ||
      !Array.isArray(policy.allowedWrites) ||
      (policy.sandbox === "read-only"
        ? policy.allowedWrites.length !== 0
        : policy.allowedWrites.length !== 1 || policy.allowedWrites[0] !== input.workspace))
  )
    throw new Error("Unsupported or conflicting Jev execution policy.");
  const startedAt = process.hrtime.bigint();
  const child = spawn(
    "codex",
    [
      "exec",
      "--json",
      "--model",
      input.model,
      "--config",
      `model_reasoning_effort="${input.effort}"`,
      ...(policy
        ? [
            "--ignore-user-config",
            "--ignore-rules",
            "--sandbox",
            policy.sandbox,
            "--config",
            'approval_policy="never"',
            ...(policy.sandbox === "workspace-write"
              ? ["--config", "sandbox_workspace_write.network_access=true"]
              : []),
            "--skip-git-repo-check",
          ]
        : []),
      "--cd",
      input.workspace,
      "-",
    ],
    { cwd: input.workspace, stdio: ["pipe", "pipe", "pipe"], signal: input.signal },
  );

  let threadId: string | null = null;
  let runId: string | null = null;
  let finalMessage: string | null = null;
  let turnCompleted = false;
  let error: string | null = null;
  let stderr = "";
  let pending = "";
  let usage: JevCodexExecution["usage"] = null;

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
    if (typeof event.turn_id === "string") runId = event.turn_id;
    if (event.type === "error" && typeof event.message === "string") {
      error = event.message;
    }
    if (event.type === "turn.completed") {
      turnCompleted = true;
      const raw = event.usage as Record<string, unknown> | undefined;
      if (raw && Number.isFinite(raw.input_tokens) && Number.isFinite(raw.output_tokens)) {
        const details = raw.output_tokens_details as Record<string, unknown> | undefined;
        usage = {
          inputTokens: raw.input_tokens as number,
          outputTokens: raw.output_tokens as number,
          ...(Number.isFinite(raw.cached_input_tokens)
            ? { cachedInputTokens: raw.cached_input_tokens as number }
            : {}),
          ...(Number.isFinite(details?.reasoning_tokens)
            ? { reasoningOutputTokens: details?.reasoning_tokens as number }
            : {}),
        };
      }
    }
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
        runId,
        finalMessage,
        turnCompleted,
        error,
        stderr,
        elapsedMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        usage,
        policy: policy ?? null,
      });
    });
  });
}

type ExecInput = {
  prompt: string;
  workspace: string;
  requestId: string;
  mode?: "guided" | "auto" | "pinned";
  policy?: JevExecutionPolicy;
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
    (input.mode !== undefined && !["guided", "auto", "pinned"].includes(input.mode)) ||
    (input.policy !== undefined &&
      (!input.policy ||
        Object.keys(input.policy).some(
          (key) => !["sandbox", "approval", "allowedWrites"].includes(key),
        ) ||
        !["read-only", "workspace-write"].includes(input.policy.sandbox) ||
        input.policy.approval !== "never" ||
        !Array.isArray(input.policy.allowedWrites) ||
        (input.policy.sandbox === "read-only"
          ? input.policy.allowedWrites.length !== 0
          : input.policy.allowedWrites.length !== 1 ||
            input.policy.allowedWrites[0] !== input.workspace))) ||
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
    transport?: typeof fetch,
    provider?: "openrouter" | "typesafe",
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

export async function loadJevExecutionSidecar(
  directory: string,
  reviewId: string,
  expectedRequestId?: string,
) {
  if (!/^[0-9a-f-]{36}$/.test(reviewId)) throw new Error("Invalid review ID.");
  const sidecar = JSON.parse(
    await NodeFSP.readFile(NodePath.join(directory, `${reviewId}.exec.json`), "utf8"),
  ) as { requestId: string; workspace: string; prompt: string; policy?: JevExecutionPolicy };
  if (
    typeof sidecar.requestId !== "string" ||
    !sidecar.requestId.trim() ||
    !NodePath.isAbsolute(sidecar.workspace) ||
    typeof sidecar.prompt !== "string" ||
    !sidecar.prompt.trim()
  )
    throw new Error("Invalid pending Jev execution.");
  if (expectedRequestId && sidecar.requestId !== expectedRequestId)
    throw new Error("This Jev review belongs to a different request ID.");
  return sidecar;
}

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
    expectedRequestId: Flag.String("expected-request-id").pipe(
      Flag.withDescription("Require this saved request ID before selecting or executing a review."),
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
    Command.withHandler(({ baseDir, inputFile, reviewId, expectedRequestId, option, json }) =>
      Effect.gen(function* () {
        const envHome = yield* Config.String("T3CODE_HOME").pipe(Config.option);
        const resolvedBaseDir = yield* resolveBaseDir(
          Option.getOrUndefined(baseDir) ?? Option.getOrUndefined(envHome),
        );
        yield* Effect.promise(async () => {
          const directory = deps.reviewDirectory(resolvedBaseDir);
          let storedReviewId = Option.getOrUndefined(reviewId);
          const expectedId = Option.getOrUndefined(expectedRequestId);
          if (expectedId && !storedReviewId)
            throw new Error("--expected-request-id requires --review-id.");
          let request: JevRouteRequest;
          let workspace: string;
          let prompt: string;
          let executionPolicy: JevExecutionPolicy | undefined;
          let outcome: JevCliOutcome;
          if (storedReviewId) {
            const sidecar = await loadJevExecutionSidecar(directory, storedReviewId, expectedId);
            const selectedOption = Option.getOrUndefined(option);
            if (selectedOption) await deps.resume(directory, storedReviewId, selectedOption);
            const saved = await deps.loadResolved(directory, storedReviewId);
            if (sidecar.requestId !== saved.request.requestId)
              throw new Error("Invalid pending Jev execution.");
            request = saved.request;
            workspace = sidecar.workspace;
            prompt = sidecar.prompt;
            executionPolicy = sidecar.policy;
            outcome = saved.outcome;
          } else {
            const file = Option.getOrUndefined(inputFile);
            if (!file) throw new Error("Provide --input-file or --review-id.");
            const input = parseExecInput(JSON.parse(await NodeFSP.readFile(file, "utf8")));
            request = makeJevExecRequest(input);
            workspace = input.workspace;
            prompt = input.prompt;
            executionPolicy = input.policy;
            const pinnedChoice = request.candidates.find(
              (candidate) =>
                candidate.model === input.current.model &&
                candidate.effort === input.current.effort,
            )?.key;
            if (input.mode === "pinned" && !pinnedChoice)
              throw new Error("Pinned model and effort must be in the candidate list.");
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
            const pinnedResult: JevRouteResult = {
              choice: pinnedChoice ?? null,
              confidence: null,
              probabilities: {},
              latencyMs: 0,
              error: null,
              inputTokens: null,
              outputTokens: null,
              costUsd: null,
              costKind: "unknown",
              reasons: ["pinned_by_caller"],
            };
            outcome =
              input.mode === "pinned"
                ? {
                    status: "routed",
                    requestId: request.requestId,
                    choice: pinnedChoice!,
                    result: pinnedResult,
                  }
                : await deps.route(
                    request,
                    process.env.JEV_API_PROVIDER === "typesafe"
                      ? process.env.TYPESAFE_API_KEY
                      : process.env.OPENROUTER_API_KEY,
                    input.mode ?? "guided",
                    fetch,
                    process.env.JEV_API_PROVIDER === "typesafe" ? "typesafe" : "openrouter",
                  );
            if (outcome.status === "review_required") {
              const pending = await deps.persist(directory, request, outcome);
              await NodeFSP.writeFile(
                NodePath.join(directory, `${pending.reviewId}.exec.json`),
                JSON.stringify({
                  requestId: request.requestId,
                  workspace,
                  prompt: input.prompt,
                  policy: input.policy,
                }),
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
            ...(executionPolicy ? { policy: executionPolicy } : {}),
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
            mode: outcome.result.reasons?.includes("pinned_by_caller") ? "pinned" : "jev",
            workspace,
            policy: executionPolicy ?? null,
            execution,
            accounting: {
              actualBilledCostUsd: null,
              apiEquivalentEstimateUsd: succeeded
                ? estimateJevCodexRun(model, execution.usage, request.requestId).totalUsd
                : null,
              standardApiEquivalent: succeeded
                ? estimateJevCodexRun(model, execution.usage, request.requestId)
                : null,
              subscriptionAllowanceObservation: null,
              routingOverhead: {
                costUsd: outcome.result.costUsd,
                costKind: outcome.result.costKind,
              },
            },
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
