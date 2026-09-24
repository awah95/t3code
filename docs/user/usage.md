# Usage and limits

## Understand your usage

**Usage** combines Codex, Claude Code, Grok Build, OpenCode, and Cursor usage from your connected
environments. It shows token use, cache savings, model breakdowns, and estimated API-equivalent
cost. These estimates are not your subscription bill.

Totals depend on the history available on each server. Grok turns without a saved completed-turn
record are missing from the totals.

OpenCode usage reads its local history database, including sessions run outside T3. It includes
child sessions. OpenCode's reported cost is a model-rate calculation, not a bill; a reported zero
can also mean OpenCode lacked pricing data. Check the model's current terms before treating a zero
as a free request. External OpenCode servers do not expose their history to this local scan.

Cursor tokens are recorded for turns run through T3 Code when Cursor supplies token counts in its
ACP response. Cursor sessions run elsewhere and turns without reported counts are not included.
Cursor cost uses a model-rate estimate when a rate is known; it is not the amount charged against
your Cursor plan. If no rate is available, the tokens remain visible with unpriced cost.
Some Cursor CLI versions omit usage from ACP responses, so those turns have no token or cost
record in Usage. Cursor's monthly allowance indicator is a separate account-level observation.

Usage includes each configured account's history, including disabled accounts. Custom homes follow
the account's home setting or its `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `GROK_HOME`, or `XDG_DATA_HOME` environment
variable. Use absolute paths or `~/` paths in the account's environment settings; relative
environment paths depend on each project's working directory and cannot be reliably discovered
by Usage. Accounts sharing a history directory count once.

On web and desktop, use the environment dropdown to filter costs, tokens, and limits. All
environments are selected by default. The dropdown shows which environments are still scanning;
results appear as each one responds.

If recent work is missing or a new model shows no cost, refresh to rescan session history and
update model pricing.

## Review Codex work by turn

Open **Usage → Codex ledger** on web, desktop, or mobile to inspect a Codex turn's reported
input, cached reads, cache writes, output, reasoning subset, and linked child work. Select a turn
to see its individual responses, including compaction when reported. Chat badges on web, desktop,
and mobile show **Own turn** usage; open a turn to compare its own estimate with the task-family
estimate including linked child work. Incomplete child linkage or active children appear beside
the family total. A missing count or
price reads **Unknown**; it does not mean zero.

The ledger's dollar figure is a **Standard API-equivalent estimate**, not a subscription charge.
If some responses lack a defensible price, the figure is marked **priced subtotal** and coverage
explains what is missing. Account allowance observations appear separately, with their reported
window and reset time. They cannot reliably assign a subscription debit to one turn while other
work may be using the same account.

Use **Export JSONL** to save the response facts, observations, tools, child links, rate snapshots,
valuations, allowance observations, Jev receipts, and experiment records together. Set a date range
when the export is large. **Pause capture** and **Resume capture** control new collection.

Under **Rate scenario**, select an earlier snapshot to restore its estimate. To override rates,
copy the current rules, give the copy a new ID and retrieval date, edit the USD rates per million
tokens and source URLs, then save and select it. Earlier rate snapshots and response facts stay
available. The chosen Standard scenario revalues historical responses; it is never a bill.

In **Optimization experiments**, name a fixed task corpus, acceptance checks, and one rate snapshot
before recording runs. Link all root turns used by each attempt, including failed work and repairs,
then record the outcome, quality verdict, and whether Jev was enabled. The report shows Codex API
cost and Jev billed or estimated overhead separately, then a combined scenario cost per accepted
case only when both are known. Missing usage, prices, work links, or quality keep the comparison
inconclusive. Paired cases are descriptive unless the study itself was randomized. The existing
**Cost** and **Tokens** tabs still use the older combined session-history view, so their Codex
totals may differ while ledger coverage is being reconciled.

## Set custom model prices

