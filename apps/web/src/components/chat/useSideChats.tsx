import { useCallback, useMemo, useState } from "react";
import type { AssistantCitation, ProviderDriverKind, ScopedThreadRef } from "@t3tools/contracts";
import { ThreadId as ThreadIdSchema } from "@t3tools/contracts";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { DraftId } from "~/composerDraftStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import { newMessageId, newThreadId } from "~/lib/utils";
import { useRightPanelStore } from "~/rightPanelStore";
import { readThreadShell, useThreadShellsForProjectRefs } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import type { Thread } from "~/types";
import { SideChatPanel } from "./SideChatPanel";
import { stackedThreadToast, toastManager } from "../ui/toast";
import type { useThreadActions } from "~/hooks/useThreadActions";

type SideChatInput = {
  activeThreadRef: ScopedThreadRef | null;
  activeServerThread: Thread | null;
  selectedProvider: ProviderDriverKind | null;
  composerDraftTarget: ScopedThreadRef | DraftId;
  lifecycle: Pick<ReturnType<typeof useThreadActions>, "archiveThread" | "unarchiveThread"> & {
    deleteSideThread: ReturnType<typeof useThreadActions>["deleteThread"];
  };
};

export function useSideChats(input: SideChatInput) {
  const { activeThreadRef, activeServerThread, selectedProvider, composerDraftTarget, lifecycle } =
    input;
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
  const [sideDraftInsertion, setSideDraftInsertion] = useState<{
    threadId: string;
    id: string;
    text: string;
  } | null>(null);
  const acknowledgeSideDraftInsertion = useCallback((id: string) => {
    setSideDraftInsertion((current) => (current?.id === id ? null : current));
  }, []);
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
              thread.parentThreadId === activeServerThread.id &&
              thread.archivedAt === null,
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
          interactionMode: activeServerThread.interactionMode,
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
    acknowledgeSideDraftInsertion,
    addSideChatSurface,
    askInSideChat,
    addSideChatMessageToMainDraft,
    sendSideChatAnswerToMain,
    updateThreadMetadata,
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
    acknowledgeSideDraftInsertion,
    addSideChatSurface,
    addSideChatMessageToMainDraft,
    sendSideChatAnswerToMain,
    updateThreadMetadata,
  } = controller;
  if (!activeThreadRef) return null;
  return (
    <SideChatPanel
      environmentId={activeThreadRef.environmentId}
      threadId={threadId}
      parentThreadId={activeThreadRef.threadId}
      onSendToMain={(text) => addSideChatMessageToMainDraft(threadId, text)}
      onDraftInsertionHandled={acknowledgeSideDraftInsertion}
      onOpenExisting={(threadId, title) =>
        useRightPanelStore.getState().openSideChat(activeThreadRef, threadId, title)
      }
      onCreateNew={() => {
        void addSideChatSurface(true);
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
      onSendAnswerToMain={(text) => sendSideChatAnswerToMain(threadId, text)}
    />
  );
}
