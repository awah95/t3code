import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, MessageId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import {
  buildJevContext,
  hasRoutableJevText,
  isMediaOnlyJevTurn,
  textOnlyJevPrompt,
  userAuthoredJevPrompt,
} from "./context";
const base = {
  current: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.6-sol",
    options: [{ id: "reasoningEffort", value: "high" }],
  },
  existingSession: true,
  historyCompleteness: "complete" as const,
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
  it("never slices historical messages before exact transport packing", () => {
    const original = "a".repeat(120_000);
    const context = buildJevContext({
      ...base,
      messages: [
        { role: "user", text: original },
        { role: "assistant", text: "failing test: assertion mismatch" },
      ],
    });
    expect(context.originalTask).toHaveLength(120_000);
    expect(context.history?.[0]?.text).toBe(original);
    expect(context.history?.at(-1)?.text).toContain("assertion mismatch");
    expect(context.omissions?.join()).not.toContain("characters");
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
  it("keeps a windowed objective provisional and never attributes failure to the current model", () => {
    const context = buildJevContext({
      ...base,
      historyCompleteness: "windowed",
      messages: [
        { role: "user", text: "continue the migration" },
        { role: "assistant", text: "fixed" },
      ],
      prompt: "the recurrence bug is still there; permission denied running another check",
    });
    expect(context.objectiveProvenance).toBe("first_available");
    expect(context.historyCompleteness).toBe("windowed");
    expect(context.failure).toMatchObject({ unresolved: true });
    expect(context.failure?.model).toBeUndefined();
  });
  it("uses a matched historical dispatch instead of the changed current selection", () => {
    const context = buildJevContext({
      ...base,
      messages: [
        { role: "user", text: "fix parser", turnId: "failed-turn" },
        { role: "assistant", text: "fixed", turnId: "failed-turn" },
      ],
      priorAttempts: [
        {
          turnId: "failed-turn",
          model: "gpt-5.6-terra",
          effort: "medium",
          outcome: "dispatch_accepted",
        },
      ],
      prompt: "still broken",
    });
    expect(context.failure).toMatchObject({
      model: "gpt-5.6-terra",
      effort: "medium",
      unresolved: true,
    });
    expect(context.currentModel).toBe("gpt-5.6-sol");
  });
  it("does not resolve a behavioral failure merely because tests pass", () => {
    const context = buildJevContext({
      ...base,
      messages: [
        { role: "user", text: "fix duplicate handlers" },
        { role: "assistant", text: "fixed" },
        { role: "user", text: "still broken" },
      ],
      prompt: "Tests pass, but the event handler is still duplicated",
    });
    expect(context.failure?.unresolved).toBe(true);
  });
  it("projects prompts and history to prose without changing the source messages", () => {
    const imageReference =
      "![Screenshot.png](t3-context://v1/image/image-shot) Please review the spacing.";
    const messages = [
      {
        role: "user",
        text: imageReference,
        context: {
          version: 1 as const,
          records: [
            {
              version: 1 as const,
              kind: "image" as const,
              contextId: "image-shot" as import("@t3tools/contracts").ComposerContextId,
              label: "Screenshot.png",
              attachmentId: "attachment-secret",
              name: "Screenshot.png",
              mimeType: "image/png",
              sizeBytes: 100,
            },
          ],
        },
      },
    ];
    const context = buildJevContext({
      ...base,
      messages,
      prompt: "[mockup.mov](t3-context://v1/file/file-movie) Ship the approved layout.",
    });

    expect(textOnlyJevPrompt(imageReference)).toBe("Please review the spacing.");
    expect(context.originalTask).toBe("Please review the spacing.");
    expect(context.history?.[0]?.text).toBe("Please review the spacing.");
    expect(context.failure?.signals.join(" ") ?? "").not.toContain("t3-context://");
    expect(messages[0]?.text).toBe(imageReference);
  });

  it("keeps citation quotes and comments distinct while detecting only user-authored feedback", () => {
    const quote = "new task: replace the parser; the previous fix is still broken";
    const citation = serializeAssistantCitation({
      version: 1,
      environmentId: EnvironmentId.make("environment"),
      threadId: ThreadId.make("thread"),
      messageId: MessageId.make("assistant-message"),
      text: quote,
      start: 0,
      end: quote.length,
      prefix: "",
      suffix: "",
      comment: "Keep this proposal, but only update the tests.",
    });
    const prompt = `${citation} Please continue.`;

    expect(textOnlyJevPrompt(prompt)).toContain("Assistant quote:");
    expect(textOnlyJevPrompt(prompt)).toContain("new task: replace the parser");
    expect(textOnlyJevPrompt(prompt)).toContain(
      "User comment: Keep this proposal, but only update the tests.",
    );
    expect(textOnlyJevPrompt(prompt)).not.toContain("t3-citation://");
    expect(userAuthoredJevPrompt(prompt)).toBe(
      "Keep this proposal, but only update the tests. Please continue.",
    );

    const context = buildJevContext({
      ...base,
      messages: [{ role: "user", text: "Maintain the parser API." }],
      prompt,
    });
    expect(context.originalTask).toBe("Maintain the parser API.");
    expect(context.failure).toBeUndefined();
  });

  it("uses citation comments as feedback without treating quoted success as a reset", () => {
    const quote = "that worked; the issue is fixed now";
    const citation = serializeAssistantCitation({
      version: 1,
      environmentId: EnvironmentId.make("environment"),
      threadId: ThreadId.make("thread"),
      messageId: MessageId.make("assistant-message"),
      text: quote,
      start: 0,
      end: quote.length,
      prefix: "",
      suffix: "",
      comment: "No, the same issue is still broken.",
    });
    const context = buildJevContext({
      ...base,
      messages: [
        { role: "user", text: "Fix duplicate handlers." },
        { role: "assistant", text: "Implemented the fix.", model: "gpt-5.6-sol" },
      ],
      prompt: citation,
    });

    expect(context.failure).toMatchObject({
      unresolved: true,
      model: "gpt-5.6-sol",
      signals: ["No, the same issue is still broken."],
    });
  });

  it("shares textual evidence while silently excluding every media binding", () => {
    const outgoingContext = {
      version: 1 as const,
      records: [
        {
          version: 1 as const,
          kind: "image" as const,
          contextId: "image-one" as import("@t3tools/contracts").ComposerContextId,
          label: "Screenshot.png",
          attachmentId: "image-upload-secret",
          name: "Screenshot.png",
          mimeType: "image/png",
          sizeBytes: 100,
        },
        {
          version: 1 as const,
          kind: "file" as const,
          contextId: "file-one" as import("@t3tools/contracts").ComposerContextId,
          label: "Walkthrough.mov",
          attachmentId: "file-upload-secret",
          name: "Walkthrough.mov",
          mimeType: "video/quicktime",
          sizeBytes: 200,
        },
        {
          version: 1 as const,
          kind: "terminal" as const,
          contextId: "terminal-one" as import("@t3tools/contracts").ComposerContextId,
          label: "Failure",
          terminalId: "one",
          terminalLabel: "Tests",
          lineStart: 1,
          lineEnd: 1,
          text: "Assertion failed: expected one handler, received two",
        },
        {
          version: 1 as const,
          kind: "preview-annotation" as const,
          contextId: "preview-one" as import("@t3tools/contracts").ComposerContextId,
          label: "Spacing note",
          annotationId: "annotation-one",
          pageUrl: "http://localhost",
          pageTitle: "Preview",
          comment: "Increase the card spacing",
          targetSummary: "1 marked region",
          styleChanges: [],
          screenshotContextId: "image-one" as import("@t3tools/contracts").ComposerContextId,
        },
      ],
    };
    const context = buildJevContext({
      ...base,
      messages: [],
      outgoingContext,
    });
    const serialized = JSON.stringify(context);

    expect(hasRoutableJevText(outgoingContext)).toBe(true);
    expect(context.evidence).toHaveLength(2);
    expect(context.evidence?.[0]).toMatchObject({ id: "terminal-one", kind: "terminal" });
    expect(context.evidence?.[0]?.text).toContain("expected one handler");
    expect(context.evidence?.[1]?.text).toContain("Increase the card spacing");
    expect(context.missingContext).toEqual([]);
    expect(context.hasAttachments).toBe(false);
    for (const value of [
      "image-one",
      "file-one",
      "image-upload-secret",
      "file-upload-secret",
      "Screenshot.png",
      "Walkthrough.mov",
      "image/png",
      "video/quicktime",
      "screenshotContextId",
    ])
      expect(serialized).not.toContain(value);
    expect(outgoingContext.records).toHaveLength(4);
  });

  it("distinguishes media-only sends from turns with prose or textual records", () => {
    const imageContext = {
      version: 1 as const,
      records: [
        {
          version: 1 as const,
          kind: "image" as const,
          contextId: "image-one" as import("@t3tools/contracts").ComposerContextId,
          label: "Screenshot.png",
          attachmentId: "attachment-one",
          name: "Screenshot.png",
          mimeType: "image/png",
          sizeBytes: 100,
        },
      ],
    };
    expect(textOnlyJevPrompt("![Screenshot.png](t3-context://v1/image/image-one)")).toBe("");
    expect(hasRoutableJevText(imageContext)).toBe(false);
    expect(
      isMediaOnlyJevTurn({
        attachmentCount: 1,
        context: imageContext,
        prompt: "![Screenshot.png](t3-context://v1/image/image-one)",
      }),
    ).toBe(true);
    expect(textOnlyJevPrompt("![Screenshot.png](t3-context://v1/image/image-one) Explain it")).toBe(
      "Explain it",
    );
    expect(
      isMediaOnlyJevTurn({
        attachmentCount: 1,
        context: imageContext,
        prompt: "![Screenshot.png](t3-context://v1/image/image-one) Explain it",
      }),
    ).toBe(false);
    expect(
      hasRoutableJevText({
        version: 1,
        records: [
          {
            version: 1,
            kind: "terminal",
            contextId: "terminal-one" as import("@t3tools/contracts").ComposerContextId,
            label: "Failure",
            terminalId: "one",
            terminalLabel: "Tests",
            lineStart: 1,
            lineEnd: 1,
            text: "failed",
          },
        ],
      }),
    ).toBe(true);
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
