# T3 Jev Paperclip adapter

This external Paperclip adapter invokes the standalone `t3jev jev exec` command. The tested Paperclip adapter contract is `@paperclipai/adapter-utils` 2026.916.1.

## Install from this checkout

Build the package, then install its directory using [Paperclip's external adapter installation](https://docs.paperclip.ing/reference/adapters/external-adapters/) with a local path:

```sh
cd integrations/paperclip-jev
npm install
npm run build
```

Install the absolute path to `integrations/paperclip-jev`. Paperclip's local-path plugin loader loads the compiled entrypoint from `dist/`. Rebuild after source changes and reload the adapter. The package also runs its build from `prepare` during package installation.

## Agent configuration

Set these adapter fields:

- `executable`: absolute path to the `t3jev` executable
- `workspace`: absolute task workspace path
- `artifactTaskId`: the assigned Paperclip task ID; update it for each new task
- `artifactFolder`: that task's canonical artifact folder, inside `workspace`; update it together with `artifactTaskId`
- `sandbox`: `read-only` (required). The CLI passes this and `approval_policy="never"` to Codex while ignoring the user's normal Codex config. Explicit `workspace-write` policies are rejected because Codex can allow writes beyond a listed workspace. The folder field is a prompt destination, not a filesystem boundary.
- `mode`: `pinned`, `auto`, or `guided`. `pinned` uses `currentModel` and `currentEffort` without Jev routing.
- `currentModel`: current Codex model ID
- `currentEffort`: `low`, `medium`, `high`, or `xhigh`
- `candidatesJson`: required for `auto` and `guided`; JSON array such as `[ {"model":"gpt-6-sol","efforts":["low","medium"]} ]`

The task prompt comes from Paperclip's `paperclipTaskMarkdown` and current wake context. The adapter does not infer models or efforts.
The adapter forwards completed-turn input, output, and cached input tokens as per-run usage when Codex reports them. Reasoning output tokens remain in the structured CLI result because Paperclip's `UsageSummary` has no reasoning field. Codex subscription use is not a provider-billed dollar receipt. Jev routing overhead stays in `routing`; no API-equivalent estimate is sent as Paperclip `costUsd`. A billed cost event requires a separate provider receipt and deduplication by its provider ID; this adapter currently sends none. Reconcile the structured result with Codex subscription allowance separately.

## Review and resume

When Jev requires review, the adapter returns exit code 2 and a non-success Paperclip result containing the review options, a `question` payload, and a resume command. The installed contract accepts a `question`, but no verified hook returns its answer to this external adapter. Treat this as a blocked run, not an approved one. Record its task ID, run ID, and review ID; choose an option; set `reviewId`, `option`, `reviewTaskId` (the same task ID), and `reviewRunId` (the blocked run ID) in the adapter config; then explicitly wake that assigned task once. The adapter passes `reviewRunId` as `--expected-request-id`, so the CLI checks the saved request before selecting a choice or dispatching Codex. Its durable review record supplies the original prompt, workspace, and policy. Repeated submissions cannot launch another Codex turn; an interrupted result can remain `execution_unknown` and needs workspace inspection. Clear the review fields after the continuation. Keep the agent idle with automatic wakes disabled until an operator assigns a task.
