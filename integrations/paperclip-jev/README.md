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
- `sandbox`: `read-only` or `workspace-write`. Writable runs require `workspace` and `artifactFolder` to be the same assigned task folder. The CLI passes `approval_policy="never"`, ignores user config and rules, and enables network for the Gemini tool in writable mode. Codex may still write runtime and temporary files outside the task folder; the task-folder boundary applies to business artifacts, not host bookkeeping.
- `transcribeTool` and `sourceVideo` (optional): absolute path to the existing local Transcribe script and a MOV/MP4 inside the assigned task folder. Paperclip runs transcription on the Mac host before Codex, where MLX can access Metal; complete output is reused on later runs. The script writes `analysis/transcription/` inside the task folder.
- `mode`: `pinned`, `auto`, or `guided`. `pinned` uses `currentModel` and `currentEffort` without Jev routing.
- `currentModel`: current Codex model ID
- `currentEffort`: `low`, `medium`, `high`, or `xhigh`
- `candidatesJson`: required for `auto` and `guided`; JSON array such as `[ {"model":"gpt-6-sol","efforts":["low","medium"]} ]`

The task prompt comes from Paperclip's `paperclipTaskMarkdown` and current wake context. The adapter does not infer models or efforts.
For a one-shot manual trial, bind `artifactTaskId` to the issue UUID and `artifactFolder` to its canonical folder while automatic wakes are disabled. Then issue exactly one board-authenticated `POST /api/agents/<agent-uuid>/wakeup` with JSON `{"source":"on_demand","triggerDetail":"manual","reason":"Issue-scoped manual trial","payload":{"issueId":"<issue-uuid>"}}`. Use the assigned issue's UUID, not its display key. The wake must include that exact issue's markdown in the adapter context. Do not use the generic agent “Run now” control. Enabling on-demand wakes can itself queue an assignment run; inspect issue runs before submitting another wake. T3's CLI deduplicates repeated delivery of the same run ID and leaves an interrupted dispatch unknown rather than rerunning it.
The adapter forwards completed-turn input, output, and cached input tokens as per-run usage when Codex reports them. Each successful run's visible summary includes its tokens, model, Standard API-equivalent estimate or unknown rate, and unknown actual billed cost. The structured `resultJson.accounting.standardApiEquivalent` also records the rate URL/date and a range: Codex reports whole-turn totals but not per-request context sizes or cache-write counts, so the point estimate assumes ordinary rates for unreported cache writes and standard context rates. The upper bound uses the snapshot's long-context and cache-write rates where available; an unavailable upper rate remains unknown. T3 stores the result under its Jev execution record keyed by the Paperclip run ID. Reasoning output tokens are included in output, not charged twice. Subscription allowance remains unknown without receipts. Jev routing overhead stays in `routing`; the estimate is never sent as Paperclip `costUsd`.

## Review and resume

When Jev requires review, the adapter returns exit code 2 and a non-success Paperclip result containing the review options, a `question` payload, and a resume command. The installed contract accepts a `question`, but no verified hook returns its answer to this external adapter. Treat this as a blocked run, not an approved one. Record its task ID, run ID, and review ID; choose an option; set `reviewId`, `option`, `reviewTaskId` (the same task ID), and `reviewRunId` (the blocked run ID) in the adapter config; then explicitly wake that assigned task once. The adapter passes `reviewRunId` as `--expected-request-id`, so the CLI checks the saved request before selecting a choice or dispatching Codex. Its durable review record supplies the original prompt, workspace, and policy. Repeated submissions cannot launch another Codex turn; an interrupted result can remain `execution_unknown` and needs workspace inspection. Clear the review fields after the continuation. Keep the agent idle with automatic wakes disabled until an operator assigns a task.
