import { runJevAutomation, type JevAutomationObservation } from "@t3tools/shared/jevAutomation";
import { describe, expect, it } from "vite-plus/test";

import {
  buildJevBrowserGuardExpression,
  buildJevBrowserObservationExpression,
  buildJevBrowserPrepareTextExpression,
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
    return false;
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
