import { useEnvironmentThread } from "~/state/threads";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { ThreadId, type EnvironmentId } from "@t3tools/contracts";
import {
  Check,
  Archive,
  MessageSquareText,
  Pencil,
  Plus,
  Search,
  Trash2,
  ArchiveRestore,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import * as Option from "effect/Option";
import { Button } from "~/components/ui/button";
import { readThreadShell, useThreadShell, useThreadShellsForProjectRefs } from "~/state/entities";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useRightPanelStore } from "~/rightPanelStore";
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

import ChatView from "../ChatView";

export interface SideChatPanelProps {
  environmentId: EnvironmentId;
  threadId: string;
  parentThreadId: string;
  onSendToMain: (text: string) => Promise<void>;
  onSendAnswerToMain?: (text: string) => Promise<void>;
  onOpenExisting?: (threadId: string, title: string) => void;
  onCreateNew?: () => void;
  draftInsertion?: { id: string; text: string };
  onDraftInsertionHandled?: (id: string) => void;
  onRenameSideChat?: (threadId: string, title: string) => Promise<void> | void;
  onArchiveSideChat?: (threadId: string) => Promise<void>;
  onRestoreSideChat?: (threadId: string) => Promise<void>;
  onDeleteSideChat?: (threadId: string) => Promise<void>;
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
  onSendToMain,
  onSendAnswerToMain,
  onOpenExisting,
  onCreateNew,
  draftInsertion,
  onDraftInsertionHandled,
  onRenameSideChat,
  onArchiveSideChat,
  onRestoreSideChat,
  onDeleteSideChat,
}: SideChatPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const threadState = useEnvironmentThread(environmentId, ThreadId.make(threadId));
  const thread = Option.getOrNull(threadState.data);
  const syncError = Option.getOrNull(threadState.error);
  const displayedError = error ?? syncError;
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
  const [searchTerm, setSearchTerm] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [lifecycleBusyId, setLifecycleBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const openSurfaces = useRightPanelStore(
    (state) => state.byThreadKey[scopedThreadKey(parentThreadRef)]?.surfaces ?? [],
  );
  const openSurfaceIds = useMemo<ReadonlySet<string>>(
    () => new Set(openSurfaces.map((surface) => surface.id)),
    [openSurfaces],
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
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="space-y-2 border-b px-3 py-2.5">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
            <MessageSquareText className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-medium">{activeShell?.title ?? "Side chat"}</h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-3xs text-muted-foreground">
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

        <p className="text-3xs leading-relaxed text-muted-foreground">
          Starts from the main chat’s current context. New messages stay in this side chat.
        </p>
      </header>

      <section aria-label="Side chats" className="border-b bg-muted/20 px-2 py-2">
        <div className="mb-1.5 flex items-center justify-between px-1">
          <span className="text-3xs font-medium uppercase tracking-wide text-muted-foreground">
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
                          className={`size-1.5 shrink-0 rounded-full ${status === "Working" ? "bg-info-foreground" : status === "Needs attention" ? "bg-destructive" : "bg-muted-foreground/40"}`}
                        />
                        <span className="truncate text-xs">{sideChat.title}</span>
                        <span className="ml-auto shrink-0 text-3xs text-muted-foreground">
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

      {displayedError ? (
        <p role="alert" className="px-3 py-2 text-sm text-destructive">
          {displayedError}
        </p>
      ) : null}
      {!thread && syncError ? null : (
        <ChatView
          environmentId={environmentId}
          threadId={ThreadId.make(threadId)}
          routeKind="server"
          threadSyncPhase={!thread && threadState.status !== "deleted" ? "loading" : null}
          reserveTitleBarControlInset={false}
          sideChatSurface={{
            onClose: () => closeSideChat(threadId),
            onNewSideChat: () => onCreateNew?.(),
            ...(onDraftInsertionHandled ? { onDraftInsertionHandled } : {}),
            ...(draftInsertion ? { draftInsertion } : {}),
            onAddToMainDraft: onSendToMain,
            ...(onSendAnswerToMain ? { onSendToMain: onSendAnswerToMain } : {}),
          }}
        />
      )}
    </div>
  );
}
