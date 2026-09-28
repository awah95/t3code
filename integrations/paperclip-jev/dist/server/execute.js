import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute, sep } from "node:path";
import { renderPaperclipWakePrompt, selectPaperclipTaskMarkdown, } from "@paperclipai/adapter-utils/server-utils";
const validEffort = (value) => ["low", "medium", "high", "xhigh"].includes(String(value));
const configString = (ctx, key) => {
    const value = ctx.config[key];
    return typeof value === "string" ? value.trim() : "";
};
const parseCandidates = (value) => {
    if (typeof value !== "string")
        throw new Error("Jev candidates must be configured as JSON.");
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) ||
        parsed.length === 0 ||
        parsed.some((item) => !item ||
            typeof item.model !== "string" ||
            !item.model.trim() ||
            !Array.isArray(item.efforts) ||
            item.efforts.length === 0 ||
            item.efforts.some((effort) => !validEffort(effort)))) {
        throw new Error("Jev candidates must be a non-empty JSON list of {model, efforts}.");
    }
    return parsed;
};
export function isTaskArtifactFolder(workspace, artifactFolder, allowWorkspace = false) {
    if (!isAbsolute(workspace) || !isAbsolute(artifactFolder))
        return false;
    const within = relative(workspace, artifactFolder);
    return (allowWorkspace || within !== "") && within !== ".." && !within.startsWith(`..${sep}`) && !isAbsolute(within);
}
function taskPrompt(ctx, workspace, taskId) {
    const task = selectPaperclipTaskMarkdown(ctx.context);
    if (task) {
        const artifactFolder = configString(ctx, "artifactFolder");
        if (!taskId || configString(ctx, "artifactTaskId") !== taskId)
            throw new Error("Bind artifactTaskId and artifactFolder to the assigned Paperclip task.");
        if (!isTaskArtifactFolder(workspace, artifactFolder, configString(ctx, "sandbox") === "workspace-write"))
            throw new Error("Configure the task's canonical artifactFolder inside workspace.");
        const wake = renderPaperclipWakePrompt(ctx.context.paperclipWake, {
            suppressIssueDescription: true,
        });
        return [task, `Canonical artifact folder: ${artifactFolder}`, wake]
            .filter(Boolean)
            .join("\n\n");
    }
    throw new Error("Generic Run now has no issue context or paperclipTaskMarkdown. Wake the assigned issue with an issue-scoped board request (payload.issueId). No Codex run started.");
}
function runJson(command, args, cwd, ctx) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            detached: process.platform !== "win32",
            stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        let cancelled = false;
        let forceKill;
        let spawnError;
        let spawnReport = Promise.resolve();
        const signalProcessGroup = (name) => {
            if (!child.pid)
                return;
            try {
                if (process.platform === "win32")
                    child.kill(name);
                else
                    process.kill(-child.pid, name);
            }
            catch (error) {
                if (error.code !== "ESRCH") {
                    try {
                        child.kill(name);
                    }
                    catch {
                        /* The process may already have exited. */
                    }
                }
            }
        };
        const waitForProcessGroupExit = async () => {
            if (process.platform === "win32" || !child.pid)
                return;
            const deadline = Date.now() + 1000;
            while (Date.now() < deadline) {
                try {
                    process.kill(-child.pid, 0);
                }
                catch (error) {
                    if (error.code === "ESRCH")
                        return;
                }
                await new Promise((done) => setTimeout(done, 10));
            }
        };
        const stop = () => {
            cancelled = true;
            signalProcessGroup("SIGTERM");
            forceKill ??= setTimeout(() => signalProcessGroup("SIGKILL"), 1000);
            forceKill.unref();
        };
        const cleanup = () => {
            ctx.signal?.removeEventListener("abort", stop);
            if (forceKill)
                clearTimeout(forceKill);
        };
        child.stdout.setEncoding("utf8").on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.setEncoding("utf8").on("data", (chunk) => {
            stderr += chunk;
        });
        child.once("error", (error) => {
            cleanup();
            reject(error);
        });
        child.once("close", (code, signal) => {
            // The wrapper can close its own pipes while a Codex child ignores SIGTERM.
            if (cancelled)
                signalProcessGroup("SIGKILL");
            void (cancelled ? waitForProcessGroupExit() : Promise.resolve())
                .then(() => spawnReport)
                .then(() => {
                cleanup();
                if (spawnError)
                    reject(spawnError);
                else
                    resolve({ code: code ?? 1, signal, stdout, stderr, cancelled });
            });
        });
        ctx.signal?.addEventListener("abort", stop, { once: true });
        if (typeof child.pid === "number") {
            spawnReport = Promise.resolve()
                .then(() => ctx.onSpawn?.({
                pid: child.pid,
                processGroupId: process.platform === "win32" ? null : child.pid,
                startedAt: new Date().toISOString(),
            }))
                .catch((error) => {
                spawnError = error;
                stop();
            });
        }
        if (ctx.signal?.aborted)
            stop();
        child.stdin.end();
    });
}
async function prepareTranscription(ctx, workspace) {
    const tool = configString(ctx, "transcribeTool");
    if (!tool)
        return;
    const video = configString(ctx, "sourceVideo");
    if (!isAbsolute(tool) || !isTaskArtifactFolder(workspace, video))
        throw new Error("Configure an absolute transcription tool and a video inside the assigned task folder.");
    if (!/\.(mov|mp4)$/i.test(video) || !(await stat(video)).isFile())
        throw new Error("The assigned MOV/MP4 input is missing.");
    const output = join(workspace, "analysis", "transcription");
    const receipt = join(output, "manifest.json");
    try {
        const existing = JSON.parse(await readFile(receipt, "utf8"));
        await Promise.all(["timeline.json", "transcript.json", "transcript.md"].map((name) => stat(join(output, name))));
        if (existing.source?.path !== video)
            throw new Error("Existing transcript belongs to a different video.");
        return;
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
    }
    try {
        await stat(output);
        throw new Error("Partial transcription folder exists; inspect it before retrying.");
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
    }
    await ctx.onCancellationReady?.();
    const proc = await runJson("python3", [tool, video, output, "--timestamps"], workspace, {
        ...ctx,
        onSpawn: undefined,
    });
    if (proc.cancelled)
        throw new Error("Transcription was cancelled; inspect the task folder before retrying.");
    if (proc.code !== 0)
        throw new Error(`Local transcription failed (${proc.code}): ${proc.stderr.slice(-2000)}`);
    await Promise.all(["manifest.json", "timeline.json", "transcript.json", "transcript.md"].map((name) => stat(join(output, name))));
}
export function completedRunSummary(result, taskId) {
    const execution = result.execution;
    const usage = execution?.usage;
    const accounting = result.accounting;
    const estimate = accounting?.standardApiEquivalent;
    const range = estimate?.possibleRangeUsd;
    const tokens = usage
        ? `input ${String(usage.inputTokens ?? "unknown")} (cached ${String(usage.cachedInputTokens ?? "unknown")}), output ${String(usage.outputTokens ?? "unknown")}`
        : "tokens unknown";
    const estimated = typeof estimate?.totalUsd === "string"
        ? `$${estimate.totalUsd} (range $${String(range?.lower ?? "unknown")}–${typeof range?.upper === "string" ? `$${range.upper}` : "unknown"})`
        : "unknown";
    const receipt = `Task ${taskId}; model ${String(result.model ?? "unknown")}; ${tokens}; Standard API-equivalent estimate ${estimated}; actual billed cost unknown; subscription allowance unknown. Rate snapshot ${String(estimate?.rateSnapshotId ?? "unknown")} (${String(estimate?.rateRetrievedOn ?? "unknown")}); cache-write counts unreported${estimate?.assumptions && Array.isArray(estimate.assumptions) && estimate.assumptions.length > 1 ? "; per-request context sizes unreported" : ""}.`;
    return [execution?.finalMessage, receipt].filter((part) => typeof part === "string" && part.trim()).join("\n\n");
}
export async function execute(ctx) {
    const command = configString(ctx, "executable");
    const workspace = configString(ctx, "workspace");
    const model = configString(ctx, "currentModel");
    const effortValue = configString(ctx, "currentEffort");
    const mode = configString(ctx, "mode") || "auto";
    if (!["auto", "guided", "pinned"].includes(mode))
        throw new Error("mode must be auto, guided, or pinned.");
    const sandbox = configString(ctx, "sandbox");
    if (sandbox !== "read-only" && sandbox !== "workspace-write")
        throw new Error("This adapter supports read-only or task-folder workspace-write sandboxing.");
    if (!command.startsWith("/") || !workspace.startsWith("/"))
        throw new Error("Configure absolute executable and workspace paths.");
    if (sandbox === "workspace-write" && configString(ctx, "artifactFolder") !== workspace)
        throw new Error("Writable runs require workspace to equal the assigned canonical artifact folder.");
    const reviewId = configString(ctx, "reviewId");
    const option = configString(ctx, "option");
    const reviewTaskId = configString(ctx, "reviewTaskId");
    const reviewRunId = configString(ctx, "reviewRunId");
    const currentTaskId = typeof ctx.context.issueId === "string" ? ctx.context.issueId.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(currentTaskId))
        throw new Error("An issue-scoped board wake must supply the issue UUID; generic Run now cannot dispatch t3jev.");
    if (ctx.context.taskId && ctx.context.taskId !== currentTaskId)
        throw new Error("Paperclip taskId and issueId disagree; refusing to dispatch.");
    const consumedReview = ctx.runtime.sessionParams?.consumedJevReview;
    const alreadyConsumed = consumedReview &&
        typeof consumedReview === "object" &&
        consumedReview.reviewId === reviewId &&
        consumedReview.taskId === currentTaskId &&
        consumedReview.runId === reviewRunId;
    if (reviewId && reviewTaskId === currentTaskId && !reviewRunId)
        throw new Error("Set reviewRunId from the blocked run to resume its Jev choice.");
    if (reviewId && reviewTaskId && reviewTaskId === currentTaskId && !alreadyConsumed && !option) {
        throw new Error("Set option together with reviewId to resume a reviewed Jev run.");
    }
    const resumeReview = Boolean(reviewId && option && reviewTaskId && reviewTaskId === currentTaskId && !alreadyConsumed);
    const args = ["jev", "exec"];
    let input;
    if (resumeReview) {
        args.push("--review-id", reviewId, "--expected-request-id", reviewRunId, "--option", option, "--json");
    }
    else {
        if (!model || !validEffort(effortValue))
            throw new Error("Configure currentModel and currentEffort.");
        const candidates = mode === "pinned"
            ? [{ model, efforts: [effortValue] }]
            : parseCandidates(ctx.config.candidatesJson);
        const prompt = taskPrompt(ctx, workspace, currentTaskId);
        input = {
            prompt,
            workspace,
            requestId: ctx.runId,
            current: { model, effort: effortValue },
            candidates,
            mode,
            policy: {
                sandbox,
                approval: "never",
                allowedWrites: sandbox === "workspace-write" ? [workspace] : [],
            },
        };
        args.push("--json");
    }
    let tempDirectory;
    if (!resumeReview) {
        if (sandbox === "workspace-write")
            await prepareTranscription(ctx, workspace);
        tempDirectory = await mkdtemp(join(tmpdir(), "t3jev-paperclip-"));
        const inputFile = join(tempDirectory, "request.json");
        await writeFile(inputFile, JSON.stringify(input), { mode: 0o600, flag: "wx" });
        args.push("--input-file", inputFile);
    }
    let proc;
    try {
        await ctx.onCancellationReady?.();
        if (ctx.signal?.aborted)
            return {
                exitCode: null,
                signal: null,
                timedOut: false,
                errorCode: "cancelled",
                errorMessage: "Stopped before Jev startup.",
            };
        proc = await runJson(command, args, workspace, ctx);
    }
    finally {
        if (tempDirectory)
            await rm(tempDirectory, { recursive: true, force: true });
    }
    // The structured result is attached to the run below; avoid duplicating the answer in raw logs.
    if (proc.stderr)
        await ctx.onLog("stderr", proc.stderr);
    if (proc.cancelled)
        return {
            exitCode: proc.code || 1,
            signal: proc.signal,
            timedOut: false,
            errorCode: "cancelled",
            errorMessage: "Jev execution was stopped.",
        };
    let result;
    try {
        result = JSON.parse(proc.stdout.trim());
    }
    catch {
        return {
            exitCode: proc.code || 1,
            signal: null,
            timedOut: false,
            errorMessage: "t3jev returned invalid JSON.",
        };
    }
    if (resumeReview && result.requestId !== reviewRunId)
        throw new Error("Resolved Jev review belongs to a different Paperclip run.");
    if (result.status === "review_required") {
        if (typeof result.reviewId !== "string" || !result.reviewId.trim()) {
            return {
                exitCode: 1,
                signal: null,
                timedOut: false,
                errorMessage: "t3jev returned review_required without a valid review ID.",
                resultJson: result,
            };
        }
        const options = Array.isArray(result.options) ? result.options : [];
        const optionText = options
            .map((entry) => {
            const item = entry;
            return `- ${String(item.id)}: ${String(item.label)}`;
        })
            .join("\n");
        const resume = `t3jev jev exec --review-id ${String(result.reviewId)} --expected-request-id ${ctx.runId} --option <option-id> --json`;
        const summary = `Jev review required; task was not dispatched.\n${optionText}\nResume after selection: ${resume}`;
        return {
            exitCode: 2,
            signal: null,
            timedOut: false,
            errorMessage: summary,
            summary,
            resultJson: result,
            question: {
                prompt: `Jev choice for task ${currentTaskId}, run ${ctx.runId}`,
                choices: options.map((entry) => {
                    const item = entry;
                    return { key: item.id, label: item.label };
                }),
            },
        };
    }
    if (result.status !== "completed" || proc.code !== 0) {
        return {
            exitCode: proc.code || 1,
            signal: null,
            timedOut: false,
            errorMessage: `Jev did not complete execution (status: ${String(result.status)}).`,
            resultJson: result,
        };
    }
    return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        provider: "openai",
        model: String(result.model ?? model),
        ...(result.execution?.usage
            ? {
                usage: result.execution.usage,
                usageBasis: "per_run",
            }
            : {}),
        summary: completedRunSummary(result, currentTaskId),
        resultJson: result,
        ...(resumeReview
            ? {
                sessionParams: {
                    ...ctx.runtime.sessionParams,
                    consumedJevReview: { reviewId, taskId: currentTaskId, runId: reviewRunId },
                },
            }
            : alreadyConsumed
                ? { sessionParams: ctx.runtime.sessionParams }
                : {}),
    };
}