On web or desktop, open the environment dropdown on **Usage**, then choose **Model prices** to add,
edit, or reset a model's estimated price. **Apply to** starts with your current Usage filter;
choose all environments or select individual destinations. Enter the exact model ID and USD
rates per million input and output tokens. You can enter any model ID, including models
without public pricing.

Cache read and cache write rates are optional and use the input rate when blank. Enter `0` for
tokens that are free. Saved prices replace automatic pricing for all of that environment's
history and are shared with clients connected to it. When environments have different prices,
cells show **Mixed**. Edit rates directly in the table, then choose **Save changes** to apply all
edited rows. Untouched cells keep each environment's rate. Select one environment to inspect its
prices. **Reset to automatic** marks a model's override for removal when you save; you can undo
it before saving.

Each destination reports whether the change saved. Offline or unavailable environments are
marked **Not saved**. Reconnect them and choose **Retry failed saves** to finish the same change
without writing again to environments that already saved. Changes are not queued after you close
the dialog.

## Track subscription limits

**Usage → Limits** pools every subscription account it can see per provider, so with several Codex
or Claude accounts across your environments and hubs you read one number per window rather than a
list. Each window card shows how much of the pool is left and a bar with one segment per account,
kept in the same column across windows. Accounts are ordered by their 5-hour reset, soonest
first, or by the first available window when no account reports a 5-hour limit. A gap means the
account does not report that window. When the provider reports reset times, the card also says
when the next reset lands and how much it hands back. The hatched
part of a segment is what that reset restores. Tap a segment or account row for the account's plan,
where it is signed in, and its reset time. On web, you can hover too. Codex accounts with banked
reset credits show a ticket count and the **Use reset** action in the account details. On narrow screens, numbered rows below
the bar show each account's quota, countdown, and credits. Tap a row to open its details.

The same account signed in on more than one environment, or reported by a hub as well, counts once.
Filter with the environment dropdown to see what a single machine has.

Opening Limits checks the selected connected environments automatically. Each client waits at
least five minutes between automatic checks of an environment, including after a failed check.
If a window still looks stale, refresh Limits to re-check every provider and hub.

Pick `/usage-limits` from the composer's command menu, or send it as a message, to check the
current model's limits without leaving the conversation. The result opens above the composer and
closes when you dismiss it or send your next message. It uses the same snapshot as **Usage → Limits**, so it does not run the agent or refresh
anything. The command is offered only for providers that appear under **Usage → Limits**.

OpenCode Go reports its session, weekly, and monthly allowance when OpenCode runs locally in
the environment. T3 cannot report limits for external OpenCode servers because their credentials
belong to the remote server. Cursor reports
its monthly allowance, including separate Auto and API usage, using a file-based CLI login or
`CURSOR_AUTH_TOKEN`. Cursor's default macOS keychain login does not currently report limits.
On macOS, use `AGENT_CLI_CREDENTIAL_STORE=file` when signing in and in the provider's environment
to use a file-based login.

Grok reports the remaining subscription allowance and reset time for its current billing period
after signing in with `grok login`. Explicit `XAI_API_KEY` connections and custom authentication
or endpoint configurations do not report subscription limits.

API-key accounts may not report subscription limits. This also applies to Claude connections
using a proxy through `ANTHROPIC_AUTH_TOKEN`.

## Connect a CLIProxyAPI hub

To see pooled accounts, open **Settings → Providers → Usage providers → Add hub**. Choose the
environment that will connect to the hub and enter its URL and management key.

The accounts appear under **Usage → Limits**. Codex accounts show banked reset credits; select an
account and choose **Use reset** to redeem one. No hub plugin is required.

This connection supplies usage information; configure
the provider separately to send agent requests through the hub. Remove the hub from the same
settings section when you no longer need it.

## Subscription usage widget

Add **Subscription usage** from your iOS or Android widget gallery to see remaining Codex and
Claude quotas. Tap it to open **Usage → Limits**. On iOS, use **Edit Widget** to choose Session,
Weekly, or both for each provider. Reopen T3 to refresh expired readings.
