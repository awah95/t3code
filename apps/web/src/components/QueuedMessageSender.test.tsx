import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ServerProvider,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import * as Cause from "effect/Cause";
import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useQueuedMessageStore, type QueuedComposerMessage } from "../queuedMessageStore";
import { sendQueuedMessage } from "./chat/sendQueuedMessage";
import { QueuedMessageSender } from "./QueuedMessageSender";

const io = vi.hoisted(() => ({
  run: vi.fn(),
  upload: vi.fn(),
  toast: vi.fn(),
  thread: null as unknown,
  shell: { runtimeMode: "full-access", interactionMode: "default" } as Record<string, unknown>,
  jevMode: "off" as "off" | "guided" | "auto",
  jevDecide: vi.fn(),
  jevPrepared: vi.fn(),
  jevDispatched: vi.fn(),
  navigate: vi.fn(),
  jevCalls: [] as Array<{ id: string; decision?: string }>,
}));
const codexProvider: ServerProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-09-25T00:00:00Z",
  models: ["gpt-6-sol", "gpt-6-luna"].map((slug) => ({
    slug,
    name: slug,
    isCustom: false,
    capabilities: {
      optionDescriptors: [
        {
          id: "reasoningEffort",
          label: "Effort",
          type: "select",
          options: [{ id: "medium", label: "Medium" }],
        },
      ],
    },
  })),
  slashCommands: [],
  skills: [],
};
const config = {
  environment: { capabilities: { attachmentUploads: true, inlineMessageContext: true } },
  providers: [codexProvider],
};
vi.mock("../env", () => ({ isElectron: true }));
vi.mock("@tanstack/react-router", async (load) => ({
  ...(await load<typeof import("@tanstack/react-router")>()),
  useNavigate: () => io.navigate,
  useParams: () => ({}),
}));
vi.mock("../hooks/useSettings", () => ({
  useEnvironmentSettings: () => DEFAULT_UNIFIED_SETTINGS,
}));
vi.mock("../jev/jevStore", () => ({
  useJevStore: {
    getState: () => ({
      getThreadEnabled: () => io.jevMode !== "off",
      getThreadMode: () => io.jevMode,
      calls: io.jevCalls,
      recordPreparedDispatch: (...args: unknown[]) => io.jevPrepared(...args),
      recordDispatch: (...args: unknown[]) => io.jevDispatched(...args),
      cancelPending: vi.fn(),
    }),
  },
  decideWithJev: (...args: unknown[]) => io.jevDecide(...args),
  jevPriorAttempts: () => [],
}));
vi.mock("@t3tools/client-runtime/state/runtime", async (load) => ({
  ...(await load<typeof import("@t3tools/client-runtime/state/runtime")>()),
  runAtomCommand: (...args: unknown[]) => io.run(...args),
}));
vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: { get: () => new Map([["env-a", config]]) },
}));
vi.mock("../state/server", () => ({ environmentServerConfigsAtom: {} }));
vi.mock("../state/threads", () => ({
  threadEnvironment: {
    updateMetadata: "metadata",
    setRuntimeMode: "runtime",
    setInteractionMode: "interaction",
    startTurn: "start",
  },
}));
vi.mock("../state/environments", () => ({
  useEnvironment: () => ({
    connection: { phase: "connected" },
    entry: { target: { _tag: "PrimaryConnectionTarget" } },
  }),
}));
vi.mock("../state/entities", () => ({
  useThread: () => io.thread,
  useThreadStatus: () => "live",
  useServerConfigs: () => new Map([["env-a", config]]),
  readThreadShell: () => io.shell,
  readThread: () => io.thread,
}));
vi.mock("./ui/toast", () => ({
  toastManager: { add: (...args: unknown[]) => io.toast(...args), close: vi.fn() },
}));
vi.mock("../lib/attachmentUploadQueue", () => ({
  startAttachmentUpload: vi.fn(),
  awaitAttachmentUploads: (...args: unknown[]) => io.upload(...args),
  getUploadedAttachments: () => [
    { type: "image", id: "uploaded", name: "a.png", mimeType: "image/png", sizeBytes: 4 },
  ],
  releaseDraftAttachments: vi.fn(),
}));

