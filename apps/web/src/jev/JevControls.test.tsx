import { act, type ReactElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../env", () => ({ isElectron: true }));
vi.mock("./JevEvaluation", () => ({ JevEvaluation: () => null }));

import { JevComposerReview, JevControls, JevPanel } from "./JevControls";
import { useJevStore, type JevCall } from "./jevStore";

let renderer: ReactTestRenderer | undefined;
const scope = { environmentId: "env", threadId: "thread" };

async function renderComponent(component: ReactElement) {
  await act(async () => {
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
      modesByThread: {},
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
    const root = await renderComponent(<JevPanel scope={scope} />);
    const selector = root.findByProps({ "aria-label": "Jev routing mode" });

    await act(async () => selector.parent!.props.onValueChange("guided"));

    expect(getJevStatus).toHaveBeenCalledOnce();
    expect(useJevStore.getState()).toMatchObject({
      modesByThread: {},
      panelOpen: true,
      notice: expect.stringContaining("Settings > General > Jev Auto routing"),
    });
  });

  it("turns off a restored enabled state when its key is missing", async () => {
    useJevStore.getState().setThreadMode("env", "thread", "guided");
    vi.stubGlobal("window", {
      desktopBridge: {
        getJevStatus: vi.fn().mockResolvedValue({ hasKey: false, secureStorageAvailable: true }),
        cancelJevRoute: vi.fn(),
      },
    });

    await renderComponent(<JevControls scope={scope} />);
    await act(async () => Promise.resolve());

    expect(useJevStore.getState()).toMatchObject({
      modesByThread: {},
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
    const root = await renderComponent(<JevPanel scope={scope} />);
    const selector = root.findByProps({ "aria-label": "Jev routing mode" });

    await act(async () => selector.parent!.props.onValueChange("auto"));

    expect(useJevStore.getState().getThreadMode("env", "thread")).toBe("auto");
    await act(async () => selector.parent!.props.onValueChange("off"));
    expect(useJevStore.getState().getThreadMode("env", "thread")).toBe("off");
  });

  it("shows the active main chat's status rather than another chat's status", async () => {
    vi.stubGlobal("window", {
      desktopBridge: { getJevStatus: vi.fn().mockResolvedValue({ hasKey: true }) },
    });
    useJevStore.getState().setThreadMode("env", "thread", "guided");
    const root = await renderComponent(
      <JevControls scope={{ environmentId: "env", threadId: "other-thread" }} />,
    );
    expect(root.findByProps({ "aria-label": "Jev routing: off" })).toBeDefined();
    expect(useJevStore.getState().getThreadEnabled("env", "thread")).toBe(true);
    expect(useJevStore.getState().getThreadEnabled("env", "other-thread")).toBe(false);
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
      receiptContext: { environmentId: "env", projectId: "project", threadId: "thread" },
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
      modesByThread: { [JSON.stringify(["env", "thread"])]: "guided" },
      panelOpen: true,
      calls: [call],
      notice: null,
      billedUsd: 0,
      estimatedUsd: 0,
      unknownCostCalls: 0,
    });

    const root = await renderComponent(
      <div>
        <JevComposerReview scope={scope} />
        <JevPanel scope={scope} />
      </div>,
    );
    const rendered = JSON.stringify(renderer!.toJSON());

    expect(rendered).toContain("Keep GPT-5.6 Sol");
    expect(rendered).toContain("Medium effort → Low effort");
    expect(rendered).toContain("Why review is needed");
    expect(rendered).toContain("Show more");
    expect(rendered).not.toContain("continuation_retained_model");
    expect(root.findAllByProps({ "aria-label": "Review Jev recommendation" })).toHaveLength(1);
    expect(root.findAllByProps({ "data-testid": "jev-composer-review" })).toHaveLength(1);
    expect(root.findByProps({ "data-testid": "jev-composer-review" }).props.className).toContain(
      "absolute",
    );
    expect(
      root.findByProps({ "aria-label": "Jev routing calls" }).findAllByProps({
        "aria-label": "Review Jev recommendation",
      }),
    ).toHaveLength(0);
    expect(root.findByProps({ "data-testid": "jev-review-scroll-body" }).props.className).toContain(
      "overflow-y-auto",
    );
    expect(root.findByProps({ "data-testid": "jev-review-actions" }).props.className).toContain(
      "shrink-0",
    );
    expect(rendered).toContain("Cancel send");
  });

  it("shows each approval only above its own chat composer", async () => {
    const call: JevCall = {
      id: "side-review",
      createdAt: "2026-09-21T12:00:00.000Z",
      status: "awaiting-review",
      notice: null,
      receiptContext: { environmentId: "env", projectId: "project", threadId: "side" },
      request: {
        requestId: "side-review",
        prompt: "Side chat task",
        candidates: [],
        context: { existingSession: false, hasAttachments: false, interactionMode: "default" },
      },
      result: null,
    };
    useJevStore.setState({ calls: [call] });
    const root = await renderComponent(
      <div>
        <JevComposerReview scope={scope} />
        <JevComposerReview scope={{ environmentId: "env", threadId: "side" }} />
      </div>,
    );
    expect(root.findAllByProps({ "data-testid": "jev-composer-review" })).toHaveLength(1);
    expect(JSON.stringify(renderer!.toJSON())).toContain("Side chat task");
  });

  it("keeps routing logs collapsed below live actions and reveals them on demand", async () => {
    const call: JevCall = {
      id: "routing-1",
      createdAt: "2026-09-21T12:00:00.000Z",
      status: "pending",
      notice: null,
      receiptContext: { environmentId: "env", projectId: "project", threadId: "thread" },
      request: {
        requestId: "routing-1",
        prompt: "Choose a model",
        candidates: [],
        context: {
          existingSession: true,
          hasAttachments: false,
          interactionMode: "default",
        },
      },
      result: null,
    };
    useJevStore.setState({
      modesByThread: { [JSON.stringify(["env", "thread"])]: "guided" },
      panelOpen: true,
      calls: [call, { ...call, id: "routing-2", status: "blocked", notice: "Routing failed." }],
      notice: null,
      billedUsd: 0,
      estimatedUsd: 0,
      unknownCostCalls: 0,
    });

    const root = await renderComponent(<JevPanel scope={scope} />);
    const toggle = root.findByProps({ "aria-controls": "jev-routing-logs" });
    expect(toggle.props["aria-expanded"]).toBe(false);
    expect(toggle.findAllByType("span")[0]?.children.join("")).toBe("All chat routing logs (2)");
    expect(JSON.stringify(renderer!.toJSON())).toContain("Cancel this chat's routing");
    expect(root.findAllByType("details")).toHaveLength(2);

    await act(() => toggle.props.onClick());

    expect(toggle.props["aria-expanded"]).toBe(true);
    expect(root.findAllByType("details")).toHaveLength(4);

    await act(() => toggle.props.onClick());
    expect(toggle.props["aria-expanded"]).toBe(false);
    expect(root.findAllByType("details")).toHaveLength(2);
  });

  it("cancels the main chat without cancelling a side chat", async () => {
    const call: JevCall = {
      id: "main-pending",
      createdAt: "2026-09-21T12:00:00.000Z",
      status: "pending",
      notice: null,
      receiptContext: { environmentId: "env", projectId: "project", threadId: "thread" },
      request: {
        requestId: "main-pending",
        prompt: "Main task",
        candidates: [],
        context: { existingSession: false, hasAttachments: false, interactionMode: "default" },
      },
      result: null,
    };
    useJevStore.setState({
      panelOpen: true,
      calls: [
        call,
        {
          ...call,
          id: "side-pending",
          receiptContext: { ...call.receiptContext!, threadId: "side" },
          request: { ...call.request, requestId: "side-pending" },
        },
        {
          ...call,
          id: "side-review",
          status: "awaiting-review",
          receiptContext: { ...call.receiptContext!, threadId: "side" },
          request: { ...call.request, requestId: "side-review" },
        },
      ],
    });
    const root = await renderComponent(<JevPanel scope={scope} />);
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("approval waiting above this chat");
    const scopedCancel = root
      .findAllByType("button")
      .find((button) => button.children.includes("Cancel this chat's routing"));
    expect(scopedCancel).toBeDefined();
    await act(() => scopedCancel!.props.onClick());
    expect(useJevStore.getState().calls.map((entry) => [entry.id, entry.status])).toEqual([
      ["main-pending", "cancelled"],
      ["side-pending", "pending"],
      ["side-review", "awaiting-review"],
    ]);
  });
});
