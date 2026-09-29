import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  documentMetadata,
  elementAtViewportPoint,
  elementFramePath,
  elementViewportRect,
  frameContentPoint,
  projectRectThroughFrame,
} from "./AnnotationFrames.ts";

const frame = (overrides: Record<string, unknown> = {}) =>
  ({
    tagName: "IFRAME",
    isConnected: true,
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 300 }),
    offsetWidth: 200,
    offsetHeight: 150,
    clientLeft: 2,
    clientTop: 3,
    clientWidth: 196,
    clientHeight: 144,
    ...overrides,
  }) as unknown as HTMLIFrameElement;

afterEach(() => vi.unstubAllGlobals());

describe("annotation frame coordinates", () => {
  it("maps a child rect through iframe borders and scale, clipping to the content", () => {
    const canvas = frame();
    expect(projectRectThroughFrame({ x: 10, y: 20, width: 50, height: 30 }, canvas)).toEqual({
      x: 124,
      y: 96,
      width: 100,
      height: 60,
    });
    expect(projectRectThroughFrame({ x: 190, y: 140, width: 40, height: 30 }, canvas)).toEqual({
      x: 484,
      y: 336,
      width: 12,
      height: 8,
    });
    expect(frameContentPoint(canvas, 124, 96)).toEqual({ x: 10, y: 20 });
    expect(frameContentPoint(canvas, 100, 50)).toBeNull();
  });

  it("projects through nested frames and drops a detached canvas", () => {
    const topDocument = {} as Document;
    vi.stubGlobal("document", topDocument);
    const outerDocument = { defaultView: {} } as Document;
    const innerDocument = { defaultView: {} } as Document;
    const outerFrame = frame({ ownerDocument: topDocument, contentDocument: outerDocument });
    const innerFrame = frame({ ownerDocument: outerDocument, contentDocument: innerDocument });
    Object.assign(outerDocument.defaultView!, { frameElement: outerFrame });
    Object.assign(innerDocument.defaultView!, { frameElement: innerFrame });
    const element = {
      ownerDocument: innerDocument,
      isConnected: true,
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 50, height: 30 }),
    } as Element;
    expect(elementViewportRect(element)).toEqual({ x: 352, y: 248, width: 144, height: 96 });
    Object.assign(innerFrame, { isConnected: false });
    expect(elementViewportRect(element)).toBeNull();
  });

  it("drops a selection when its document can no longer expose its frame", () => {
    vi.stubGlobal("document", {});
    const childDocument = {
      defaultView: {
        get frameElement() {
          throw new Error("navigated");
        },
      },
    } as unknown as Document;
    const element = { ownerDocument: childDocument, isConnected: true } as Element;
    expect(elementViewportRect(element)).toBeNull();
  });
});

describe("annotation iframe hit testing", () => {
  it("returns a child element through an accessible iframe", () => {
    const child = { tagName: "DIV" } as Element;
    const childDocument = {
      documentElement: {},
      body: {},
      elementsFromPoint: vi.fn(() => [child]),
    } as unknown as Document;
    const canvas = frame({ contentDocument: childDocument });
    const topDocument = {
      documentElement: {},
      body: {},
      elementsFromPoint: vi.fn(() => [canvas]),
    } as unknown as Document;
    vi.stubGlobal("document", topDocument);
    expect(elementAtViewportPoint(124, 96, () => false)).toBe(child);
    expect(childDocument.elementsFromPoint).toHaveBeenCalledWith(10, 20);
  });

  it("does not claim an element inside an inaccessible iframe", () => {
    const canvas = frame();
    Object.defineProperty(canvas, "contentDocument", {
      get() {
        throw new Error("cross origin");
      },
    });
    vi.stubGlobal("document", {
      documentElement: {},
      body: {},
      elementsFromPoint: () => [canvas],
    });
    expect(elementAtViewportPoint(124, 96, () => false)).toBeNull();
  });
});

describe("annotation frame metadata", () => {
  it("uses a document URL when navigation makes window location inaccessible", () => {
    const doc = {
      defaultView: {
        location: {
          get href() {
            throw new Error("navigated");
          },
        },
      },
      URL: "https://example.test/canvas",
      get title() {
        throw new Error("navigated");
      },
    } as unknown as Document;
    expect(documentMetadata(doc)).toEqual({
      pageUrl: "https://example.test/canvas",
      title: undefined,
    });
  });

  it("keeps the frame selector if the iframe changes access between reads", () => {
    const topDocument = { querySelectorAll: () => [canvas] } as unknown as Document;
    const childDocument = { defaultView: {} } as Document;
    let reads = 0;
    const canvas = frame({ id: "canvas", ownerDocument: topDocument });
    Object.defineProperty(canvas, "contentDocument", {
      get() {
        if (++reads === 1) return childDocument;
        throw new Error("navigated");
      },
    });
    Object.assign(childDocument.defaultView!, { frameElement: canvas });
    vi.stubGlobal("document", topDocument);
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    const element = { ownerDocument: childDocument } as Element;
    expect(elementFramePath(element)).toEqual([
      {
        selector: "#canvas",
        pageUrl: undefined,
        title: undefined,
      },
    ]);
  });
});
