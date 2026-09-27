export const type = "t3jev";
export const label = "T3 Jev";
export const models = [{ id: "jev-routed", label: "Jev routed Codex" }];
export const agentConfigurationDoc = `# T3 Jev configuration

Requires the absolute path to the fork's t3jev executable, a current Codex model and effort, and an explicit list of candidate Codex models and efforts. No model defaults are inferred.

Paperclip supplies the task context. When Jev requires review, the run returns a blocked result containing options and a resume command. Set reviewId, option, and reviewTaskId (the current Paperclip task ID) in the adapter configuration to resume that review. The adapter ignores these fields on other tasks and after the review is consumed.
`;

export { createServerAdapter } from "./server/index.js";
