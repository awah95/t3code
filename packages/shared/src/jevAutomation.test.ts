import { describe, expect, it, vi } from "vite-plus/test";

import type {
  JevAutomationAdapter,
  JevAutomationAction,
  JevAutomationAssertion,
  JevAutomationDecisionClient,
  JevAutomationObservation,
  JevAutomationVerificationResult,
} from "./jevAutomation.ts";
import { evaluateJevAutomationAssertions, runJevAutomation } from "./jevAutomation.ts";

const before: JevAutomationObservation = {
  revision: "r1",
  surface: "browser",
  location: "https://example.test/form",
  title: "Form",
  visibleText: "Name Submit",
  controls: [
    { id: "name", role: "textbox", name: "Name", value: "", disabled: false },
    { id: "submit", role: "button", name: "Submit", disabled: false },
  ],
  candidates: [
    {
      id: "fill-name",
      operation: "set-text",
      targetId: "name",
      inputId: "person-name",
      description: "Fill the name field",
    },
  ],
};

const after: JevAutomationObservation = {
  ...before,
  revision: "r2",
  controls: [
    { id: "name", role: "textbox", name: "Name", value: "Ada", disabled: false },
    { id: "submit", role: "button", name: "Submit", disabled: false },
  ],
};

const paid = { inputTokens: 12, outputTokens: 3, costUsd: 0.00002 } as const;

const verifyAgainst = (
  observation: JevAutomationObservation,
  assertions: readonly JevAutomationAssertion[],
): JevAutomationVerificationResult => ({
  results: evaluateJevAutomationAssertions(observation, assertions).map((result) => ({
    ...result,
    verdict: result.verdict ?? (result.passed ? "passed" : "failed"),
    matchCount: result.matchCount ?? 0,
    coverage: { status: "complete", searchedScopes: 1, omittedScopes: 0, omissions: [] },
    document: {
      documentId: observation.document?.documentId ?? "test-document",
      revision: observation.document?.revision ?? observation.revision,
      status: "current",
    },
  })),
});

describe("evaluateJevAutomationAssertions", () => {
  it("matches pre-observation controls by exact unique role and name", () => {
    const observation: JevAutomationObservation = {
      revision: "semantic-1",
      surface: "browser",
      controls: [
        {
          id: "e0",
          role: "textbox",
          name: "Search products",
          value: "Studio",
        },
        {
          id: "e1",
          role: "checkbox",
          name: "Include audio",
          checked: true,
        },
      ],
      candidates: [],
    };

    expect(
      evaluateJevAutomationAssertions(observation, [
        {
          kind: "control",
          target: { role: "textbox", name: "Search products" },
          property: "value",
          operator: "equals",
          expected: "Studio",
        },
        {
          kind: "control",
          target: { role: "checkbox", name: "Include audio" },
          property: "checked",
          operator: "equals",
          expected: true,
        },
        {
          kind: "control-exists",
          target: { role: "checkbox", name: "Include audio" },
        },
      ]),
    ).toMatchObject([
      { passed: true, actual: "Studio" },
      { passed: true, actual: true },
      { passed: true },
    ]);
  });

  it("never passes an ambiguous role and name match", () => {
    const observation: JevAutomationObservation = {
      revision: "semantic-duplicates",
      surface: "browser",
      controls: [
        { id: "e0", role: "checkbox", name: "Stock only", checked: true },
        { id: "e9", role: "checkbox", name: "Stock only", checked: true },
      ],
      candidates: [],
    };

    expect(
      evaluateJevAutomationAssertions(observation, [
        {
          kind: "control-exists",
          target: { role: "checkbox", name: "Stock only" },
        },
        {
          kind: "control",
          target: { role: "checkbox", name: "Stock only" },
          property: "checked",
          operator: "equals",
          expected: true,
        },
      ]),
    ).toMatchObject([
      {
        assertion: {
          kind: "control-exists",
          target: { role: "checkbox", name: "Stock only" },
        },
        passed: false,
      },
      {
        assertion: {
          kind: "control",
          target: { role: "checkbox", name: "Stock only" },
          property: "checked",
          operator: "equals",
          expected: true,
        },
        passed: false,
      },
    ]);
  });

  it("derives the uniquely selected user-facing option label", () => {
    const observation: JevAutomationObservation = {
      revision: "selected-label",
      surface: "browser",
      controls: [
        {
          id: "media-type",
          role: "combobox",
          name: "Media type",
          value: "audio",
          options: [
            { value: "image", label: "Image", selected: false },
            { value: "audio", label: "Audio", selected: true },
          ],
        },
      ],
      candidates: [],
    };

    expect(
      evaluateJevAutomationAssertions(observation, [
        {
          kind: "control",
          target: { role: "combobox", name: "Media type" },
          property: "selectedLabel",
          operator: "equals",
          expected: "Audio",
        },
      ]),
    ).toMatchObject([{ passed: true, actual: "Audio" }]);
  });

  it("fails selectedLabel when options are missing or selection is ambiguous", () => {
    const observation: JevAutomationObservation = {
      revision: "selected-label-invalid",
      surface: "browser",
      controls: [
        { id: "missing", role: "combobox", name: "Missing options", value: "audio" },
        {
          id: "ambiguous",
          role: "combobox",
          name: "Ambiguous options",
          value: "audio",
          options: [
            { value: "audio", label: "Audio", selected: true },
            { value: "music", label: "Music", selected: true },
          ],
        },
      ],
      candidates: [],
    };

    expect(
      evaluateJevAutomationAssertions(observation, [
        {
          kind: "control",
          target: { role: "combobox", name: "Missing options" },
          property: "selectedLabel",
          operator: "equals",
          expected: "Audio",
        },
        {
          kind: "control",
          target: { role: "combobox", name: "Ambiguous options" },
          property: "selectedLabel",
          operator: "equals",
          expected: "Audio",
        },
      ]),
    ).toMatchObject([{ passed: false }, { passed: false }]);
  });
});

