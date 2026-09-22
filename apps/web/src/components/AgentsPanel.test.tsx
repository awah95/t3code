import type {
  AgentPanelModel,
  AgentPanelWorkflowGroup,
  RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { AgentsPanel } from "./AgentsPanel";

let renderer: ReactTestRenderer | undefined;

const agent: RuntimeSubagent = {
  id: "agent-research",
  kind: "subagent",
  title: "Researcher",
  role: "research",
  model: "gpt-5.6-sol",
  effort: "medium",
  status: "running",
  activationCount: 1,
  usage: { totalTokens: 12_345, toolUses: 4 },
  progress: "Comparing the timeline implementations",
  lastToolName: "rg",
  result: null,
  error: null,
  outputFile: null,
  parentAgentId: null,
  agentIndex: 0,
  phaseIndex: null,
  phaseTitle: null,
  attempt: 1,
  workflowName: null,
  phases: [],
  runHandles: null,
  recentActivity: [
    { at: "2026-09-22T06:00:00.000Z", summary: "Read the timeline source" },
    { at: "2026-09-22T06:00:02.000Z", summary: "Compared receipt ownership" },
  ],
  firstSeenAt: "2026-09-22T06:00:00.000Z",
  startedAt: "2026-09-22T06:00:00.000Z",
  completedAt: null,
  updatedAt: "2026-09-22T06:00:02.000Z",
};

const model: AgentPanelModel = {
  workflows: [],
  directAgents: [agent],
  runningCount: 1,
  waitingCount: 0,
  idleCount: 0,
  settledCount: 0,
  totalTokens: 12_345,
  hasAgents: true,
  liveCount: 1,
};

const workflowMember: RuntimeSubagent = {
  ...agent,
  id: "workflow-agent-review",
  kind: "workflow_agent",
  title: "Reviewer",
  status: "completed",
  progress: null,
  result: "Review complete",
  parentAgentId: "workflow-review",
  phaseIndex: 0,
  phaseTitle: "Review",
  completedAt: "2026-09-22T06:01:00.000Z",
  updatedAt: "2026-09-22T06:01:00.000Z",
};

const workflow: RuntimeSubagent = {
  ...workflowMember,
  id: "workflow-review",
  kind: "workflow",
  title: "Review workflow",
  parentAgentId: null,
  phaseIndex: null,
  phaseTitle: null,
  phases: [{ index: 0, title: "Review" }],
};

const workflowGroup: AgentPanelWorkflowGroup = {
  workflow,
  phases: [
    {
      index: 0,
      title: "Review",
      members: [workflowMember],
      state: "done",
      activeCount: 0,
      settledCount: 1,
    },
  ],
  unphasedMembers: [],
};

const settledWorkflowModel: AgentPanelModel = {
  workflows: [workflowGroup],
  directAgents: [],
  runningCount: 0,
  waitingCount: 0,
  idleCount: 0,
  settledCount: 1,
  totalTokens: workflowMember.usage?.totalTokens ?? 0,
  hasAgents: true,
  liveCount: 0,
};

describe("AgentsPanel", () => {
  beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));

  afterEach(async () => {
    await act(() => renderer?.unmount());
    renderer = undefined;
    vi.unstubAllGlobals();
  });

  it("opens an individual agent and shows its own activity and usage", async () => {
    await act(() => {
      renderer = create(<AgentsPanel model={model} />);
    });
    const inspect = renderer!.root.findByProps({ "aria-label": "Inspect Researcher" });

    await act(() => inspect.props.onClick());

    const rendered = JSON.stringify(renderer!.toJSON());
    expect(inspect.props["aria-expanded"]).toBe(true);
    expect(rendered).toContain("Comparing the timeline implementations");
    expect(rendered).toContain("Read the timeline source");
    expect(rendered).toContain("12.3k");
    expect(rendered).toContain("Tool uses");
  });

  it("opens a timeline-focused agent immediately", async () => {
    await act(() => {
      renderer = create(<AgentsPanel model={model} focusedAgentId={agent.id} />);
    });

    expect(
      renderer!.root.findByProps({ "aria-label": "Inspect Researcher" }).props["aria-expanded"],
    ).toBe(true);
  });

  it("reveals and scrolls to a focused member inside a settled workflow", async () => {
    const scrollIntoView = vi.fn();
    await act(() => {
      renderer = create(
        <AgentsPanel
          model={settledWorkflowModel}
          focusedAgentId={workflowMember.id}
          focusedAgentRequestId={1}
        />,
        {
          createNodeMock: (element) =>
            (element.props as Record<string, unknown>)["data-agent-id"] === workflowMember.id
              ? { scrollIntoView }
              : null,
        },
      );
    });

    expect(
      renderer!.root.findByProps({ "aria-label": "Inspect Reviewer" }).props["aria-expanded"],
    ).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("reopens the same focused agent for a later timeline request", async () => {
    const scrollIntoView = vi.fn();
    await act(() => {
      renderer = create(
        <AgentsPanel model={model} focusedAgentId={agent.id} focusedAgentRequestId={1} />,
        {
          createNodeMock: (element) =>
            (element.props as Record<string, unknown>)["data-agent-id"] === agent.id
              ? { scrollIntoView }
              : null,
        },
      );
    });
    const inspect = renderer!.root.findByProps({ "aria-label": "Inspect Researcher" });
    await act(() => inspect.props.onClick());
    expect(inspect.props["aria-expanded"]).toBe(false);

    await act(() => {
      renderer!.update(
        <AgentsPanel model={model} focusedAgentId={agent.id} focusedAgentRequestId={2} />,
      );
    });

    expect(
      renderer!.root.findByProps({ "aria-label": "Inspect Researcher" }).props["aria-expanded"],
    ).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});
