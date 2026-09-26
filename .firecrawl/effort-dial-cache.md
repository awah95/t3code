Last week, Anthropic's [guide to choosing a model and effort level in Claude Code](https://claude.com/blog/claude-model-and-effort-level-in-claude-code) was doing the rounds on r/ClaudeAI. I asked Fable to work out how those levels interact with the prompt cache, posted its answer as a comment, and watched that comment get more attention than anything else I've put there. The subreddit's summary bot called it a "seriously helpful deep dive", which I'm choosing to accept as a compliment from a robot.

This is the tidied version, checked against the docs and expanded with the best points from the replies.

![A vintage amplifier with a large EFFORT knob, a hand reaching to turn it, a warning note reading TURNING THIS VOIDS YOUR CACHE, and a long receipt spilling onto the floor](https://haraldmaassen.com/devblog/posts/2026-09-20-the-effort-dial-the-cache-and-the-five-minute-subagent/images/effort-dial.png)

_Every notch on the dial has a price. Most of it appears on the receipt._

## The cache only works while the prefix stays put

Claude Code re-sends your entire conversation with every request. Prompt caching stops that from becoming ruinous: the API matches the start of each request against what it just processed, then bills the matching part at about a tenth of the normal input price. I wrote more about the difference this makes in [Your context is burning more tokens than you think](https://haraldmaassen.com/devblog/post/your-context-is-burning-more-tokens-than-you-think).

It is a prefix match. Change something near the top of the request and everything after it has to be processed again at full price. Two settings you might not expect sit near the top: the model and the effort level.

## Turn the effort dial mid-session and you rebuild the cache

On most models, each effort level has its own cache. Switch from `high` to `medium` two hours into a conversation and the next request reads the entire history with zero cache hits. You pay to rebuild it. Switching models does the same thing.

Fable 5.1 is the exception. With an API key or a Claude subscription, you can change effort on Fable without losing the cache, and Claude Code applies the new level without asking. The API feature behind this is in beta for Opus 5 too, so I expect it to reach Claude Code eventually. It does not apply on Bedrock, Vertex, or through a gateway.

One person in the replies had been switching constantly: plan with Opus, lower the effort for implementation, then move to Sonnet for follow-up questions, all in the same session. Every switch forced a full re-read.

They asked whether the answer was simply to choose one setting and keep it. Yes, but separate sessions are better. Let the Opus planner write its plan to a Markdown file, which it does anyway. Then start a new session, or use `/clear`, choose the model and effort you want, and tell it to implement the plan. Two people in the thread described exactly that handoff. A third had the high-effort planner direct a lower-effort subagent to do the work. That is the same idea inside one session, since subagents have their own cache.

The terminal warns you before an effort or model switch while the cache is still warm. The Desktop app does not. I use Desktop, so I only learnt this when someone in the replies pointed out that the CLI "quite literally warns you".

## Ultracode is a workflow instruction wearing an effort label

Ultracode looks like an effort level. It sits at the top of the `/effort` slider, above `max`. What it actually sends is `xhigh` plus an instruction to orchestrate dynamic workflows, which means spawning a lot of subagents. That is all.

This has two consequences. If you are already on `xhigh`, switching to ultracode is free. On Fable, it is free from any level because of the exception above.

You do not need the setting to get the workflow. Type `ultracode` anywhere in a prompt and Claude creates one for that task without changing the session's effort. Saying "use a workflow" in plain English does the same thing. I prefer that version because it does not sound like a setting.

Someone asked whether "use a workflow" affects only the current prompt or every prompt after it. The keyword applies to one prompt. The `/effort ultracode` setting applies to the whole session.

## Ultrathink leaves the effort dial alone

There is also `ultrathink`, with _think_ on the end. It is a keyword you type in a prompt. All it does is add an instruction asking the model to think harder, the same as if you had typed "think hard" or "think more" yourself. The effort level does not change.

That kind of prompting is an old technique. Newer models work out for themselves how hard a problem needs, so telling them to think harder does not help much and can even make things worse. Effort is the real control now. Ultrathink is a relic. Pretend I did not bring it up.

## Sometimes lower effort is the bug fix

Higher is not always better. Some of Claude's most annoying habits are forms of rabbit-holing: verifying the same thing three ways, exploring half the codebase for a one-line change, or looping on a problem it should have abandoned. Lowering the effort level fixes a lot of that.

It can also make Claude give up too soon on a genuinely difficult problem. And plenty of rabbit-holing is really a prompting problem. If your prompt was vague, more effort may just produce a more thoroughly built version of the wrong thing, as one reply put it. Fix the prompt first. Then turn the dial.

## Your subagents inherit the expensive setting

This matters once you use workflows. Spawn twenty subagents from an `xhigh` session and you get twenty `xhigh` subagents.

A subagent definition can override that with an `effort:` line in its frontmatter. Someone in the replies pointed this out, and the original poster confirmed it with a [link to the docs](https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields). If you have a fleet of agents doing mechanical work, give them a lower effort level instead of inheriting the expensive one.

Workflow agents that share a model, effort level, tools, and working directory also share a cache prefix. Claude Code holds back all but the first agent in a fan-out for a few seconds, allowing the rest to read the cache the first one built. Then the five-minute clock enters the picture.

## A subagent's cache lasts five minutes

Your main conversation keeps its cache for an hour when you are using a Claude subscription inside your plan's included usage. With an API key, a cloud provider, or usage credits, it drops to five minutes. Buyer beware.

Subagents get five minutes, even on a subscription.

I often start a Fable session and tell it to spawn subagents for everything in the backlog. Later, I notice that a couple look stuck and ask what is holding them up. Fable says, "oh, that agent was waiting on something, let me give it a nudge." That nudge costs a fortune if the agent has been idle for more than five minutes, because its entire conversation must be cached again from scratch.

The clock starts when the subagent goes idle, not when it starts. Most are sent to do one job and never sit still long enough for this to matter. Sometimes they do, whether because a tool call takes a long time to return or because the main agent goes back to a finished subagent for one more piece of work. Someone asked whether this affects a long-running but uninterrupted subagent task. It does not. Caching changes cost and speed, never the result.

My general rule is not to wake old subagents. Spawn fresh ones. A new agent has overhead too, so the choice depends on how much work the old one had already done, but new is usually cheaper. One commenter puts the rule straight into the orchestrator prompt: "Do not let subagents wait around for more than 5 minutes." I like that.

If you want the hour, `subagentPromptCacheTtl` in `settings.json` sets the TTL for everything outside the main conversation. An individual agent definition can instead set `experimental: cacheTtl: 1h`. The hour is not free: a one-hour cache write costs twice the base input rate, compared with 1.25x for five minutes. For agents that do one thing and exit, the default is right.

## `/usage` tells you whether the cache survived

Run `/usage`. After the first response, you will see a "Prompt cache (main)" line showing the hit rate, the number of misses, and whether the cache is warm. You want the hit rate around 98 or 99 percent. When the cache misses, recent versions name the likely cause, such as "tool definitions changed". If you have been changing MCP servers mid-session, that is another dial you did not know you were turning.

This is what each outcome costs:

| Tokens                         | Price relative to normal input |
| ------------------------------ | ------------------------------ |
| Read from cache                | 0.1x                           |
| Written to cache, 5 minute TTL | 1.25x                          |
| Written to cache, 1 hour TTL   | 2x                             |
| Cache miss                     | Full price, then written again |

## Set the dial once, then leave it alone

Choose your model and effort level at the start of the session. If the task changes shape, hand it off through a file to a new session instead of retuning the old one. If a subagent has been quiet for more than five minutes, let it go.

And if you were wondering, the thread settled the matter: the correct term is Le Mans.

The Claude Code docs this was checked against: [prompt caching](https://code.claude.com/docs/en/prompt-caching), [effort levels](https://code.claude.com/docs/en/model-config#adjust-effort-level), [dynamic workflows](https://code.claude.com/docs/en/workflows) and [subagents](https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields). The original thread is [here](https://www.reddit.com/r/ClaudeAI/comments/1wkg2w8/comment/parbc5s/?context=3).

_Written by Claude as dictated by Harald and edited by ChatGPT._

## Comments (0)

No comments yet. Be the first!

Website

Name

Comment

Post Comment
