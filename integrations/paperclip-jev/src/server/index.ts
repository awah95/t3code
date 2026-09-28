import type { ServerAdapterModule } from "@paperclipai/adapter-utils";
import { agentConfigurationDoc, models, type } from "../index.js";
import { execute, isTaskArtifactFolder } from "./execute.js";

export function createServerAdapter(): ServerAdapterModule {
  return {
    type,
    models,
    agentConfigurationDoc,
    execute,
    async testEnvironment(ctx) {
      const executable = typeof ctx.config.executable === "string" ? ctx.config.executable : "";
      const workspace = typeof ctx.config.workspace === "string" ? ctx.config.workspace : "";
      const artifactFolder =
        typeof ctx.config.artifactFolder === "string" ? ctx.config.artifactFolder : "";
      const artifactTaskId = ctx.config.artifactTaskId;
      const sandbox = ctx.config.sandbox;
      const transcribeTool = ctx.config.transcribeTool;
      const sourceVideo = ctx.config.sourceVideo;
      const mode = ctx.config.mode ?? "auto";
      const ready =
        executable.startsWith("/") &&
        workspace.startsWith("/") &&
        isTaskArtifactFolder(workspace, artifactFolder, sandbox === "workspace-write") &&
        typeof artifactTaskId === "string" &&
        artifactTaskId.trim().length > 0 &&
        (sandbox === "read-only" ||
          (sandbox === "workspace-write" && workspace === artifactFolder)) &&
        (transcribeTool === undefined ||
          (sandbox === "workspace-write" &&
            typeof transcribeTool === "string" &&
            transcribeTool.startsWith("/") &&
            typeof sourceVideo === "string" &&
            isTaskArtifactFolder(workspace, sourceVideo))) &&
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
              : "Configure absolute paths, a task-bound artifact folder, mode, and a supported sandbox. Writable runs require workspace to equal artifactFolder.",
          },
        ],
      };
    },
  };
}
