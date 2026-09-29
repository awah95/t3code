import type { PreviewAnnotationRect } from "@t3tools/contracts";

const MAX_FRAME_DEPTH = 8;

const isFrame = (element: Element): element is HTMLIFrameElement =>
  element.tagName.toLowerCase() === "iframe";

const intersect = (a: PreviewAnnotationRect, b: PreviewAnnotationRect): PreviewAnnotationRect => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
};

/** The frame chain is read afresh because builder canvases can reload during a pick. */
export function frameChain(element: Element): HTMLIFrameElement[] | null {
  const chain: HTMLIFrameElement[] = [];
  let childDocument = element.ownerDocument;
  for (let depth = 0; depth <= MAX_FRAME_DEPTH; depth += 1) {
    if (childDocument === document) return chain;
    let frame: Element | null | undefined;
    try {
      frame = childDocument.defaultView?.frameElement;
      if (!frame || !isFrame(frame) || !frame.isConnected) return null;
      if (frame.contentDocument !== childDocument) return null;
    } catch {
      return null;
    }
    chain.unshift(frame);
    childDocument = frame.ownerDocument;
  }
  return null;
}

export function elementViewportRect(element: Element): PreviewAnnotationRect | null {
  const chain = frameChain(element);
  if (!chain || !element.isConnected) return null;
  const bounds = element.getBoundingClientRect();
  let rect: PreviewAnnotationRect = {
    x: bounds.left,
    y: bounds.top,
    width: bounds.width,
    height: bounds.height,
  };
  for (const frame of chain.toReversed()) {
    rect = projectRectThroughFrame(rect, frame);
  }
  return rect;
}

/** Map a child viewport rectangle through its iframe border and CSS scale. */
export function projectRectThroughFrame(
  rect: PreviewAnnotationRect,
  frame: HTMLIFrameElement,
): PreviewAnnotationRect {
  const frameRect = frame.getBoundingClientRect();
  const scaleX = frame.offsetWidth ? frameRect.width / frame.offsetWidth : 1;
  const scaleY = frame.offsetHeight ? frameRect.height / frame.offsetHeight : 1;
  const contentX = frameRect.left + frame.clientLeft * scaleX;
  const contentY = frameRect.top + frame.clientTop * scaleY;
  return intersect(
    {
      x: contentX + rect.x * scaleX,
      y: contentY + rect.y * scaleY,
      width: rect.width * scaleX,
      height: rect.height * scaleY,
    },
    {
      x: contentX,
      y: contentY,
      width: frame.clientWidth * scaleX,
      height: frame.clientHeight * scaleY,
    },
  );
}

export function frameContentPoint(frame: HTMLIFrameElement, x: number, y: number) {
  const rect = frame.getBoundingClientRect();
  const scaleX = frame.offsetWidth ? rect.width / frame.offsetWidth : 1;
  const scaleY = frame.offsetHeight ? rect.height / frame.offsetHeight : 1;
  const contentX = rect.left + frame.clientLeft * scaleX;
  const contentY = rect.top + frame.clientTop * scaleY;
  const childX = (x - contentX) / scaleX;
  const childY = (y - contentY) / scaleY;
  return childX >= 0 && childY >= 0 && childX < frame.clientWidth && childY < frame.clientHeight
    ? { x: childX, y: childY }
    : null;
}

/** Returns the deepest same-origin target; an inaccessible frame stays the target. */
export function elementAtViewportPoint(
  x: number,
  y: number,
  ignore: (element: Element) => boolean,
): Element | null {
  let currentDocument = document;
  for (let depth = 0; depth <= MAX_FRAME_DEPTH; depth += 1) {
    const candidate = currentDocument
      .elementsFromPoint(x, y)
      .find(
        (element) =>
          !ignore(element) &&
          element !== currentDocument.documentElement &&
          element !== currentDocument.body,
      );
    if (!candidate || !isFrame(candidate)) return candidate ?? null;
    if (depth === MAX_FRAME_DEPTH) return null;
    const point = frameContentPoint(candidate, x, y);
    if (!point) return null;
    try {
      const child = candidate.contentDocument;
      if (!child?.documentElement) return null;
      currentDocument = child;
      x = point.x;
      y = point.y;
    } catch {
      return null;
    }
  }
  return null;
}

