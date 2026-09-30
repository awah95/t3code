// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import * as Option from "effect/Option";
import {
  EMPTY_ENVIRONMENT_THREAD_STATE,
  type EnvironmentThreadState,
} from "@t3tools/client-runtime/state/threads";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationThread,
} from "@t3tools/contracts";

const runtime = vi.hoisted(() => ({ state: null as EnvironmentThreadState | null }));
vi.mock("~/state/threads", () => ({ useEnvironmentThread: () => runtime.state }));
vi.mock("~/state/entities", () => ({
  useThreadShell: () => null,
  useThreadShellsForProjectRefs: () => [],
  readThreadShell: () => null,
}));
vi.mock("~/lib/archivedThreadsState", () => ({
  useArchivedThreadSnapshots: () => ({ snapshots: [], error: null, isLoading: false }),
}));
vi.mock("../ChatView", () => ({ default: () => <div>Chat transcript</div> }));

import { SideChatPanel } from "./SideChatPanel";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useRightPanelStore } from "~/rightPanelStore";

const thread: OrchestrationThread = {
  id: ThreadId.make("side"),
  projectId: ProjectId.make("project"),
  parentThreadId: ThreadId.make("main"),
  title: "Side chat",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" },
  runtimeMode: "approval-required",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  pullRequests: [],
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useRightPanelStore
    .getState()
    .openSideChat(
      scopeThreadRef(EnvironmentId.make("qa"), ThreadId.make("main")),
      "side",
      "Side chat",
    );
});
afterEach(() => {
  vi.unstubAllGlobals();
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
});

async function mountPanel() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = () =>
    root.render(
      <SideChatPanel
        environmentId={EnvironmentId.make("qa")}
        threadId="side"
        parentThreadId="main"
        onSendToMain={async () => {}}
      />,
    );
  await act(render);
  return {
    container,
    render,
    cleanup: async () => {
      await act(() => root.unmount());
      container.remove();
    },
  };
}

test("shows an initial synchronization failure and restores the chat after the retry succeeds", async () => {
  runtime.state = {
    ...EMPTY_ENVIRONMENT_THREAD_STATE,
    error: Option.some("Could not synchronize the thread."),
  };
  const panel = await mountPanel();
  try {
    expect(panel.container.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not synchronize the thread.",
    );
    expect(panel.container.textContent).not.toContain("Chat transcript");
    runtime.state = {
      ...EMPTY_ENVIRONMENT_THREAD_STATE,
      status: "live",
      data: Option.some(thread),
    };
    await act(panel.render);
    expect(panel.container.querySelector('[role="alert"]')).toBeNull();
    expect(panel.container.textContent).toContain("Chat transcript");
  } finally {
    await panel.cleanup();
  }
});

test("keeps the cached transcript available while explaining a synchronization failure", async () => {
  runtime.state = {
    ...EMPTY_ENVIRONMENT_THREAD_STATE,
    status: "cached",
    data: Option.some(thread),
    error: Option.some("Connection interrupted."),
  };
  const panel = await mountPanel();
  try {
    expect(panel.container.querySelector('[role="alert"]')?.textContent).toBe(
      "Connection interrupted.",
    );
    expect(panel.container.textContent).toContain("Chat transcript");
  } finally {
    await panel.cleanup();
  }
});
