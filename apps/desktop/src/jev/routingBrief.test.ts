import { describe, expect, it } from "vite-plus/test";
import {
  compactJevDecisionBody,
  isWithinJevHardLimits,
  JEV_STATE_QUESTION_BYTE_LIMIT,
  measureJevDecisionBody,
  type JevDecisionBody,
} from "./routingBrief.ts";

const question: JevDecisionBody["questions"][string] = {
  type: "choice",
  instructions: "Choose the required capability.",
  criteria: { low: "Direct work", high: "Complex work" },
};

const body = (history: JevDecisionBody["state"]["history"]): JevDecisionBody => ({
  model: "typesafe/jev-1.13",
  state: {
    task: "Continue the current work",
    ...(history ? { history } : {}),
    omissions: [],
  },
  questions: { model: question },
});

describe("Jev routing brief compaction", () => {
  it("removes the fewest oldest intermediate assistant updates needed for the soft target", () => {
    const input = body([
      { role: "user", text: "original user requirement" },
      { role: "assistant", text: `old progress ${"a".repeat(14_000)}` },
      { role: "assistant", text: "old terminal conclusion" },
      { role: "user", text: "second user correction" },
      { role: "assistant", text: `second progress ${"b".repeat(14_000)}` },
      { role: "assistant", text: "second terminal conclusion" },
      { role: "user", text: "recent user requirement" },
      { role: "assistant", text: "recent progress must stay" },
      { role: "assistant", text: "recent terminal must stay" },
      { role: "user", text: "latest user annotation" },
      { role: "assistant", text: "latest assistant proposal" },
    ]);
    const before = JSON.stringify(input);
    const compacted = compactJevDecisionBody(input);
    const retained = compacted.state.history?.map(({ text }) => text);

    expect(retained).toEqual([
      "original user requirement",
      "old terminal conclusion",
      "second user correction",
      expect.stringMatching(/^second progress/),
      "second terminal conclusion",
      "recent user requirement",
      "recent progress must stay",
      "recent terminal must stay",
      "latest user annotation",
      "latest assistant proposal",
    ]);
    expect(compacted.state.omissions).toEqual([
      expect.stringContaining("1 intermediate assistant update from 1 older exchange"),
    ]);
    expect(JSON.stringify(input)).toBe(before);
    expect(compactJevDecisionBody(compacted)).toEqual(compacted);
    expect(measureJevDecisionBody(compacted).payloadBytes).toBeLessThan(
      measureJevDecisionBody(input).payloadBytes,
    );
  });

  it("does not discard terminal outcomes or any content from the two newest exchanges", () => {
    const protectedText = "x".repeat(40_000);
    const input = body([
      { role: "user", text: "proposal with important constraints" },
      { role: "assistant", text: protectedText },
      { role: "assistant", text: "Ready" },
      { role: "user", text: "yes, implement it" },
      { role: "assistant", text: "working" },
    ]);

    expect(compactJevDecisionBody(input)).toBe(input);
    expect(compactJevDecisionBody(input).state.history?.[1]?.text).toBe(protectedText);
    expect(isWithinJevHardLimits(input)).toBe(false);
  });

  it("preserves task state, evidence, failure details, plans, and existing omission receipts", () => {
    const input: JevDecisionBody = {
      ...body([
        { role: "user", text: "original requirement" },
        { role: "assistant", text: `old progress ${"a".repeat(30_000)}` },
        { role: "assistant", text: "old conclusion" },
        { role: "user", text: "recent correction" },
        { role: "assistant", text: "recent conclusion" },
        { role: "user", text: "latest request" },
      ]),
      state: {
        task: "latest request",
        originalTask: "original requirement",
        activePlan: "approved implementation plan",
        evidence: [{ id: "terminal-1", kind: "terminal", text: "failing assertion" }],
        failure: { unresolved: true, model: "gpt-5.6-sol", effort: "high" },
        missingContext: ["older evidence unavailable"],
        omissions: ["two older exchanges omitted upstream"],
        history: [
          { role: "user", text: "original requirement" },
          { role: "assistant", text: `old progress ${"a".repeat(30_000)}` },
          { role: "assistant", text: "old conclusion" },
          { role: "user", text: "recent correction" },
          { role: "assistant", text: "recent conclusion" },
          { role: "user", text: "latest request" },
        ],
      },
    };
    const compacted = compactJevDecisionBody(input);

    expect(compacted.state).toMatchObject({
      task: input.state.task,
      originalTask: input.state.originalTask,
      activePlan: input.state.activePlan,
      evidence: input.state.evidence,
      failure: input.state.failure,
      missingContext: input.state.missingContext,
    });
    expect(compacted.state.omissions?.[0]).toBe("two older exchanges omitted upstream");
    expect(compacted.state.omissions?.[1]).toContain("1 intermediate assistant update");
  });

  it("accepts the exact hard state envelope boundary and rejects one additional byte", () => {
    const base = body(undefined);
    const withPadding = (length: number): JevDecisionBody => ({
      ...base,
      state: { ...base.state, padding: "x".repeat(length) },
    });
    const emptyPaddingSize = measureJevDecisionBody(withPadding(0)).stateQuestionEnvelopeBytes;
    const exact = withPadding(JEV_STATE_QUESTION_BYTE_LIMIT - emptyPaddingSize);

    expect(measureJevDecisionBody(exact).stateQuestionEnvelopeBytes).toBe(
      JEV_STATE_QUESTION_BYTE_LIMIT,
    );
    expect(isWithinJevHardLimits(exact)).toBe(true);
    expect(
      isWithinJevHardLimits(withPadding(JEV_STATE_QUESTION_BYTE_LIMIT - emptyPaddingSize + 1)),
    ).toBe(false);
  });

  it("measures serialized UTF-8 bytes, including questions and protocol reserve", () => {
    const input = body([{ role: "user", text: '界😊\n"quoted"' }]);
    const measured = measureJevDecisionBody(input);
    const encoder = new TextEncoder();

    expect(measured.payloadBytes).toBe(encoder.encode(JSON.stringify(input)).length);
    expect(measured.stateBytes).toBe(encoder.encode(JSON.stringify(input.state)).length);
    expect(measured.longestQuestionBytes).toBe(encoder.encode(JSON.stringify(question)).length);
    expect(measured.stateQuestionEnvelopeBytes).toBe(
      measured.stateBytes + measured.longestQuestionBytes + 1024,
    );
    expect(measured.stateQuestionEnvelopeBytes).toBeLessThan(JEV_STATE_QUESTION_BYTE_LIMIT);
  });
});
