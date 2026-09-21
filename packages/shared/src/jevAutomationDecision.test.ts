import { describe, expect, it, vi } from "vite-plus/test";

import type { JevAutomationObservation } from "./jevAutomation.ts";
import {
  buildJevAutomationDecisionBody,
  createOpenRouterJevAutomationDecision,
  JEV_AUTOMATION_MODEL,
  JEV_SYSTEM_ONE_URL,
  parseJevAutomationDecision,
} from "./jevAutomationDecision.ts";

const observation: JevAutomationObservation = {
  revision: "rev-1",
  surface: "browser",
  location: "https://example.test",
  visibleText: "Email Continue",
  omissions: ["cross-origin iframe contents"],
  controls: [{ id: "email", role: "textbox", name: "Email", value: "" }],
  candidates: [
    {
      id: "fill-email",
      operation: "set-text",
      targetId: "email",
      inputId: "email-value",
      description: "Fill email",
    },
  ],
};

const input = {
  task: "Fill the email",
  observation,
  inputs: [
    {
      id: "email-value",
      kind: "text" as const,
      value: "person@example.test",
      description: "account email",
    },
  ],
  unmetConditions: [
    {
      assertion: {
        kind: "control" as const,
        targetId: "email",
        property: "value" as const,
        operator: "equals" as const,
        expected: "person@example.test",
      },
      passed: false,
      actual: "",
    },
  ],
  priorReceipts: [],
};

const answer = (choice: string) => ({
  id: "gen-1",
  model: "typesafe/jev-1.13-20260917",
  provider: "TypeSafe",
  answers: { next: { type: "choice", choice } },
  usage: { input_tokens: 516, output_tokens: 38, cost: 0.000021672 },
});

describe("Jev automation decision transport", () => {
  it("uses one finite next-action head and withholds supplied values", () => {
    const { body } = buildJevAutomationDecisionBody(input);
    expect(Object.keys(body.questions)).toEqual(["next"]);
    expect(body.questions.next.criteria).toMatchObject({
      action_0: expect.stringContaining("set-text"),
      done: expect.any(String),
      needs_novel_text: expect.any(String),
    });
    expect(body.state.unmetConditions[0]).toMatchObject({ passed: false, actual: "" });
    expect(body.state.observation).toMatchObject({ visibleText: "Email Continue" });
    expect(body.state.suppliedInputs[0]?.value).toBe("[host-held value]");
    expect(body.state.unmetConditions[0]?.assertion).toMatchObject({
      expected: "person@example.test",
    });
  });

  it("withholds adapter-derived input values from decision state", () => {
    const { body } = buildJevAutomationDecisionBody({
      ...input,
      observation: {
        ...observation,
        inputs: [{ id: "safe-enter", kind: "key", value: "Enter", description: "the Enter key" }],
      },
      inputs: [
        ...input.inputs,
        { id: "safe-enter", kind: "key", value: "Enter", description: "the Enter key" },
      ],
    });

    expect(body.state.observation.inputs?.[0]?.value).toBe("[host-held value]");
  });

  it("parses an exact action and retains official response accounting", () => {
    const { heads } = buildJevAutomationDecisionBody(input);
    expect(parseJevAutomationDecision(answer("action_0"), heads)).toEqual({
      decision: { outcome: "act", candidateId: "fill-email" },
      accounting: {
        inputTokens: 516,
        outputTokens: 38,
        costUsd: 0.000021672,
        responseModel: "typesafe/jev-1.13-20260917",
        provider: "TypeSafe",
      },
    });
  });

  it("validates only the selected single head and supports explicit handoff", () => {
    const { heads } = buildJevAutomationDecisionBody(input);
    expect(parseJevAutomationDecision(answer("done"), heads).decision).toEqual({ outcome: "done" });
    expect(
      parseJevAutomationDecision(answer("needs_visual_understanding"), heads).decision,
    ).toEqual({
      outcome: "needs-agent",
      reason: "visual-understanding",
    });
  });

  it("rejects an unknown choice while retaining charged usage", () => {
    const { heads } = buildJevAutomationDecisionBody(input);
    expect(parseJevAutomationDecision(answer("invented-action"), heads)).toMatchObject({
      decision: { outcome: "unavailable" },
      accounting: { costUsd: 0.000021672, inputTokens: 516 },
    });
  });

  it("posts the documented endpoint with an injected key that never enters the body or result", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(answer(Object.keys(sent.questions.next.criteria)[0]!)));
    });
    const client = createOpenRouterJevAutomationDecision({ apiKey: "secret-key", transport });
    const result = await client.decide({
      ...input,
      signal: new AbortController().signal,
    });
    const [url, init] = transport.mock.calls[0]!;
    expect(url).toBe(JEV_SYSTEM_ONE_URL);
    expect(init?.headers).toEqual({
      Authorization: "Bearer secret-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: JEV_AUTOMATION_MODEL });
    expect(String(init?.body)).not.toContain("secret-key");
    expect(JSON.stringify(result)).not.toContain("secret-key");
  });

  it("does not call transport after cancellation", async () => {
    const transport = vi.fn<typeof fetch>();
    const result = await createOpenRouterJevAutomationDecision({
      apiKey: "secret-key",
      transport,
    }).decide({ ...input, signal: AbortSignal.abort() });
    expect(transport).not.toHaveBeenCalled();
    expect(result.decision.outcome).toBe("unavailable");
  });
});
