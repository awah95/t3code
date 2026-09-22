import { runJevAutomation, type JevAutomationObservation } from "@t3tools/shared/jevAutomation";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  buildJevBrowserGuardExpression,
  buildJevBrowserObservationExpression,
  buildJevBrowserPrepareTextExpression,
  buildJevBrowserReadyObservationExpression,
  buildJevBrowserSetTextExpression,
} from "./JevBrowserObservation.ts";

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

const rect = (x = 0, y = 0, width = 100, height = 30): Rect => ({
  x,
  y,
  width,
  height,
  left: x,
  right: x + width,
  top: y,
  bottom: y + height,
});

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  textContent = "";
  type = "";
  checked = false;
  disabled = false;
  readOnly = false;
  isConnected = true;
  labels: FakeElement[] = [];
  shadowRoot: object | null = null;
  visible = true;
  readonly tagName: string;
  readonly box: Rect;
  readonly id: string;
  readonly events: string[] = [];
  onFocus: (() => void) | undefined;
  onDispatch: ((event: FakeEvent) => void) | undefined;
  private storedValue = "";

  constructor(tagName: string, box: Rect = rect(), id = "") {
    this.tagName = tagName;
    this.box = box;
    this.id = id;
  }

  getBoundingClientRect() {
    return this.box;
  }

  get value() {
    return this.storedValue;
  }

  set value(value: string) {
    this.storedValue = value;
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  matches(selector: string) {
    if (selector === ":disabled") return this.disabled;
    if (selector === "optgroup:disabled") return this.tagName === "OPTGROUP" && this.disabled;
    if (selector.includes("button") && this.tagName === "BUTTON") return true;
    return false;
  }

  querySelector() {
    return null;
  }

  closest(selector: string) {
    if (selector.includes("aria-hidden") && this.attributes.get("aria-hidden") === "true")
      return this;
    if (selector.includes("inert") && this.attributes.has("inert")) return this;
    return null;
  }

  checkVisibility() {
    return this.visible;
  }

  contains(other: FakeElement) {
    return other === this;
  }

  focus() {
    this.onFocus?.();
  }

  replaceChildren() {
    this.textContent = "";
  }

  dispatchEvent(event: FakeEvent) {
    this.events.push(event.type);
    this.onDispatch?.(event);
    return true;
  }
}

class FakeEvent {
  readonly type: string;

  constructor(type: string) {
    this.type = type;
  }
}

class FakeSelectElement extends FakeElement {
  multiple = false;
  options: Array<{
    value: string;
    label: string;
    disabled: boolean;
    parentElement: FakeElement | null;
  }> = [];

  constructor(id: string) {
    super("SELECT", rect(), id);
  }
}

