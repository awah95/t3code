import { describe, expect, it, vi } from "vite-plus/test";
import type { JevRouteRequest } from "@t3tools/contracts";
import {
  buildJevDecisionBody,
  JEV_MODEL,
  parseJevDecision,
  requestJevDecision,
} from "./decision.ts";

const request: JevRouteRequest = {
  requestId: "test-request",
  prompt: "Review a small documentation change",
  candidates: [
    { key: "fast", description: "Fast model" },
    { key: "strong", description: "Deep reasoning" },
  ],
  context: { existingSession: false, hasAttachments: false, interactionMode: "default" },
};
const responseBody = () => ({
  model: "jev-1.13.0",
  answers: {
    route: {
      type: "choice",
      choice: "fast",
      confidence: 0.8,
      probabilities: { fast: 0.9, strong: 0.1 },
    },
  },
  usage: { input_tokens: 1000, output_tokens: 20 },
});
const parse = (body: unknown) => parseJevDecision(body, ["fast", "strong"], 123);

describe("Jev decision validation and accounting", () => {
  it("accepts the underlying model version and estimates usage separately from billing", () => {
    expect(parse(responseBody())).toMatchObject({
      choice: "fast",
      latencyMs: 123,
      costKind: "estimated",
      costUsd: 0.000042,
      inputTokens: 1000,
    });
  });
  it("uses reported cost including a legitimate zero", () => {
    const body = responseBody();
    expect(parse({ ...body, usage: { ...body.usage, cost: 0.001 } })).toMatchObject({
      costKind: "billed",
      costUsd: 0.001,
    });
    expect(parse({ ...body, usage: { cost: 0 } })).toMatchObject({
      costKind: "billed",
      costUsd: 0,
    });
  });
  it("does not turn missing or invalid usage into free calls", () => {
    expect(parse({ ...responseBody(), usage: undefined })).toMatchObject({
      costKind: "unknown",
      costUsd: null,
    });
    expect(
      parse({ ...responseBody(), usage: { input_tokens: -1, cost: Number.NaN } }),
    ).toMatchObject({ costKind: "unknown", costUsd: null });
  });
  it("rejects a choice outside the candidate pool but retains accounting", () => {
    const body = responseBody();
    body.answers.route.choice = "unconfigured-model";
    expect(parse(body)).toMatchObject({ choice: null, costKind: "estimated", inputTokens: 1000 });
  });
  it.each([
    { fast: 0.9 },
    { fast: 0.9, strong: 0.9 },
    { fast: -0.1, strong: 1.1 },
    { fast: 0.2, strong: 0.8 },
    { fast: 0.9, strong: 0.1, unexpected: 0 },
  ])("rejects an incomplete or inconsistent distribution %j", (probabilities) => {
    const body = responseBody();
    expect(
      parse({ ...body, answers: { route: { ...body.answers.route, probabilities } } }).choice,
    ).toBeNull();
  });
  it("falls back on low confidence without hiding a paid call", () => {
    const body = responseBody();
    body.answers.route.confidence = 0.3;
    expect(parse(body)).toMatchObject({ choice: null, confidence: 0.3, costKind: "estimated" });
  });
  it("rejects malformed responses without throwing", () => {
    for (const body of [null, [], "oops", {}, { model: JEV_MODEL, answers: null }]) {
      expect(parse(body)).toMatchObject({ choice: null, costKind: "unknown" });
    }
  });
});