const threadRef = scopeThreadRef(EnvironmentId.make("env-a"), ThreadId.make("thread-a"));
const threadKey = scopedThreadKey(threadRef);
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-sol" };
const jevContext = {
  settings: DEFAULT_UNIFIED_SETTINGS,
  environmentTarget: {
    _tag: "PrimaryConnectionTarget" as const,
    environmentId: EnvironmentId.make("env-a"),
    label: "Local",
    httpBaseUrl: "http://localhost",
    wsBaseUrl: "ws://localhost",
  },
};
const readyThread = () => ({
  session: {
    status: "ready",
    activeTurnId: null,
    updatedAt: "2026-09-25T00:00:00Z",
    providerInstanceId: modelSelection.instanceId,
  },
  activities: [],
  messages: [],
  latestTurn: null,
  proposedPlans: [],
  projectId: "project-a",
});
const chooseLuna = () =>
  io.jevDecide.mockImplementation(
    async (request: { candidates: Array<{ key: string; model: string }> }) => ({
      choice: request.candidates.find((candidate) => candidate.model === "gpt-6-luna")?.key ?? null,
      error: null,
    }),
  );

function enqueue(overrides: Partial<QueuedComposerMessage> = {}) {
  return useQueuedMessageStore.getState().enqueue(threadKey, {
    prompt: "follow up",
    images: [],
    files: [],
    terminalContexts: [],
    previewAnnotations: [],
    reviewComments: [],
    sendSettings: {
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      promptEffort: null,
    },
    queuedAfterToolActivityId: null,
    createdAt: "2026-09-25T00:00:00Z",
    ...overrides,
  });
}

const commandsRun = () => io.run.mock.calls.map((call) => call[1]);
const queue = () => useQueuedMessageStore.getState().queuesByThreadKey[threadKey];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useQueuedMessageStore.setState({ queuesByThreadKey: {}, lastDispatchByThreadKey: {} });
  io.thread = null;
  io.run.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  io.upload.mockReset().mockResolvedValue(undefined);
  io.toast.mockReset();
  io.jevMode = "off";
  io.jevDecide.mockReset();
  io.jevPrepared.mockReset();
  io.jevDispatched.mockReset();
  io.navigate.mockReset();
  io.jevCalls = [];
  io.shell = {
    projectId: "project-a",
    title: "Queued chat",
    modelSelection,
    branch: null,
    runtimeMode: "full-access",
    interactionMode: "default",
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QueuedMessageSender", () => {
  const thread = (
    status: string,
    { toolActivityIds = [] as string[], userMessageIds = [] as string[] } = {},
  ) => ({
    session: { status, activeTurnId: null, updatedAt: status },
    activities: toolActivityIds.map((id, index) => ({
      id,
      kind: "tool.completed",
      sequence: index,
      createdAt: "2026-09-25T00:00:01Z",
    })),
    messages: userMessageIds.map((id) => ({ id, role: "user" })),
    latestTurn: null,
  });
  let root: ReactTestRenderer | null = null;
  const render = () =>
    act(() => {
      if (root) root.update(createElement(QueuedMessageSender));
      else root = create(createElement(QueuedMessageSender));
    });
  afterEach(async () => {
    await act(() => root?.unmount());
    root = null;
  });

  it("sends a queued message when the turn ends, with no chat view open", async () => {
    enqueue();
    io.thread = thread("running");
    await render();
    expect(commandsRun()).toEqual([]);

    io.thread = thread("ready");
    await render();

    expect(commandsRun()).toEqual(["start"]);
    expect(io.run.mock.calls[0]?.[2]).toMatchObject({
      environmentId: "env-a",
      input: { threadId: "thread-a", message: { text: "follow up" }, modelSelection },
    });
    expect(queue()).toBeUndefined();
    expect(io.jevDecide).not.toHaveBeenCalled();
  });

  it("routes an Automatic queued turn while its chat is closed", async () => {
    io.jevMode = "auto";
    chooseLuna();
    enqueue();
    io.thread = readyThread();

    await render();

    expect(io.jevDecide).toHaveBeenCalledTimes(1);
    expect(commandsRun()).toEqual(["metadata", "start"]);
    const start = io.run.mock.calls.find((call) => call[1] === "start");
    expect(start?.[2]).toMatchObject({ input: { modelSelection: { model: "gpt-6-luna" } } });
    expect(io.jevPrepared).toHaveBeenCalledTimes(1);
    expect(io.jevDispatched).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ succeeded: true, model: "gpt-6-luna" }),
    );
    expect(queue()).toBeUndefined();
  });

  it("offers a route to a closed chat when a Guided queued turn awaits review", async () => {
    io.jevMode = "guided";
    io.jevDecide.mockImplementation(
      async (
        request: { candidates: Array<{ key: string; model: string }> },
        _context: unknown,
        _label: unknown,
        onReviewPending: () => void,
      ) => {
        onReviewPending();
        return {
          choice: request.candidates.find((candidate) => candidate.model === "gpt-6-luna")?.key,
          error: null,
        };
      },
    );
    enqueue();
    io.thread = readyThread();

    await render();

    const reviewToast = io.toast.mock.calls.find(
      (call) => call[0]?.title === "Jev review needed",
    )?.[0];
    expect(reviewToast?.actionProps?.children).toBe("Open chat");
    reviewToast.actionProps.onClick();
    expect(io.navigate).toHaveBeenCalledWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: "env-a", threadId: "thread-a" },
    });
  });

  it("holds the next message until the server picks up the one before it", async () => {
    enqueue({ prompt: "first" });
    enqueue({ prompt: "second" });
    io.thread = thread("ready");
    await render();
    await render();
    expect(commandsRun()).toEqual(["start"]);

    // The first message started a turn; the second waits for its next tool call.
    io.thread = thread("running", { userMessageIds: ["first"] });
    await render();
    expect(commandsRun()).toEqual(["start"]);
    io.thread = thread("running", { userMessageIds: ["first"], toolActivityIds: ["tool-1"] });
    await render();
    expect(commandsRun()).toEqual(["start", "start"]);
  });

  it("moves on to the next message after a failed one is cancelled", async () => {
    io.run.mockResolvedValueOnce({ _tag: "Failure", cause: Cause.fail(new Error("offline")) });
    const first = enqueue({ prompt: "first" });
    enqueue({ prompt: "second" });
    io.thread = thread("ready");
    await render();
    expect(queue()?.[0]).toMatchObject({ prompt: "first", holdUntilUserAction: true });

    await act(() => {
      useQueuedMessageStore.getState().remove(threadKey, first.id);
    });
    await render();

    expect(commandsRun()).toEqual(["start", "start"]);
    expect(io.run.mock.calls[1]?.[2]).toMatchObject({ input: { message: { text: "second" } } });
  });
});

