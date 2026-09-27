import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderPaperclipWakePrompt, selectPaperclipTaskMarkdown } from "@paperclipai/adapter-utils/server-utils";
const validEffort = (value) => ["low", "medium", "high", "xhigh"].includes(String(value));
const configString = (ctx, key) => {
    const value = ctx.config[key];
    return typeof value === "string" ? value.trim() : "";
};
const parseCandidates = (value) => {
    if (typeof value !== "string")
        throw new Error("Jev candidates must be configured as JSON.");
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((item) => !item || typeof item.model !== "string" || !item.model.trim() || !Array.isArray(item.efforts) ||
        item.efforts.length === 0 || item.efforts.some((effort) => !validEffort(effort)))) {
        throw new Error("Jev candidates must be a non-empty JSON list of {model, efforts}.");
    }
    return parsed;
};
function taskPrompt(ctx) {
    const task = selectPaperclipTaskMarkdown(ctx.context);
    if (task) {
        const wake = renderPaperclipWakePrompt(ctx.context.paperclipWake, { suppressIssueDescription: true });
        return [task, wake].filter(Boolean).join("\n\n");
    }
    throw new Error("Paperclip did not provide paperclipTaskMarkdown in the execution context.");
}
function runJson(command, args, cwd, ctx) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
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
                    catch { /* The process may already have exited. */ }
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
        child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
        child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
        child.once("error", (error) => { cleanup(); reject(error); });
        child.once("close", (code, signal) => {
            // The wrapper can close its own pipes while a Codex child ignores SIGTERM.
            if (cancelled)
                signalProcessGroup("SIGKILL");
            void (cancelled ? waitForProcessGroupExit() : Promise.resolve()).then(() => spawnReport).then(() => {
                cleanup();
                if (spawnError)
                    reject(spawnError);
                else
                    resolve({ code: code ?? 1, signal, stdout, stderr, cancelled });
            });
        });
        ctx.signal?.addEventListener("abort", stop, { once: true });
        if (typeof child.pid === "number") {
            spawnReport = Promise.resolve().then(() => ctx.onSpawn?.({
                pid: child.pid,
                processGroupId: process.platform === "win32" ? null : child.pid,
                startedAt: new Date().toISOString(),
            })).catch((error) => { spawnError = error; stop(); });
        }
        if (ctx.signal?.aborted)
            stop();
        child.stdin.end();
    });
}
export async function execute(ctx) {
    const command = configString(ctx, "executable");
    const workspace = configString(ctx, "workspace");
    const model = configString(ctx, "currentModel");
    const effortValue = configString(ctx, "currentEffort");
    if (!command.startsWith("/") || !workspace.startsWith("/"))
        throw new Error("Configure absolute executable and workspace paths.");
    const reviewId = configString(ctx, "reviewId");
    const option = configString(ctx, "option");
    const reviewTaskId = configString(ctx, "reviewTaskId");
    const taskId = [ctx.context.taskId, ctx.context.issueId].find((value) => typeof value === "string" && value.trim());
    const currentTaskId = taskId?.trim() ?? "";
    const consumedReview = ctx.runtime.sessionParams?.consumedJevReview;
    const alreadyConsumed = consumedReview && typeof consumedReview === "object" &&
        consumedReview.reviewId === reviewId &&
        consumedReview.taskId === currentTaskId;
    if (reviewId && reviewTaskId && reviewTaskId === currentTaskId && !alreadyConsumed && !option) {
        throw new Error("Set option together with reviewId to resume a reviewed Jev run.");
    }
    const resumeReview = Boolean(reviewId && option && reviewTaskId && reviewTaskId === currentTaskId && !alreadyConsumed);
    const args = ["jev", "exec"];
    let input;
    if (resumeReview) {
        args.push("--review-id", reviewId, "--option", option, "--json");
    }
    else {
        if (!model || !validEffort(effortValue))
            throw new Error("Configure currentModel and currentEffort.");
        const candidates = parseCandidates(ctx.config.candidatesJson);
        const prompt = taskPrompt(ctx);
        input = { prompt, workspace, requestId: ctx.runId, current: { model, effort: effortValue }, candidates, mode: "auto" };
        args.push("--json");
    }
    let tempDirectory;
    if (!resumeReview) {
        tempDirectory = await mkdtemp(join(tmpdir(), "t3jev-paperclip-"));
        const inputFile = join(tempDirectory, "request.json");
        await writeFile(inputFile, JSON.stringify(input), { mode: 0o600, flag: "wx" });
        args.push("--input-file", inputFile);
    }
    let proc;
    try {
        await ctx.onCancellationReady?.();
        if (ctx.signal?.aborted)
            return { exitCode: null, signal: null, timedOut: false, errorCode: "cancelled", errorMessage: "Stopped before Jev startup." };
        proc = await runJson(command, args, workspace, ctx);
    }
    finally {
        if (tempDirectory)
            await rm(tempDirectory, { recursive: true, force: true });
    }
    await ctx.onLog("stdout", proc.stdout);
    if (proc.stderr)
        await ctx.onLog("stderr", proc.stderr);
    if (proc.cancelled)
        return { exitCode: proc.code || 1, signal: proc.signal, timedOut: false, errorCode: "cancelled", errorMessage: "Jev execution was stopped." };
    let result;
    try {
        result = JSON.parse(proc.stdout.trim());
    }
    catch {
        return { exitCode: proc.code || 1, signal: null, timedOut: false, errorMessage: "t3jev returned invalid JSON." };
    }
    if (result.status === "review_required") {
        if (typeof result.reviewId !== "string" || !result.reviewId.trim()) {
            return { exitCode: 1, signal: null, timedOut: false, errorMessage: "t3jev returned review_required without a valid review ID.", resultJson: result };
        }
        const options = Array.isArray(result.options) ? result.options : [];
        const optionText = options.map((entry) => {
            const item = entry;
            return `- ${String(item.id)}: ${String(item.label)}`;
        }).join("\n");
        const resume = `t3jev jev exec --review-id ${String(result.reviewId)} --option <option-id> --json`;
        const summary = `Jev review required; task was not dispatched.\n${optionText}\nResume after selection: ${resume}`;
        return { exitCode: 2, signal: null, timedOut: false, errorMessage: summary, summary, resultJson: result };
    }
    if (result.status !== "completed" || proc.code !== 0) {
        return { exitCode: proc.code || 1, signal: null, timedOut: false, errorMessage: `Jev did not complete execution (status: ${String(result.status)}).`, resultJson: result };
    }
    return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        provider: "openai",
        model: String(result.model ?? model),
        summary: String(result.execution?.finalMessage ?? "Jev Codex turn completed."),
        resultJson: result,
        ...(resumeReview
            ? { sessionParams: { ...ctx.runtime.sessionParams, consumedJevReview: { reviewId, taskId: currentTaskId } } }
            : alreadyConsumed ? { sessionParams: ctx.runtime.sessionParams } : {}),
    };
}
