// @effect-diagnostics nodeBuiltinImport:off -- The CLI owns terminal and file IO.
import * as NodeFSP from "node:fs/promises";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";
import * as NodeReadlinePromises from "node:readline/promises";

import { JevRouteRequest, type JevRouteResult } from "@t3tools/contracts";
import { failedJevDecision, JEV_TIMEOUT_MS, requestJevDecision } from "@t3tools/jev/decision";
import { isValidJevRouteRequest } from "@t3tools/jev/requestValidation";
import { isAutomaticJevRoute, resolveJevReviewSelection } from "@t3tools/jev/review";
import * as Effect from "effect/Effect";
import * as Config from "effect/Config";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/unstable/cli";
import { resolveBaseDir } from "../os-jank.ts";
import { baseDirFlag } from "./config.ts";
import { makeJevExecCommand } from "./jevExec.ts";

type ReviewOption = {
  readonly id: string;
  readonly label: string;
  readonly choice: string | null;
};

export type JevCliOutcome =
  | {
      readonly status: "routed";
      readonly requestId: string;
      readonly choice: string;
      readonly result: JevRouteResult;
    }
  | {
      readonly status: "review_required";
      readonly requestId: string;
      readonly reviewId: string;
      readonly reason: readonly string[];
      readonly options: readonly ReviewOption[];
      readonly result: JevRouteResult;
    }
  | {
      readonly status: "selected" | "cancelled";
      readonly requestId: string;
      readonly choice: string | null;
      readonly result: JevRouteResult;
    };

type JevCliSelection = Extract<JevCliOutcome, { status: "selected" | "cancelled" }>;

const decodeJevRouteRequest = Schema.decodeUnknownSync(JevRouteRequest);
const isJevRouteRequest = Schema.is(JevRouteRequest);
const parseRequest = (source: string) => decodeJevRouteRequest(JSON.parse(source));
const printOutcome = (outcome: JevCliOutcome) =>
  process.stdout.write(`${JSON.stringify(outcome)}\n`);

export const jevReviewDirectory = (baseDir: string) =>
  NodePath.join(baseDir, "userdata", "jev-cli-reviews");

const reviewPath = (directory: string, reviewId: string) => {
  if (!/^[0-9a-f-]{36}$/.test(reviewId)) throw new Error("Invalid review ID.");
  return NodePath.join(directory, `${reviewId}.json`);
};

/** The pending record is independent of the CLI process, so another agent can relay it. */
export async function persistJevCliReview(
  directory: string,
  request: JevRouteRequest,
  outcome: Extract<JevCliOutcome, { status: "review_required" }>,
) {
  const reviewId = NodeCrypto.randomUUID();
  const pending = { ...outcome, reviewId };
  await NodeFSP.mkdir(directory, { recursive: true, mode: 0o700 });
  await NodeFSP.writeFile(
    reviewPath(directory, reviewId),
    JSON.stringify({ request, outcome: pending }),
    {
      flag: "wx",
      mode: 0o600,
    },
  );
  return pending;
}

