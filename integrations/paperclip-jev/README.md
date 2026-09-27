# T3 Jev Paperclip adapter

This external Paperclip adapter invokes the `t3jev jev exec` command. It requires a built T3 Jev CLI on the Paperclip host and runs Codex using that host's normal Codex configuration.

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
- `currentModel`: current Codex model ID
- `currentEffort`: `low`, `medium`, `high`, or `xhigh`
- `candidatesJson`: JSON array such as `[ {"model":"gpt-6-sol","efforts":["medium","high"]} ]`

The task prompt comes from Paperclip's `paperclipTaskMarkdown` and current wake context. The adapter does not infer models or efforts.
The adapter returns the Jev routing result, including its reported or estimated routing cost, but no Codex execution dollar value.

## Review and resume

When Jev requires review, the adapter returns exit code 2 and a non-success Paperclip result containing the review options and a `t3jev jev exec --review-id … --option … --json` resume command. No Codex turn is dispatched before a selection. Paperclip's generic adapter result does not create clickable approval choices, so a person or orchestration layer must select an option and set `reviewId`, `option`, and `reviewTaskId` (the current Paperclip task ID) in the adapter config for a later invocation. The CLI's saved review record supplies the original prompt and workspace during resume. The adapter ignores these fields on a different task. After a successful resume, its Paperclip session state marks the review consumed so a later wake on the same task starts a new request. Keep the review fields scoped to one task and clear them when the review is finished.
