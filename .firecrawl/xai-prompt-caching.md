#### [Advanced API Usage](https://docs.x.ai/developers/advanced-api-usage/prompt-caching#advanced-api-usage)

# [Prompt Caching](https://docs.x.ai/developers/advanced-api-usage/prompt-caching#prompt-caching)

Copy for LLM [View as Markdown](https://docs.x.ai/developers/advanced-api-usage/prompt-caching.md)

[Create API key](https://console.x.ai/team/default/api-keys?utm_source=docs&utm_medium=referral&utm_campaign=developers-advanced-api-usage-prompt-caching&utm_content=article-api-key) [Meet grok-4.7](https://x.ai/news/grok-4-7)

When consecutive requests share the same starting messages, the xAI API automatically caches them. On the next request, messages at the beginning that match exactly are served from cache:

- **Faster time-to-first-token** — the model skips re-computing cached messages
- **Lower cost** — cached tokens are billed at a reduced rate

The xAI API performs prompt caching **automatically**. However, we recommend setting the `x-grok-conv-id` HTTP header to maximize your cache hit rate.

---

## [In this section](https://docs.x.ai/developers/advanced-api-usage/prompt-caching#in-this-section)

- [How It Works](https://docs.x.ai/developers/advanced-api-usage/prompt-caching/how-it-works) — Understand how caching works from the start of your messages array
- [Maximizing Cache Hits](https://docs.x.ai/developers/advanced-api-usage/prompt-caching/maximizing-cache-hits) — Set up `x-grok-conv-id` and `prompt_cache_key` for optimal caching
- [What Breaks Caching](https://docs.x.ai/developers/advanced-api-usage/prompt-caching/multi-turn) — Common mistakes that cause cache misses
- [Usage & Pricing](https://docs.x.ai/developers/advanced-api-usage/prompt-caching/usage-and-pricing) — Read cached token counts and understand billing
- [Best Practices & FAQ](https://docs.x.ai/developers/advanced-api-usage/prompt-caching/best-practices) — Tips, supported models, and common questions

---

Last updated: March 16, 2026
