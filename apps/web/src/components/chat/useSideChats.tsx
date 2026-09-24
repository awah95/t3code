import { useCallback, useMemo, useState } from "react";
import type { AssistantCitation, ProviderDriverKind, ScopedThreadRef } from "@t3tools/contracts";
import { ThreadId as ThreadIdSchema } from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import {
  assistantCitationsToPlainText,
  serializeAssistantCitation,
} from "@t3tools/shared/assistantCitations";
import { getJevModelProfile, isJevCandidateAllowed } from "@t3tools/shared/jevRouting";
import { createModelSelection } from "@t3tools/shared/model";
import { truncate } from "@t3tools/shared/String";
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { DraftId } from "~/composerDraftStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import { isElectron } from "~/env";
import { decideWithJev, jevPriorAttempts, useJevStore } from "~/jev/jevStore";
import { prepareJevTurn } from "~/jev/routing";
import { newMessageId, newThreadId, randomUUID } from "~/lib/utils";
import { getAppModelOptionsForInstance } from "~/modelSelection";
import type { ProviderInstanceEntry } from "~/providerInstances";
import { useRightPanelStore } from "~/rightPanelStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentServerConfigsAtom } from "~/state/server";
import { readThreadShell, useThreadShellsForProjectRefs } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import type { Thread } from "~/types";
import { buildThreadTurnInterruptInput } from "../ChatView.logic";
import { SideChatPanel } from "./SideChatPanel";
import { stackedThreadToast, toastManager } from "../ui/toast";
import type { useThreadActions } from "~/hooks/useThreadActions";

type SideChatInput = {
  activeThreadRef: ScopedThreadRef | null;
  activeServerThread: Thread | null;
  selectedProvider: ProviderDriverKind | null;
  providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  settings: UnifiedSettings;
  sideEnvironmentIsLocal: boolean;
  composerDraftTarget: ScopedThreadRef | DraftId;
  sideThreadId: string | null;
  lifecycle: Pick<ReturnType<typeof useThreadActions>, "archiveThread" | "unarchiveThread"> & {
    deleteSideThread: ReturnType<typeof useThreadActions>["deleteThread"];
  };
};