/** CSS path scoped to one document; each frame has its own path in the payload. */
export function elementSelector(element: Element): string {
  const escapedId = element.id ? CSS.escape(element.id) : "";
  if (
    escapedId.length > 0 &&
    escapedId.length <= 2_047 &&
    element.ownerDocument.querySelectorAll(`#${escapedId}`).length === 1
  )
    return `#${escapedId}`;
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== element.ownerDocument.documentElement) {
    const parent: Element | null = current.parentElement;
    const tag = current.localName;
    const siblings = parent
      ? Array.from(parent.children).filter((sibling) => sibling.localName === tag)
      : [];
    parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(current) + 1})`);
    current = parent;
  }
  while (parts.length > 1 && parts.join(" > ").length > 2_048) parts.shift();
  return parts.join(" > ");
}

export function documentMetadata(doc: Document): {
  pageUrl: string | undefined;
  title: string | undefined;
} {
  let pageUrl: string | undefined;
  let title: string | undefined;
  try {
    pageUrl = doc.defaultView?.location.href;
  } catch {
    /* A frame may navigate while its element context is captured. */
  }
  if (!pageUrl) {
    try {
      pageUrl = doc.URL;
    } catch {
      /* Detached documents may no longer expose their URL. */
    }
  }
  try {
    title = doc.title?.trim() || undefined;
  } catch {
    /* A navigated frame may no longer expose its title. */
  }
  return { pageUrl, title };
}

export function elementFramePath(element: Element) {
  return frameChain(element)?.map((frame) => {
    let child: Document | null = null;
    try {
      child = frame.contentDocument;
    } catch {
      /* Keep the frame selector if navigation changes access. */
    }
    const metadata = child ? documentMetadata(child) : null;
    return {
      selector: elementSelector(frame),
      pageUrl: metadata?.pageUrl?.slice(0, 2_048),
      title: metadata?.title?.slice(0, 2_048),
    };
  });
}

/** Query only documents whose frame intersects the marquee. */
export function elementsInViewportRect(
  rect: PreviewAnnotationRect,
  ignore: (element: Element) => boolean,
): Element[] {
  const result: Element[] = [];
  const visit = (doc: Document, depth: number): void => {
    if (depth < MAX_FRAME_DEPTH) {
      for (const frame of doc.querySelectorAll("iframe")) {
        const bounds = elementViewportRect(frame);
        if (
          !bounds ||
          bounds.x > rect.x + rect.width ||
          bounds.x + bounds.width < rect.x ||
          bounds.y > rect.y + rect.height ||
          bounds.y + bounds.height < rect.y
        )
          continue;
        try {
          if (frame.contentDocument?.body) visit(frame.contentDocument, depth + 1);
        } catch {
          /* Inaccessible frames remain visual regions only. */
        }
      }
    }
    let visited = 0;
    for (const element of doc.querySelectorAll("body *")) {
      if (++visited > 12_000) break;
      if (ignore(element)) continue;
      if (isFrame(element)) continue;
      const bounds = elementViewportRect(element);
      if (!bounds || bounds.width < 2 || bounds.height < 2) continue;
      if (
        bounds.x > rect.x + rect.width ||
        bounds.x + bounds.width < rect.x ||
        bounds.y > rect.y + rect.height ||
        bounds.y + bounds.height < rect.y
      )
        continue;
      const centerX = bounds.x + bounds.width / 2;
      const centerY = bounds.y + bounds.height / 2;
      if (
        centerX < rect.x ||
        centerX > rect.x + rect.width ||
        centerY < rect.y ||
        centerY > rect.y + rect.height
      )
        continue;
      if (
        element.children.length === 0 ||
        element.localName === "button" ||
        element.localName === "a" ||
        element.getAttribute("role") === "button"
      )
        result.push(element);
    }
  };
  visit(document, 0);
  return result;
}
