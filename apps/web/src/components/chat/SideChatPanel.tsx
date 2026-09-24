import { useEnvironmentThread } from "~/state/threads";
import type {
  EnvironmentThread,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { collectAssistantCitations } from "@t3tools/shared/assistantCitations";
import {
  ThreadId,
  type EnvironmentId,
  type ModelSelection,
  type ProviderOptionSelection,
  type OrchestrationMessage,
  type RuntimeMode,
  type ScopedThreadRef,
  type TurnId,
} from "@t3tools/contracts";
import {
  Check,
  Archive,
  CornerUpRight,
  MessageSquareText,
  Pencil,
  Plus,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
  ArchiveRestore,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Option from "effect/Option";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { readThreadShell, useThreadShell, useThreadShellsForProjectRefs } from "~/state/entities";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useRightPanelStore } from "~/rightPanelStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import ChatMarkdown from "../ChatMarkdown";
import { Select, SelectItem, SelectPopup, SelectValue } from "../ui/select";
import { AssistantCitationChip } from "./AssistantCitationChip";
import { Switch } from "../ui/switch";
import { CodexTurnUsage } from "./CodexTurnUsage";
import { ComposerSurface } from "./ComposerSurface";
import { ComposerSelectControl } from "./ComposerControl";
import { runtimeModeConfig, runtimeModeOptions } from "./runtimeModeConfig";
import { SideChatPendingRequests } from "./SideChatPendingRequests";
import { ComposerPromptEditor, type ComposerPromptEditorHandle } from "../ComposerPromptEditor";
import { EMPTY_COMPOSER_CONTEXT_RECORDS } from "../composerContextPresentation";
import { useArchivedThreadSnapshots } from "~/lib/archivedThreadsState";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";

type SideChatModelChoice = {
  label: string;
  selection: ModelSelection;
  efforts: ReadonlyArray<{ id: string; label: string }>;
};
const EMPTY_MODEL_CHOICES: ReadonlyArray<SideChatModelChoice> = [];
const EMPTY_EFFORTS: ReadonlyArray<{ id: string; label: string }> = [];
const EMPTY_SKILLS: ReadonlyArray<never> = [];

function VisibleSideChatTurnUsage({
  environmentId,
  threadId,
  turnId,
  isLatestTurn,
  isUnsettled,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  turnId: TurnId;
  isLatestTurn: boolean;
  isUnsettled: boolean;
}) {
  const markerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const marker = markerRef.current;
    if (!marker || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: "400px" },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div ref={markerRef} className="mt-1">
      {visible ? (
        <CodexTurnUsage
          environmentId={environmentId}
          threadId={threadId}
          turnId={turnId}
          isLatestTurn={isLatestTurn}
          isUnsettled={isUnsettled}
        />
      ) : null}
    </div>
  );
}

