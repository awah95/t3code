# Codex

For one account, use the default Codex provider with your normal Codex login.
[Provider setup](./install.md#providers) covers installation, Settings > Providers,
and custom binaries or environment variables.

## Jev routing in this desktop fork

Save an OpenRouter API key in **Settings > General > Jev Auto routing**, then turn
on **Jev Auto** in the chat header. Jev chooses a supported Codex model and reasoning effort in your
selected provider instance; existing conversations stay in that instance. Selecting
a model manually turns Auto off. Routing failures retain a valid selected model.

Open **Jev calls** to inspect routing requests, decisions, latency and session cost.
Guided mode reviews each user-message recommendation before dispatch. In **Jev calls**,
choose **Guided** or **Automatic**. Guided offers the recommendation, your current selection,
or another compatible model/effort pair; **Cancel send** keeps the message unsent. No
review is accepted automatically. Model selection and effort are assessed separately;
confidence describes their selection certainty, not the probability of task success.
The original recommendation remains visible when you choose a different model.

**Evaluate a prompt set** accepts the JSON companion to a routing corpus. It calls Jev
through your saved key, excludes expected answers from requests, and executes no coding
tasks. Download the results to compare recommendations with your expected ranges. It
runs at most 56 cases and checks a $0.25 stop budget between calls. Evaluation costs are
separate from the chat log; a final call can take the total over the stop amount.

The log keeps the latest 50 calls plus active requests in memory; totals also include older calls. Estimated
costs are separate from reported charges and exclude the coding model's own usage.
OpenRouter receives the full current prompt, up to ten recent user/assistant exchanges,
the original task, agreed plan, failure feedback, model profiles and available quota snapshots.
Raw tool logs, internal reasoning and attachment bodies are excluded. History omissions
are shown in the call log; oversized requests fall back without silently shortening the prompt.
Routing favors capability and expected completion quality before quota. Profile guidance is
not a measured success rate or speed benchmark. Common credential
patterns are redacted, but this is not a guarantee that all sensitive text is removed.

The separate **Codex subagent routing** control opts into a T3 session hook. Enabling
it trusts the exact generated hook through Codex's configuration API. Other hooks and
account settings remain intact. Full-history forks retain their parent's model;
independent subtasks can use Jev's selected model and effort. Child routing remains automatic
with its confidence guard, including when user-message routing is Guided. Turning routing off stops further
Jev decisions; a previously written hook trust entry may remain in Codex settings.

This MVP supports local desktop environments. Provider commands, plan follow-ups and
explicit multi-model sends retain their normal model selection. Auto and subagent
routing start off when the desktop client reloads. The API key is encrypted with the
operating system's secure storage and can be removed from Settings.

## Use multiple accounts

A shared Codex home with a shadow home lets work and personal accounts continue
the same threads. The accounts share Codex sessions and configuration while keeping
their own login and available models.

Keep your first account in `~/.codex`. On the environment's machine, sign the
second account into a fresh directory:

```bash
mkdir -p ~/.codex_personal
CODEX_HOME=~/.codex_personal codex login
```

Then add a second Codex instance in **Settings > Providers**:

| Instance       | CODEX_HOME path | Shadow home path    |
| -------------- | --------------- | ------------------- |
| Codex Work     | `~/.codex`      | Leave empty         |
| Codex Personal | `~/.codex`      | `~/.codex_personal` |

Both instances must use the same **CODEX_HOME path**. T3 Code prepares the shared
state in the shadow directory; do not populate it by copying your whole Codex
home.

The shadow account needs its own `auth.json` file. If Codex uses an OS credential
store, configure file storage for this setup. See
[OpenAI's credential storage guide](https://learn.chatgpt.com/docs/auth#credential-storage).

Use a completely separate **CODEX_HOME path**, with no shadow home, when you want
separate Codex sessions and configuration. That instance cannot continue threads
from the other home.

## Switch accounts in an existing thread

Choose the other account from the thread's model picker. T3 Code offers compatible
Codex instances that share the thread's **CODEX_HOME path**. Changing accounts does
not move the conversation into a separate Codex home.

If the account is missing from the picker, compare the home paths in provider
settings. If two instances show the same unexpected account or models, check their
reported accounts, refresh provider status, and confirm the second instance has
its own shadow path and login. A shadow-home conflict usually means the directory
contains a copied Codex setup. Use a fresh shadow directory and sign in again.

## Answer questions while Codex works

Codex can ask a question and keep working. Answer it in the thread's question
panel. The answer becomes a new message: it reaches the active turn, or starts
another turn if Codex has finished. Unanswered questions survive reconnects.
If you do not want to answer, dismiss the question from its panel. Dismissing
closes it without sending anything to Codex. This requires a Codex version that
supports async questions.

## Approve app access

Codex tools can request access to another app. Respond to the named app's request
in the thread on web, desktop, or mobile. Some tools offer access for one request,
the current session, or permanently. See [Permission modes](./permission-modes.md)
for command and file approvals.

## Codex says I hit a usage limit

When Codex stops on a usage limit, the thread names the window that ran out and
when it resets, when Codex reports them. Send the message again after the reset. On a workspace plan the
message also says whether your workspace owner needs to add credits or raise the
spend limit to continue sooner.

## Send feedback to OpenAI

In an existing Codex thread, send `/feedback` with an optional description, for
example `/feedback The agent stopped before finishing the tests`. This uploads
the conversation and Codex logs to OpenAI. The returned thread ID can be shared
with OpenAI support.
