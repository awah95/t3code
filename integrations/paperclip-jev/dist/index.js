export const type = "t3jev";
export const label = "T3 Jev";
export const models = [{ id: "jev-routed", label: "Jev routed Codex" }];
export const agentConfigurationDoc = `# T3 Jev configuration

Requires absolute executable and workspace paths; artifactTaskId and that task's canonical artifactFolder; read-only or workspace-write sandbox; mode (pinned, auto, or guided); currentModel and currentEffort. In workspace-write mode, workspace must equal artifactFolder. An optional absolute transcribeTool plus task-local sourceVideo runs local MLX transcription on the host before Codex starts. Auto and guided also require candidatesJson. Update the task ID and artifact folder together for each new assignment. No model defaults are inferred.

For a manual run, send one board-authenticated POST /api/agents/<agent-id>/wakeup with payload.issueId set to the assigned issue UUID. Generic Run now cannot supply task markdown. Do not enable automatic wakes before clicking Run now. Guided review returns a blocked result containing options and a resume command. Set reviewId, option, reviewTaskId (the current Paperclip task ID), and reviewRunId (the blocked Paperclip run ID) in the adapter configuration, then explicitly wake that assigned task once. The adapter ignores these fields on other tasks and after the review is consumed. Keep automatic wakes disabled. The run resultJson contains Standard API-equivalent estimate and unknown actual billed cost.
`;
export { createServerAdapter } from "./server/index.js";