describe("Jev OpenRouter transport", () => {
  it("provides full current task, recent context, model profiles and capability-first policy", () => {
    const body = buildJevDecisionBody(
      {
        ...request,
        prompt: "x".repeat(13_000) + " decisive requirement",
        candidates: [
          {
            key: "astra_medium",
            description: "Astra medium",
            model: "gpt-6-astra",
            effort: "medium",
          },
        ],
        context: {
          ...request.context,
          originalTask: "Fix scheduling",
          activePlan: "Preserve invariants",
          history: [{ role: "assistant", text: "The last test still failed." }],
          budget: {
            checkedAt: "2026-09-20T00:00:00Z",
            windows: [{ label: "Weekly", remainingPercent: 20 }],
          },
        },
      },
      Date.parse("2026-09-20T00:10:00Z"),
    );
    expect(body.state.task).toHaveLength(13_021);
    expect(body.state.originalTask).toBe("Fix scheduling");
    expect(body.state.routingPolicy.profiles.map((profile) => profile.model)).toEqual([
      "gpt-6-astra",
    ]);
    expect(body.state.budgetStatus).toContain("stale");
    expect(body.questions.model!.instructions).toContain("lowest expected total");
  });
  it("blocks an unresolved failure downgrade while retaining charged usage", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const sent = JSON.parse(String(init?.body));
      const answers = Object.fromEntries(
        Object.entries(sent.questions).map(([key, value]) => {
          const question = value as { criteria: Record<string, string> };
          const keys = Object.keys(question.criteria);
          return [
            key,
            {
              type: "choice",
              choice: keys[0],
              confidence: 0.9,
              probabilities: Object.fromEntries(
                keys.map((entry) => [entry, entry === keys[0] ? 1 : 0]),
              ),
            },
          ];
        }),
      );
      return new Response(
        JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 1000 } }),
      );
    });
    const result = await requestJevDecision(
      {
        ...request,
        candidates: [
          { key: "fast", description: "Luna high", model: "gpt-5.6-luna", effort: "high" },
          { key: "strong", description: "Sol high", model: "gpt-5.6-sol", effort: "high" },
        ],
        context: {
          ...request.context,
          failure: {
            unresolved: true,
            signals: ["still broken"],
            model: "gpt-5.6-sol",
            effort: "medium",
          },
        },
      },
      "key",
      new AbortController().signal,
      transport,
    );
    expect(result).toMatchObject({ choice: null, inputTokens: 1000, costKind: "estimated" });
    expect(result.error).toContain("downgrade");
  });
  it("does not send silently truncated oversized input", async () => {
    const transport = vi.fn<typeof fetch>();
    const result = await requestJevDecision(
      { ...request, prompt: "x".repeat(240_001) },
      "key",
      new AbortController().signal,
      transport,
    );
    expect(transport).not.toHaveBeenCalled();
    expect(result.error).toContain("No task text was silently truncated");
  });
  it("uses the decision endpoint and keeps the key out of the body and result", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(responseBody())));
    const result = await requestJevDecision(
      request,
      "test-secret",
      new AbortController().signal,
      transport,
    );
    const [url, init] = transport.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(init?.headers).toEqual({
      Authorization: "Bearer test-secret",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: JEV_MODEL,
      state: { task: request.prompt },
      questions: {
        route: { type: "choice", criteria: { fast: "Fast model", strong: "Deep reasoning" } },
      },
    });
    expect(String(init?.body)).not.toContain("test-secret");
    expect(JSON.stringify(result)).not.toContain("test-secret");
  });
  it("does not call the provider when already cancelled", async () => {
    const transport = vi.fn<typeof fetch>();
    const result = await requestJevDecision(request, "test-secret", AbortSignal.abort(), transport);
    expect(transport).not.toHaveBeenCalled();
    expect(result.choice).toBeNull();
  });
  it("does not expose provider error bodies or transport errors", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("test-secret", { status: 401 }))
      .mockRejectedValueOnce(new Error("test-secret"));
    for (let count = 0; count < 2; count++) {
      const result = await requestJevDecision(
        request,
        "test-secret",
        new AbortController().signal,
        transport,
      );
      expect(result.choice).toBeNull();
      expect(JSON.stringify(result)).not.toContain("test-secret");
    }
  });
  it("handles malformed JSON and oversized responses as fallback", async () => {
    for (const body of ["not-json", "x".repeat(100_001)]) {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
      expect(
        (await requestJevDecision(request, "key", new AbortController().signal, transport)).choice,
      ).toBeNull();
    }
  });
});
