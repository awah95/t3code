import { agentConfigurationDoc, models, type } from "../index.js";
import { execute, isTaskArtifactFolder } from "./execute.js";
export function createServerAdapter() {
    return {
        type,
        models,
        agentConfigurationDoc,
        execute,
        async testEnvironment(ctx) {
            const executable = typeof ctx.config.executable === "string" ? ctx.config.executable : "";
            const workspace = typeof ctx.config.workspace === "string" ? ctx.config.workspace : "";
            const artifactFolder = typeof ctx.config.artifactFolder === "string" ? ctx.config.artifactFolder : "";
            const artifactTaskId = ctx.config.artifactTaskId;
            const sandbox = ctx.config.sandbox;
            const mode = ctx.config.mode ?? "auto";
            const ready = executable.startsWith("/") &&
                workspace.startsWith("/") &&
                isTaskArtifactFolder(workspace, artifactFolder) &&
                typeof artifactTaskId === "string" &&
                artifactTaskId.trim().length > 0 &&
                sandbox === "read-only" &&
                (mode === "auto" || mode === "guided" || mode === "pinned");
            return {
                adapterType: type,
                status: ready ? "pass" : "fail",
                testedAt: new Date().toISOString(),
                checks: [
                    {
                        code: "jev_paths",
                        level: ready ? "info" : "error",
                        message: ready
                            ? "Paths, mode, and execution sandbox are configured."
                            : "Configure absolute executable and workspace paths, a task-bound artifact folder inside workspace, mode, and read-only sandbox.",
                    },
                ],
            };
        },
    };
}
