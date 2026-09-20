import { describe, expect, it } from "vite-plus/test";
import { ProviderInstanceId } from "@t3tools/contracts";
import { JEV_HISTORY_CHAR_BUDGET } from "@t3tools/shared/jevRouting";
import { buildJevContext } from "./context";
const base = {
  current: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.6-sol",
    options: [{ id: "reasoningEffort", value: "high" }],
  },
  existingSession: true,
  interactionMode: "default",
  prompt: "continue",
};
describe("Jev context", () => {
  it("retains ten exchanges including multiple assistant messages, original goal and accepted plan", () => {
    const messages = Array.from({ length: 12 }, (_, i) => [
      { role: "user", text: `goal ${i}` },
      { role: "assistant", text: `working ${i}` },
      { role: "assistant", text: `result ${i}` },
    ]).flat();
    const context = buildJevContext({
      ...base,
      messages: [
        ...messages,
        { role: "reasoning", text: "private" },
        { role: "tool", text: "raw logs" },
      ],
      plans: [
        { planMarkdown: "approved plan", implementedAt: "2026-09-20" },
        { planMarkdown: "unapproved", implementedAt: null },
      ],
    });
    expect(context.history).toHaveLength(30);
    expect(context.historyExchangeCount).toBe(10);
    expect(context.history?.[0]?.text).toBe("goal 2");
    expect(context.originalTask).toBe("goal 0");
    expect(context.activePlan).toBe("approved plan");
    expect(context.omissions?.[0]).toContain("2 older exchanges");
  });
  it("retains explicit unresolved failure through followups and resets on success or new task", () => {
    const messages = [
      { role: "user", text: "fix the parser" },
      { role: "assistant", text: "fixed", model: "gpt-5.6-sol", effort: "medium" },
      { role: "user", text: "still broken: test parse_invalid fails" },
      { role: "assistant", text: "checking" },
    ];
    expect(buildJevContext({ ...base, messages }).failure).toMatchObject({
      unresolved: true,
      model: "gpt-5.6-sol",
      effort: "medium",
    });
    for (const prompt of ["that worked", "new task: update docs"])
      expect(buildJevContext({ ...base, messages, prompt }).failure).toBeUndefined();
  });
  it("recognizes direct failed-fix feedback", () => {
    for (const prompt of ["no this didn’t fix it", "this didn't fix it", "still not fixed"])
      expect(buildJevContext({ ...base, messages: [], prompt }).failure?.unresolved).toBe(true);
  });
  it("does not confuse preferences or environment failures with model failure", () => {
    for (const prompt of [
      "use a stronger model",
      "that didn't work: permission denied",
      "network unavailable",
      'if I say "still broken", keep the model',
      "make the button blue",
    ])
      expect(buildJevContext({ ...base, messages: [], prompt }).failure).toBeUndefined();
  });
  it("reports historical overflow while preserving newest evidence and full original task", () => {
    const original = "a".repeat(120_000);
    const context = buildJevContext({
      ...base,
      messages: [
        { role: "user", text: original },
        { role: "assistant", text: "failing test: assertion mismatch" },
      ],
    });
    expect(context.originalTask).toHaveLength(120_000);
    expect(context.history?.reduce((sum, message) => sum + message.text.length, 0)).toBe(
      JEV_HISTORY_CHAR_BUDGET,
    );
    expect(context.history?.at(-1)?.text).toContain("assertion mismatch");
    expect(context.omissions?.join()).toContain("history budget");
  });
  it("anchors an explicit new task separately from the previous goal and plan", () => {
    const messages = [
      { role: "user", text: "redesign the whole architecture" },
      { role: "user", text: "still broken" },
      { role: "user", text: "new task: fix a typo" },
    ];
    const context = buildJevContext({
      ...base,
      messages,
      plans: [{ planMarkdown: "architecture plan", implementedAt: "2026-09-19" }],
    });
    expect(context.originalTask).toBe("new task: fix a typo");
    expect(context.failure).toBeUndefined();
    expect(context.activePlan).toBeUndefined();
    expect(context.history).toHaveLength(1);
    expect(
      buildJevContext({ ...base, messages, prompt: "different task: update a label" }).originalTask,
    ).toBe("different task: update a label");
  });
  it("includes timestamped remaining usage only when a snapshot exists", () => {
    expect(buildJevContext({ ...base, messages: [] }).budget).toBeUndefined();
    expect(
      buildJevContext({
        ...base,
        messages: [],
        usageLimits: {
          checkedAt: "2026-09-20T00:00:00Z",
          windows: [{ id: "weekly", label: "Weekly", kind: "weekly", usedPercent: 70 }],
        },
      }).budget,
    ).toEqual({
      checkedAt: "2026-09-20T00:00:00Z",
      windows: [{ label: "Weekly", remainingPercent: 30 }],
    });
  });
});