const SideChatTranscript = memo(function SideChatTranscript({
  messages,
  threadRef,
  cwd,
  latestTurnId,
  isCurrentTurnRunning,
  progressSummary,
  loading,
  loadError,
  busy,
  onHandoff,
  onSendAnswerToMain,
}: {
  messages: ReadonlyArray<OrchestrationMessage>;
  threadRef: ScopedThreadRef;
  cwd: string | undefined;
  latestTurnId: TurnId | undefined;
  isCurrentTurnRunning: boolean;
  progressSummary: string | undefined;
  loading: boolean;
  loadError: string | null;
  busy: boolean;
  onHandoff: (text: string) => void;
  onSendAnswerToMain?: (text: string) => void;
}) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const followTranscriptRef = useRef(true);
  const finalAssistantMessageIds = useMemo(() => {
    const finalIds = new Set<string>();
    const seenTurnIds = new Set<TurnId>();
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]!;
      if (message.role !== "assistant" || !message.turnId || seenTurnIds.has(message.turnId)) {
        continue;
      }
      seenTurnIds.add(message.turnId);
      finalIds.add(message.id);
    }
    return finalIds;
  }, [messages]);
  const lastMessageText = messages.at(-1)?.text;

  useEffect(() => {
    if (
      (!lastMessageText && !isCurrentTurnRunning && !progressSummary) ||
      !followTranscriptRef.current
    )
      return;
    const frame = requestAnimationFrame(() => {
      const viewport = transcriptRef.current?.querySelector<HTMLElement>(
        '[data-slot="scroll-area-viewport"]',
      );
      if (viewport && followTranscriptRef.current) viewport.scrollTop = viewport.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [lastMessageText, progressSummary, isCurrentTurnRunning]);

  return (
    <ScrollArea
      ref={transcriptRef}
      className="min-h-0 flex-1"
      onScrollCapture={(event) => {
        const viewport = event.currentTarget.querySelector<HTMLElement>(
          '[data-slot="scroll-area-viewport"]',
        );
        if (!viewport) return;
        followTranscriptRef.current =
          viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 72;
      }}
    >
      <div className="space-y-3 p-3">
        {messages.length === 0 ? (
          <div className="mx-auto mt-8 max-w-56 text-center text-xs text-muted-foreground">
            <MessageSquareText className="mx-auto mb-2 size-5 opacity-60" />
            {loadError ??
              (loading
                ? "Loading side chat…"
                : "Ask a question while the main chat keeps working.")}
          </div>
        ) : (
          messages.map((message) => (
            <article
              key={message.id}
              className={message.role === "user" ? "flex justify-end" : "min-w-0 px-1 py-0.5"}
            >
              <div
                className={
                  message.role === "user"
                    ? "max-w-[85%] min-w-0 rounded-2xl bg-message p-3 text-message-foreground"
                    : "min-w-0"
                }
              >
                <h3 className="sr-only select-none">
                  {message.role === "user" ? "You" : "T3 Code"}
                </h3>
                <ChatMarkdown
                  text={message.text}
                  cwd={cwd}
                  threadRef={threadRef}
                  isStreaming={message.streaming}
                  className="break-words text-sm"
                />
                {message.role === "assistant" &&
                message.turnId &&
                finalAssistantMessageIds.has(message.id) ? (
                  <VisibleSideChatTurnUsage
                    environmentId={threadRef.environmentId}
                    threadId={threadRef.threadId}
                    turnId={message.turnId}
                    isLatestTurn={latestTurnId === message.turnId}
                    isUnsettled={latestTurnId === message.turnId && isCurrentTurnRunning}
                  />
                ) : null}
                {message.role === "assistant" && !message.streaming ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => onHandoff(message.text)}
                    >
                      <CornerUpRight /> Add to main draft
                    </Button>
                    {onSendAnswerToMain ? (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={busy}
                        onClick={() => onSendAnswerToMain(message.text)}
                      >
                        <Send /> Send to main
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </article>
          ))
        )}
        {isCurrentTurnRunning ? (
          <div
            className="truncate px-1 text-xs text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            Working{progressSummary ? ` · ${progressSummary}` : "…"}
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );
});

function removeCitationMarkers(prompt: string): string {
  const citations = collectAssistantCitations(prompt);
  let prose = prompt;
  for (let index = citations.length - 1; index >= 0; index -= 1) {
    const citation = citations[index]!;
    prose = `${prose.slice(0, citation.start)}${prose.slice(citation.end)}`;
  }
  return prose
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function composeDraftWithCitations(prose: string, markers: ReadonlyArray<string>): string {
  if (markers.length === 0) return prose;
  return [prose.trimEnd(), ...markers].filter(Boolean).join("\n\n");
}

export interface SideChatPanelProps {
  environmentId: EnvironmentId;
  threadId: string;
  parentThreadId: string;
  onSend: (text: string, thread: EnvironmentThread | null) => Promise<void>;
  onSendToMain: (text: string) => Promise<void>;
  onOpenExisting?: (threadId: string, title: string) => void;
  onCreateNew?: () => void;
  onRuntimeModeChange?: (mode: RuntimeMode) => Promise<void>;
  onSendAnswerToMain?: (text: string) => Promise<void>;
  draftInsertion?: { id: string; text: string };
  modelChoices?: ReadonlyArray<SideChatModelChoice>;
  onModelChange?: (selection: ModelSelection) => void;
  onRenameSideChat?: (threadId: string, title: string) => Promise<void> | void;
  onArchiveSideChat?: (threadId: string) => Promise<void>;
  onRestoreSideChat?: (threadId: string) => Promise<void>;
  onDeleteSideChat?: (threadId: string) => Promise<void>;
  jevEnabled?: boolean;
  jevAuto?: boolean;
  onJevAutoChange?: (enabled: boolean) => void;
  composerRichTextEnabled?: boolean;
  onInterrupt?: () => Promise<void>;
}

function latestActivityLabel(shell: EnvironmentThreadShell): string {
  if (shell.latestTurn?.state === "running" || shell.session?.activeTurnId) return "Working";
  if (shell.latestTurn?.state === "error" || shell.session?.status === "error") {
    return "Needs attention";
  }
  if (shell.latestTurn?.state === "interrupted" || shell.session?.status === "interrupted") {
    return "Paused";
  }
  return shell.latestTurn?.state === "completed" ? "Ready" : "New";
}

function modelKey(selection: ModelSelection | undefined): string {
  return selection ? `${selection.instanceId}:${selection.model}` : "";
}

function currentEffort(selection: ModelSelection | undefined): string | undefined {
  const value = selection?.options?.find((option) => option.id === "reasoningEffort")?.value;
  return typeof value === "string" ? value : undefined;
}

function withEffort(selection: ModelSelection, effort: string): ModelSelection {
  const options = (selection.options ?? []).filter((option) => option.id !== "reasoningEffort");
  return {
    ...selection,
    options: [
      ...options,
      { id: "reasoningEffort", value: effort } satisfies ProviderOptionSelection,
    ],
  };
}

function withoutEffort(selection: ModelSelection): ModelSelection {
  const options = (selection.options ?? []).filter((option) => option.id !== "reasoningEffort");
  const nextSelection = { ...selection };
  if (options.length > 0) nextSelection.options = options;
  else delete nextSelection.options;
  return nextSelection;
}

function ArchivedSideChats({
  environmentId,
  parentThreadId,
  busyId,
  onRestore,
}: {
  environmentId: EnvironmentId;
  parentThreadId: string;
  busyId: string | null;
  onRestore: (id: string) => void;
}) {
  const environmentIds = useMemo(() => [environmentId], [environmentId]);
  const { snapshots, error, isLoading } = useArchivedThreadSnapshots(environmentIds);
  const archived = useMemo(
    () =>
      snapshots
        .flatMap(({ snapshot }) => snapshot.threads)
        .filter((shell) => shell.parentThreadId === ThreadId.make(parentThreadId))
        .sort((left, right) => (right.archivedAt ?? "").localeCompare(left.archivedAt ?? "")),
    [snapshots, parentThreadId],
  );

  if (error) return <p className="px-2 py-2 text-xs text-destructive">{error}</p>;
  if (isLoading && archived.length === 0)
    return <p className="px-2 py-2 text-xs text-muted-foreground">Loading archived chats…</p>;
  if (archived.length === 0)
    return <p className="px-2 py-2 text-xs text-muted-foreground">No archived side chats.</p>;

  return (
    <div className="max-h-36 space-y-0.5 overflow-y-auto">
      {archived.map((shell) => (
        <div key={shell.id} className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1">
          <span className="min-w-0 flex-1 truncate text-xs">{shell.title}</span>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Restore ${shell.title}`}
            disabled={busyId !== null}
            onClick={() => onRestore(shell.id)}
          >
            <ArchiveRestore />
          </Button>
        </div>
      ))}
    </div>
  );
}

export function SideChatPanel({
  environmentId,
  threadId,
  parentThreadId,
  onSend,
  onSendToMain,
  onOpenExisting,
  onCreateNew,
  onRuntimeModeChange,
  onSendAnswerToMain,
  draftInsertion,
  modelChoices,
  onModelChange,
  onRenameSideChat,
  onArchiveSideChat,
  onRestoreSideChat,
  onDeleteSideChat,
  jevEnabled = false,
  jevAuto = false,
  onJevAutoChange,
  composerRichTextEnabled = false,
  onInterrupt,
}: SideChatPanelProps) {
  const availableModelChoices = modelChoices ?? EMPTY_MODEL_CHOICES;
  const threadState = useEnvironmentThread(environmentId, ThreadId.make(threadId));
  const thread = Option.getOrNull(threadState.data);
  const parentThreadRef = useMemo(
    () => scopeThreadRef(environmentId, ThreadId.make(parentThreadId)),
    [environmentId, parentThreadId],
  );
  const parentShell = useThreadShell(parentThreadRef);
  const projectId = parentShell?.projectId ?? thread?.projectId;
  const projectRefs = useMemo(
    () => (projectId ? [{ environmentId, projectId }] : []),
    [environmentId, projectId],
  );
  const threadShells = useThreadShellsForProjectRefs(projectRefs);
  const relatedSideChats = useMemo(
    () =>
      threadShells
        .filter(
          (shell) =>
            shell.environmentId === environmentId &&
            shell.parentThreadId === ThreadId.make(parentThreadId) &&
            shell.archivedAt === null,
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [threadShells, environmentId, parentThreadId],
  );
  const activeShell = relatedSideChats.find((shell) => shell.id === ThreadId.make(threadId));
  const threadWithEnvironment: EnvironmentThread | null = thread
    ? { ...thread, environmentId }
    : null;
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, ThreadId.make(threadId)),
    [environmentId, threadId],
  );
  const draft = useComposerDraftStore((state) => state.getComposerDraft(threadRef)?.prompt ?? "");
  const citationMatches = useMemo(() => collectAssistantCitations(draft), [draft]);
  const draftProse = useMemo(() => removeCitationMarkers(draft), [draft]);
  const setDraft = useComposerDraftStore((state) => state.setPrompt);
  const [busy, setBusy] = useState(false);
  const [runtimeModeBusy, setRuntimeModeBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [lifecycleBusyId, setLifecycleBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [editorCursor, setEditorCursor] = useState(0);
  const [interruptBusy, setInterruptBusy] = useState(false);
  const editorRef = useRef<ComposerPromptEditorHandle>(null);
  const seenInsertionIdRef = useRef<string | null>(null);
  const openSurfaces = useRightPanelStore(
    (state) => state.byThreadKey[scopedThreadKey(parentThreadRef)]?.surfaces ?? [],
  );
  const openSurfaceIds = useMemo<ReadonlySet<string>>(
    () => new Set(openSurfaces.map((surface) => surface.id)),
    [openSurfaces],
  );
  const messages = useMemo(
    () =>
      (thread?.messages ?? []).filter(
        (message) => message.role === "user" || message.role === "assistant",
      ),
    [thread?.messages],
  );
  const currentSelection = activeShell?.modelSelection;
  const currentChoice = availableModelChoices.find(
    (choice) => modelKey(choice.selection) === modelKey(currentSelection),
  );
  const visibleSideChats = relatedSideChats.filter((shell) =>
    shell.title.toLocaleLowerCase().includes(searchTerm.trim().toLocaleLowerCase()),
  );
  const deleteTargetRunning = relatedSideChats.some(
    (shell) =>
      shell.id === deleteTarget?.id &&
      (shell.latestTurn?.state === "running" || !!shell.session?.activeTurnId),
  );
  const isCurrentTurnRunning =
    activeShell?.latestTurn?.state === "running" || !!activeShell?.session?.activeTurnId;
  const currentTurnId = thread?.session?.activeTurnId ?? thread?.latestTurn?.turnId;
  const progressSummary = useMemo(
    () =>
      currentTurnId
        ? thread?.activities.findLast((activity) => activity.turnId === currentTurnId)?.summary
        : undefined,
    [thread?.activities, currentTurnId],
  );
  const useJevAuto = jevEnabled && jevAuto;
  const runtimeMode = activeShell?.runtimeMode ?? "approval-required";
  const RuntimeModeIcon = runtimeModeConfig[runtimeMode].icon;

  useEffect(() => {
    if (!draftInsertion || seenInsertionIdRef.current === draftInsertion.id) return;
    seenInsertionIdRef.current = draftInsertion.id;
    const currentDraft = useComposerDraftStore.getState().getComposerDraft(threadRef)?.prompt ?? "";
    setDraft(
      threadRef,
      currentDraft.trim()
        ? `${currentDraft.replace(/\s+$/, "")}\n\n${draftInsertion.text}`
        : draftInsertion.text,
    );
    requestAnimationFrame(() => editorRef.current?.focusAtEnd());
  }, [draftInsertion, setDraft, threadRef]);

  const send = async (action: (text: string) => Promise<void>) => {
    const text = draft.trim();
    if (!text || busy || runtimeModeBusy) return;
    setBusy(true);
    setError(null);
    try {
      await action(text);
      const currentDraft =
        useComposerDraftStore.getState().getComposerDraft(threadRef)?.prompt ?? "";
      if (currentDraft.trim() === text) setDraft(threadRef, "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to send this message.");
    } finally {
      setBusy(false);
    }
  };
  const handoff = useCallback(
    async (text: string) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await onSendToMain(text);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Unable to add this to the main chat.");
      } finally {
        setBusy(false);
      }
    },
    [busy, onSendToMain],
  );
  const sendAnswerToMain = useCallback(
    async (text: string) => {
      if (!onSendAnswerToMain || busy) return;
      setBusy(true);
      setError(null);
      try {
        await onSendAnswerToMain(text);
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Unable to send this answer to the main chat.",
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, onSendAnswerToMain],
  );
  const interrupt = async () => {
    if (!onInterrupt || interruptBusy) return;
    setInterruptBusy(true);
    setError(null);
    try {
      await onInterrupt();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to stop this side chat.");
    } finally {
      setInterruptBusy(false);
    }
  };
  const startRename = (id: string, title: string) => {
    setRenamingId(id);
    setRenameValue(title);
  };
  const saveRename = async () => {
    const title = renameValue.trim();
    if (!renamingId || !title || !onRenameSideChat || renameBusy) return;
    setRenameBusy(true);
    try {
      await onRenameSideChat(renamingId, title);
      setRenamingId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to rename this side chat.");
    } finally {
      setRenameBusy(false);
    }
  };
  const closeSideChat = (id: string) => {
    useRightPanelStore.getState().closeSurface(parentThreadRef, `side-chat:${id}`);
  };
  const archiveSideChat = async (id: string) => {
    if (!onArchiveSideChat || lifecycleBusyId) return;
    setLifecycleBusyId(id);
    setError(null);
    try {
      await onArchiveSideChat(id);
      closeSideChat(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to archive this side chat.");
    } finally {
      setLifecycleBusyId(null);
    }
  };
  const restoreSideChat = async (id: string) => {
    if (!onRestoreSideChat || lifecycleBusyId) return;
    setLifecycleBusyId(id);
    setError(null);
    try {
      await onRestoreSideChat(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to restore this side chat.");
    } finally {
      setLifecycleBusyId(null);
    }
  };
  const deleteSideChat = async () => {
    if (!deleteTarget || !onDeleteSideChat || lifecycleBusyId) return;
    const id = deleteTarget.id;
    const current = readThreadShell(scopeThreadRef(environmentId, ThreadId.make(id)));
    if (current?.latestTurn?.state === "running" || current?.session?.activeTurnId) {
      setError("Wait for this side chat to finish or stop its turn before deleting it.");
      return;
    }
    setLifecycleBusyId(id);
    setError(null);
    try {
      await onDeleteSideChat(id);
      setDeleteTarget(null);
      closeSideChat(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete this side chat.");
    } finally {
      setLifecycleBusyId(null);
    }
  };
  const selectedEffort = currentEffort(currentSelection);
  const currentEfforts = currentChoice?.efforts ?? EMPTY_EFFORTS;
  const modelSelectValue = modelKey(currentSelection);
  const updateDraftProse = (prose: string) =>
    setDraft(
      threadRef,
      composeDraftWithCitations(
        prose,
        citationMatches.map((item) => item.source),
      ),
    );
  const removeCitation = (index: number) => {
    const markers = citationMatches
      .filter((_, matchIndex) => matchIndex !== index)
      .map((item) => item.source);
    setDraft(threadRef, composeDraftWithCitations(draftProse, markers));
  };

  const modelControls =
    availableModelChoices.length > 0 && currentSelection && onModelChange ? (
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {jevEnabled && onJevAutoChange ? (
          <label className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-[10px] text-muted-foreground">
            <Switch
              size="sm"
              checked={useJevAuto}
              disabled={isCurrentTurnRunning}
              aria-label="Use Jev Auto for this side chat"
              onCheckedChange={(checked) => onJevAutoChange(checked === true)}
            />
            <Sparkles className="size-3" />
            {useJevAuto ? "Jev Auto" : "Manual"}
          </label>
        ) : null}
        <Select
          value={modelSelectValue}
          disabled={isCurrentTurnRunning}
          onValueChange={(value) => {
            const next = availableModelChoices.find(
              (choice) => modelKey(choice.selection) === value,
            );
            if (next) onModelChange(next.selection);
          }}
        >
          <ComposerSelectControl
            size="xs"
            className="min-w-0 max-w-48 flex-1"
            aria-label={useJevAuto ? "Fallback model preference" : "Side chat model"}
          >
            <SelectValue>{currentChoice?.label ?? currentSelection.model}</SelectValue>
          </ComposerSelectControl>
          <SelectPopup>
            {availableModelChoices.map((choice) => (
              <SelectItem key={modelKey(choice.selection)} value={modelKey(choice.selection)}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        {currentEfforts.length > 0 ? (
          <Select
            value={selectedEffort ?? "__default"}
            disabled={isCurrentTurnRunning}
            onValueChange={(value) => {
              if (!currentSelection || value === null) return;
              onModelChange(
                value === "__default"
                  ? withoutEffort(currentSelection)
                  : withEffort(currentSelection, value),
              );
            }}
          >
            <ComposerSelectControl
              size="xs"
              className="max-w-28"
              aria-label={useJevAuto ? "Fallback effort preference" : "Side chat effort"}
            >
              <SelectValue>
                {currentEfforts.find((effort) => effort.id === selectedEffort)?.label ??
                  "Default effort"}
              </SelectValue>
            </ComposerSelectControl>
            <SelectPopup align="end">
              <SelectItem value="__default">Default</SelectItem>
              {currentEfforts.map((effort) => (
                <SelectItem key={effort.id} value={effort.id}>
                  {effort.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : null}
        {useJevAuto ? (
          <span className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-[10px] font-medium text-muted-foreground">
            Fallback
          </span>
        ) : null}
      </div>
    ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="space-y-2 border-b px-3 py-2.5">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
            <MessageSquareText className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-medium">{activeShell?.title ?? "Side chat"}</h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>
                {activeShell?.sideChatOwnsWorktree ? "Isolated worktree" : "Main checkout"}
              </span>
              {isCurrentTurnRunning ? <span className="text-foreground">· Working</span> : null}
            </div>
          </div>
          {onCreateNew ? (
            <Button size="xs" variant="outline" className="shrink-0" onClick={onCreateNew}>
              <Plus /> New
            </Button>
          ) : null}
        </div>

        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Uses completed main-chat history when available. The current in-progress turn is not
          included.
        </p>
      </header>

      <section aria-label="Side chats" className="border-b bg-muted/20 px-2 py-2">
        <div className="mb-1.5 flex items-center justify-between px-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Side chats <span className="font-normal">{relatedSideChats.length}</span>
          </span>
        </div>
        {relatedSideChats.length > 3 ? (
          <label className="mb-1.5 flex h-7 items-center gap-1.5 rounded-md border bg-background px-2 text-muted-foreground focus-within:ring-1 focus-within:ring-ring">
            <Search className="size-3.5 shrink-0" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Find a side chat"
              aria-label="Find a side chat"
              className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
            {searchTerm ? (
              <button type="button" aria-label="Clear search" onClick={() => setSearchTerm("")}>
                <X className="size-3" />
              </button>
            ) : null}
          </label>
        ) : null}
        {visibleSideChats.length > 0 ? (
          <div className="max-h-36 space-y-0.5 overflow-y-auto">
            {visibleSideChats.map((sideChat) => {
              const isCurrent = sideChat.id === ThreadId.make(threadId);
              const surfaceId = `side-chat:${sideChat.id}`;
              const isOpen = openSurfaceIds.has(surfaceId);
              const status = latestActivityLabel(sideChat);
              return (
                <div
                  key={sideChat.id}
                  className={`flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 ${isCurrent ? "bg-accent/70" : "hover:bg-accent/50"}`}
                >
                  {renamingId === sideChat.id ? (
                    <>
                      <input
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void saveRename();
                          if (event.key === "Escape") setRenamingId(null);
                        }}
                        autoFocus
                        maxLength={80}
                        aria-label="Side chat title"
                        className="h-6 min-w-0 flex-1 rounded border bg-background px-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Save title"
                        disabled={!renameValue.trim() || renameBusy}
                        onClick={() => void saveRename()}
                      >
                        <Check />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Cancel rename"
                        onClick={() => setRenamingId(null)}
                      >
                        <X />
                      </Button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        aria-current={isCurrent ? "page" : undefined}
                        onClick={() => onOpenExisting?.(sideChat.id, sideChat.title)}
                        disabled={!onOpenExisting || isCurrent}
                      >
                        <span
                          className={`size-1.5 shrink-0 rounded-full ${status === "Working" ? "bg-blue-500" : status === "Needs attention" ? "bg-destructive" : "bg-muted-foreground/40"}`}
                        />
                        <span className="truncate text-xs">{sideChat.title}</span>
                        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                          {isCurrent ? "Here" : `${isOpen ? "Open" : "Closed"} · ${status}`}
                        </span>
                      </button>
                      {onRenameSideChat ? (
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Rename ${sideChat.title}`}
                          onClick={() => startRename(sideChat.id, sideChat.title)}
                        >
                          <Pencil />
                        </Button>
                      ) : null}
                      {onArchiveSideChat ? (
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Archive ${sideChat.title}`}
                          disabled={lifecycleBusyId !== null || status === "Working"}
                          onClick={() => void archiveSideChat(sideChat.id)}
                        >
                          <Archive />
                        </Button>
                      ) : null}
                      {onDeleteSideChat ? (
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Delete ${sideChat.title}`}
                          disabled={lifecycleBusyId !== null || status === "Working"}
                          onClick={() =>
                            setDeleteTarget({ id: sideChat.id, title: sideChat.title })
                          }
                        >
                          <Trash2 />
                        </Button>
                      ) : null}
                      {!isCurrent && isOpen ? (
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Close ${sideChat.title}`}
                          onClick={() => closeSideChat(sideChat.id)}
                        >
                          <X />
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            {relatedSideChats.length === 0
              ? "Start a side chat to keep a focused thread alongside the planner."
              : "No matching side chats."}
          </p>
        )}
        {onRestoreSideChat ? (
          <div className="mt-1 border-t pt-1">
            <button
              type="button"
              className="w-full rounded px-1.5 py-1 text-left text-xs text-muted-foreground hover:bg-accent/50"
              aria-expanded={showArchived}
              onClick={() => setShowArchived((current) => !current)}
            >
              Archived side chats {showArchived ? "▴" : "▾"}
            </button>
            {showArchived ? (
              <ArchivedSideChats
                environmentId={environmentId}
                parentThreadId={parentThreadId}
                busyId={lifecycleBusyId}
                onRestore={(id) => void restoreSideChat(id)}
              />
            ) : null}
          </div>
        ) : null}
      </section>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete side chat “{deleteTarget?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes its conversation. If it owns an isolated worktree, cleanup
              follows your storage settings; local changes may keep the worktree on disk.
              {deleteTargetRunning
                ? " Stop its running turn before deleting this side chat."
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="outline" disabled={lifecycleBusyId !== null} />}
            >
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              disabled={lifecycleBusyId !== null || deleteTargetRunning}
              onClick={() => void deleteSideChat()}
            >
              Delete side chat
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      <SideChatTranscript
        messages={messages}
        threadRef={threadRef}
        cwd={thread?.worktreePath ?? undefined}
        latestTurnId={thread?.latestTurn?.turnId}
        isCurrentTurnRunning={isCurrentTurnRunning}
        progressSummary={progressSummary}
        loading={!thread && threadState.status !== "deleted"}
        loadError={Option.getOrNull(threadState.error)}
        busy={busy}
        onHandoff={handoff}
        {...(onSendAnswerToMain ? { onSendAnswerToMain: sendAnswerToMain } : {})}
      />
      <SideChatPendingRequests
        environmentId={environmentId}
        threadId={threadId}
        activities={thread?.activities ?? []}
      />
      <div className="border-t px-3 py-3">
        <ComposerSurface.Shell>
          <ComposerSurface.Host>
            <ComposerSurface.Main>
              <form
                className="min-w-0"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send((text) => onSend(text, threadWithEnvironment));
                }}
              >
                {citationMatches.length > 0 ? (
                  <div
                    className="flex flex-wrap items-center gap-1.5 px-3 pt-3"
                    role="group"
                    aria-label="Cited assistant excerpts"
                  >
                    {citationMatches.map(({ citation }, index) => {
                      const citationLabel = (citation.comment?.trim() || citation.text)
                        .replace(/\s+/g, " ")
                        .slice(0, 48);
                      return (
                        <span
                          key={`${citation.environmentId}:${citation.threadId}:${citation.messageId}:${citation.start}:${citation.end}`}
                          className="inline-flex max-w-full items-center gap-0.5"
                        >
                          <AssistantCitationChip citation={citation} composer />
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            aria-label={`Remove citation ${index + 1}: ${citationLabel}`}
                            onClick={() => removeCitation(index)}
                          >
                            <X />
                          </Button>
                        </span>
                      );
                    })}
                  </div>
                ) : null}
                <div className="px-3 pt-3" role="group" aria-label="Side chat message">
                  <ComposerPromptEditor
                    editorRef={editorRef}
                    richTextEnabled={composerRichTextEnabled}
                    value={draftProse}
                    cursor={editorCursor}
                    contextRecords={EMPTY_COMPOSER_CONTEXT_RECORDS}
                    skills={EMPTY_SKILLS}
                    disabled={false}
                    placeholder="Ask a question or describe a change…"
                    className="min-h-20 max-h-48"
                    onChange={(value, cursor) => {
                      setEditorCursor(cursor);
                      updateDraftProse(value);
                    }}
                    onCommandKeyDown={(key, event) => {
                      if (key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return false;
                      void send((text) => onSend(text, threadWithEnvironment));
                      return true;
                    }}
                    onPaste={() => {}}
                  />
                </div>
                <div
                  className="flex min-w-0 flex-wrap items-center gap-1 px-2 pt-1"
                  role="group"
                  aria-label="Side chat controls"
                >
                  {modelControls}
                  {onRuntimeModeChange ? (
                    <Select
                      value={runtimeMode}
                      disabled={runtimeModeBusy}
                      onValueChange={(value) => {
                        if (!value || value === runtimeMode) return;
                        setRuntimeModeBusy(true);
                        setError(null);
                        void onRuntimeModeChange(value as RuntimeMode)
                          .catch((cause) => {
                            setError(
                              cause instanceof Error ? cause.message : "Unable to change access.",
                            );
                          })
                          .finally(() => setRuntimeModeBusy(false));
                      }}
                    >
                      <ComposerSelectControl size="xs" aria-label="Runtime mode">
                        <RuntimeModeIcon className="size-3" />
                        <SelectValue>{runtimeModeConfig[runtimeMode].label}</SelectValue>
                      </ComposerSelectControl>
                      <SelectPopup align="start">
                        {runtimeModeOptions.map((mode) => {
                          const option = runtimeModeConfig[mode];
                          const OptionIcon = option.icon;
                          return (
                            <SelectItem key={mode} value={mode}>
                              <span className="inline-flex items-center gap-1.5">
                                <OptionIcon className="size-3.5" /> {option.label}
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectPopup>
                    </Select>
                  ) : null}
                  {isCurrentTurnRunning && onInterrupt ? (
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={interruptBusy}
                      onClick={() => void interrupt()}
                    >
                      <Square /> {interruptBusy ? "Stopping…" : "Stop"}
                    </Button>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3 pt-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={!draft.trim() || busy}
                    onClick={() => void send(onSendToMain)}
                  >
                    <CornerUpRight /> Add to main draft
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!draft.trim() || busy || runtimeModeBusy}
                  >
                    <Send />
                    Send
                  </Button>
                </div>
              </form>
            </ComposerSurface.Main>
          </ComposerSurface.Host>
        </ComposerSurface.Shell>
        {error ? (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <p className="mt-2 text-[10px] text-muted-foreground">Ctrl/⌘ Enter to send</p>
      </div>
    </div>
  );
}
