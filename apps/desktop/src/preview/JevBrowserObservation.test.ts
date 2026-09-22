import { runJevAutomation, type JevAutomationObservation } from "@t3tools/shared/jevAutomation";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  buildJevBrowserGuardExpression,
  buildJevBrowserObservationExpression,
  buildJevBrowserPrepareTextExpression,
  buildJevBrowserReadyObservationExpression,
  buildJevBrowserSetTextExpression,
} from "./JevBrowserObservation.ts";
import { buildJevBrowserSemanticProbeExpression } from "./JevBrowserSemanticProbe.ts";
import {
  buildBrowserExtractExpression,
  buildBrowserWaitForAssertionExpression,
} from "./BrowserQueries.ts";

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
  readonly childNodes: Array<FakeElement | FakeText> = [];
  parentElement: FakeElement | null = null;
  textContent = "";
  type = "";
  checked = false;
  disabled = false;
  readOnly = false;
  isConnected = true;
  labels: FakeElement[] = [];
  shadowRoot: object | null = null;
  contentDocument: object | null = null;
  rootNode: object | null = null;
  ownerDocument: object | null = null;
  clientLeft = 0;
  clientTop = 0;
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

  hasAttribute(name: string) {
    return this.attributes.has(name);
  }

  matches(selector: string) {
    if (selector === ":disabled") return this.disabled;
    if (selector === "optgroup:disabled") return this.tagName === "OPTGROUP" && this.disabled;
    if (selector === "iframe,frame") return this.tagName === "IFRAME" || this.tagName === "FRAME";
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector === "iframe:nth-of-type(1)") {
      if (this.tagName !== "IFRAME") return false;
      return (
        this.parentElement?.children.filter((element) => element.tagName === "IFRAME")[0] === this
      );
    }
    if (selector.includes("button") && this.tagName === "BUTTON") return true;
    return false;
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    const descendants: FakeElement[] = [];
    const visit = (element: FakeElement) => {
      for (const child of element.children) {
        descendants.push(child);
        visit(child);
      }
    };
    visit(this);
    return descendants;
  }

  getRootNode() {
    return this.rootNode ?? this.ownerDocument ?? this;
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

class FakeText {
  readonly nodeType = 3;
  readonly textContent: string;

  constructor(textContent: string) {
    this.textContent = textContent;
  }

  readonly childNodes: never[] = [];
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

  get selectedOptions() {
    return this.options.filter((option) => option.value === this.value);
  }
}

const makeHarness = (initialControls: FakeElement[]) => {
  const page: { __t3JevBrowser?: unknown } = {};
  const root = new FakeElement("HTML");
  const body = { innerText: "Catalog" };
  const state = {
    controls: initialControls,
    title: "Catalog",
    locationHref: "https://example.test/catalog",
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
      control.ownerDocument = document;
      control.rootNode = document;
      control.onFocus = () => {
        state.active = control;
      };
    }
  };
  const document = {
    body,
    documentElement: root,
    get title() {
      return state.title;
    },
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
    addEventListener() {},
    removeEventListener() {},
  };
  root.ownerDocument = document;
  root.rootNode = document;
  attach();
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
      {
        get href() {
          return state.locationHref;
        },
      },
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
  return { page, root, body, state, attach, evaluate };
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
    expect(harness.state.treeWalks).toBe(0);
  });

  it("verifies controls beyond the compact viewport budget and rejects offscreen ambiguity", () => {
    const leading = Array.from({ length: 180 }, (_, index) => {
      const control = new FakeElement("BUTTON", rect(0, index * 2), `leading-${index}`);
      control.textContent = `Leading ${index}`;
      return control;
    });
    const later = new FakeElement("BUTTON", rect(0, 900), "later");
    later.textContent = "Later action";
    const harness = makeHarness([...leading, later]);
    const observation = harness.evaluate(buildJevBrowserObservationExpression()) as {
      controls: unknown[];
      documentId: string;
    };
    expect(observation.controls).toHaveLength(180);

    const unique = harness.evaluate(
      buildJevBrowserSemanticProbeExpression({
        assertions: [{ kind: "control-exists", target: { role: "button", name: "Later action" } }],
        expectedDocumentId: observation.documentId,
      }),
    ) as { results: Array<{ verdict: string; matchCount: number; matches?: unknown[] }> };
    expect(unique.results[0]).toMatchObject({ verdict: "passed", matchCount: 1 });
    expect(unique.results[0]?.matches).toHaveLength(1);

    const duplicate = new FakeElement("BUTTON", rect(0, 1200), "later-duplicate");
    duplicate.textContent = "Later action";
    harness.state.controls.push(duplicate);
    harness.attach();
    // Refresh establishes the changed document revision before the independent query.
    harness.evaluate(buildJevBrowserObservationExpression());
    const ambiguous = harness.evaluate(
      buildJevBrowserSemanticProbeExpression({
        assertions: [{ kind: "control-exists", target: { role: "button", name: "Later action" } }],
      }),
    ) as { results: Array<{ verdict: string; matchCount: number; reason?: string }> };
    expect(ambiguous.results[0]).toMatchObject({
      verdict: "failed",
      matchCount: 2,
      reason: "The semantic target is ambiguous; narrow its scope.",
    });
  });

  it("uses a labelled native section as a semantic region scope and extraction source", () => {
    const section = new FakeElement("SECTION", rect(), "profile");
    section.attributes.set("aria-labelledby", "profile-heading");
    const heading = new FakeElement("H2", rect(), "profile-heading");
    heading.textContent = "Profile settings";
    const save = new FakeElement("BUTTON", rect(0, 40), "save-profile");
    save.textContent = "Save";
    const harness = makeHarness([section, heading, save]);
    heading.parentElement = section;
    save.parentElement = section;
    section.children.push(heading, save);
    section.childNodes.push(heading, save);
    harness.evaluate(buildJevBrowserObservationExpression());
    const runtime = harness.page as {
      __t3JevBrowser?: {
        probe: (query: unknown) => unknown;
        extract: (query: unknown) => unknown;
      };
    };

    expect(
      runtime.__t3JevBrowser?.probe({
        assertions: [
          {
            kind: "control-exists",
            target: {
              role: "button",
              name: "Save",
              scope: {
                ancestor: { kind: "semantic", role: "region", name: "Profile settings" },
              },
            },
          },
        ],
      }),
    ).toMatchObject({ results: [{ verdict: "passed", matchCount: 1 }] });
    expect(
      runtime.__t3JevBrowser?.extract({
        source: {
          kind: "region",
          target: { role: "region", name: "Profile settings" },
        },
        fields: [
          {
            kind: "descendant",
            key: "save",
            target: { role: "button", name: "Save" },
            property: "name",
          },
        ],
      }),
    ).toMatchObject({
      rows: [{ fields: [{ key: "save", value: "Save" }] }],
      coverage: { status: "complete" },
    });
  });

  it("does not infer a region or textbox name from section contents or an input value", () => {
    const section = new FakeElement("SECTION", rect(), "unnamed-section");
    section.textContent = "Profile settings";
    const input = new FakeElement("INPUT", rect(0, 40), "current-value");
    input.type = "text";
    input.value = "Current value";
    const harness = makeHarness([section, input]);
    harness.evaluate(buildJevBrowserObservationExpression());
    const runtime = harness.page as { __t3JevBrowser?: { probe: (query: unknown) => unknown } };

    expect(
      runtime.__t3JevBrowser?.probe({
        assertions: [
          { kind: "control-exists", target: { role: "region", name: "Profile settings" } },
          { kind: "control-exists", target: { role: "textbox", name: "Current value" } },
        ],
      }),
    ).toMatchObject({
      results: [
        { verdict: "failed", matchCount: 0 },
        { verdict: "failed", matchCount: 0 },
      ],
    });
  });

  it("extracts native list items and table columns through implicit roles", () => {
    const list = new FakeElement("UL", rect(), "people-list");
    list.attributes.set("aria-label", "People");
    const aliceItem = new FakeElement("LI", rect(0, 30), "alice-item");
    aliceItem.textContent = "Alice";
    const bobItem = new FakeElement("LI", rect(0, 60), "bob-item");
    bobItem.textContent = "Bob";
    list.children.push(aliceItem, bobItem);

    const table = new FakeElement("TABLE", rect(200, 0), "people-table");
    table.attributes.set("aria-label", "People table");
    const headerRow = new FakeElement("TR", rect(200, 30), "header-row");
    const nameHeader = new FakeElement("TH", rect(200, 30), "name-header");
    nameHeader.textContent = "Name";
    headerRow.children.push(nameHeader);
    const dataRow = new FakeElement("TR", rect(200, 60), "data-row");
    const nameCell = new FakeElement("TD", rect(200, 60), "name-cell");
    nameCell.textContent = "Alice";
    dataRow.children.push(nameCell);
    table.children.push(headerRow, dataRow);

    const harness = makeHarness([
      list,
      aliceItem,
      bobItem,
      table,
      headerRow,
      nameHeader,
      dataRow,
      nameCell,
    ]);
    aliceItem.parentElement = list;
    bobItem.parentElement = list;
    headerRow.parentElement = table;
    dataRow.parentElement = table;
    nameHeader.parentElement = headerRow;
    nameCell.parentElement = dataRow;
    harness.evaluate(buildJevBrowserObservationExpression());
    const runtime = harness.page as { __t3JevBrowser?: { extract: (query: unknown) => unknown } };

    expect(
      runtime.__t3JevBrowser?.extract({
        source: { kind: "list", target: { role: "list", name: "People" } },
        fields: [{ kind: "container", key: "name", property: "text" }],
      }),
    ).toMatchObject({
      rows: [
        { fields: [{ key: "name", value: "Alice" }] },
        { fields: [{ key: "name", value: "Bob" }] },
      ],
      coverage: { status: "complete" },
    });
    expect(
      runtime.__t3JevBrowser?.extract({
        source: { kind: "table", target: { role: "table", name: "People table" } },
        fields: [{ kind: "table-column", key: "name", columnName: "Name", property: "text" }],
      }),
    ).toMatchObject({
      rows: [
        { fields: [{ key: "name", value: "Name" }] },
        { fields: [{ key: "name", value: "Alice" }] },
      ],
      coverage: { status: "complete" },
    });
  });

  it("excludes a wrapping select's option text from its accessible label", () => {
    const label = new FakeElement("LABEL", rect(), "large-option-label");
    label.textContent = `Large option set ${Array.from(
      { length: 105 },
      (_, index) => `Option ${index + 1}`,
    ).join(" ")}`;
    const select = new FakeSelectElement("large-option-set");
    select.options = Array.from({ length: 105 }, (_, index) => ({
      value: String(index + 1),
      label: `Option ${index + 1}`,
      disabled: false,
      parentElement: null,
    }));
    select.value = "105";
    select.labels = [label];
    label.children.push(select);
    label.childNodes.push(new FakeText("Large option set"), select);
    const harness = makeHarness([label, select]);
    select.parentElement = label;
    harness.evaluate(buildJevBrowserObservationExpression());
    const runtime = harness.page as { __t3JevBrowser?: { probe: (query: unknown) => unknown } };

    expect(
      runtime.__t3JevBrowser?.probe({
        assertions: [
          {
            kind: "control",
            target: { role: "combobox", name: "Large option set" },
            property: "selectedLabel",
            operator: "equals",
            expected: "Option 105",
          },
        ],
      }),
    ).toMatchObject({ results: [{ verdict: "passed", actual: "Option 105" }] });
  });

  it("matches semantic names beyond the compact 240 character observation field", () => {
    const button = new FakeElement("BUTTON", rect(), "long-name");
    const fullName = `Save ${"profile ".repeat(40)}`.trim();
    button.attributes.set("aria-label", fullName);
    const harness = makeHarness([button]);
    const observation = harness.evaluate(buildJevBrowserObservationExpression()) as {
      controls: Array<{ name: string }>;
    };
    expect(observation.controls[0]?.name).toHaveLength(240);
    const runtime = harness.page as { __t3JevBrowser?: { probe: (query: unknown) => unknown } };
    expect(
      runtime.__t3JevBrowser?.probe({
        assertions: [{ kind: "control-exists", target: { role: "button", name: fullName } }],
      }),
    ).toMatchObject({ results: [{ verdict: "passed", matchCount: 1 }] });
  });

  it("queries text beyond the compact 12k observation without returning it unbounded", () => {
    const harness = makeHarness([]);
    harness.state.controls = [];
    const marker = "TARGET-AFTER-COMPACT-BUDGET";
    const bodyText = `${"x".repeat(13_000)}${marker}`;
    harness.body.innerText = bodyText;
    harness.evaluate(buildJevBrowserObservationExpression());
    const page = harness.page as {
      __t3JevBrowser?: { probe: (input: unknown) => unknown };
    };
    // This assertion validates probe behavior directly; output actual remains capped by the runtime.
    const result = page.__t3JevBrowser?.probe({
      assertions: [
        {
          kind: "location",
          property: "visibleText",
          operator: "contains",
          expected: marker,
        },
      ],
    }) as { results: Array<{ verdict: string; actual?: string }> };
    expect(result.results[0]?.verdict).toBe("passed");
    expect(result.results[0]?.actual?.length).toBeLessThanOrEqual(2_000);

    harness.body.innerText = `${marker}${"z".repeat(260_000)}`;
    const partial = page.__t3JevBrowser?.probe({
      assertions: [
        {
          kind: "location",
          property: "visibleText",
          operator: "contains",
          expected: marker,
        },
      ],
    }) as { results: Array<{ verdict: string; coverage: { status: string } }> };
    expect(partial.results[0]).toMatchObject({
      verdict: "indeterminate",
      coverage: { status: "partial" },
    });
  });

  it("keeps main-document negative verification complete despite an unrelated inaccessible frame", () => {
    const frame = new FakeElement("IFRAME", rect(), "remote-frame");
    frame.attributes.set("aria-label", "Remote content");
    frame.contentDocument = null;
    const harness = makeHarness([frame]);
    harness.evaluate(buildJevBrowserObservationExpression());

    const main = harness.evaluate(
      buildJevBrowserSemanticProbeExpression({
        assertions: [{ kind: "control-exists", target: { role: "button", name: "Missing" } }],
      }),
    ) as { results: Array<{ verdict: string; coverage: { status: string } }> };
    expect(main.results[0]).toMatchObject({ verdict: "failed", coverage: { status: "complete" } });

    const allFrames = harness.evaluate(
      buildJevBrowserSemanticProbeExpression({
        assertions: [
          {
            kind: "control-exists",
            target: {
              role: "button",
              name: "Missing",
              scope: { frame: { kind: "all-authorized-frames" } },
            },
          },
        ],
      }),
    ) as { results: Array<{ verdict: string; coverage: { status: string } }> };
    expect(allFrames.results[0]).toMatchObject({
      verdict: "indeterminate",
      coverage: { status: "partial" },
    });

    const present = new FakeElement("BUTTON", rect(0, 40), "present");
    present.textContent = "Present";
    harness.state.controls.push(present);
    harness.attach();
    harness.evaluate(buildJevBrowserObservationExpression());
    const positivePartial = harness.evaluate(
      buildJevBrowserSemanticProbeExpression({
        assertions: [
          {
            kind: "control-exists",
            target: {
              role: "button",
              name: "Present",
              scope: { frame: { kind: "all-authorized-frames" } },
            },
          },
        ],
      }),
    ) as { results: Array<{ verdict: string; coverage: { status: string } }> };
    expect(positivePartial.results[0]).toMatchObject({
      verdict: "indeterminate",
      coverage: { status: "partial" },
    });
  });

  it("discovers exact controls in open shadow roots and semantically scoped same-origin frames", () => {
    const shadowButton = new FakeElement("BUTTON", rect(0, 40), "shadow-save");
    shadowButton.textContent = "Shadow save";
    const shadowHost = new FakeElement("CATALOG-PANEL", rect(), "catalog-panel");
    const shadowRoot = {
      host: shadowHost,
      textContent: "Shadow save",
      querySelectorAll: () => [shadowButton],
      getElementById: (id: string) => (id === shadowButton.id ? shadowButton : null),
      elementFromPoint: () => shadowButton,
    };
    shadowHost.shadowRoot = shadowRoot;
    shadowButton.rootNode = shadowRoot;

    const frameButton = new FakeElement("BUTTON", rect(0, 20), "frame-save");
    frameButton.textContent = "Frame save";
    const frameRoot = new FakeElement("HTML");
    const childDocument = {
      documentElement: frameRoot,
      body: { innerText: "Frame save" },
      activeElement: null,
      defaultView: null,
      querySelectorAll: (selector: string) =>
        selector.startsWith("#")
          ? selector.slice(1) === frameButton.id
            ? [frameButton]
            : []
          : [frameButton],
      getElementById: (id: string) => (id === frameButton.id ? frameButton : null),
      elementFromPoint: () => frameButton,
    };
    frameRoot.ownerDocument = childDocument;
    frameButton.ownerDocument = childDocument;
    const frame = new FakeElement("IFRAME", rect(200, 100), "editor-frame");
    frame.attributes.set("aria-label", "Editor canvas");
    frame.contentDocument = childDocument;

    const harness = makeHarness([shadowHost, frame]);
    harness.evaluate(buildJevBrowserObservationExpression());
    const result = harness.evaluate(
      buildJevBrowserSemanticProbeExpression({
        assertions: [
          {
            kind: "control-exists",
            target: { role: "button", name: "Shadow save" },
          },
          {
            kind: "control-exists",
            target: {
              role: "button",
              name: "Frame save",
              scope: {
                frame: {
                  kind: "frame-path",
                  frames: [{ kind: "semantic", name: "Editor canvas" }],
                },
              },
            },
          },
        ],
      }),
    ) as { results: Array<{ verdict: string; matches?: Array<{ frameId: string }> }> };

    expect(result.results.map(({ verdict }) => verdict)).toEqual(["passed", "passed"]);
    expect(result.results[0]?.matches?.[0]?.frameId).toBe("main");
    expect(result.results[1]?.matches?.[0]?.frameId).not.toBe("main");
  });

  it("isolates exact frame coverage while rejecting cross-origin and ambiguous selectors", () => {
    const apply = new FakeElement("BUTTON", rect(0, 20), "apply-frame-preference");
    apply.textContent = "Apply frame preference";
    const childRoot = new FakeElement("HTML");
    const childDocument = {
      documentElement: childRoot,
      body: { innerText: "Apply frame preference" },
      activeElement: null,
      defaultView: null,
      querySelectorAll: (selector: string) =>
        selector.startsWith("#") ? (selector.slice(1) === apply.id ? [apply] : []) : [apply],
      getElementById: (id: string) => (id === apply.id ? apply : null),
      elementFromPoint: () => apply,
    };
    childRoot.ownerDocument = childDocument;
    apply.ownerDocument = childDocument;
    apply.rootNode = childDocument;

    const sameSection = new FakeElement("SECTION", rect(), "same-section");
    const sameFrame = new FakeElement("IFRAME", rect(), "same-origin-frame");
    sameFrame.attributes.set("aria-label", "Same-origin preferences");
    sameFrame.contentDocument = childDocument;
    sameSection.children.push(sameFrame);
    const crossSection = new FakeElement("SECTION", rect(200, 0), "cross-section");
    const crossFrame = new FakeElement("IFRAME", rect(200, 0), "cross-origin-frame");
    crossFrame.attributes.set("aria-label", "Cross-origin preferences");
    crossFrame.contentDocument = null;
    crossSection.children.push(crossFrame);

    const harness = makeHarness([sameSection, sameFrame, crossSection, crossFrame]);
    sameFrame.parentElement = sameSection;
    crossFrame.parentElement = crossSection;
    harness.evaluate(buildJevBrowserObservationExpression());
    const runtime = harness.page as { __t3JevBrowser?: { probe: (query: unknown) => unknown } };
    const target = (frame: unknown) => ({
      role: "button",
      name: "Apply frame preference",
      scope: { frame },
    });
    const result = runtime.__t3JevBrowser?.probe({
      assertions: [
        {
          kind: "control-exists",
          target: target({
            kind: "frame-path",
            frames: [{ kind: "semantic", name: "Same-origin preferences" }],
          }),
        },
        {
          kind: "control-exists",
          target: target({
            kind: "frame-path",
            frames: [{ kind: "semantic", name: "Cross-origin preferences" }],
          }),
        },
        {
          kind: "control-exists",
          target: target({
            kind: "frame-path",
            frames: [{ kind: "locator", locator: "iframe:nth-of-type(1)" }],
          }),
        },
      ],
    }) as {
      results: Array<{
        verdict: string;
        matchCount: number;
        coverage: { status: string; omissions: string[] };
      }>;
    };

    expect(result.results[0]).toMatchObject({
      verdict: "passed",
      matchCount: 1,
      coverage: { status: "complete" },
    });
    expect(result.results[1]).toMatchObject({
      verdict: "indeterminate",
      matchCount: 0,
      coverage: {
        status: "unsupported",
        omissions: ["selected frame is cross-origin or detached"],
      },
    });
    expect(result.results[2]).toMatchObject({
      verdict: "indeterminate",
      matchCount: 1,
      coverage: { status: "partial", omissions: ["frame selector is ambiguous"] },
    });
  });

  it("returns indeterminate document freshness for a replaced expected document", () => {
    const button = new FakeElement("BUTTON", rect(), "save");
    button.textContent = "Save";
    const harness = makeHarness([button]);
    harness.evaluate(buildJevBrowserObservationExpression());
    const result = harness.evaluate(
      buildJevBrowserSemanticProbeExpression({
        assertions: [{ kind: "control-exists", target: { role: "button", name: "Save" } }],
        expectedDocumentId: "replaced-document",
      }),
    ) as { results: Array<{ verdict: string; document: { status: string } }> };
    expect(result.results[0]).toMatchObject({
      verdict: "indeterminate",
      document: { status: "changed" },
    });
  });

  it("bounds multibyte extraction output below the broker response budget", () => {
    const region = new FakeElement("SECTION", rect(), "catalog-region");
    region.attributes.set("role", "region");
    region.attributes.set("aria-label", "Catalog data");
    region.textContent = "界".repeat(20_000);
    const harness = makeHarness([region]);
    harness.evaluate(buildJevBrowserObservationExpression());
    const runtime = harness.page as {
      __t3JevBrowser?: { extract: (query: unknown) => unknown };
    };
    const result = runtime.__t3JevBrowser?.extract({
      source: {
        kind: "region",
        target: { role: "region", name: "Catalog data" },
      },
      fields: Array.from({ length: 32 }, (_, index) => ({
        kind: "container",
        key: `field-${index}`,
        property: "text",
      })),
      maxFieldChars: 4_000,
    }) as {
      omittedRows: number;
      omittedFields: number;
      omissions: string[];
      coverage: { status: string };
    };
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(48_000);
    expect(result.omittedRows + result.omittedFields).toBeGreaterThan(0);
    expect(result.omissions).toContain("Extraction output budget reached.");
    expect(result.coverage.status).toBe("partial");
  });

  it("bounds aggregate multibyte verification evidence without preserving a false pass", () => {
    const controls = Array.from({ length: 128 }, (_, index) => {
      const input = new FakeElement("INPUT", rect(0, index * 2), `field-${index}`);
      input.type = "text";
      input.attributes.set("aria-label", `Field ${index}`);
      input.value = "界".repeat(1_000);
      return input;
    });
    const harness = makeHarness(controls);
    harness.evaluate(buildJevBrowserObservationExpression());
    const runtime = harness.page as { __t3JevBrowser?: { probe: (query: unknown) => unknown } };
    const result = runtime.__t3JevBrowser?.probe({
      assertions: controls.map((_, index) => ({
        kind: "control",
        target: { role: "textbox", name: `Field ${index}` },
        property: "value",
        operator: "contains",
        expected: "界",
      })),
    }) as {
      results: Array<{
        verdict: string;
        passed: boolean;
        reason?: string;
        actual?: unknown;
        matches?: unknown[];
        coverage: { omissions: string[] };
      }>;
    };
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(48_000);
    expect(result.results).toHaveLength(128);
    expect(
      result.results.every(({ verdict, passed }) => verdict === "indeterminate" && !passed),
    ).toBe(true);
    expect(
      result.results.every(({ actual, matches }) => actual === undefined && matches === undefined),
    ).toBe(true);
    expect(result.results[0]?.reason).toBe("output-budget");
    expect(result.results[0]?.coverage.omissions).toEqual(["output-budget"]);
  });

  it("fits 128 receipts when assertions fill the 16 KiB input budget", () => {
    const harness = makeHarness([]);
    harness.state.title = "界".repeat(4_000);
    harness.state.locationHref = `https://example.test/${"界".repeat(4_000)}`;
    harness.evaluate(buildJevBrowserObservationExpression());
    const assertions = Array.from({ length: 128 }, (_, index) => ({
      kind: "location",
      property: index % 2 === 0 ? "location" : "title",
      operator: "contains",
      expected: "界".repeat(17),
    }));
    const assertionBytes = new TextEncoder().encode(JSON.stringify(assertions)).byteLength;
    expect(assertionBytes).toBeGreaterThan(16_000);
    expect(assertionBytes).toBeLessThanOrEqual(16_384);

    const runtime = harness.page as { __t3JevBrowser?: { probe: (query: unknown) => unknown } };
    const result = runtime.__t3JevBrowser?.probe({ assertions }) as {
      results: Array<{
        assertion: unknown;
        verdict: string;
        passed: boolean;
        reason?: string;
        actual?: unknown;
        matches?: unknown[];
        coverage: { omissions: string[] };
        document: { documentId: string; revision: string; status: string };
      }>;
    };

    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(48_000);
    expect(result.results).toHaveLength(128);
    expect(result.results.map(({ assertion }) => assertion)).toEqual(assertions);
    expect(
      result.results.every(({ verdict, passed }) => verdict === "indeterminate" && !passed),
    ).toBe(true);
    expect(
      result.results.every(({ actual, matches }) => actual === undefined && matches === undefined),
    ).toBe(true);
    expect(result.results[0]?.reason).toBe("output-budget");
    expect(result.results[0]?.coverage.omissions).toEqual(["output-budget"]);
  });

  it("times out an unmet assertion at the exact bound and cleans observers", async () => {
    vi.useFakeTimers();
    try {
      const harness = makeHarness([]);
      harness.evaluate(buildJevBrowserObservationExpression());
      const runtime = harness.page as {
        __t3JevBrowser?: { waitForAssertion: (query: unknown) => Promise<unknown> };
      };
      const pending = runtime.__t3JevBrowser!.waitForAssertion({
        assertion: { kind: "control-exists", target: { role: "button", name: "Never" } },
        timeoutMs: 25,
      });
      await vi.advanceTimersByTimeAsync(25);
      await expect(pending).resolves.toMatchObject({
        status: "timed-out",
        result: { verdict: "failed" },
      });
      expect(harness.state.observerDisconnects).toBeGreaterThan(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not report a silent programmatic value change as a satisfied wait", async () => {
    vi.useFakeTimers();
    try {
      const input = new FakeElement("INPUT", rect(), "status");
      input.type = "text";
      input.attributes.set("aria-label", "Status");
      input.value = "pending";
      const harness = makeHarness([input]);
      harness.evaluate(buildJevBrowserObservationExpression());
      const runtime = harness.page as {
        __t3JevBrowser?: { waitForAssertion: (query: unknown) => Promise<unknown> };
      };
      const pending = runtime.__t3JevBrowser!.waitForAssertion({
        assertion: {
          kind: "control",
          target: { role: "textbox", name: "Status" },
          property: "value",
          operator: "equals",
          expected: "ready",
        },
        timeoutMs: 25,
      });
      input.value = "ready";
      await vi.advanceTimersByTimeAsync(25);
      await expect(pending).resolves.toMatchObject({
        status: "timed-out",
        result: {
          verdict: "indeterminate",
          reason: "The assertion was true at the deadline without an observable event.",
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-verifies fresh state after an in-document value change", () => {
    const input = new FakeElement("INPUT", rect(), "status");
    input.type = "text";
    input.attributes.set("aria-label", "Status");
    input.value = "pending";
    const harness = makeHarness([input]);
    harness.evaluate(buildJevBrowserObservationExpression());
    const runtime = harness.page as { __t3JevBrowser?: { probe: (query: unknown) => unknown } };
    const assertion = {
      kind: "control",
      target: { role: "textbox", name: "Status" },
      property: "value",
      operator: "equals",
      expected: "ready",
    };
    expect(runtime.__t3JevBrowser?.probe({ assertions: [assertion] })).toMatchObject({
      results: [{ verdict: "failed", document: { status: "current" } }],
    });
    input.value = "ready";
    expect(runtime.__t3JevBrowser?.probe({ assertions: [assertion] })).toMatchObject({
      results: [{ verdict: "passed", document: { status: "current" } }],
    });
  });

  it("serializes standalone extract and event-backed wait expressions", () => {
    expect(() =>
      Function(
        `return (${buildBrowserExtractExpression({
          source: { kind: "region", target: { role: "region", name: "Catalog" } },
          fields: [{ kind: "container", key: "name", property: "name" }],
        })});`,
      ),
    ).not.toThrow();
    expect(() =>
      Function(
        `return (${buildBrowserWaitForAssertionExpression({
          assertion: {
            kind: "control-exists",
            target: { role: "button", name: "Ready" },
          },
          timeoutMs: 1_000,
        })});`,
      ),
    ).not.toThrow();
  });
});