const makeHarness = (initialControls: FakeElement[]) => {
  const page: { __t3JevBrowser?: unknown } = {};
  const root = new FakeElement("HTML");
  const body = { innerText: "Catalog" };
  const state = {
    controls: initialControls,
    hit: null as FakeElement | null,
    hasFrame: false,
    hasCanvas: false,
    treeWalks: 0,
    active: null as FakeElement | null,
    frameCount: 0,
    onFrame: undefined as ((frame: number) => void) | undefined,
    animations: [] as Array<{ playState: string; effect: { target: FakeElement } }>,
    framesPaused: false,
    cancelledFrames: [] as number[],
    observerDisconnects: 0,
    pagehideListeners: new Set<unknown>(),
    failQueries: false,
  };
  const attach = () => {
    root.children.splice(0, root.children.length, ...state.controls);
    for (const control of state.controls) {
      control.parentElement = root;
      control.onFocus = () => {
        state.active = control;
      };
    }
  };
  attach();
  const document = {
    body,
    documentElement: root,
    title: "Catalog",
    readyState: "complete",
    get activeElement() {
      return state.active;
    },
    querySelectorAll(selector: string) {
      if (state.failQueries) throw new Error("document unavailable");
      if (selector.startsWith("#"))
        return state.controls.filter((control) => control.id === selector.slice(1));
      return state.controls;
    },
    querySelector(selector: string) {
      if (selector === "iframe,frame") return state.hasFrame ? {} : null;
      if (selector === "canvas") return state.hasCanvas ? {} : null;
      return null;
    },
    getElementById(id: string) {
      return state.controls.find((control) => control.id === id) ?? null;
    },
    createTreeWalker() {
      state.treeWalks++;
      const nodes = [root, ...state.controls];
      let index = 0;
      return { nextNode: () => nodes[++index] ?? null };
    },
    getAnimations() {
      return state.animations;
    },
    execCommand(command: string, _showUi: boolean, value: string) {
      if (command !== "insertText" || !state.active) return false;
      state.active.value = value;
      state.active.dispatchEvent(new FakeEvent("input"));
      return true;
    },
    elementFromPoint() {
      return state.hit;
    },
  };
  const evaluate = (expression: string) =>
    Function(
      "globalThis",
      "document",
      "crypto",
      "Element",
      "HTMLSelectElement",
      "HTMLInputElement",
      "HTMLTextAreaElement",
      "CSS",
      "getComputedStyle",
      "location",
      "innerWidth",
      "innerHeight",
      "scrollX",
      "scrollY",
      "Event",
      "InputEvent",
      "MutationObserver",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "window",
      `return (${expression});`,
    )(
      page,
      document,
      { randomUUID: () => "document" },
      FakeElement,
      FakeSelectElement,
      FakeElement,
      FakeElement,
      { escape: (value: string) => value },
      () => ({ display: "block", visibility: "visible", opacity: "1" }),
      { href: "https://example.test/catalog" },
      1024,
      768,
      0,
      0,
      FakeEvent,
      FakeEvent,
      class {
        observe() {}
        disconnect() {
          state.observerDisconnects++;
        }
      },
      (callback: () => void) => {
        const frame = ++state.frameCount;
        if (state.framesPaused) return frame;
        queueMicrotask(() => {
          state.onFrame?.(frame);
          callback();
        });
        return frame;
      },
      (frame: number) => state.cancelledFrames.push(frame),
      {
        addEventListener(type: string, listener: unknown) {
          if (type === "pagehide") state.pagehideListeners.add(listener);
        },
        removeEventListener(type: string, listener: unknown) {
          if (type === "pagehide") state.pagehideListeners.delete(listener);
        },
      },
    );
  return { page, root, state, attach, evaluate };
};

