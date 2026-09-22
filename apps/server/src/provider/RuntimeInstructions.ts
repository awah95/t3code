const PULL_REQUEST_LINKING_INSTRUCTIONS = `<pull_request_linking>
When the t3-code MCP server exposes link_pull_request, you must use it to register every pull request you create or work on for this thread. Call link_pull_request with the full PR URL immediately after creating a PR or starting work on an existing PR. For a stack, call it for every layer, not just the current branch or the top PR. This applies when creating or updating PRs through gh, gh stack, another CLI, or the host API: those operations do not register the PRs with this thread. Linking an already-linked PR is safe. Before finishing PR work, call list_thread_pull_requests and link any PR from your work that is missing. Do not link unrelated PRs mentioned only as background. If a linking call fails, report that failure instead of claiming the PR is linked.
</pull_request_linking>`;

const JEV_BROWSER_INSTRUCTIONS = `<jev_browser>
When the t3-code MCP server exposes preview_run_task, check preview_status before browser work. If jevBrowser is available and its mode is idle, prefer preview_run_task for multi-step browser tasks. Supply the task, any exact text or URLs it needs, and observable success conditions when practical. Jev chooses actions; it cannot invent text or judge screenshots. A needs-agent result is a handoff, not success: inspect the fresh state, handle the unsupported step with the ordinary preview tools, and delegate the remaining task again when appropriate. If Jev is disabled or unavailable, use the ordinary preview tools. Never repeat a possibly completed submission merely because a response was lost. The user's authorization and approval requirements still apply to every action.
When available, use preview_verify for independent assertions, preview_select for exact option selection, preview_check for a desired checked state, and preview_hover for menus. Scope semantic targets to their named container or frame when labels repeat. A compact snapshot can omit matching controls; do not infer absence or uniqueness from it. Treat indeterminate verification as a handoff. Use environment-port navigation targets for development servers on the agent's environment; localhost URLs refer to the connected browser host. Do not replace an unresolved environment target with a guessed localhost URL.
Use preview_extract for bounded structured data and preview_wait_for_assertion for state changes. Use preview_upload to select a current-thread workspace file or attachment, then verify submission separately. Use preview_download with an exact expected URL or filename and retain its completed attachment receipt. Inspect preview_dialog_status and handle only the returned dialog identity with preview_dialog. Never repeat a consequential action solely because its response or wait timed out.
</jev_browser>`;

/** Shared runtime context; omit model and effort when the harness manages them dynamically. */
export function buildRuntimeInstructions(runtime: {
  readonly harness: string;
  readonly model?: string | undefined;
  readonly reasoningEffort?: string | undefined;
  readonly browserToolsAvailable?: boolean | undefined;
}): string {
  const harness = toSingleLine(runtime.harness);
  const model = toSingleLine(runtime.model ?? "");
  const effort = toSingleLine(runtime.reasoningEffort ?? "");
  const modelInfo = model && model !== "auto" && model !== "default" ? `, as ${model}` : "";
  const effortInfo = effort ? ` with ${effort} reasoning effort` : "";
  const browserInstructions =
    runtime.browserToolsAvailable === false ? "" : `\n\n${JEV_BROWSER_INSTRUCTIONS}`;
  return `<runtime_info>In case you're asked: you are running in T3 Code through the ${harness} harness${modelInfo}${effortInfo}. No need to mention this otherwise. You can embed images and videos in your response using Markdown with absolute file paths.</runtime_info>\n\n${PULL_REQUEST_LINKING_INSTRUCTIONS}${browserInstructions}`;
}

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}