describe("sendQueuedMessage", () => {
  it("keeps an explicit queued model even when Automatic is enabled later", async () => {
    io.jevMode = "auto";
    io.thread = readyThread();
    const message = enqueue({
      sendSettings: {
        modelSelection,
        explicitModelSelection: true,
        runtimeMode: "full-access",
        interactionMode: "default",
        promptEffort: null,
      },
    });

    await sendQueuedMessage(threadRef, message.id, jevContext);

    expect(io.jevDecide).not.toHaveBeenCalled();
    expect(io.run.mock.calls.find((call) => call[1] === "start")?.[2]).toMatchObject({
      input: { modelSelection },
    });
  });

  it("bypasses Jev for a media-only queued turn", async () => {
    io.jevMode = "auto";
    io.thread = readyThread();
    const image = {
      type: "image" as const,
      id: "image-1",
      name: "a.png",
      mimeType: "image/png",
      sizeBytes: 4,
      previewUrl: "data:image/png;base64,AAAA",
      file: new File(["AAAA"], "a.png", { type: "image/png" }),
    };
    const message = enqueue({ prompt: "", images: [image] });
    io.shell = null as unknown as Record<string, unknown>;

    await sendQueuedMessage(threadRef, message.id);

    expect(io.jevDecide).not.toHaveBeenCalled();
    expect(commandsRun()).toEqual(["start"]);
  });

  it("sends a queued provider command with its selected model without routing context", async () => {
    io.jevMode = "auto";
    io.thread = readyThread();
    const message = enqueue({ prompt: "  /compact" });

    await sendQueuedMessage(threadRef, message.id);

    expect(io.jevDecide).not.toHaveBeenCalled();
    expect(commandsRun()).toEqual(["start"]);
  });

  it("holds a routable queued turn when its routing context is unavailable", async () => {
    io.jevMode = "auto";
    io.thread = readyThread();
    const message = enqueue();

    await sendQueuedMessage(threadRef, message.id);

    expect(commandsRun()).toEqual([]);
    expect(queue()?.[0]).toMatchObject({ id: message.id, holdUntilUserAction: true });
    expect(io.jevDecide).not.toHaveBeenCalled();
  });

  it("holds a queued turn if Jev mode changes after its decision", async () => {
    io.jevMode = "auto";
    io.thread = readyThread();
    chooseLuna();
    const message = enqueue();
    let reachedMetadata!: () => void;
    let releaseMetadata!: () => void;
    const metadataReached = new Promise<void>((resolve) => (reachedMetadata = resolve));
    const metadataReleased = new Promise<void>((resolve) => (releaseMetadata = resolve));
    io.run.mockImplementation(async (_registry: unknown, command: unknown) => {
      if (command === "metadata") {
        reachedMetadata();
        await metadataReleased;
      }
      return { _tag: "Success", value: undefined };
    });

    const sending = sendQueuedMessage(threadRef, message.id, jevContext);
    await metadataReached;
    io.jevMode = "off";
    releaseMetadata();
    await sending;

    expect(commandsRun()).toEqual(["metadata"]);
    expect(queue()?.[0]).toMatchObject({ id: message.id, holdUntilUserAction: true });
    expect(io.jevPrepared).not.toHaveBeenCalled();
  });

  it("records failed dispatch and routes one new attempt on retry", async () => {
    io.jevMode = "auto";
    io.thread = readyThread();
    chooseLuna();
    const message = enqueue();
    io.run.mockImplementation((_registry: unknown, command: unknown) =>
      Promise.resolve(
        command === "start"
          ? { _tag: "Failure", cause: Cause.fail(new Error("offline")) }
          : { _tag: "Success", value: undefined },
      ),
    );

    await sendQueuedMessage(threadRef, message.id, jevContext);

    expect(queue()?.[0]).toMatchObject({ id: message.id, holdUntilUserAction: true });
    expect(io.jevDispatched).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ succeeded: false }),
    );
    io.run.mockResolvedValue({ _tag: "Success", value: undefined });
    await sendQueuedMessage(threadRef, message.id, jevContext);

    expect(io.jevDecide).toHaveBeenCalledTimes(2);
    expect(io.jevPrepared).toHaveBeenCalledTimes(2);
    expect(io.jevDispatched).toHaveBeenCalledTimes(2);
    expect(queue()).toBeUndefined();
  });
  it("saves a mode changed before queueing, then starts the turn", async () => {
    io.shell = { ...io.shell, runtimeMode: "approval-required" };
    const message = enqueue();

    await sendQueuedMessage(threadRef, message.id);

    expect(commandsRun()).toEqual(["runtime", "start"]);
    expect(io.run.mock.calls[1]?.[2]).toMatchObject({ input: { runtimeMode: "full-access" } });
    expect(queue()).toBeUndefined();
  });

  it("gives a message back to Stop while its upload runs, without starting a turn", async () => {
    let finishUpload!: () => void;
    io.upload.mockReturnValue(new Promise<void>((resolve) => (finishUpload = resolve)));
    const image = {
      type: "image" as const,
      id: "image-1",
      name: "a.png",
      mimeType: "image/png",
      sizeBytes: 4,
      previewUrl: "data:image/png;base64,AAAA",
      file: new File(["AAAA"], "a.png", { type: "image/png" }),
    };
    const message = enqueue({ images: [image] });

    const sending = sendQueuedMessage(threadRef, message.id);
    expect(useQueuedMessageStore.getState().drain(threadKey)).toHaveLength(1);
    finishUpload();
    await sending;

    expect(commandsRun()).toEqual([]);
    expect(io.toast).not.toHaveBeenCalled();
    expect(queue()).toBeUndefined();
  });

  it("holds a message at the head when the turn start fails", async () => {
    io.run.mockResolvedValue({ _tag: "Failure", cause: Cause.fail(new Error("offline")) });
    enqueue({ prompt: "first" });
    const second = enqueue({ prompt: "second" });

    await sendQueuedMessage(threadRef, second.id);

    expect(queue()?.map((entry) => [entry.prompt, entry.holdUntilUserAction])).toEqual([
      ["second", true],
      ["first", undefined],
    ]);
    expect(io.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "offline" }));
  });
});
