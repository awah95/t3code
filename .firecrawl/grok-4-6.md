#### [Get Started](https://docs.x.ai/developers/grok-4-7#get-started)

# [Grok 4.7](https://docs.x.ai/developers/grok-4-7#grok-47)

Copy for LLM [View as Markdown](https://docs.x.ai/developers/grok-4-7.md)

[Create API key](https://console.x.ai/team/default/api-keys?utm_source=docs&utm_medium=referral&utm_campaign=developers-grok-4-7&utm_content=article-api-key) [Meet grok-4.7](https://x.ai/news/grok-4-7)

Grok 4.7 is SpaceXAI's frontier model built for coding, agentic tasks, and knowledge work.

## [Using the API](https://docs.x.ai/developers/grok-4-7#using-the-api)

If you already have an [API key](https://console.x.ai/team/default/api-keys?utm_source=docs&utm_medium=referral&utm_campaign=developers-grok-4-7&utm_content=api-keys), set the model name to `grok-4.7`:

Python JavaScriptJavaScript (OpenAI)Bash

```
import os
from xai_sdk import Client
from xai_sdk.chat import user

client = Client(api_key=os.getenv("XAI_API_KEY"))

chat = client.chat.create(model="grok-4.7")
chat.append(user("Find and fix the bug, then explain it: function median(a){a.sort();return a[a.length/2]}"))

response = chat.sample()
print(response.content)
```

```
import { xai } from '@ai-sdk/xai';
import { generateText } from 'ai';

const { text } = await generateText({
  model: xai.responses('grok-4.7'),
  prompt:
    'Find and fix the bug, then explain it: function median(a){a.sort();return a[a.length/2]}',
});

console.log(text);
```

```
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: 'https://api.x.ai/v1',
});

const response = await client.responses.create({
  model: 'grok-4.7',
  input: [\
    {\
      role: 'user',\
      content:\
        'Find and fix the bug, then explain it: function median(a){a.sort();return a[a.length/2]}',\
    },\
  ],
});

console.log(response.output_text);
```

```
curl https://api.x.ai/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -d '{
    "model": "grok-4.7",
    "input": "Find and fix the bug, then explain it: function median(a){a.sort();return a[a.length/2]}"
  }'
```

New to the xAI API? Follow the [Quickstart](https://docs.x.ai/developers/quickstart) to create an account and make your first request.

## [At a glance](https://docs.x.ai/developers/grok-4-7#at-a-glance)

| Property         | Value                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Model name       | `grok-4.7`                                                                                                                                                                                                                                                         |
| Context window   | 500,000 tokens                                                                                                                                                                                                                                                     |
| Knowledge cutoff | May 2026                                                                                                                                                                                                                                                           |
| Modalities       | Text and image input; text output                                                                                                                                                                                                                                  |
| Output limit     | No text output limit                                                                                                                                                                                                                                               |
| Input price      | $2.00 / 1M tokens                                                                                                                                                                                                                                                  |
| Output price     | $6.00 / 1M tokens                                                                                                                                                                                                                                                  |
| Reasoning        | Low, medium, high (default), or xhigh                                                                                                                                                                                                                              |
| APIs             | [Responses API](https://docs.x.ai/developers/rest-api-reference/inference/responses#create-new-response), [Chat Completions](https://docs.x.ai/developers/rest-api-reference/inference/chat-completions#chat-completions)                                          |
| Tools            | [Function calling](https://docs.x.ai/developers/tools/function-calling), [web search](https://docs.x.ai/developers/tools/web-search), [X search](https://docs.x.ai/developers/tools/x-search), [code execution](https://docs.x.ai/developers/tools/code-execution) |

Rate limits and live pricing for your team are on the [model detail page](https://docs.x.ai/developers/models/grok-4.7) and [Pricing](https://docs.x.ai/developers/pricing).

## [Important details](https://docs.x.ai/developers/grok-4-7#important-details)

- **We highly recommend setting a [`prompt_cache_key`](https://docs.x.ai/developers/advanced-api-usage/prompt-caching/maximizing-cache-hits)** (Responses API; `x-grok-conv-id` header on Chat Completions). It routes a conversation's requests to the same server, making cache hits reliable; without it you often pay full input price on a cache-cold server. See [What Breaks Caching](https://docs.x.ai/developers/advanced-api-usage/prompt-caching/multi-turn) for common mistakes.
- **Long agent loops** additionally benefit from [context compaction](https://docs.x.ai/developers/advanced-api-usage/context-compaction); for tool-heavy workloads see [function calling](https://docs.x.ai/developers/tools/function-calling).
- **Encrypted reasoning is always returned on the Responses API.** `POST /v1/responses` responses from `grok-4.7` include `reasoning.encrypted_content` even when `include` does not list it, so multi-turn conversations keep the model's reasoning without extra configuration. Pass the reasoning items back unchanged in the next request's `input`; see [Encrypted reasoning content](https://docs.x.ai/developers/model-capabilities/text/reasoning#encrypted-reasoning-content). Chat Completions is unchanged.

## [Fast variant](https://docs.x.ai/developers/grok-4-7#fast-variant)

Grok 4.7 Fast is the same model served on faster infrastructure, billed at twice the standard token rates. It is available only in Cursor and [Grok Build](https://docs.x.ai/build/overview), and it is not included in Grok Build's free tier. It is not available on the public xAI API. Rates are on the [Pricing](https://docs.x.ai/developers/pricing#grok-47-fast-pricing-cursor-and-grok-build-only) page.

## [Where it runs](https://docs.x.ai/developers/grok-4-7#where-it-runs)

- **xAI API**: get a key from the [console](https://console.x.ai/?utm_source=docs&utm_medium=referral&utm_campaign=developers-grok-4-7&utm_content=console-home)
- **US regional endpoint**: also served at [`https://us.api.x.ai/v1`](https://us.api.x.ai/v1), which keeps inference in the United States, with token usage priced at a 10% premium; see [Regional Endpoints](https://docs.x.ai/developers/advanced-api-usage/regions)
- **Grok Build**: the default model of the [coding agent](https://docs.x.ai/build/overview)
- **Cursor**: available on all plans
- **Model gateways**: OpenRouter, Vercel, and Cloudflare

## [Learn more](https://docs.x.ai/developers/grok-4-7#learn-more)

- [Reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning#the-reasoning_effort-parameter) \- controlling `reasoning_effort`, including `"xhigh"`
- [Announcement](https://x.ai/news/grok-4-7) \- launch post with demos and full benchmark figures
- [Models](https://docs.x.ai/developers/models) \- compare available models and their capabilities
- [Pricing](https://docs.x.ai/developers/pricing) \- token pricing for all models

---

Last updated: September 21, 2026