describe("runJevAutomation", () => {
  it("fails closed when assertion-bearing automation has no independent verifier", async () => {
    const result = await runJevAutomation(
      {
        task: "Verify the saved name",
        assertions: [
          {
            kind: "control",
            targetId: "name",
            property: "value",
            operator: "equals",
            expected: "Ada",
          },
        ],
      },
      { observe: async () => ({ ...after, candidates: [] }), execute: vi.fn() },
      { decide: vi.fn() },
    );

    expect(result).toMatchObject({
      status: "needs-agent",
      reason: expect.stringContaining("independent targeted verification"),
    });
  });

  it("never turns an indeterminate verifier result into completion", async () => {
    const assertion = {
      kind: "control-exists" as const,
      target: { role: "button", name: "Save" },
    };
    const result = await runJevAutomation(
      { task: "Verify Save exists", assertions: [assertion] },
      {
        observe: async () => ({ ...after, candidates: [] }),
        verify: async () => ({
          results: [
            {
              assertion,
              verdict: "indeterminate",
              passed: false,
              reason: "One frame was not searchable.",
              matchCount: 1,
              coverage: {
                status: "partial",
                searchedScopes: 1,
                omittedScopes: 1,
                omissions: ["unsupported-frame"],
              },
              document: { documentId: "doc-1", revision: "r2", status: "current" },
            },
          ],
        }),
        execute: vi.fn(),
      },
      { decide: vi.fn() },
    );

    expect(result.status).toBe("needs-agent");
    expect(result.assertions).toMatchObject([{ verdict: "indeterminate", passed: false }]);
  });

  it("rejects verifier success without complete coverage", async () => {
    const assertion = {
      kind: "control-exists" as const,
      target: { role: "button", name: "Save" },
    };
    const result = await runJevAutomation(
      { task: "Verify Save exists", assertions: [assertion] },
      {
        observe: async () => ({ ...after, candidates: [] }),
        verify: async () => ({
          results: [
            {
              assertion,
              verdict: "passed",
              passed: true,
              matchCount: 1,
              coverage: {
                status: "partial",
                searchedScopes: 1,
                omittedScopes: 1,
                omissions: ["closed-shadow-root"],
              },
              document: { documentId: "doc-1", revision: "r2", status: "current" },
            },
          ],
        }),
        execute: vi.fn(),
      },
      { decide: vi.fn() },
    );

    expect(result).toMatchObject({
      status: "failed",
      reason: "The verifier claimed success without complete coverage.",
    });
  });

  it("executes only a host candidate, persists its proposal first, and verifies completion fresh", async () => {
    let current = before;
    const events: string[] = [];
    const adapter: JevAutomationAdapter = {
      observe: vi.fn(async () => current),
      verify: vi.fn(async ({ assertions }) => verifyAgainst(current, assertions)),
      execute: vi.fn(async ({ revision, action }) => {
        events.push(`execute:${action.candidateId}`);
        expect(revision).toBe("r1");
        expect(action).toMatchObject({
          candidateId: "fill-name",
          operation: "set-text",
          targetId: "name",
          inputId: "person-name",
          value: "Ada",
        });
        current = after;
        return { status: "executed" as const };
      }),
    };
    const decide = vi.fn<JevAutomationDecisionClient["decide"]>(async ({ unmetConditions }) => {
      expect(unmetConditions).toHaveLength(1);
      expect(unmetConditions[0]).toMatchObject({ passed: false, actual: "" });
      return { decision: { outcome: "act", candidateId: "fill-name" }, accounting: paid };
    });

    const result = await runJevAutomation(
      {
        task: "Fill the name",
        inputs: [{ id: "person-name", kind: "text", value: "Ada", description: "the name" }],
        assertions: [
          {
            kind: "control",
            targetId: "name",
            property: "value",
            operator: "equals",
            expected: "Ada",
          },
        ],
        onReceipt: (receipt) => {
          events.push(`receipt:${receipt.status}`);
        },
      },
      adapter,
      { decide },
    );

    expect(result).toMatchObject({
      status: "completed",
      decisionCalls: 1,
      executedSteps: 1,
      billedCostUsd: 0.00002,
    });
    expect(events).toEqual(["receipt:proposed", "execute:fill-name", "receipt:executed"]);
    expect(adapter.observe).toHaveBeenCalledTimes(2);
  });

  it("treats DONE without assertions as a request for independent verification", async () => {
    const result = await runJevAutomation(
      {
        task: "Check the form",
        inputs: [{ id: "person-name", kind: "text", value: "Ada", description: "the name" }],
      },
      { observe: async () => before, execute: vi.fn() },
      { decide: async () => ({ decision: { outcome: "done" }, accounting: paid }) },
    );
    expect(result.status).toBe("needs-agent");
    expect(result.reason).toContain("independent verification");
    expect(result.receipts).toHaveLength(1);
  });

  it("stops unknown billing before execution and does not present it as free", async () => {
    const execute = vi.fn();
    const result = await runJevAutomation(
      {
        task: "Fill the name",
        inputs: [{ id: "person-name", kind: "text", value: "Ada", description: "the name" }],
      },
      { observe: async () => before, execute },
      {
        decide: async () => ({
          decision: { outcome: "act", candidateId: "fill-name" },
          accounting: { inputTokens: 10, outputTokens: 2, costUsd: null },
        }),
      },
    );
    expect(result).toMatchObject({ status: "budget-exhausted", billedCostUsd: null });
    expect(execute).not.toHaveBeenCalled();
    expect(result.receipts[0]).toMatchObject({ status: "rejected", accounting: { costUsd: null } });
  });

  it("preserves an unavailable transport reason when billing is unknown", async () => {
    const result = await runJevAutomation(
      {
        task: "Fill the name",
        inputs: [{ id: "person-name", kind: "text", value: "Ada", description: "the name" }],
      },
      { observe: async () => before, execute: vi.fn() },
      {
        decide: async () => ({
          decision: { outcome: "unavailable", reason: "The Jev request failed with HTTP 503." },
          accounting: { inputTokens: null, outputTokens: null, costUsd: null },
        }),
      },
    );

    expect(result).toMatchObject({
      status: "failed",
      reason: expect.stringContaining("HTTP 503"),
      billedCostUsd: null,
    });
    expect(result.receipts[0]).toMatchObject({
      status: "unavailable",
      accounting: { costUsd: null },
    });
  });

  it("retains stale receipts and never repeats an executed action on an unchanged revision", async () => {
    const statuses = ["stale", "executed"] as const;
    const execute = vi.fn(async () => ({ status: statuses[execute.mock.calls.length - 1]! }));
    const result = await runJevAutomation(
      {
        task: "Fill the name",
        inputs: [{ id: "person-name", kind: "text", value: "Ada", description: "the name" }],
        limits: { maxSteps: 10, maxDecisionCalls: 10 },
      },
      { observe: async () => before, execute },
      {
        decide: async () => ({
          decision: { outcome: "act", candidateId: "fill-name" },
          accounting: paid,
        }),
      },
    );
    expect(result.status).toBe("needs-agent");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.receipts.filter(({ status }) => status === "stale")).toHaveLength(1);
    expect(result.receipts.at(-1)).toMatchObject({ status: "rejected" });
  });

  it("does not repeat activation when only clock text and revision changed", async () => {
    let observations = 0;
    const execute = vi.fn(async () => ({ status: "executed" as const }));
    const observe = async (): Promise<JevAutomationObservation> => {
      observations += 1;
      return {
        revision: `clock-${observations}`,
        surface: "browser",
        location: "https://example.test/checkout",
        visibleText: `Checkout ${12 + observations}:00`,
        controls: [
          { id: "email", role: "textbox", name: "Email", value: "person@example.test" },
          { id: "submit", role: "button", name: "Purchase" },
          { id: "clock", role: "status", name: "Clock", text: `${12 + observations}:00` },
        ],
        candidates: [
          {
            id: "fill-email",
            operation: "set-text",
            targetId: "email",
            inputId: "email-value",
            description: "Fill email",
          },
          {
            id: "purchase",
            operation: "activate",
            targetId: "submit",
            description: "Purchase",
          },
        ],
      };
    };
    let latestObservation: JevAutomationObservation | null = null;
    const observeForAdapter = async () => {
      latestObservation = await observe();
      return latestObservation;
    };

    const result = await runJevAutomation(
      {
        task: "Purchase",
        inputs: [
          {
            id: "email-value",
            kind: "text",
            value: "person@example.test",
            description: "email address",
          },
        ],
      },
      {
        observe: observeForAdapter,
        verify: async ({ assertions }) => {
          if (!latestObservation) throw new Error("verify called before observe");
          return verifyAgainst(latestObservation, assertions);
        },
        execute,
      },
      {
        decide: async () => ({
          decision: { outcome: "act", candidateId: "purchase" },
          accounting: paid,
        }),
      },
    );

    expect(result.status).toBe("needs-agent");
    expect(result.reason).toContain("meaningful actionable progress");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("allows activation retry after a meaningful form value edit", async () => {
    let observations = 0;
    const execute = vi.fn(async () => ({ status: "executed" as const }));
    const observe = async (): Promise<JevAutomationObservation> => {
      observations += 1;
      const value = observations === 1 ? "Studio" : "Studio Pro";
      return {
        revision: `form-${observations}`,
        surface: "browser",
        location: "https://example.test/catalog",
        visibleText: observations >= 3 ? "1 result" : `Catalog ${observations}:00`,
        controls: [
          { id: "search", role: "searchbox", name: "Search products", value },
          { id: "submit", role: "button", name: "Apply" },
          { id: "clock", role: "status", name: "Clock", text: `${observations}:00` },
        ],
        candidates: [
          {
            id: "fill-search",
            operation: "set-text",
            targetId: "search",
            inputId: "search-value",
            description: "Fill search",
          },
          {
            id: "apply",
            operation: "activate",
            targetId: "submit",
            description: "Apply filters",
          },
        ],
      };
    };
    let latestObservation: JevAutomationObservation | null = null;
    const observeForAdapter = async () => {
      latestObservation = await observe();
      return latestObservation;
    };

    const result = await runJevAutomation(
      {
        task: "Find Studio Pro",
        inputs: [
          {
            id: "search-value",
            kind: "text",
            value: "Studio Pro",
            description: "search value",
          },
        ],
        assertions: [
          {
            kind: "location",
            property: "visibleText",
            operator: "contains",
            expected: "1 result",
          },
        ],
      },
      {
        observe: observeForAdapter,
        verify: async ({ assertions }) => {
          if (!latestObservation) throw new Error("verify called before observe");
          return verifyAgainst(latestObservation, assertions);
        },
        execute,
      },
      {
        decide: async () => ({
          decision: { outcome: "act", candidateId: "apply" },
          accounting: paid,
        }),
      },
    );

    expect(result.status).toBe("completed");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("does not execute disabled controls or unavailable select options", async () => {
    const observation: JevAutomationObservation = {
      revision: "r1",
      surface: "browser",
      controls: [
        {
          id: "country",
          role: "combobox",
          options: [{ value: "eg", label: "Egypt", disabled: true }],
        },
      ],
      candidates: [
        {
          id: "choose-eg",
          operation: "select-option",
          targetId: "country",
          inputId: "country-eg",
          description: "Choose Egypt",
        },
      ],
    };
    const execute = vi.fn();
    const decisions = [
      { decision: { outcome: "act", candidateId: "choose-eg" } as const, accounting: paid },
      { decision: { outcome: "done" } as const, accounting: paid },
    ];
    const result = await runJevAutomation(
      {
        task: "Choose the country",
        inputs: [{ id: "country-eg", kind: "option", value: "eg", description: "Egypt option" }],
      },
      { observe: async () => observation, execute },
      { decide: async () => decisions.shift()! },
    );
    expect(execute).not.toHaveBeenCalled();
    expect(result.receipts[0]).toMatchObject({
      status: "rejected",
      detail: "The selected option is disabled.",
    });
  });

  it("merges adapter-derived safe inputs into decisions and action resolution", async () => {
    let complete = false;
    const observedInput = {
      id: "safe-enter",
      kind: "key" as const,
      value: "Enter",
      description: "the Enter key",
    };
    const execute = vi.fn(async ({ action }) => {
      expect(action).toMatchObject({
        candidateId: "press-enter",
        operation: "press-key",
        inputId: "safe-enter",
        value: "Enter",
      });
      complete = true;
      return { status: "executed" as const };
    });
    const decide = vi.fn<JevAutomationDecisionClient["decide"]>(async ({ inputs }) => {
      expect(inputs).toEqual([observedInput]);
      return {
        decision: { outcome: "act", candidateId: "press-enter" },
        accounting: paid,
      };
    });
    const observation = (): JevAutomationObservation => ({
      revision: complete ? "keys-2" : "keys-1",
      surface: "browser",
      visibleText: complete ? "Search complete" : "Search pending",
      inputs: [observedInput],
      controls: [],
      candidates: [
        {
          id: "press-enter",
          operation: "press-key",
          inputId: "safe-enter",
          description: "Submit with Enter",
        },
      ],
    });

    const result = await runJevAutomation(
      {
        task: "Submit the search",
        assertions: [
          {
            kind: "location",
            property: "visibleText",
            operator: "contains",
            expected: "complete",
          },
        ],
      },
      {
        observe: async () => observation(),
        verify: async ({ assertions }) => verifyAgainst(observation(), assertions),
        execute,
      },
      { decide },
    );

    expect(result.status).toBe("completed");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("binds logical navigation and desired check state only from host candidates", async () => {
    const logicalTarget = {
      kind: "environment-port" as const,
      port: 5173,
      path: "/settings",
    };
    const observations: JevAutomationObservation[] = [
      {
        revision: "navigation-1",
        surface: "browser",
        controls: [{ id: "stock", role: "checkbox", name: "Stock only", checked: false }],
        candidates: [
          {
            id: "navigate-settings",
            operation: "navigate",
            inputId: "settings-target",
            description: "Open settings",
          },
        ],
      },
      {
        revision: "check-1",
        surface: "browser",
        controls: [{ id: "stock", role: "checkbox", name: "Stock only", checked: false }],
        candidates: [
          {
            id: "check-stock",
            operation: "set-checked",
            targetId: "stock",
            checked: true,
            description: "Enable stock only",
          },
        ],
      },
      { revision: "done", surface: "browser", controls: [], candidates: [] },
    ];
    const decisions = [
      { decision: { outcome: "act", candidateId: "navigate-settings" } as const, accounting: paid },
      { decision: { outcome: "act", candidateId: "check-stock" } as const, accounting: paid },
      { decision: { outcome: "done" } as const, accounting: paid },
    ];
    const executedActions: JevAutomationAction[] = [];
    const execute = vi.fn(async ({ action }: { action: JevAutomationAction }) => {
      executedActions.push(action);
      return { status: "executed" as const };
    });
    const result = await runJevAutomation(
      {
        task: "Open settings and enable stock only",
        inputs: [
          {
            id: "settings-target",
            kind: "navigation",
            target: logicalTarget,
            description: "the settings dev server",
          },
        ],
      },
      {
        observe: async () => observations.shift()!,
        execute,
      },
      { decide: async () => decisions.shift()! },
    );

    expect(result.status).toBe("needs-agent");
    expect(executedActions[0]).toMatchObject({
      operation: "navigate",
      navigationTarget: logicalTarget,
    });
    expect(executedActions[1]).toMatchObject({
      operation: "set-checked",
      targetId: "stock",
      checked: true,
    });
  });

  it("rejects request and observation input id collisions", async () => {
    const decide = vi.fn();
    const result = await runJevAutomation(
      {
        task: "Submit the search",
        inputs: [{ id: "shared", kind: "text", value: "Studio", description: "search text" }],
      },
      {
        observe: async () => ({
          revision: "collision",
          surface: "browser",
          inputs: [{ id: "shared", kind: "key", value: "Enter", description: "Enter key" }],
          controls: [],
          candidates: [],
        }),
        execute: vi.fn(),
      },
      { decide },
    );

    expect(result).toMatchObject({
      status: "failed",
      reason: "The request supplied duplicate input ids.",
    });
    expect(decide).not.toHaveBeenCalled();
  });

  it("stops for independent verification when execution throws", async () => {
    const execute = vi.fn(async () => {
      throw new Error("connection lost after click");
    });
    const result = await runJevAutomation(
      {
        task: "Fill the name",
        inputs: [{ id: "person-name", kind: "text", value: "Ada", description: "the name" }],
      },
      { observe: async () => before, execute },
      {
        decide: async () => ({
          decision: { outcome: "act", candidateId: "fill-name" },
          accounting: paid,
        }),
      },
    );

    expect(result.status).toBe("needs-agent");
    expect(result.reason).toContain("unknown mutation outcome");
    expect(execute).toHaveBeenCalledOnce();
    expect(result.receipts.at(-1)).toMatchObject({
      status: "rejected",
      detail: expect.stringContaining("outcome is unknown"),
    });
  });

  it("honors cancellation while awaiting proposal receipt persistence", async () => {
    const controller = new AbortController();
    const execute = vi.fn();
    const result = await runJevAutomation(
      {
        task: "Fill the name",
        inputs: [{ id: "person-name", kind: "text", value: "Ada", description: "the name" }],
        signal: controller.signal,
        onReceipt: async (receipt) => {
          if (receipt.status !== "proposed") return;
          await Promise.resolve();
          controller.abort();
        },
      },
      { observe: async () => before, execute },
      {
        decide: async () => ({
          decision: { outcome: "act", candidateId: "fill-name" },
          accounting: paid,
        }),
      },
    );

    expect(result.status).toBe("cancelled");
    expect(execute).not.toHaveBeenCalled();
    expect(result.receipts.map(({ status }) => status)).toEqual(["proposed", "rejected"]);
    expect(result.receipts.at(-1)?.detail).toContain("before execution");
  });
});