/** A lock directory prevents two CLI processes from approving the same review. */
export async function resumeJevCliReview(directory: string, reviewId: string, optionId: string) {
  const path = reviewPath(directory, reviewId);
  const resolvedPath = `${path}.resolved`;
  const lock = `${path}.lock`;
  await NodeFSP.mkdir(lock);
  try {
    try {
      const resolved = JSON.parse(await NodeFSP.readFile(resolvedPath, "utf8")) as {
        optionId: string;
        outcome: JevCliSelection;
      };
      if (resolved.optionId !== optionId)
        throw new Error("This Jev review already has a different selection.");
      return resolved.outcome;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const saved = JSON.parse(await NodeFSP.readFile(path, "utf8")) as {
      request: JevRouteRequest;
      outcome: Extract<JevCliOutcome, { status: "review_required" }>;
    };
    if (saved.outcome.reviewId !== reviewId || !isJevRouteRequest(saved.request))
      throw new Error("Invalid pending Jev review.");
    const selected = selectJevCliOption(saved.request, saved.outcome, optionId);
    if (!selected) throw new Error("Invalid Jev review option.");
    await NodeFSP.writeFile(
      resolvedPath,
      JSON.stringify({ optionId, request: saved.request, outcome: selected }),
      {
        flag: "wx",
        mode: 0o600,
      },
    );
    await NodeFSP.unlink(path);
    return selected;
  } finally {
    await NodeFSP.rmdir(lock);
  }
}

export async function loadResolvedJevCliReview(directory: string, reviewId: string) {
  const record = JSON.parse(
    await NodeFSP.readFile(`${reviewPath(directory, reviewId)}.resolved`, "utf8"),
  ) as {
    optionId: string;
    request: JevRouteRequest;
    outcome: JevCliSelection;
  };
  if (!isJevRouteRequest(record.request) || record.outcome.requestId !== record.request.requestId)
    throw new Error("Invalid resolved Jev review.");
  return record;
}

/** Claim a reviewed turn immediately before dispatch. A repeated CLI call cannot send it twice. */
export async function claimJevCliReviewExecution(directory: string, reviewId: string) {
  await loadResolvedJevCliReview(directory, reviewId);
  try {
    await NodeFSP.mkdir(`${reviewPath(directory, reviewId)}.execution-claimed`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error("This Jev review was already submitted for execution.", { cause: error });
    throw error;
  }
}

const candidateLabel = (candidate: JevRouteRequest["candidates"][number]) =>
  candidate.model
    ? `${candidate.model}${candidate.effort ? ` / ${candidate.effort}` : ""}`
    : candidate.description;

/** Build the same review choices as the desktop, without approving any of them. */
export function makeJevCliOutcome(
  request: JevRouteRequest,
  result: JevRouteResult,
  mode: "guided" | "auto" = "guided",
): JevCliOutcome {
  if (mode === "auto" && isAutomaticJevRoute(request, result)) {
    return { status: "routed", requestId: request.requestId, choice: result.choice!, result };
  }
  const suggestion = resolveJevReviewSelection(request, result, "suggestion");
  const options: ReviewOption[] = [];
  if (suggestion) {
    const candidate = request.candidates.find((entry) => entry.key === suggestion.choice)!;
    options.push({
      id: "recommended",
      label: `Use ${candidateLabel(candidate)}`,
      choice: suggestion.choice,
    });
  }
  options.push({
    id: "current",
    label: `Keep ${request.context.currentModel ?? "current model"}${request.context.currentEffort ? ` / ${request.context.currentEffort}` : ""}`,
    choice: null,
  });
  for (const candidate of request.candidates) {
    if (candidate.key === suggestion?.choice) continue;
    options.push({
      id: `alternative:${candidate.key}`,
      label: `Use ${candidateLabel(candidate)}`,
      choice: candidate.key,
    });
  }
  options.push({ id: "cancel", label: "Cancel", choice: null });
  return {
    status: "review_required",
    requestId: request.requestId,
    reviewId: request.requestId,
    reason: result.reasons ?? (result.error ? [result.error] : []),
    options,
    result,
  };
}

export function selectJevCliOption(
  request: JevRouteRequest,
  outcome: Extract<JevCliOutcome, { status: "review_required" }>,
  optionId: string,
): JevCliSelection | undefined {
  const option = outcome.options.find((entry) => entry.id === optionId);
  if (!option) return undefined;
  if (option.id === "cancel")
    return {
      status: "cancelled",
      requestId: request.requestId,
      choice: null,
      result: outcome.result,
    };
  const action =
    option.id === "recommended"
      ? "suggestion"
      : option.id === "current"
        ? "current"
        : "alternative";
  const selection = resolveJevReviewSelection(
    request,
    outcome.result,
    action,
    option.choice ?? undefined,
  );
  if (!selection) return undefined;
  return {
    status: "selected",
    requestId: request.requestId,
    choice: selection.choice,
    result: outcome.result,
  };
}

export async function routeJevCliRequest(
  request: JevRouteRequest,
  key: string | undefined,
  mode: "guided" | "auto" = "guided",
  transport: typeof fetch = fetch,
  provider: "openrouter" | "typesafe" = "openrouter",
): Promise<JevCliOutcome> {
  const result = !isValidJevRouteRequest(request)
    ? failedJevDecision("Invalid routing request; using the selected model.")
    : !key?.trim()
      ? failedJevDecision("Set the selected Jev provider API key to use routing.")
      : await requestJevDecision(
          request,
          key,
          AbortSignal.timeout(JEV_TIMEOUT_MS),
          transport,
          provider,
        );
  return makeJevCliOutcome(request, result, mode);
}

export async function promptForJevReview(
  request: JevRouteRequest,
  outcome: Extract<JevCliOutcome, { status: "review_required" }>,
): Promise<JevCliSelection> {
  const terminal = NodeReadlinePromises.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    process.stderr.write(
      `Jev review required${outcome.reason.length ? `: ${outcome.reason.join(", ")}` : ""}\n`,
    );
    outcome.options.forEach((option, index) =>
      process.stderr.write(`  ${index + 1}. ${option.label}\n`),
    );
    for (;;) {
      const answer = (await terminal.question("Choose an option: ")).trim();
      const index = Number(answer) - 1;
      const option = Number.isInteger(index)
        ? outcome.options[index]
        : outcome.options.find((entry) => entry.id === answer);
      if (option) {
        const selected = selectJevCliOption(request, outcome, option.id);
        if (selected) return selected;
      }
      process.stderr.write("Choose one of the listed options.\n");
    }
  } finally {
    terminal.close();
  }
}

const routeCommand = Command.make("route", {
  baseDir: baseDirFlag,
  requestFile: Flag.String("request-file").pipe(
    Flag.withDescription("Path to a JevRouteRequest JSON file."),
  ),
  mode: Flag.Literals("mode", ["guided", "auto"]).pipe(
    Flag.withDescription(
      "Guided always requests review; auto routes only on a valid policy decision.",
    ),
    Flag.withDefault("guided"),
  ),
  json: Flag.Boolean("json").pipe(
    Flag.withDescription("Emit one JSON result without prompting."),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription("Route a task with Jev and review the recommendation."),
  Command.withHandler(({ requestFile, json, baseDir, mode }) =>
    Effect.gen(function* () {
      const envHome = yield* Config.String("T3CODE_HOME").pipe(Config.option);
      const resolvedBaseDir = yield* resolveBaseDir(
        Option.getOrUndefined(baseDir) ?? Option.getOrUndefined(envHome),
      );
      yield* Effect.promise(async () => {
        let request: JevRouteRequest;
        try {
          request = parseRequest(await NodeFSP.readFile(requestFile, "utf8"));
        } catch {
          throw new Error("Could not read a valid JevRouteRequest JSON file.");
        }
        let outcome = await routeJevCliRequest(
          request,
          process.env.JEV_API_PROVIDER === "typesafe"
            ? process.env.TYPESAFE_API_KEY
            : process.env.OPENROUTER_API_KEY,
          mode,
          fetch,
          process.env.JEV_API_PROVIDER === "typesafe" ? "typesafe" : "openrouter",
        );
        if (outcome.status === "review_required") {
          const pending = await persistJevCliReview(
            jevReviewDirectory(resolvedBaseDir),
            request,
            outcome,
          );
          outcome = pending;
          if (!json && process.stdin.isTTY) {
            const selection = await promptForJevReview(request, pending);
            const optionId =
              selection.status === "cancelled"
                ? "cancel"
                : (pending.options.find(
                    (option) => option.id !== "cancel" && option.choice === selection.choice,
                  )?.id ?? "current");
            outcome = await resumeJevCliReview(
              jevReviewDirectory(resolvedBaseDir),
              pending.reviewId,
              optionId,
            );
          }
        }
        printOutcome(outcome);
        if (outcome.status === "review_required") process.exitCode = 2;
      });
    }),
  ),
);

const resumeCommand = Command.make("resume", {
  baseDir: baseDirFlag,
  reviewId: Flag.String("review-id").pipe(
    Flag.withDescription("Review ID from a review_required result."),
  ),
  option: Flag.String("option").pipe(
    Flag.withDescription("Option ID from a review_required result."),
  ),
}).pipe(
  Command.withDescription("Record a selection for a pending Jev review."),
  Command.withHandler(({ baseDir, reviewId, option }) =>
    Effect.gen(function* () {
      const envHome = yield* Config.String("T3CODE_HOME").pipe(Config.option);
      const resolvedBaseDir = yield* resolveBaseDir(
        Option.getOrUndefined(baseDir) ?? Option.getOrUndefined(envHome),
      );
      const outcome = yield* Effect.promise(() =>
        resumeJevCliReview(jevReviewDirectory(resolvedBaseDir), reviewId, option),
      );
      printOutcome(outcome);
    }),
  ),
);

export const jevCommand = Command.make("jev").pipe(
  Command.withDescription("Jev routing commands."),
  Command.withSubcommands([
    routeCommand,
    resumeCommand,
    makeJevExecCommand({
      reviewDirectory: jevReviewDirectory,
      route: routeJevCliRequest,
      persist: persistJevCliReview,
      resume: resumeJevCliReview,
      loadResolved: loadResolvedJevCliReview,
      claim: claimJevCliReviewExecution,
      promptForReview: promptForJevReview,
    }),
  ]),
);