describe("JevBrowserObservation", () => {
  it("allows consecutive Tab actions when only focus changes and rejects stale keyboard state", async () => {
    const first = new FakeElement("INPUT", rect(), "first");
    const second = new FakeElement("INPUT", rect(0, 40), "second");
    const harness = makeHarness([first, second]);
    const observe = () =>
      harness.evaluate(buildJevBrowserObservationExpression()) as JevAutomationObservation;
    const initial = observe();
    first.focus();
    expect(harness.evaluate(buildJevBrowserGuardExpression(initial.revision))).toEqual({
      ok: false,
      reason: "page-changed",
    });
    harness.state.active = null;
    let steps = 0;
    const result = await runJevAutomation(
      { task: "Tab twice", limits: { maxSteps: 2 } },
      {
        observe: async () => ({
          ...observe(),
          surface: "browser",
          candidates: [
            { id: "tab", operation: "press-key", inputId: "tab-input", description: "Tab" },
          ],
          inputs: [{ id: "tab-input", kind: "key", value: "Tab", description: "Tab" }],
        }),
        execute: async () => {
          [first, second][steps++]!.focus();
          return { status: "executed" };
        },
      },
      {
        decide: async () => ({
          decision: { outcome: "act", candidateId: "tab" },
          accounting: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
        }),
      },
    );
    expect(steps).toBe(2);
    expect(result.executedSteps).toBe(2);
    expect(harness.state.active).toBe(second);
    expect(observe().revision).toBe(result.observation?.revision);
  });

  it("serializes a standalone expression after TypeScript transformation", () => {
    expect(() => Function(`return (${buildJevBrowserObservationExpression()});`)).not.toThrow();
    expect(() =>
      Function(`return (${buildJevBrowserReadyObservationExpression()});`),
    ).not.toThrow();
  });

  it("observes controls that appear during a bounded post-action transition", async () => {
    const trigger = new FakeElement("BUTTON", rect(), "sort");
    trigger.textContent = "Sort";
    const menu = new FakeElement("DIV", rect(0, 40), "sort-menu");
    menu.attributes.set("role", "presentation");
    const harness = makeHarness([trigger, menu]);
    harness.evaluate(buildJevBrowserObservationExpression());
    const option = new FakeElement("DIV", rect(0, 70), "regex");
    option.attributes.set("role", "menuitemradio");
    option.textContent = "Regular expression";
    harness.state.onFrame = (frame) => {
      if (frame !== 2) return;
      harness.state.controls = [trigger, menu, option];
      harness.attach();
    };

    const observation = (await harness.evaluate(buildJevBrowserReadyObservationExpression())) as {
      controls: Array<{ role: string; name: string }>;
    };

    expect(observation.controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "menuitemradio", name: "Regular expression" }),
      ]),
    );
    expect(harness.state.frameCount).toBeLessThanOrEqual(8);
  });

  it("bounds post-action readiness when the page does not change", async () => {
    const button = new FakeElement("BUTTON", rect(), "save");
    const harness = makeHarness([button]);
    const initial = harness.evaluate(buildJevBrowserObservationExpression()) as {
      revision: string;
    };

    const observation = (await harness.evaluate(buildJevBrowserReadyObservationExpression())) as {
      revision: string;
    };

    expect(observation.revision).toBe(initial.revision);
    expect(harness.state.frameCount).toBe(8);
  });

  it("uses the wall bound and cleans up when animation frames are throttled", async () => {
    vi.useFakeTimers();
    try {
      const button = new FakeElement("BUTTON", rect(), "save");
      const harness = makeHarness([button]);
      harness.evaluate(buildJevBrowserObservationExpression());
      harness.state.framesPaused = true;

      const pending = harness.evaluate(buildJevBrowserReadyObservationExpression()) as Promise<{
        revision: string;
      }>;
      expect(harness.state.pagehideListeners.size).toBe(1);
      expect(harness.state.observerDisconnects).toBe(0);

      await vi.advanceTimersByTimeAsync(750);
      await expect(pending).resolves.toMatchObject({ revision: "document:1" });
      expect(harness.state.cancelledFrames).toEqual([1]);
      expect(harness.state.observerDisconnects).toBe(1);
      expect(harness.state.pagehideListeners.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects and cleans up instead of observing a departing document", async () => {
    vi.useFakeTimers();
    try {
      const button = new FakeElement("BUTTON", rect(), "leave");
      const harness = makeHarness([button]);
      harness.evaluate(buildJevBrowserObservationExpression());
      harness.state.framesPaused = true;

      const pending = harness.evaluate(buildJevBrowserReadyObservationExpression()) as Promise<{
        revision: string;
      }>;
      const pagehide = [...harness.state.pagehideListeners][0] as () => void;
      pagehide();

      await expect(pending).rejects.toThrow(
        "The document changed before the browser observation became ready.",
      );
      expect(harness.state.cancelledFrames).toEqual([1]);
      expect(harness.state.observerDisconnects).toBe(1);
      expect(harness.state.pagehideListeners.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects and cleans up when the final semantic observation fails", async () => {
    const button = new FakeElement("BUTTON", rect(), "save");
    const harness = makeHarness([button]);
    harness.evaluate(buildJevBrowserObservationExpression());
    harness.state.failQueries = true;

    const pending = harness.evaluate(buildJevBrowserReadyObservationExpression()) as Promise<{
      revision: string;
    }>;

    await expect(pending).rejects.toThrow("document unavailable");
    expect(harness.state.cancelledFrames).toEqual([8]);
    expect(harness.state.observerDisconnects).toBe(1);
    expect(harness.state.pagehideListeners.size).toBe(0);
  });

  it("waits for a relevant control animation to finish", async () => {
    const button = new FakeElement("BUTTON", rect(), "menu");
    const harness = makeHarness([button]);
    const animation = { playState: "running", effect: { target: button } };
    harness.state.animations = [animation];
    harness.evaluate(buildJevBrowserObservationExpression());
    harness.state.onFrame = (frame) => {
      if (frame === 10) animation.playState = "finished";
    };

    await harness.evaluate(buildJevBrowserReadyObservationExpression());

    expect(harness.state.frameCount).toBe(10);
  });

  it("reads contenteditable text as the editor value", () => {
    const editor = new FakeElement("DIV", rect(), "pattern");
    editor.attributes.set("contenteditable", "plaintext-only");
    editor.textContent = "^products\\/(.+)$";
    const richEditor = new FakeElement("DIV", rect(0, 40), "heading");
    richEditor.attributes.set("contenteditable", "");
    richEditor.textContent = "Heading";
    const harness = makeHarness([editor, richEditor]);

    const observation = harness.evaluate(buildJevBrowserObservationExpression()) as {
      controls: Array<{ role: string; value: string }>;
    };

    expect(observation.controls[0]).toMatchObject({
      role: "textbox",
      value: "^products\\/(.+)$",
    });
    expect(observation.controls[1]).toMatchObject({ role: "textbox", value: "Heading" });
  });

  it("prioritizes viewport controls and reports unsupported or bounded content", () => {
    const select = new FakeSelectElement("category");
    const disabledGroup = new FakeElement("OPTGROUP");
    disabledGroup.disabled = true;
    select.options = Array.from({ length: 101 }, (_, index) => ({
      value: String(index),
      label: `Option ${index}`,
      disabled: false,
      parentElement: index === 0 ? disabledGroup : null,
    }));
    const submit = new FakeElement("INPUT", rect(0, 40), "submit");
    submit.type = "submit";
    submit.value = "Search catalog";
    const offscreen = new FakeElement("BUTTON", rect(0, 900), "offscreen");
    const extras = Array.from(
      { length: 180 },
      (_, index) => new FakeElement("BUTTON", rect(0, 80 + index), `extra-${index}`),
    );
    const harness = makeHarness([select, submit, offscreen, ...extras]);
    harness.root.shadowRoot = {};
    harness.state.hasFrame = true;

    const observation = harness.evaluate(buildJevBrowserObservationExpression()) as {
      controls: Array<{ name: string; options: Array<{ disabled: boolean }> }>;
      omissions: string[];
    };

    expect(observation.controls).toHaveLength(180);
    expect(observation.controls[0]?.options).toHaveLength(100);
    expect(observation.controls[0]?.options[0]?.disabled).toBe(true);
    expect(observation.controls[0]?.options[1]?.disabled).toBe(false);
    expect(observation.controls[1]?.name).toBe("Search catalog");
    expect(observation.omissions).toEqual(
      expect.arrayContaining([
        "2 viewport controls omitted",
        "1 offscreen controls not observed",
        "1 native select options omitted",
        "frame contents require agent inspection",
        "shadow root contents require agent inspection",
      ]),
    );
  });

  it("exposes link destinations while suppressing sensitive input values and multi-selects", () => {
    const link = new FakeElement("A", rect(), "docs") as FakeElement & { href: string };
    link.href = "https://docs.example.test/guide";
    link.textContent = "Guide";
    const password = new FakeElement("INPUT", rect(0, 40), "password");
    password.type = "password";
    password.value = "secret";
    const file = new FakeElement("INPUT", rect(0, 80), "upload");
    file.type = "file";
    file.value = "/private/file.txt";
    const multiple = new FakeSelectElement("tags");
    multiple.multiple = true;
    const harness = makeHarness([link, password, file, multiple]);

    const observation = harness.evaluate(buildJevBrowserObservationExpression()) as {
      controls: Array<{ href?: string; name: string; value: string; disabled: boolean }>;
    };

    expect(observation.controls[0]?.href).toBe("https://docs.example.test/guide");
    expect(observation.controls[1]).toMatchObject({ name: "", value: "", disabled: true });
    expect(observation.controls[2]).toMatchObject({ name: "", value: "", disabled: true });
    expect(observation.controls[3]?.disabled).toBe(true);
  });

  it("rejects changed values and same-looking replacement nodes", () => {
    const input = new FakeElement("INPUT", rect(), "query");
    input.type = "text";
    input.value = "before";
    const harness = makeHarness([input]);
    harness.state.hit = input;
    const observation = harness.evaluate(buildJevBrowserObservationExpression()) as {
      revision: string;
      controls: Array<{ id: string }>;
    };
    const id = observation.controls[0]!.id;

    input.value = "after";
    expect(harness.evaluate(buildJevBrowserGuardExpression(observation.revision, id))).toEqual({
      ok: false,
      reason: "page-changed",
    });

    input.value = "before";
    input.isConnected = false;
    const replacement = new FakeElement("INPUT", rect(), "query");
    replacement.type = "text";
    replacement.value = "before";
    harness.state.controls = [replacement];
    harness.state.hit = replacement;
    harness.attach();
    expect(harness.evaluate(buildJevBrowserGuardExpression(observation.revision, id))).toEqual({
      ok: false,
      reason: "page-changed",
    });
  });

  it("prepares the retained text node and refuses replacement during clear", () => {
    const input = new FakeElement("INPUT", rect(), "text1");
    input.type = "text";
    input.value = "before";
    const harness = makeHarness([input]);
    harness.state.hit = input;
    const observation = harness.evaluate(buildJevBrowserObservationExpression()) as {
      revision: string;
      controls: Array<{ id: string }>;
    };
    const id = observation.controls[0]!.id;

    expect(
      harness.evaluate(buildJevBrowserPrepareTextExpression(observation.revision, id)),
    ).toEqual({ ok: true, focusId: id });
    expect(input.value).toBe("");
    expect(harness.state.active).toBe(input);
    expect(input.events).toEqual(["beforeinput", "input"]);

    const replacementInput = new FakeElement("INPUT", rect(), "text1");
    replacementInput.type = "text";
    replacementInput.value = "again";
    const replacementHarness = makeHarness([replacementInput]);
    replacementHarness.state.hit = replacementInput;
    const fresh = replacementHarness.evaluate(buildJevBrowserObservationExpression()) as {
      revision: string;
      controls: Array<{ id: string }>;
    };
    const replacement = new FakeElement("INPUT", rect(), "text1");
    replacement.type = "text";
    replacementInput.onDispatch = (event) => {
      if (event.type !== "input") return;
      replacementInput.isConnected = false;
      replacementHarness.state.controls = [replacement];
      replacementHarness.state.hit = replacement;
      replacementHarness.attach();
    };

    expect(
      replacementHarness.evaluate(
        buildJevBrowserPrepareTextExpression(fresh.revision, fresh.controls[0]!.id),
      ),
    ).toEqual({ ok: false, reason: "target-unavailable" });
  });

  it("sets text on the retained node without native input targeting", () => {
    const input = new FakeElement("INPUT", rect(), "query");
    input.type = "text";
    input.value = "before";
    const harness = makeHarness([input]);
    harness.state.hit = input;
    const observation = harness.evaluate(buildJevBrowserObservationExpression()) as {
      revision: string;
      controls: Array<{ id: string }>;
    };

    expect(
      harness.evaluate(
        buildJevBrowserSetTextExpression(
          observation.revision,
          observation.controls[0]!.id,
          "Studio",
        ),
      ),
    ).toEqual({ ok: true });
    expect(input.value).toBe("Studio");
    expect(harness.state.active).toBe(input);
    expect(input.events).toEqual(["beforeinput", "input", "input", "change"]);
  });

  it("reports failure after a text target mutates during the atomic operation", () => {
    const input = new FakeElement("INPUT", rect(), "query");
    input.type = "text";
    input.value = "before";
    const harness = makeHarness([input]);
    harness.state.hit = input;
    const observation = harness.evaluate(buildJevBrowserObservationExpression()) as {
      revision: string;
      controls: Array<{ id: string }>;
    };
    const replacement = new FakeElement("INPUT", rect(), "query");
    replacement.type = "text";
    input.onDispatch = (event) => {
      if (event.type !== "input") return;
      input.isConnected = false;
      harness.state.controls = [replacement];
      harness.state.hit = replacement;
      harness.attach();
    };

    expect(
      harness.evaluate(
        buildJevBrowserSetTextExpression(
          observation.revision,
          observation.controls[0]!.id,
          "Studio",
        ),
      ),
    ).toEqual({ ok: false, reason: "target-unavailable" });
    expect(input.value).toBe("");
  });

  it("refuses an occluded target without requiring a new observation", () => {
    const button = new FakeElement("BUTTON", rect(), "save");
    const overlay = new FakeElement("DIV", rect());
    const harness = makeHarness([button]);
    const observation = harness.evaluate(buildJevBrowserObservationExpression()) as {
      revision: string;
      controls: Array<{ id: string }>;
    };
    harness.state.hit = overlay;

    expect(
      harness.evaluate(
        buildJevBrowserGuardExpression(observation.revision, observation.controls[0]!.id),
      ),
    ).toEqual({ ok: false, reason: "target-covered-or-offscreen" });
    expect(harness.state.treeWalks).toBe(1);
  });
});
