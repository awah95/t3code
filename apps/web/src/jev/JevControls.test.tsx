import { act, type ReactElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../env", () => ({ isElectron: true }));
vi.mock("./JevEvaluation", () => ({ JevEvaluation: () => null }));

import { JevControls, JevPanel } from "./JevControls";
import { useJevStore, type JevCall } from "./jevStore";

let renderer: ReactTestRenderer | undefined;

async function renderComponent(component: ReactElement) {
  await act(() => {
    renderer = create(component);
  });
  const current = renderer;
  if (!current) throw new Error("Jev component did not render");
  return current.root;
}

describe("Jev credential preflight", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    useJevStore.setState({
      enabled: false,
      mode: "guided",
      panelOpen: false,
      calls: [],
      notice: null,
      revision: 0,
      subagentsEnabled: false,
    });
  });

  afterEach(async () => {
    await act(() => renderer?.unmount());
    renderer = undefined;
    vi.unstubAllGlobals();
  });

  it("keeps Jev off and explains where to add a missing key", async () => {
    const getJevStatus = vi.fn().mockResolvedValue({ hasKey: false, secureStorageAvailable: true });
    vi.stubGlobal("window", { desktopBridge: { getJevStatus } });
    useJevStore.setState({ panelOpen: true });
    const root = await renderComponent(<JevPanel />);
    const toggle = root.findByProps({ "aria-pressed": false });

    await act(async () => toggle.props.onClick());

    expect(getJevStatus).toHaveBeenCalledOnce();
    expect(useJevStore.getState()).toMatchObject({
      enabled: false,
      panelOpen: true,
      notice: expect.stringContaining("Settings > General > Jev Auto routing"),
    });
  });

  it("turns off a restored enabled state when its key is missing", async () => {
    useJevStore.setState({ enabled: true });
    vi.stubGlobal("window", {
      desktopBridge: {
        getJevStatus: vi.fn().mockResolvedValue({ hasKey: false, secureStorageAvailable: true }),
        cancelJevRoute: vi.fn(),
      },
    });

    await renderComponent(<JevControls />);
    await act(async () => Promise.resolve());

    expect(useJevStore.getState()).toMatchObject({
      enabled: false,
      panelOpen: true,
      notice: expect.stringContaining("Settings > General > Jev Auto routing"),
    });
  });

  it("enables Jev after confirming that the encrypted key exists", async () => {
    vi.stubGlobal("window", {
      desktopBridge: {
        getJevStatus: vi.fn().mockResolvedValue({ hasKey: true, secureStorageAvailable: true }),
      },
    });
    useJevStore.setState({ panelOpen: true });
    const root = await renderComponent(<JevPanel />);
    const toggle = root.findByProps({ "aria-pressed": false });

    await act(async () => toggle.props.onClick());

    expect(useJevStore.getState().enabled).toBe(true);
  });
});

describe("Jev review presentation", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("window", { desktopBridge: {} });
  });

  afterEach(async () => {
    await act(() => renderer?.unmount());
    renderer = undefined;
    vi.unstubAllGlobals();
  });

  it("summarizes the recommendation delta and keeps policy diagnostics secondary", async () => {
    const prompt =
      "Update both pull requests from their base branches, then pull both branches locally without losing the current work.";
    const call: JevCall = {
      id: "review-1",
      createdAt: "2026-09-21T12:00:00.000Z",
      status: "awaiting-review",
      notice: null,
      request: {
        requestId: "review-1",
        prompt: prompt.repeat(4),
        candidates: [
          {
            key: "sol-low",
            model: "gpt-5.6-sol",
            effort: "low",
            description: "GPT-5.6 Sol with low effort",
          },
        ],
        context: {
          existingSession: true,
          hasAttachments: false,
          interactionMode: "default",
          currentModel: "gpt-5.6-sol",
          currentEffort: "medium",
        },
      },
      result: {
        choice: null,
        recommendedChoice: "sol-low",
        proposedChoice: "sol-low",
        confidence: 0.54,
        modelConfidence: 0.88,
        effortConfidence: 0.91,
        probabilities: {},
        latencyMs: 120,
        error: "Review the recommendation before sending.",
        inputTokens: 10,
        outputTokens: 2,
        costUsd: 0.0001,
        costKind: "billed",
        policyOutcome: "review",
        reasons: [
          "established_procedure_and_direct_check",
          "continuation_retained_model",
          "current_model_effort_adjusted",
          "uncertainty_changes_model_continuity",
        ],
        admissibleCandidateKeys: ["sol-low"],
      },
    };
    useJevStore.setState({
      enabled: true,
      mode: "guided",
      panelOpen: true,
      calls: [call],
      notice: null,
      billedUsd: 0,
      estimatedUsd: 0,
      unknownCostCalls: 0,
    });

    const root = await renderComponent(<JevPanel />);
    const rendered = JSON.stringify(renderer!.toJSON());

    expect(rendered).toContain("Keep GPT-5.6 Sol");
    expect(rendered).toContain("Medium effort → Low effort");
    expect(rendered).toContain("Why review is needed");
    expect(rendered).toContain("Show more");
    expect(rendered).not.toContain("continuation_retained_model");
    expect(root.findAllByProps({ "aria-label": "Review Jev recommendation" })).toHaveLength(1);
    expect(root.findByProps({ "data-testid": "jev-review-scroll-body" }).props.className).toContain(
      "overflow-y-auto",
    );
    expect(root.findByProps({ "data-testid": "jev-review-actions" }).props.className).toContain(
      "shrink-0",
    );
    expect(rendered).toContain("Cancel send");
  });
});
