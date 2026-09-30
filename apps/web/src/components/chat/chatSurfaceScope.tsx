import { createContext, type RefObject } from "react";

export type ChatSurfaceScope = {
  activeSurfaceKey: RefObject<string>;
  surfaceKey: string;
};

// Side chats share keyboard ownership with their containing chat, including
// controls rendered in a portal after focus leaves the chat DOM.
export const ChatSurfaceScopeContext = createContext<ChatSurfaceScope | null>(null);

export function chatSurfaceKeyFromEvent(event: Event): string | null {
  const path = event.composedPath();
  if (path.length === 0 && event.target) path.push(event.target);
  for (const target of path) {
    if (!(target instanceof Element)) continue;
    const surface = target.closest<HTMLElement>("[data-chat-surface]");
    if (surface) return surface.dataset.chatSurface ?? null;
  }
  return null;
}

export function chatSurfaceOwnsEvent(
  event: Event,
  surfaceKey: string,
  activeSurfaceKey: string,
): boolean {
  return (chatSurfaceKeyFromEvent(event) ?? activeSurfaceKey) === surfaceKey;
}

// A side chat is itself a panel. Close its own nested panel first, then its
// containing side panel; only a chat with neither should allow native close.
export function closeChatSurfacePanel(
  event: KeyboardEvent,
  closeOwnPanel: (() => void) | undefined,
  closeContainingPanel: (() => void) | undefined,
): void {
  const close = closeOwnPanel ?? closeContainingPanel;
  if (!close) return;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) close();
}
