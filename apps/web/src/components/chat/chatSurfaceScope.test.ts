// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { resolveShortcutCommand } from "../../keybindings";
import { selectActiveRightPanelSurface, useRightPanelStore } from "../../rightPanelStore";
import {
  chatSurfaceKeyFromEvent,
  chatSurfaceOwnsEvent,
  closeChatSurfacePanel,
} from "./chatSurfaceScope";

function makeSurfaces() {
  const main = document.createElement("section");
  main.dataset.chatSurface = "main";
  const side = document.createElement("section");
  side.dataset.chatSurface = "side";
  const editor = document.createElement("textarea");
  side.append(editor);
  main.append(side);
  document.body.append(main);
  return { main, side, editor };
}

afterEach(() => {
  document.body.replaceChildren();
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
});

describe("side chat panel close shortcut", () => {
  const mainRef = scopeThreadRef(EnvironmentId.make("qa"), ThreadId.make("main"));
  const sideRef = scopeThreadRef(EnvironmentId.make("qa"), ThreadId.make("side"));

  function closeFromSide(options?: { nested?: boolean; repeat?: boolean }) {
    const { editor } = makeSurfaces();
    const store = useRightPanelStore.getState();
    store.openSideChat(mainRef, "side", "Side chat");
    if (options?.nested) store.open(sideRef, "files");
    const handler = (event: KeyboardEvent) => {
      if (!chatSurfaceOwnsEvent(event, "side", "side")) return;
      if (
        resolveShortcutCommand(event, DEFAULT_RESOLVED_KEYBINDINGS, {
          platform: "MacIntel",
          context: { terminalFocus: false },
        }) !== "rightPanel.close"
      )
        return;
      const nested = selectActiveRightPanelSurface(
        useRightPanelStore.getState().byThreadKey,
        sideRef,
      );
      closeChatSurfacePanel(
        event,
        nested ? () => store.closeSurface(sideRef, nested.id) : undefined,
        () => store.closeSurface(mainRef, "side-chat:side"),
      );
    };
    window.addEventListener("keydown", handler, true);
    const event = new KeyboardEvent("keydown", {
      key: "w",
      metaKey: true,
      bubbles: true,
      cancelable: true,
      repeat: options?.repeat ?? false,
    });
    try {
      editor.dispatchEvent(event);
    } finally {
      window.removeEventListener("keydown", handler, true);
    }
    return event;
  }

  test("Cmd+W closes the containing side panel and prevents native window close", () => {
    expect(closeFromSide().defaultPrevented).toBe(true);
    expect(
      selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, mainRef),
    ).toBeNull();
  });

  test("a nested child panel closes before the containing side chat", () => {
    expect(closeFromSide({ nested: true }).defaultPrevented).toBe(true);
    expect(
      selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, sideRef),
    ).toBeNull();
    expect(
      selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, mainRef)?.kind,
    ).toBe("side-chat");
  });

  test("a repeated close key cannot close another panel or fall through to native close", () => {
    expect(closeFromSide({ repeat: true }).defaultPrevented).toBe(true);
    expect(
      selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, mainRef)?.kind,
    ).toBe("side-chat");
  });

  test("a main chat with no panels retains native close", () => {
    const event = new KeyboardEvent("keydown", { key: "w", metaKey: true, cancelable: true });
    closeChatSurfacePanel(event, undefined, undefined);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("chat surface keyboard ownership", () => {
  test("a side composer shortcut reaches only the side chat even inside the main chat", () => {
    const { editor } = makeSurfaces();
    const handled: string[] = [];
    const handler = (event: Event) => {
      for (const surface of ["main", "side"]) {
        if (chatSurfaceOwnsEvent(event, surface, "main")) handled.push(surface);
      }
    };
    document.addEventListener("keydown", handler);
    try {
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(handled).toEqual(["side"]);
    } finally {
      document.removeEventListener("keydown", handler);
    }
  });

  test("the main chat keeps its shortcuts when a side chat is open", () => {
    const { main } = makeSurfaces();
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    main.dispatchEvent(event);
    expect(chatSurfaceOwnsEvent(event, "main", "side")).toBe(true);
    expect(chatSurfaceOwnsEvent(event, "side", "side")).toBe(false);
  });

  test("portal controls follow the chat that opened them", () => {
    makeSurfaces();
    const popup = document.createElement("input");
    document.body.append(popup);
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
    popup.dispatchEvent(event);
    expect(chatSurfaceKeyFromEvent(event)).toBeNull();
    expect(chatSurfaceOwnsEvent(event, "main", "side")).toBe(false);
    expect(chatSurfaceOwnsEvent(event, "side", "side")).toBe(true);
  });

  test("type and paste to focus stay with the last active chat after its composer blurs", () => {
    makeSurfaces();
    const event = new Event("paste", { bubbles: true });
    document.body.dispatchEvent(event);
    expect(chatSurfaceOwnsEvent(event, "side", "side")).toBe(true);
    expect(chatSurfaceOwnsEvent(event, "main", "side")).toBe(false);
    expect(chatSurfaceOwnsEvent(event, "main", "main")).toBe(true);
  });

  test("shadow controls resolve their nearest chat through the composed path", () => {
    const { side } = makeSurfaces();
    const host = document.createElement("div");
    side.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const control = document.createElement("button");
    shadow.append(control);
    let owner: string | null = null;
    side.addEventListener("keydown", (event) => {
      owner = chatSurfaceKeyFromEvent(event);
    });
    control.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );
    expect(owner).toBe("side");
  });
});