export function useSideChats(input: SideChatInput) {
  const {
    activeThreadRef,
    activeServerThread,
    selectedProvider,
    providerInstanceEntries,
    settings,
    sideEnvironmentIsLocal,
    composerDraftTarget,
    sideThreadId,
    lifecycle,
  } = input;
  const parentEnvironmentId = activeServerThread?.environmentId;
  const parentProjectId = activeServerThread?.projectId;
  const parentThreadId = activeServerThread?.id;
  const projectRefs = useMemo(
    () =>
      parentEnvironmentId && parentProjectId
        ? [scopeProjectRef(parentEnvironmentId, parentProjectId)]
        : [],
    [parentEnvironmentId, parentProjectId],
  );
  const allThreadShells = useThreadShellsForProjectRefs(projectRefs);
  const sideChatDestinations = useMemo(
    () =>
      parentThreadId
        ? allThreadShells
            .filter(
              (thread) => thread.parentThreadId === parentThreadId && thread.archivedAt === null,
            )
            .map((thread) => ({
              threadId: thread.id,
              title: thread.title,
            }))
        : [],
    [parentThreadId, allThreadShells],
  );
  const { archiveThread, unarchiveThread, deleteSideThread } = lifecycle;
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const startThreadTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const setRuntimeMode = useAtomCommand(threadEnvironment.setRuntimeMode, {
    reportFailure: false,
  });
  const interruptThreadTurn = useAtomCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  const [sideDraftInsertion, setSideDraftInsertion] = useState<{
    threadId: string;
    id: string;
    text: string;
  } | null>(null);
  const addSideChatSurface = useCallback(
    async (forceNew = false): Promise<string | null> => {
      if (!activeThreadRef || !activeServerThread || selectedProvider !== "codex") return null;
      const panel = useRightPanelStore.getState().byThreadKey[scopedThreadKey(activeThreadRef)];
      const hasOpenSideChat = panel?.surfaces.some((surface) => surface.kind === "side-chat");
      if (!forceNew && !hasOpenSideChat) {
        const saved = allThreadShells
          .filter(
            (thread) =>
              thread.environmentId === activeThreadRef.environmentId &&
              thread.parentThreadId === activeServerThread.id,
          )
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
        if (saved) {
          useRightPanelStore.getState().openSideChat(activeThreadRef, saved.id, saved.title);
          return saved.id;
        }
      }
      const sideThreadId = newThreadId();
      const createdAt = new Date().toISOString();
      const title = "Side chat";
      const result = await createThread({
        environmentId: activeThreadRef.environmentId,
        input: {
          threadId: sideThreadId,
          parentThreadId: activeServerThread.id,
          sideChatMode: "discuss",
          projectId: activeServerThread.projectId,
          title,
          modelSelection: activeServerThread.modelSelection,
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: activeServerThread.branch,
          worktreePath: activeServerThread.worktreePath,
          createdAt,
        },
      });
      if (result._tag === "Failure") {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Couldn't create side chat",
            description: error instanceof Error ? error.message : "Try again.",
          }),
        );
        return null;
      }
      useRightPanelStore.getState().openSideChat(activeThreadRef, sideThreadId, title);
      return sideThreadId;
    },
    [activeServerThread, activeThreadRef, allThreadShells, createThread, selectedProvider],
  );
  const askInSideChat = useCallback(
    async (
      citation: AssistantCitation,
      destination: { kind: "new" } | { kind: "existing"; threadId: string },
    ) => {
      if (!activeThreadRef) return;
      const threadId =
        destination.kind === "new" ? await addSideChatSurface(true) : destination.threadId;
      if (!threadId) return;
      if (destination.kind === "existing") {
        const shell = allThreadShells.find(
          (thread) =>
            thread.environmentId === activeThreadRef.environmentId && thread.id === threadId,
        );
        if (!shell || shell.parentThreadId !== activeThreadRef.threadId) return;
        useRightPanelStore.getState().openSideChat(activeThreadRef, threadId, shell.title);
      }
      setSideDraftInsertion({
        threadId,
        id: newMessageId(),
        text: serializeAssistantCitation(citation),
      });
    },
    [activeThreadRef, addSideChatSurface, allThreadShells],
  );
  const sideChatModelChoices = useMemo(() => {
    const instanceId = activeServerThread?.modelSelection.instanceId;
    const currentSideModel = sideThreadId
      ? allThreadShells.find(
          (thread) =>
            thread.environmentId === activeThreadRef?.environmentId && thread.id === sideThreadId,
        )?.modelSelection.model
      : null;
    const entry = providerInstanceEntries.find(
      (provider) => provider.instanceId === instanceId && provider.driverKind === "codex",
    );
    if (!entry) return [];
    const modelOptions = getAppModelOptionsForInstance(settings, entry);
    const currentProviderModel = entry.models.find((model) => model.slug === currentSideModel);
    if (currentProviderModel && !modelOptions.some((model) => model.slug === currentSideModel)) {
      modelOptions.push({
        slug: currentProviderModel.slug,
        name: currentProviderModel.name,
        isCustom: currentProviderModel.isCustom,
        ...(currentProviderModel.isLegacy ? { isLegacy: true } : {}),
      });
    }
    return modelOptions
      .filter((model) => !model.isLegacy || model.slug === currentSideModel)
      .map((model) => {
        const providerModel = entry.models.find((candidate) => candidate.slug === model.slug);
        const effort = providerModel?.capabilities?.optionDescriptors?.find(
          (option) => option.id === "reasoningEffort" && option.type === "select",
        );
        return {
          label: model.shortName ?? model.name,
          selection: createModelSelection(entry.instanceId, model.slug),
          efforts:
            effort?.type === "select"
              ? effort.options.map((option) => ({ id: option.id, label: option.label }))
              : getJevModelProfile(model.slug)
                ? [
                    { id: "low", label: "Low" },
                    { id: "medium", label: "Medium" },
                    { id: "high", label: "High" },
                    { id: "xhigh", label: "Extra high" },
                  ]
                : [],
        };
      });
  }, [
    activeServerThread?.modelSelection.instanceId,
    activeThreadRef?.environmentId,
    allThreadShells,
    providerInstanceEntries,
    sideThreadId,
    settings,
  ]);
  const sendSideChatMessage = useCallback(
    async (sideThreadId: string, text: string, sideThread: Thread | null) => {
      if (!activeThreadRef || !activeServerThread) return;
      const sideRef = scopeThreadRef(
        activeThreadRef.environmentId,
        ThreadIdSchema.make(sideThreadId),
      );
      const sideShell = readThreadShell(sideRef);
      if (!sideShell || sideShell.parentThreadId !== activeServerThread.id) {
        throw new Error("This side chat is no longer attached to the main thread.");
      }
      let selection = sideShell.modelSelection;
      const messageId = newMessageId();
      let jevRequestId: string | null = null;
      const localEnvironment = sideEnvironmentIsLocal;
      const jevStore = useJevStore.getState();
      const jevEnabled =
        isElectron &&
        jevStore.enabled &&
        jevStore.getSideRoutingMode(activeThreadRef.environmentId, sideThreadId) === "auto";
      const selectedProvider = providerInstanceEntries.find(
        (provider) => provider.instanceId === selection.instanceId,
      );
      if (jevEnabled && !localEnvironment)
        useJevStore.setState({ notice: "Jev Auto currently supports local desktop environments." });
      if (jevEnabled && text.trimStart().startsWith("/"))
        useJevStore.setState({
          notice: "Jev Auto skipped: provider commands use the selected model.",
        });
      if (jevEnabled && selectedProvider && selectedProvider.driverKind !== "codex")
        useJevStore.setState({
          notice:
            "Jev Auto supports Codex routing; this side chat uses the selected provider and model.",
        });
      if (
        jevEnabled &&
        localEnvironment &&
        !text.trimStart().startsWith("/") &&
        selectedProvider?.driverKind === "codex"
      ) {
        if (!sideThread) throw new Error("This side chat is still loading. Please try again.");
        jevRequestId = randomUUID();
        const { request, candidates } = prepareJevTurn({
          requestId: jevRequestId,
          prompt: text,
          messages: sideThread.messages,
          priorAttempts: jevPriorAttempts(sideThread.id, sideThread.messages),
          current: selection,
          candidateCurrent: selection,
          providers: providerInstanceEntries,
          settings,
          sessionInstanceId: sideThread.session?.providerInstanceId ?? null,
          hasStartedSession: sideThread.session !== null || sideThread.messages.length > 0,
          existingSession: sideThread.session !== null,
          interactionMode: sideShell.interactionMode,
          plans: sideThread.proposedPlans,
        });
        if (candidates.length === 0) {
          throw new Error("Jev has no available Codex model and effort for this side chat.");
        }
        const decision = await decideWithJev(
          request,
          {
            environmentId: activeThreadRef.environmentId,
            projectId: sideShell.projectId,
            threadId: sideThreadId,
          },
          sideShell.title,
        );
        if (!decision) throw new Error("Jev routing was cancelled.");
        const review = useJevStore.getState().calls.find((call) => call.id === jevRequestId);
        const userApprovedCurrent = review?.decision === "current";
        const userOverride = userApprovedCurrent || review?.decision === "alternative";
        if (userApprovedCurrent) {
          const liveProvider = appAtomRegistry
            .get(environmentServerConfigsAtom)
            .get(activeThreadRef.environmentId)
            ?.providers?.find((provider) => provider.instanceId === selection.instanceId);
          const liveModel = liveProvider?.models.find((model) => model.slug === selection.model);
          const currentEffort = selection.options?.find(
            (option) => option.id === "reasoningEffort",
          )?.value;
          const effort = liveModel?.capabilities?.optionDescriptors?.find(
            (option) => option.id === "reasoningEffort",
          );
          if (
            !liveProvider ||
            liveProvider.status !== "ready" ||
            liveProvider.enabled === false ||
            liveProvider.availability === "unavailable" ||
            !liveModel ||
            (typeof currentEffort === "string" &&
              (effort?.type !== "select" ||
                !effort.options.some((option) => option.id === currentEffort)))
          ) {
            throw new Error("The current model or effort is no longer available. Please retry.");
          }
        } else {
          const candidate = candidates.find((entry) => entry.key === decision.choice);
          if (!candidate || candidate.selection.instanceId !== selection.instanceId) {
            throw new Error("Jev selected an unavailable side-chat model. Please retry.");
          }
          const liveProvider = appAtomRegistry
            .get(environmentServerConfigsAtom)
            .get(activeThreadRef.environmentId)
            ?.providers?.find((provider) => provider.instanceId === candidate.selection.instanceId);
          const liveModel = liveProvider?.models.find((model) => model.slug === candidate.model);
          const effort = liveModel?.capabilities?.optionDescriptors?.find(
            (option) => option.id === "reasoningEffort",
          );
          if (
            !liveProvider ||
            liveProvider.status !== "ready" ||
            liveProvider.enabled === false ||
            liveProvider.availability === "unavailable" ||
            !liveModel ||
            effort?.type !== "select" ||
            !effort.options.some((option) => option.id === candidate.effort) ||
            (!userOverride && !isJevCandidateAllowed(candidate, request.context))
          ) {
            throw new Error("The routed model or effort is no longer available. Please retry.");
          }
          selection = createModelSelection(candidate.selection.instanceId, candidate.model, [
            ...(selection.options ?? []).filter((option) => option.id !== "reasoningEffort"),
            { id: "reasoningEffort", value: candidate.effort },
          ]);
        }
        const currentShell = readThreadShell(sideRef);
        if (
          !currentShell ||
          currentShell.parentThreadId !== activeServerThread.id ||
          currentShell.projectId !== sideShell.projectId ||
          JSON.stringify(currentShell.modelSelection) !==
            JSON.stringify(sideShell.modelSelection) ||
          useComposerDraftStore.getState().getComposerDraft(sideRef)?.prompt.trim() !== text
        ) {
          throw new Error(
            "The side chat changed during routing. Review your draft and send again.",
          );
        }
        useJevStore.getState().recordPreparedDispatch(jevRequestId, {
          model: selection.model,
          effort: selection.options?.find((option) => option.id === "reasoningEffort")?.value as
            | string
            | undefined,
          threadId: sideThreadId,
          messageId,
          environmentId: activeThreadRef.environmentId,
          projectId: sideShell.projectId,
          succeeded: null,
        });
      }
      const result = await startThreadTurn({
        environmentId: activeThreadRef.environmentId,
        input: {
          threadId: ThreadIdSchema.make(sideThreadId),
          message: { messageId, role: "user", text, attachments: [] },
          modelSelection: selection,
          runtimeMode: sideShell.runtimeMode,
          interactionMode: "default",
          titleSeed: sideShell.title,
          createdAt: new Date().toISOString(),
        },
      });
      if (jevRequestId) {
        useJevStore.getState().recordDispatch(jevRequestId, {
          model: selection.model,
          effort: selection.options?.find((option) => option.id === "reasoningEffort")?.value as
            | string
            | undefined,
          threadId: sideThreadId,
          messageId,
          environmentId: activeThreadRef.environmentId,
          projectId: sideShell.projectId,
          succeeded: result._tag !== "Failure",
        });
      }
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      if (sideShell?.title === "Side chat") {
        const title = truncate(assistantCitationsToPlainText(text).replace(/\s+/g, " ").trim());
        const titleResult = await updateThreadMetadata({
          environmentId: activeThreadRef.environmentId,
          input: { threadId: ThreadIdSchema.make(sideThreadId), title },
        });
        if (titleResult._tag === "Success") {
          useRightPanelStore.getState().openSideChat(activeThreadRef, sideThreadId, title);
        }
      }
    },
    [
      activeServerThread,
      activeThreadRef,
      sideEnvironmentIsLocal,
      providerInstanceEntries,
      settings,
      startThreadTurn,
      updateThreadMetadata,
    ],
  );
  const formatSideChatHandoff = useCallback(
    (sideThreadId: string, text: string) => {
      if (!activeThreadRef || !activeServerThread) return text;
      const side = readThreadShell(
        scopeThreadRef(activeThreadRef.environmentId, ThreadIdSchema.make(sideThreadId)),
      );
      if (!side || side.parentThreadId !== activeServerThread.id) return text;
      const worktree =
        side.sideChatOwnsWorktree && side.worktreePath
          ? `; isolated worktree: ${side.worktreePath}`
          : "";
      return `From side chat "${side.title}" (thread ${sideThreadId}${worktree}):\n\n${text}`;
    },
    [activeServerThread, activeThreadRef],
  );
  const addSideChatMessageToMainDraft = useCallback(
    async (sideThreadId: string, text: string) => {
      const current =
        useComposerDraftStore.getState().getComposerDraft(composerDraftTarget)?.prompt ?? "";
      const handoff = formatSideChatHandoff(sideThreadId, text);
      useComposerDraftStore
        .getState()
        .setPrompt(composerDraftTarget, current ? `${current}\n\n${handoff}` : handoff);
    },
    [composerDraftTarget, formatSideChatHandoff],
  );
  const sendSideChatAnswerToMain = useCallback(
    async (sideThreadId: string, text: string) => {
      if (!activeThreadRef || !activeServerThread) return;
      const result = await startThreadTurn({
        environmentId: activeThreadRef.environmentId,
        input: {
          threadId: activeServerThread.id,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: formatSideChatHandoff(sideThreadId, text),
            attachments: [],
          },
          modelSelection: activeServerThread.modelSelection,
          runtimeMode: activeServerThread.runtimeMode,
          interactionMode: activeServerThread.interactionMode,
          titleSeed: activeServerThread.title,
          createdAt: new Date().toISOString(),
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    },
    [activeServerThread, activeThreadRef, formatSideChatHandoff, startThreadTurn],
  );
  return {
    activeThreadRef,
    sideChatDestinations,
    archiveThread,
    unarchiveThread,
    deleteSideThread,
    sideDraftInsertion,
    addSideChatSurface,
    askInSideChat,
    sideChatModelChoices,
    sendSideChatMessage,
    setRuntimeMode,
    addSideChatMessageToMainDraft,
    sendSideChatAnswerToMain,
    interruptThreadTurn,
    updateThreadMetadata,
    composerRichTextEnabled: settings.composerRichTextEnabled,
  };
}

export type SideChatController = ReturnType<typeof useSideChats>;

export function SideChatPanelHost({
  controller,
  threadId,
}: {
  controller: SideChatController;
  threadId: string;
}) {
  const {
    activeThreadRef,
    archiveThread,
    unarchiveThread,
    deleteSideThread,
    sideDraftInsertion,
    addSideChatSurface,
    sideChatModelChoices,
    sendSideChatMessage,
    setRuntimeMode,
    addSideChatMessageToMainDraft,
    sendSideChatAnswerToMain,
    interruptThreadTurn,
    updateThreadMetadata,
    composerRichTextEnabled,
  } = controller;
  const jevEnabled = useJevStore((state) => state.enabled);
  const sideJevAuto = useJevStore(
    (state) =>
      activeThreadRef !== null &&
      state.getSideRoutingMode(activeThreadRef.environmentId, threadId) === "auto",
  );
  if (!activeThreadRef) return null;
  return (
    <SideChatPanel
      key={threadId}
      environmentId={activeThreadRef.environmentId}
      threadId={threadId}
      parentThreadId={activeThreadRef.threadId}
      onSend={(text, sideThread) => sendSideChatMessage(threadId, text, sideThread)}
      onSendToMain={(text) => addSideChatMessageToMainDraft(threadId, text)}
      onOpenExisting={(threadId, title) =>
        useRightPanelStore.getState().openSideChat(activeThreadRef, threadId, title)
      }
      onCreateNew={() => {
        void addSideChatSurface(true);
      }}
      modelChoices={sideChatModelChoices}
      onRuntimeModeChange={async (runtimeMode) => {
        const result = await setRuntimeMode({
          environmentId: activeThreadRef.environmentId,
          input: {
            threadId: ThreadIdSchema.make(threadId),
            runtimeMode,
            createdAt: new Date().toISOString(),
          },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      }}
      composerRichTextEnabled={composerRichTextEnabled}
      onInterrupt={async () => {
        const sideThreadId = ThreadIdSchema.make(threadId);
        const sideShell = readThreadShell(
          scopeThreadRef(activeThreadRef.environmentId, sideThreadId),
        );
        if (!sideShell || sideShell.parentThreadId !== activeThreadRef.threadId) return;
        useJevStore.getState().cancelPending({
          environmentId: activeThreadRef.environmentId,
          threadId: sideThreadId,
        });
        const result = await interruptThreadTurn({
          environmentId: activeThreadRef.environmentId,
          input: buildThreadTurnInterruptInput(sideShell),
        });
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          throw squashAtomCommandFailure(result);
        }
      }}
      onModelChange={(selection) => {
        void updateThreadMetadata({
          environmentId: activeThreadRef.environmentId,
          input: {
            threadId: ThreadIdSchema.make(threadId),
            modelSelection: selection,
          },
        }).then((result) => {
          if (result._tag === "Failure") {
            toastManager.add(
              stackedThreadToast({
                type: "error",
                title: "Couldn't change side-chat model",
                description: String(squashAtomCommandFailure(result)),
              }),
            );
          } else {
            useJevStore
              .getState()
              .setSideRoutingMode(activeThreadRef.environmentId, threadId, "manual");
          }
        });
      }}
      onRenameSideChat={async (threadId, title) => {
        const result = await updateThreadMetadata({
          environmentId: activeThreadRef.environmentId,
          input: { threadId: ThreadIdSchema.make(threadId), title },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        useRightPanelStore.getState().openSideChat(activeThreadRef, threadId, title);
      }}
      onArchiveSideChat={async (threadId) => {
        const sideRef = scopeThreadRef(
          activeThreadRef.environmentId,
          ThreadIdSchema.make(threadId),
        );
        const shell = readThreadShell(sideRef);
        if (!shell || shell.parentThreadId !== activeThreadRef.threadId) return;
        const result = await archiveThread(sideRef);
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      }}
      onRestoreSideChat={async (threadId) => {
        const sideRef = scopeThreadRef(
          activeThreadRef.environmentId,
          ThreadIdSchema.make(threadId),
        );
        const result = await unarchiveThread(sideRef);
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      }}
      onDeleteSideChat={async (threadId) => {
        const sideRef = scopeThreadRef(
          activeThreadRef.environmentId,
          ThreadIdSchema.make(threadId),
        );
        const shell = readThreadShell(sideRef);
        if (!shell || shell.parentThreadId !== activeThreadRef.threadId) return;
        const result = await deleteSideThread(sideRef);
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      }}
      {...(sideDraftInsertion?.threadId === threadId ? { draftInsertion: sideDraftInsertion } : {})}
      jevEnabled={isElectron && jevEnabled}
      jevAuto={isElectron && jevEnabled && sideJevAuto}
      onJevAutoChange={(enabled) =>
        useJevStore
          .getState()
          .setSideRoutingMode(activeThreadRef.environmentId, threadId, enabled ? "auto" : "manual")
      }
      onSendAnswerToMain={(text) => sendSideChatAnswerToMain(threadId, text)}
    />
  );
}
