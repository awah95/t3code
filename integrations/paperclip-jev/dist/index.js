export const type = "t3jev";
export const label = "T3 Jev";
export const models = [{ id: "jev-routed", label: "Jev routed Codex" }];
export const agentConfigurationDoc = `# T3 Jev configuration

Requires absolute executable and workspace paths; artifactTaskId and that task's canonical artifactFolder inside workspace; read-only sandbox; mode (pinned, auto, or guided); currentModel and currentEffort. Auto and guided also require candidatesJson. Update the task ID and artifact folder together for each new assignment. No model defaults are inferred.

Paperclip supplies the task context. Guided review returns a blocked result containing options and a resume command. Set reviewId, option, reviewTaskId (the current Paperclip task ID), and reviewRunId (the blocked Paperclip run ID) in the adapter configuration, then explicitly wake that assigned task once. The adapter ignores these fields on other tasks and after the review is consumed. Keep automatic wakes disabled.
`;
export { createServerAdapter } from "./server/index.js";
