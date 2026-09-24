import {
  ASSISTANT_CITATION_MAX_TEXT_LENGTH,
  MessageId,
  type AssistantCitation,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { MessageSquarePlus, QuoteIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  captureAssistantTextSelection,
  type AssistantCitationSourceAnchor,
} from "~/lib/assistantTextSelection";
import {
  observeSelectionActions,
  resolveSelectionActionPosition,
  type SelectionActionPoint,
} from "~/lib/selectionActions";
import { Button } from "../ui/button";

export type AssistantSideChatDestination = { kind: "new" } | { kind: "existing"; threadId: string };

export interface AssistantSideChatOption {
  threadId: string;
  title: string;
}

const EMPTY_SIDE_CHAT_DESTINATIONS: ReadonlyArray<AssistantSideChatOption> = [];

export function AssistantSelectionToolbar({
  viewport,
  threadRef,
  onCite,
  onAskInSideChat,
  sideChatDestinations,
}: {
  viewport: HTMLElement | null;
  threadRef: ScopedThreadRef;
  onCite: (citation: AssistantCitation, sourceAnchor: AssistantCitationSourceAnchor) => boolean;
  onAskInSideChat?: (
    citation: AssistantCitation,
    destination: AssistantSideChatDestination,
  ) => void;
  sideChatDestinations?: ReadonlyArray<AssistantSideChatOption>;
}) {
  const destinations = sideChatDestinations ?? EMPTY_SIDE_CHAT_DESTINATIONS;
  const [selection, setSelection] = useState<{
    citation: AssistantCitation;
    position: SelectionActionPoint;
    sourceAnchor: AssistantCitationSourceAnchor;
  } | null>(null);
  const [destinationPickerOpen, setDestinationPickerOpen] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<ReturnType<typeof observeSelectionActions> | null>(null);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || !selection) return;
    const rect = toolbar.getBoundingClientRect();
    toolbar.style.left = `${Math.max(8, Math.min(selection.position.x, window.innerWidth - rect.width - 8))}px`;
    toolbar.style.top = `${Math.max(8, Math.min(selection.position.y, window.innerHeight - rect.height - 8))}px`;
  }, [selection]);

  useEffect(() => {
    if (!viewport) return;
    const clear = () => {
      setDestinationPickerOpen(false);
      setSelection(null);
    };
    const update = (pointer: SelectionActionPoint | null) => {
      const nativeSelection = window.getSelection();
      const captured = captureAssistantTextSelection(viewport, nativeSelection);
      const messageId = captured?.source.dataset.assistantCitationSource;
      if (!captured || !messageId) {
        clear();
        return;
      }
      const rect = captured.range.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      if (rect.bottom < viewportRect.top || rect.top > viewportRect.bottom || rect.width === 0) {
        clear();
        return;
      }
      const rects = captured.range.getClientRects();
      setDestinationPickerOpen(false);
      setSelection({
        sourceAnchor: { source: captured.source, range: captured.range, viewport },
        citation: {
          version: 1,
          ...threadRef,
          messageId: MessageId.make(messageId),
          ...captured.selector,
        },
        position: resolveSelectionActionPosition({
          bounds: viewportRect,
          selectionRect: rects.item(rects.length - 1) ?? rect,
          pointer,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }),
      });
    };
    const actions = observeSelectionActions({
      element: viewport,
      getActionElement: () => toolbarRef.current,
      onSelection: update,
      onDismiss: clear,
    });
    actionsRef.current = actions;
    const focusActions = (event: KeyboardEvent) => {
      const toolbar = toolbarRef.current;
      if (
        event.key !== "Tab" ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.isComposing ||
        event.defaultPrevented ||
        !toolbar ||
        toolbar.contains(event.target as Node)
      ) {
        return;
      }
      const firstAction = toolbar.querySelector("button");
      if (!firstAction || firstAction.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      firstAction.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", focusActions, true);
    document.addEventListener("selectionchange", actions.selectionChanged);
    return () => {
      document.removeEventListener("keydown", focusActions, true);
      document.removeEventListener("selectionchange", actions.selectionChanged);
      actions.dispose();
      actionsRef.current = null;
    };
  }, [threadRef, viewport]);

  if (!selection) return null;
  const tooLong = selection.citation.text.length > ASSISTANT_CITATION_MAX_TEXT_LENGTH;
  const dismiss = () => {
    actionsRef.current?.cancel();
    setSelection(null);
  };
  const cite = () => {
    if (tooLong || !onCite(selection.citation, selection.sourceAnchor)) return false;
    window.getSelection()?.removeAllRanges();
    dismiss();
    return true;
  };
  const askInSideChat = (destination: AssistantSideChatDestination) => {
    if (tooLong || !onAskInSideChat) return;
    onAskInSideChat(selection.citation, destination);
    setDestinationPickerOpen(false);
    window.getSelection()?.removeAllRanges();
    dismiss();
  };
  return createPortal(
    <div
      ref={toolbarRef}
      className="fixed z-50 flex max-w-[calc(100vw-1rem)] items-center gap-1 rounded-full border border-border/70 bg-background/95 p-1 shadow-lg backdrop-blur"
      style={{ left: selection.position.x, top: selection.position.y }}
      onPointerDown={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          setDestinationPickerOpen(false);
          dismiss();
        }
      }}
    >
      <Button
        type="button"
        size="xs"
        variant="glass"
        disabled={tooLong}
        aria-label={tooLong ? "Selection is too long to cite" : "Cite selection in composer"}
        onClick={cite}
      >
        <QuoteIcon aria-hidden="true" className="size-3.5" />
        {tooLong ? "Shorten selection" : "Cite"}
      </Button>
      {tooLong ? (
        <span role="status" className="px-1 text-xs text-muted-foreground">
          Selection is too long to cite
        </span>
      ) : null}
      {onAskInSideChat ? (
        <div className="relative">
          <Button
            type="button"
            size="xs"
            variant="glass"
            disabled={tooLong}
            aria-label={tooLong ? "Selection is too long to ask about" : "Ask in side chat"}
            aria-haspopup="menu"
            aria-expanded={destinationPickerOpen}
            onClick={() => setDestinationPickerOpen((open) => !open)}
          >
            <MessageSquarePlus aria-hidden="true" className="size-3.5" />
            Ask in side chat
          </Button>
          {destinationPickerOpen ? (
            <div
              role="menu"
              aria-label="Choose a side chat"
              className={`absolute left-0 z-[130] w-64 max-w-[calc(100vw-1rem)] rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg [&_[data-slot=button]]:w-full [&_[data-slot=button]]:justify-start ${selection.position.y > window.innerHeight / 2 ? "bottom-full mb-2" : "top-full mt-2"}`}
            >
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                Start a side chat with this citation
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                role="menuitem"
                onClick={() => askInSideChat({ kind: "new" })}
              >
                <MessageSquarePlus aria-hidden="true" className="size-4 shrink-0" />
                New side chat
              </Button>
              {destinations.length > 0 ? (
                <>
                  <div className="my-1 border-t" />
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    Continue in an existing side chat
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {destinations.map((destination) => (
                      <Button
                        key={destination.threadId}
                        type="button"
                        variant="ghost"
                        size="sm"
                        role="menuitem"
                        title={destination.title}
                        onClick={() =>
                          askInSideChat({ kind: "existing", threadId: destination.threadId })
                        }
                      >
                        <MessageSquarePlus aria-hidden="true" className="size-4 shrink-0" />
                        <span className="min-w-0 truncate">{destination.title}</span>
                      </Button>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
