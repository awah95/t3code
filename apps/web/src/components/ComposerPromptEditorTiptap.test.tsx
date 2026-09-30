// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vite-plus/test";
import { EMPTY_COMPOSER_CONTEXT_RECORDS } from "./composerContextPresentation";
import {
  ComposerPromptEditorTiptap,
  type ComposerPromptEditorHandle,
} from "./ComposerPromptEditorTiptap";

test("a torn-down Tiptap view tolerates focus and reapplies the controlled draft after recreation", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const editorRef = createRef<ComposerPromptEditorHandle>();
  const onChange = vi.fn();
  const render = (value: string) => (
    <ComposerPromptEditorTiptap
      value={value}
      cursor={value.length}
      contextRecords={EMPTY_COMPOSER_CONTEXT_RECORDS}
      skills={[]}
      disabled={false}
      placeholder="Ask a question"
      onChange={onChange}
      onPaste={() => {}}
      editorRef={editorRef}
    />
  );
  try {
    await act(() => root.render(render("Initial draft")));
    const originalElement = container.querySelector<HTMLElement & { editor?: Editor }>(
      '[data-testid="composer-editor"]',
    );
    const originalEditor = originalElement?.editor;
    expect(originalEditor).toBeDefined();
    expect(originalElement?.textContent).toBe("Initial draft");

    await act(() => originalEditor!.destroy());
    expect(originalEditor!.isDestroyed).toBe(true);
    onChange.mockClear();
    expect(() => editorRef.current?.focusAtEnd()).not.toThrow();
    expect(() => editorRef.current?.isCaretOnVisualEdge("end")).not.toThrow();
    expect(onChange).not.toHaveBeenCalled();

    // React layout effects see the old instance before useEditor's passive
    // effect recreates it, as happens when a suspended chat surface reappears.
    await act(() => root.render(render("Updated draft")));
    const replacementElement = container.querySelector<HTMLElement & { editor?: Editor }>(
      '[data-testid="composer-editor"]',
    );
    expect(replacementElement?.editor).not.toBe(originalEditor);
    expect(replacementElement?.textContent).toBe("Updated draft");
    expect(onChange).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
