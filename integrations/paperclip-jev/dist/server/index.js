import { agentConfigurationDoc, models, type } from "../index.js";
import { execute } from "./execute.js";
export function createServerAdapter() {
    return {
        type,
        models,
        agentConfigurationDoc,
        execute,
        async testEnvironment(ctx) {
            const executable = typeof ctx.config.executable === "string" ? ctx.config.executable : "";
            const workspace = typeof ctx.config.workspace === "string" ? ctx.config.workspace : "";
            const ready = executable.startsWith("/") && workspace.startsWith("/");
            return {
                adapterType: type,
                status: ready ? "pass" : "fail",
                testedAt: new Date().toISOString(),
                checks: [{ code: "jev_paths", level: ready ? "info" : "error", message: ready ? "Executable and workspace paths are absolute." : "Configure absolute t3jev executable and workspace paths." }],
            };
        },
    };
}
