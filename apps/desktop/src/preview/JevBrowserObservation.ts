/**
 * Trusted page code. Run every expression from this module in the same isolated world;
 * models only see the serialized observation and opaque control IDs.
 */
export function buildJevBrowserObservationExpression(): string {
  return `(${installJevBrowserObserver.toString()})()`;
}

export function buildJevBrowserReadyObservationExpression(): string {
  return `globalThis.__t3JevBrowser?.observeReady?.() ?? (${installJevBrowserObserver.toString()})()`;
}

export function buildJevBrowserGuardExpression(revision: string, targetId?: string): string {
  return `globalThis.__t3JevBrowser?.guard(${JSON.stringify(revision)}, ${JSON.stringify(targetId ?? null)}) ?? { ok: false, reason: 'document-changed' }`;
}

export function buildJevBrowserSelectExpression(
  revision: string,
  targetId: string,
  value: string,
): string {
  return `globalThis.__t3JevBrowser?.select(${JSON.stringify(revision)}, ${JSON.stringify(targetId)}, ${JSON.stringify(value)}) ?? { ok: false, reason: 'document-changed' }`;
}

export function buildJevBrowserPrepareTextExpression(revision: string, targetId: string): string {
  return `globalThis.__t3JevBrowser?.prepareText(${JSON.stringify(revision)}, ${JSON.stringify(targetId)}) ?? { ok: false, reason: 'document-changed' }`;
}

export function buildJevBrowserSetTextExpression(
  revision: string,
  targetId: string,
  value: string,
): string {
  return `globalThis.__t3JevBrowser?.setText(${JSON.stringify(revision)}, ${JSON.stringify(targetId)}, ${JSON.stringify(value)}) ?? { ok: false, reason: 'document-changed' }`;
}

// This function is serialized into the page; all dependencies must stay inside it.
function installJevBrowserObserver() {
  const page = globalThis as typeof globalThis & {
    __t3JevBrowser?: {
      observe: () => unknown;
      observeReady: () => Promise<unknown>;
      guard: (revision: string, id: string | null) => unknown;
      select: (revision: string, id: string, value: string) => unknown;
      selectLabel: (revision: string, id: string, label: string) => unknown;
      prepareText: (revision: string, id: string) => unknown;
      setText: (revision: string, id: string, value: string) => unknown;
      check: (revision: string, id: string, desired: boolean) => unknown;
      hover: (revision: string, id: string) => unknown;
      scrollTarget: (
        revision: string,
        id: string,
        direction: "up" | "down" | "left" | "right",
      ) => unknown;
      scrollIntoViewTarget: (revision: string, id: string) => unknown;
      registerTarget: (element: Element) => unknown;
      elementFor: (revision: string, id: string) => Element | null;
      probe: (input: unknown) => unknown;
      extract: (query: unknown) => unknown;
      waitForAssertion: (query: unknown) => Promise<unknown>;
    };
  };
  if (page.__t3JevBrowser) return page.__t3JevBrowser.observe();
  // @effect-diagnostics-next-line cryptoRandomUUID:off -- This function is serialized into an isolated browser world, outside the desktop Effect runtime.
  const documentId = crypto.randomUUID();
  const ids = new WeakMap<Element, string>();
  const nodes = new Map<string, Element>();
  const nodeFrames = new Map<
    string,
    {
      readonly frameId: string;
      readonly frameDocument: Document;
      readonly frameElements: readonly Element[];
      readonly offsetX: number;
      readonly offsetY: number;
    }
  >();
  const frameIds = new WeakMap<Element, string>();
  const frameDocumentIds = new WeakMap<Document, string>();
  let sequence = 0;
  let observedFingerprint = "";
  let revision = 0;
  const renderedRect = (element: Element) => {
    if (element.closest('[aria-hidden="true"],[inert]')) return null;
    const rect = element.getBoundingClientRect();
    const style =
      element.ownerDocument?.defaultView?.getComputedStyle(element) ?? getComputedStyle(element);
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0"
    )
      return null;
    if (
      "checkVisibility" in element &&
      !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    )
      return null;
    return rect;
  };
  const intersectsViewport = (rect: DOMRect) =>
    rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
  const normalizeName = (value: string) => value.replace(/\s+/g, " ").trim();
  const labelText = (label: Element, labelledElement: Element) => {
    const parts: string[] = [];
    const visit = (node: Node) => {
      if (node === labelledElement) return;
      if (node !== label && node.nodeType === 1) {
        const childElement = node as Element;
        if (
          childElement.getAttribute("aria-hidden") === "true" ||
          childElement.hasAttribute("hidden")
        )
          return;
      }
      if (node.nodeType === 3) {
        parts.push(node.textContent ?? "");
        return;
      }
      for (const child of Array.from(node.childNodes)) visit(child);
    };
    visit(label);
    return normalizeName(parts.join(" "));
  };
  const nameOf = (element: Element) => {
    const labelled = element.getAttribute("aria-labelledby");
    if (labelled) {
      const root = element.getRootNode?.() ?? element.ownerDocument ?? document;
      const labelledById = (id: string) =>
        "getElementById" in root && typeof root.getElementById === "function"
          ? (root.getElementById(id)?.textContent ?? "")
          : "";
      const text = normalizeName(labelled.split(/\s+/).map(labelledById).join(" "));
      if (text) return text;
    }
    const labels = "labels" in element ? (element as HTMLInputElement).labels : null;
    const inputType = element.tagName === "INPUT" ? (element as HTMLInputElement).type : "";
    const sensitive = inputType === "password" || inputType === "file";
    return normalizeName(
      element.getAttribute("aria-label") ||
        (labels
          ? Array.from(labels)
              .map((label) => labelText(label, element))
              .join(" ")
          : "") ||
        element.getAttribute("alt") ||
        (element.tagName === "INPUT" &&
        ["button", "submit", "reset"].includes(inputType) &&
        !sensitive &&
        "value" in element
          ? String((element as HTMLInputElement).value)
          : "") ||
        element.textContent?.trim() ||
        element.getAttribute("placeholder") ||
        element.getAttribute("title") ||
        element.getAttribute("name") ||
        "",
    );
  };
  const isContentEditable = (element: Element) => {
    const contentEditable = element.getAttribute("contenteditable");
    return (
      contentEditable === "" ||
      contentEditable === "true" ||
      contentEditable === "plaintext-only" ||
      ("isContentEditable" in element && element.isContentEditable === true)
    );
  };
  const roleOf = (element: Element) => {
    const explicit = element.getAttribute("role");
    if (explicit) return explicit.trim().split(/\s+/)[0] ?? "generic";
    const tag = element.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a" || tag === "area") return element.hasAttribute("href") ? "link" : "generic";
    if (tag === "select")
      return (element as HTMLSelectElement).multiple || (element as HTMLSelectElement).size > 1
        ? "listbox"
        : "combobox";
    if (tag === "textarea" || isContentEditable(element)) return "textbox";
    if (tag === "input") {
      const type = (element as HTMLInputElement).type;
      if (["checkbox", "radio"].includes(type)) return type;
      if (["button", "submit", "reset", "image"].includes(type)) return "button";
      if (type === "search") return "searchbox";
      if (type === "number") return "spinbutton";
      if (type === "range") return "slider";
      if (type === "hidden") return "generic";
      return "textbox";
    }
    const hasAuthorName =
      Boolean(element.getAttribute("aria-label")?.trim()) ||
      Boolean(element.getAttribute("aria-labelledby")?.trim()) ||
      Boolean(element.getAttribute("title")?.trim());
    if (tag === "section") return hasAuthorName ? "region" : "generic";
    if (tag === "form") return hasAuthorName ? "form" : "generic";
    if (tag === "fieldset" || tag === "details" || tag === "optgroup") return "group";
    if (tag === "dialog") return "dialog";
    if (tag === "nav") return "navigation";
    if (tag === "main") return "main";
    if (tag === "aside") return "complementary";
    if (tag === "article") return "article";
    if (tag === "header" || tag === "footer") {
      let parent = element.parentElement;
      while (parent) {
        if (["ARTICLE", "ASIDE", "MAIN", "NAV", "SECTION"].includes(parent.tagName))
          return "generic";
        parent = parent.parentElement;
      }
      return tag === "header" ? "banner" : "contentinfo";
    }
    if (tag === "search") return "search";
    if (tag === "ul" || tag === "ol" || tag === "menu") return "list";
    if (tag === "li") return "listitem";
    if (tag === "table") return "table";
    if (tag === "tr") return "row";
    if (tag === "th") return element.getAttribute("scope") === "row" ? "rowheader" : "columnheader";
    if (tag === "td") return "cell";
    if (tag === "option") return "option";
    if (tag === "summary") return "button";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "img") return "img";
    if (tag === "hr") return "separator";
    if (tag === "progress") return "progressbar";
    if (tag === "meter") return "meter";
    if (tag === "figure") return "figure";
    return "generic";
  };
  const selectorFor = (element: Element) => {
    const root = element.getRootNode?.() ?? element.ownerDocument ?? document;
    if (
      element.id &&
      "querySelectorAll" in root &&
      (root as ParentNode).querySelectorAll(`#${CSS.escape(element.id)}`).length === 1
    )
      return `#${CSS.escape(element.id)}`;
    const parts: string[] = [];
    let current: Element | null = element;
    while (current && current !== document.documentElement) {
      const parent: Element | null = current.parentElement;
      const tag = current.tagName.toLowerCase();
      const siblings = parent
        ? Array.from(parent.children).filter((child) => child.tagName === current!.tagName)
        : [];
      parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(current) + 1})`);
      current = parent;
    }
    return `html > ${parts.join(" > ")}`;
  };
  const controlSelector =
    'a[href],button,input:not([type=hidden]),textarea,select,[role],[tabindex],[contenteditable]:not([contenteditable="false"])';
  const documentIdentity = (frameDocument: Document) => {
    if (frameDocument === document) return "main";
    let id = frameDocumentIds.get(frameDocument);
    if (!id) {
      // @effect-diagnostics-next-line cryptoRandomUUID:off -- Serialized page identity is host-held and never used as authority by itself.
      id = crypto.randomUUID();
      frameDocumentIds.set(frameDocument, id);
    }
    return id;
  };
  const elementIdentity = (element: Element) => {
    let id = ids.get(element);
    if (!id) {
      id = `e${sequence++}`;
      ids.set(element, id);
    }
    return id;
  };
  const frameIdentity = (element: Element) => {
    let id = frameIds.get(element);
    if (!id) {
      id = `f${sequence++}`;
      frameIds.set(element, id);
    }
    return id;
  };
  const composedParent = (element: Element): Element | null => {
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode?.();
    return root &&
      "host" in root &&
      typeof root.host === "object" &&
      root.host !== null &&
      "tagName" in root.host
      ? (root.host as Element)
      : null;
  };
  const scrollDirectionsFor = (element: Element) => {
    let current = composedParent(element);
    while (current) {
      if ("scrollHeight" in current) {
        const scrollable = current as HTMLElement;
        const style =
          current.ownerDocument?.defaultView?.getComputedStyle(current) ??
          getComputedStyle(current);
        const directions: Array<"up" | "down" | "left" | "right"> = [];
        if (
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          scrollable.scrollHeight > scrollable.clientHeight
        ) {
          if (scrollable.scrollTop > 0) directions.push("up");
          if (scrollable.scrollTop + scrollable.clientHeight < scrollable.scrollHeight)
            directions.push("down");
        }
        if (
          (style.overflowX === "auto" || style.overflowX === "scroll") &&
          scrollable.scrollWidth > scrollable.clientWidth
        ) {
          if (scrollable.scrollLeft > 0) directions.push("left");
          if (scrollable.scrollLeft + scrollable.clientWidth < scrollable.scrollWidth)
            directions.push("right");
        }
        if (directions.length > 0) return directions;
      }
      current = composedParent(current);
    }
    return [];
  };
  const collectComposed = (input: {
    readonly includeFrames: boolean;
    readonly maximumElements: number;
    readonly maximumFrames: number;
    readonly maximumShadowRoots: number;
    readonly onControl: (entry: {
      readonly element: Element;
      readonly rect: DOMRect;
      readonly frameId: string;
      readonly frameDocument: Document;
      readonly frameElements: readonly Element[];
      readonly offsetX: number;
      readonly offsetY: number;
    }) => void;
    readonly onHiddenControl?: (entry: {
      readonly element: Element;
      readonly frameId: string;
      readonly frameDocument: Document;
      readonly frameElements: readonly Element[];
      readonly offsetX: number;
      readonly offsetY: number;
    }) => void;
    readonly onElement?: (entry: {
      readonly element: Element;
      readonly frameId: string;
      readonly frameDocument: Document;
      readonly frameElements: readonly Element[];
      readonly offsetX: number;
      readonly offsetY: number;
      readonly hidden: boolean;
    }) => void;
    readonly onText?: (text: string) => void;
  }) => {
    const omissions: string[] = [];
    let searchedScopes = 0;
    let omittedScopes = 0;
    let mainSearchedScopes = 0;
    let mainOmittedScopes = 0;
    const mainOmissions: string[] = [];
    let visitedElements = 0;
    let visitedFrames = 0;
    let visitedShadowRoots = 0;
    let stopped = false;
    const seenControls = new Set<Element>();
    const frameCoverage = new Map<
      string,
      { searchedScopes: number; omittedScopes: number; omissions: string[] }
    >();
    const coverageForFrame = (frameId: string) => {
      let value = frameCoverage.get(frameId);
      if (!value) {
        value = { searchedScopes: 0, omittedScopes: 0, omissions: [] };
        frameCoverage.set(frameId, value);
      }
      return value;
    };
    const omitFromFrame = (frameId: string, omission: string) => {
      const frame = coverageForFrame(frameId);
      frame.omittedScopes++;
      if (!frame.omissions.includes(omission)) frame.omissions.push(omission);
    };
    const walkRoot = (
      root: Document | ShadowRoot,
      frameDocument: Document,
      frameId: string,
      frameElements: readonly Element[],
      offsetX: number,
      offsetY: number,
    ) => {
      if (stopped) return;
      searchedScopes++;
      coverageForFrame(frameId).searchedScopes++;
      if (frameElements.length === 0) mainSearchedScopes++;
      const all = Array.from(root.querySelectorAll("*"));
      visitedElements += all.length;
      if (visitedElements > input.maximumElements) {
        stopped = true;
        omittedScopes++;
        omissions.push("semantic traversal element bound reached");
        omitFromFrame(frameId, "semantic traversal element bound reached");
        if (frameElements.length === 0) {
          mainOmittedScopes++;
          mainOmissions.push("semantic traversal element bound reached");
        }
        return;
      }
      if (input.onElement) {
        for (const element of all)
          input.onElement({
            element,
            frameId,
            frameDocument,
            frameElements,
            offsetX,
            offsetY,
            hidden: renderedRect(element) === null,
          });
      }
      for (const element of root.querySelectorAll(controlSelector)) {
        if (seenControls.has(element)) continue;
        seenControls.add(element);
        const localRect = renderedRect(element);
        if (!localRect) {
          input.onHiddenControl?.({
            element,
            frameId,
            frameDocument,
            frameElements,
            offsetX,
            offsetY,
          });
          continue;
        }
        const rect = {
          x: localRect.x + offsetX,
          y: localRect.y + offsetY,
          left: localRect.left + offsetX,
          right: localRect.right + offsetX,
          top: localRect.top + offsetY,
          bottom: localRect.bottom + offsetY,
          width: localRect.width,
          height: localRect.height,
          toJSON: () => ({}),
        } as DOMRect;
        input.onControl({
          element,
          rect,
          frameId,
          frameDocument,
          frameElements,
          offsetX,
          offsetY,
        });
      }
      input.onText?.(
        "body" in root
          ? (root.body?.innerText ?? "")
          : String((root as ShadowRoot).textContent ?? ""),
      );
      for (const element of all) {
        const shadow = element.shadowRoot;
        if (shadow) {
          if (visitedShadowRoots >= input.maximumShadowRoots) {
            omittedScopes++;
            if (!omissions.includes("open shadow root bound reached"))
              omissions.push("open shadow root bound reached");
            omitFromFrame(frameId, "open shadow root bound reached");
            if (frameElements.length === 0) {
              mainOmittedScopes++;
              if (!mainOmissions.includes("open shadow root bound reached"))
                mainOmissions.push("open shadow root bound reached");
            }
          } else {
            visitedShadowRoots++;
            walkRoot(shadow, frameDocument, frameId, frameElements, offsetX, offsetY);
          }
        } else if (element.tagName.includes("-")) {
          omittedScopes++;
          if (!omissions.includes("closed shadow roots are unsupported"))
            omissions.push("closed shadow roots are unsupported");
          omitFromFrame(frameId, "closed shadow roots are unsupported");
          if (frameElements.length === 0) {
            mainOmittedScopes++;
            if (!mainOmissions.includes("closed shadow roots are unsupported"))
              mainOmissions.push("closed shadow roots are unsupported");
          }
        }
        if (!input.includeFrames || !element.matches("iframe,frame")) continue;
        if (visitedFrames >= input.maximumFrames) {
          omittedScopes++;
          if (!omissions.includes("frame traversal bound reached"))
            omissions.push("frame traversal bound reached");
          continue;
        }
        visitedFrames++;
        try {
          const childDocument = (element as HTMLIFrameElement).contentDocument;
          if (!childDocument?.documentElement) throw new Error("frame document unavailable");
          const frameRect = element.getBoundingClientRect();
          const childFrameId = documentIdentity(childDocument);
          frameIdentity(element);
          walkRoot(
            childDocument,
            childDocument,
            childFrameId,
            [...frameElements, element],
            offsetX + frameRect.left + (element as HTMLElement).clientLeft,
            offsetY + frameRect.top + (element as HTMLElement).clientTop,
          );
        } catch {
          omittedScopes++;
          omissions.push(`cross-origin or detached frame ${frameIdentity(element)} is unsupported`);
        }
      }
    };
    walkRoot(document, document, "main", [], 0, 0);
    return {
      status:
        stopped || omittedScopes > 0
          ? searchedScopes > 0
            ? "partial"
            : "unsupported"
          : "complete",
      searchedScopes,
      omittedScopes,
      omissions,
      main: {
        status:
          stopped || mainOmittedScopes > 0
            ? mainSearchedScopes > 0
              ? ("partial" as const)
              : ("unsupported" as const)
            : ("complete" as const),
        searchedScopes: mainSearchedScopes,
        omittedScopes: mainOmittedScopes,
        omissions: mainOmissions,
      },
      frameCoverage,
    } as const;
  };
  const read = (includeOmissions: boolean) => {
    const visibleControls: Array<{
      element: Element;
      rect: DOMRect;
      frameId: string;
      frameDocument: Document;
      frameElements: readonly Element[];
      offsetX: number;
      offsetY: number;
    }> = [];
    let offscreenControls = 0;
    let omittedControls = 0;
    let rawText = "";
    const traversal = collectComposed({
      includeFrames: true,
      maximumElements: 20_000,
      maximumFrames: 24,
      maximumShadowRoots: 128,
      onControl: (entry) => {
        if (!intersectsViewport(entry.rect)) {
          offscreenControls++;
          return;
        }
        if (visibleControls.length >= 180) {
          omittedControls++;
          return;
        }
        visibleControls.push(entry);
      },
      onText: (next) => {
        if (rawText.length < 12_001) rawText += `${rawText ? "\n" : ""}${next}`;
      },
    });
    let omittedOptions = 0;
    const controls = visibleControls.map(
      ({ element, rect, frameId, frameDocument, frameElements, offsetX, offsetY }) => {
        const id = elementIdentity(element);
        nodes.set(id, element);
        nodeFrames.set(id, { frameId, frameDocument, frameElements, offsetX, offsetY });
        const input = element as HTMLInputElement;
        const sensitive = input.type === "password" || input.type === "file";
        const contentEditable = isContentEditable(element);
        const select = element.tagName === "SELECT" ? (element as HTMLSelectElement) : null;
        if (select) omittedOptions += Math.max(0, select.options.length - 100);
        return {
          id,
          tag: element.tagName.toLowerCase(),
          role: roleOf(element),
          name: nameOf(element).slice(0, 240),
          value: sensitive
            ? ""
            : contentEditable
              ? String((element as HTMLElement).innerText ?? element.textContent ?? "").slice(
                  0,
                  2000,
                )
              : "value" in element
                ? String(input.value).slice(0, 2000)
                : "",
          checked:
            "checked" in element ? input.checked : element.getAttribute("aria-checked") === "true",
          disabled:
            element.matches(":disabled") ||
            element.getAttribute("aria-disabled") === "true" ||
            sensitive ||
            select?.multiple === true,
          options: select
            ? Array.from(select.options)
                .slice(0, 100)
                .map((option) => ({
                  value: option.value,
                  label: option.label,
                  disabled:
                    option.disabled || option.parentElement?.matches("optgroup:disabled") === true,
                }))
            : [],
          reference: { documentId, frameId, elementId: id },
          scrollDirections: scrollDirectionsFor(element),
          ...(element.tagName === "A" && "href" in element
            ? { href: String((element as HTMLAnchorElement).href) }
            : {}),
          selector: selectorFor(element),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      },
    );
    const text = rawText.slice(0, 12000);
    const omissions = includeOmissions
      ? [
          ...(omittedControls > 0 ? [`${omittedControls} viewport controls omitted`] : []),
          ...(offscreenControls > 0
            ? [`${offscreenControls} offscreen controls not observed`]
            : []),
          ...(omittedOptions > 0 ? [`${omittedOptions} native select options omitted`] : []),
          ...(rawText.length > text.length ? ["page text truncated"] : []),
          ...(document.querySelector("canvas") ? ["canvas requires visual inspection"] : []),
          ...traversal.omissions,
        ]
      : [];
    // Ignore animation geometry but retain form values and contextual text.
    const fingerprint = JSON.stringify([
      location.href,
      document.title,
      document.activeElement ? selectorFor(document.activeElement) : null,
      scrollX,
      scrollY,
      innerWidth,
      innerHeight,
      text,
      controls.map(({ x: _x, y: _y, width: _w, height: _h, ...control }) => control),
      omittedControls,
      offscreenControls,
      omittedOptions,
      traversal,
    ]);
    return { controls, text, omissions, fingerprint };
  };
  const observe = () => {
    nodes.clear();
    nodeFrames.clear();
    const state = read(true);
    if (observedFingerprint !== state.fingerprint) revision++;
    observedFingerprint = state.fingerprint;
    return {
      revision: `${documentId}:${revision}`,
      documentId,
      url: location.href,
      title: document.title,
      loading: document.readyState === "loading",
      text: state.text,
      controls: state.controls,
      omissions: state.omissions,
    };
  };
  const observeReady = () =>
    new Promise<ReturnType<typeof observe>>((resolve, reject) => {
      const idleMaximumFrames = 8;
      const maximumFrames = 30;
      const minimumFrames = 3;
      const quietFramesRequired = 2;
      let frame = 0;
      let quietFrames = 0;
      let changed = false;
      let mutationPending = false;
      let animationFrame = 0;
      let finished = false;
      let maximumWallTime: ReturnType<typeof setTimeout>;
      const mutations = new MutationObserver(() => {
        mutationPending = true;
      });
      const hasRelevantAnimation = () =>
        document.getAnimations().some((animation) => {
          if (animation.playState !== "running") return false;
          const target = (animation.effect as (AnimationEffect & { target?: unknown }) | null)
            ?.target;
          if (!target || typeof target !== "object" || !("matches" in target)) return false;
          const element = target as Element;
          return (
            element.matches(controlSelector) || element.querySelector(controlSelector) !== null
          );
        });
      const cleanup = () => {
        clearTimeout(maximumWallTime);
        cancelAnimationFrame(animationFrame);
        mutations.disconnect();
        window.removeEventListener("pagehide", abort, true);
      };
      const finish = () => {
        if (finished) return;
        finished = true;
        cleanup();
        try {
          resolve(observe());
        } catch (cause) {
          reject(cause);
        }
      };
      const abort = () => {
        if (finished) return;
        finished = true;
        cleanup();
        reject(new Error("The document changed before the browser observation became ready."));
      };
      // @effect-diagnostics-next-line globalTimers:off -- Serialized page code uses a wall-clock fallback when animation frames are throttled.
      maximumWallTime = setTimeout(finish, 750);
      const sample = () => {
        frame++;
        if (mutationPending) {
          changed = true;
          quietFrames = 0;
          mutationPending = false;
        } else {
          quietFrames++;
        }
        const animating = hasRelevantAnimation();
        // This catches ordinary render transitions without continuously scanning large pages.
        // Updates delayed beyond these bounds still require task assertions or agent handoff.
        if (
          frame >= maximumFrames ||
          (!animating && !changed && frame >= idleMaximumFrames) ||
          (!animating && changed && frame >= minimumFrames && quietFrames >= quietFramesRequired)
        ) {
          finish();
          return;
        }
        animationFrame = requestAnimationFrame(sample);
      };
      mutations.observe(document.documentElement, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      });
      window.addEventListener("pagehide", abort, true);
      animationFrame = requestAnimationFrame(sample);
    });
  const guard = (expected: string, id: string | null) => {
    if (expected !== `${documentId}:${revision}`) return { ok: false, reason: "stale-revision" };
    const node = id ? nodes.get(id) : null;
    const current = read(false);
    if (current.fingerprint !== observedFingerprint) return { ok: false, reason: "page-changed" };
    if (!id) return { ok: true };
    if (
      !node?.isConnected ||
      node.matches(":disabled") ||
      node.getAttribute("aria-disabled") === "true"
    )
      return { ok: false, reason: "target-unavailable" };
    const rect = renderedRect(node);
    const frame = nodeFrames.get(id);
    if (!rect || !frame) return { ok: false, reason: "target-unavailable" };
    const topRect = {
      left: rect.left + frame.offsetX,
      right: rect.right + frame.offsetX,
      top: rect.top + frame.offsetY,
      bottom: rect.bottom + frame.offsetY,
    };
    if (!intersectsViewport(topRect as DOMRect))
      return { ok: false, reason: "target-covered-or-offscreen" };
    const x =
      Math.max(0, topRect.left) +
      (Math.min(innerWidth, topRect.right) - Math.max(0, topRect.left)) / 2;
    const y =
      Math.max(0, topRect.top) +
      (Math.min(innerHeight, topRect.bottom) - Math.max(0, topRect.top)) / 2;
    let hitDocument = document;
    let localX = x;
    let localY = y;
    for (const frameElement of frame.frameElements) {
      const hit = hitDocument.elementFromPoint(localX, localY);
      if (!hit || !(hit === frameElement || frameElement.contains(hit)))
        return { ok: false, reason: "target-covered-or-offscreen" };
      const frameRect = frameElement.getBoundingClientRect();
      localX -= frameRect.left + (frameElement as HTMLElement).clientLeft;
      localY -= frameRect.top + (frameElement as HTMLElement).clientTop;
      const child = (frameElement as HTMLIFrameElement).contentDocument;
      if (!child) return { ok: false, reason: "target-unavailable" };
      hitDocument = child;
    }
    let hit = hitDocument.elementFromPoint(localX, localY);
    const root = node.getRootNode?.();
    if (root && "elementFromPoint" in root && typeof root.elementFromPoint === "function")
      hit = root.elementFromPoint(localX, localY) ?? hit;
    const composedContains = (ancestor: Element, descendant: Element) => {
      let current: Element | null = descendant;
      while (current) {
        if (current === ancestor) return true;
        current = composedParent(current);
      }
      return false;
    };
    if (!hit || (!composedContains(node, hit) && !(hit.shadowRoot && composedContains(hit, node))))
      return { ok: false, reason: "target-covered-or-offscreen" };
    return { ok: true, selector: selectorFor(node), x, y };
  };
  const select = (expected: string, id: string, value: string) => {
    const checked = guard(expected, id);
    if (!checked.ok) return checked;
    const node = nodes.get(id);
    if (node?.tagName !== "SELECT" || (node as HTMLSelectElement).multiple)
      return { ok: false, reason: "unsupported-select" };
    const selectNode = node as HTMLSelectElement;
    const option = Array.from(selectNode.options).find((candidate) => candidate.value === value);
    if (!option || option.disabled || option.parentElement?.matches("optgroup:disabled"))
      return { ok: false, reason: "option-unavailable" };
    const EventConstructor = selectNode.ownerDocument?.defaultView?.Event ?? Event;
    selectNode.value = value;
    selectNode.dispatchEvent(new EventConstructor("input", { bubbles: true }));
    selectNode.dispatchEvent(new EventConstructor("change", { bubbles: true }));
    return { ok: true };
  };
  const selectLabel = (expected: string, id: string, label: string) => {
    const checked = guard(expected, id);
    if (!checked.ok) return checked;
    const node = nodes.get(id);
    if (node?.tagName !== "SELECT" || (node as HTMLSelectElement).multiple)
      return { ok: false, reason: "unsupported-select" };
    const selectNode = node as HTMLSelectElement;
    const matches = Array.from(selectNode.options).filter(
      (candidate) =>
        candidate.label === label &&
        !candidate.disabled &&
        candidate.parentElement?.matches("optgroup:disabled") !== true,
    );
    if (matches.length === 0) return { ok: false, reason: "option-unavailable" };
    if (matches.length > 1) return { ok: false, reason: "option-label-ambiguous" };
    const EventConstructor = selectNode.ownerDocument?.defaultView?.Event ?? Event;
    selectNode.value = matches[0]!.value;
    selectNode.dispatchEvent(new EventConstructor("input", { bubbles: true }));
    selectNode.dispatchEvent(new EventConstructor("change", { bubbles: true }));
    return { ok: true };
  };
  const prepareText = (expected: string, id: string) => {
    const checked = guard(expected, id);
    if (!checked.ok) return checked;
    const node = nodes.get(id);
    if (!node) return { ok: false, reason: "target-unavailable" };
    const textInput =
      node.tagName === "INPUT" &&
      !new Set([
        "button",
        "checkbox",
        "color",
        "file",
        "hidden",
        "image",
        "radio",
        "range",
        "reset",
        "submit",
      ]).has((node as HTMLInputElement).type);
    const textArea = node.tagName === "TEXTAREA";
    const contentEditable = isContentEditable(node);
    if (
      (!textInput && !textArea && !contentEditable) ||
      ("readOnly" in node && (node as HTMLInputElement).readOnly)
    )
      return { ok: false, reason: "unsupported-text-target" };
    (node as HTMLElement).focus({ preventScroll: true });
    const retained = () =>
      node.isConnected &&
      nodes.get(id) === node &&
      (node.ownerDocument ?? document).activeElement === node;
    if (!retained()) return { ok: false, reason: "target-unavailable" };
    const InputEventConstructor = node.ownerDocument?.defaultView?.InputEvent ?? InputEvent;
    const beforeInput = new InputEventConstructor("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "deleteContentBackward",
      data: null,
    });
    if (!node.dispatchEvent(beforeInput)) return { ok: false, reason: "text-edit-cancelled" };
    if (!retained()) return { ok: false, reason: "target-unavailable" };
    if (textInput || textArea) {
      const ownerWindow = node.ownerDocument?.defaultView ?? window;
      const prototype = textArea
        ? (ownerWindow.HTMLTextAreaElement ?? HTMLTextAreaElement).prototype
        : (ownerWindow.HTMLInputElement ?? HTMLInputElement).prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (!setter) return { ok: false, reason: "unsupported-text-target" };
      setter.call(node, "");
    } else {
      node.replaceChildren();
    }
    node.dispatchEvent(
      new InputEventConstructor("input", {
        bubbles: true,
        inputType: "deleteContentBackward",
        data: null,
      }),
    );
    if (!retained()) return { ok: false, reason: "target-unavailable" };
    return { ok: true, focusId: id };
  };
  const setText = (expected: string, id: string, value: string) => {
    const prepared = prepareText(expected, id);
    if (!prepared.ok) return prepared;
    const node = nodes.get(id);
    const retained = () =>
      node?.isConnected &&
      nodes.get(id) === node &&
      (node.ownerDocument ?? document).activeElement === node;
    if (!retained()) return { ok: false, reason: "target-unavailable" };
    if (
      value.length > 0 &&
      !(node?.ownerDocument ?? document).execCommand("insertText", false, value)
    )
      return { ok: false, reason: "unsupported-text-target" };
    if (!retained()) return { ok: false, reason: "target-unavailable" };
    const EventConstructor = node?.ownerDocument?.defaultView?.Event ?? Event;
    node?.dispatchEvent(new EventConstructor("change", { bubbles: true }));
    return { ok: true };
  };
  const check = (expected: string, id: string, desired: boolean) => {
    const guarded = guard(expected, id);
    if (!guarded.ok) return guarded;
    const node = nodes.get(id);
    if (
      node?.tagName !== "INPUT" ||
      !["checkbox", "radio"].includes((node as HTMLInputElement).type)
    )
      return { ok: false, reason: "unsupported-check-target" };
    const inputNode = node as HTMLInputElement;
    if (inputNode.type === "radio" && !desired)
      return { ok: false, reason: "unsupported-radio-state" };
    if (inputNode.checked === desired) return { ok: true, changed: false, checked: desired };
    inputNode.click();
    if (!node.isConnected || nodes.get(id) !== node)
      return { ok: false, reason: "target-unavailable" };
    if (inputNode.checked !== desired) return { ok: false, reason: "checked-state-not-reached" };
    return { ok: true, changed: true, checked: inputNode.checked };
  };
  const hover = (expected: string, id: string) => {
    const guarded = guard(expected, id);
    if (!guarded.ok) return guarded;
    const node = nodes.get(id);
    if (!node) return { ok: false, reason: "target-unavailable" };
    const PointerEventConstructor = node.ownerDocument?.defaultView?.PointerEvent ?? PointerEvent;
    const MouseEventConstructor = node.ownerDocument?.defaultView?.MouseEvent ?? MouseEvent;
    for (const type of ["pointerover", "pointerenter", "pointermove"]) {
      node.dispatchEvent(new PointerEventConstructor(type, { bubbles: type !== "pointerenter" }));
    }
    for (const type of ["mouseover", "mouseenter", "mousemove"]) {
      node.dispatchEvent(new MouseEventConstructor(type, { bubbles: type !== "mouseenter" }));
    }
    if (!node.isConnected || nodes.get(id) !== node)
      return { ok: false, reason: "target-unavailable" };
    return { ok: true };
  };
  const scrollTarget = (
    expected: string,
    id: string,
    direction: "up" | "down" | "left" | "right",
  ) => {
    const guarded = guard(expected, id);
    if (!guarded.ok && guarded.reason !== "target-covered-or-offscreen") return guarded;
    const node = nodes.get(id);
    if (!node?.isConnected) return { ok: false, reason: "target-unavailable" };
    const scrollable = (element: Element | null) => {
      if (!element || !("scrollHeight" in element)) return false;
      const scrollElement = element as HTMLElement;
      const style =
        element.ownerDocument?.defaultView?.getComputedStyle(element) ?? getComputedStyle(element);
      return (
        ((style.overflowY === "auto" || style.overflowY === "scroll") &&
          scrollElement.scrollHeight > scrollElement.clientHeight) ||
        ((style.overflowX === "auto" || style.overflowX === "scroll") &&
          scrollElement.scrollWidth > scrollElement.clientWidth)
      );
    };
    let container: HTMLElement | null = node.parentElement as HTMLElement | null;
    while (container && !scrollable(container))
      container = container.parentElement as HTMLElement | null;
    container ??= document.scrollingElement as HTMLElement | null;
    if (!container) return { ok: false, reason: "scroll-container-unavailable" };
    const before = { x: container.scrollLeft, y: container.scrollTop };
    const vertical = direction === "up" || direction === "down";
    const sign = direction === "up" || direction === "left" ? -1 : 1;
    const amount = vertical
      ? Math.max(1, Math.round(container.clientHeight * 0.8))
      : Math.max(1, Math.round(container.clientWidth * 0.8));
    container.scrollBy({
      left: vertical ? 0 : sign * amount,
      top: vertical ? sign * amount : 0,
      behavior: "instant",
    });
    const after = { x: container.scrollLeft, y: container.scrollTop };
    return {
      ok: true,
      before,
      after,
      progressed: before.x !== after.x || before.y !== after.y,
    };
  };
  const registerTarget = (element: Element) => {
    if (!element || typeof element !== "object" || !("tagName" in element) || !element.isConnected)
      return { ok: false, reason: "target-unavailable" };
    const observation = observe();
    let retained = false;
    const register = (entry: {
      readonly element: Element;
      readonly frameId: string;
      readonly frameDocument: Document;
      readonly frameElements: readonly Element[];
      readonly offsetX: number;
      readonly offsetY: number;
    }) => {
      if (entry.element !== element) return;
      const targetId = elementIdentity(element);
      nodes.set(targetId, element);
      nodeFrames.set(targetId, {
        frameId: entry.frameId,
        frameDocument: entry.frameDocument,
        frameElements: entry.frameElements,
        offsetX: entry.offsetX,
        offsetY: entry.offsetY,
      });
      retained = true;
    };
    collectComposed({
      includeFrames: true,
      maximumElements: 30_000,
      maximumFrames: 32,
      maximumShadowRoots: 256,
      onControl: register,
      onHiddenControl: register,
    });
    if (!retained) return { ok: false, reason: "target-outside-supported-scope" };
    const targetId = elementIdentity(element);
    const guarded = guard(observation.revision, targetId);
    const anchor =
      element.tagName === "A" ? element : (element.closest("a[href]") as Element | null);
    let href: string | undefined;
    if (anchor && "href" in anchor) {
      try {
        const parsed = new URL(String((anchor as HTMLAnchorElement).href));
        if (["http:", "https:", "blob:"].includes(parsed.protocol)) {
          parsed.username = "";
          parsed.password = "";
          href = parsed.href;
        }
      } catch {
        href = undefined;
      }
    }
    const framePath = nodeFrames
      .get(targetId)!
      .frameElements.map((frameElement) =>
        Array.from(
          (frameElement.ownerDocument ?? document).querySelectorAll("iframe,frame"),
        ).indexOf(frameElement),
      );
    if (framePath.some((index) => index < 0))
      return { ok: false, reason: "frame-path-unavailable" };
    return {
      ok: true,
      revision: observation.revision,
      targetId,
      point:
        guarded.ok && typeof guarded.x === "number" && typeof guarded.y === "number"
          ? { x: guarded.x, y: guarded.y }
          : null,
      ...(href ? { href } : {}),
      framePath,
      reference: {
        documentId,
        frameId: nodeFrames.get(targetId)!.frameId,
        elementId: targetId,
      },
    };
  };
  const scrollIntoViewTarget = (expected: string, id: string) => {
    const guarded = guard(expected, id);
    if (!guarded.ok && guarded.reason !== "target-covered-or-offscreen") return guarded;
    const node = nodes.get(id);
    if (!node?.isConnected || !("scrollIntoView" in node))
      return { ok: false, reason: "target-unavailable" };
    node.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const registered = registerTarget(node);
    if (!registered.ok || !("revision" in registered) || !registered.revision) return registered;
    const finalGuard = guard(registered.revision, id);
    if (!finalGuard.ok) return finalGuard;
    return {
      ...registered,
      ok: true,
      revision: registered.revision,
      targetId: id,
      point:
        typeof finalGuard.x === "number" && typeof finalGuard.y === "number"
          ? { x: finalGuard.x, y: finalGuard.y }
          : null,
    };
  };
  const elementFor = (expected: string, id: string) => {
    if (expected !== `${documentId}:${revision}`) return null;
    const node = nodes.get(id);
    if (!node?.isConnected || !nodeFrames.has(id)) return null;
    const current = read(false);
    return current.fingerprint === observedFingerprint ? node : null;
  };
  const probe = (rawInput: unknown) => {
    type SemanticScope = {
      readonly frame?:
        | { readonly kind: "main" }
        | {
            readonly kind: "frame-path";
            readonly frames: readonly (
              | { readonly kind: "semantic"; readonly name: string }
              | { readonly kind: "locator"; readonly locator: string }
            )[];
          }
        | { readonly kind: "all-authorized-frames" };
      readonly ancestor?:
        | {
            readonly kind: "semantic";
            readonly role: "dialog" | "region" | "form" | "group";
            readonly name: string;
          }
        | { readonly kind: "locator"; readonly locator: string };
    };
    type SemanticTarget = {
      readonly role: string;
      readonly name: string;
      readonly scope?: SemanticScope;
    };
    type Assertion =
      | {
          readonly kind: "location";
          readonly property: "location" | "title" | "visibleText";
          readonly operator: "equals" | "contains";
          readonly expected: string;
        }
      | { readonly kind: "control-exists"; readonly targetId: string }
      | { readonly kind: "control-exists"; readonly target: SemanticTarget }
      | {
          readonly kind: "control";
          readonly property: "value" | "selectedLabel" | "disabled" | "checked" | "name" | "text";
          readonly operator: "equals" | "contains";
          readonly expected: string | number | boolean | readonly string[] | null;
          readonly targetId?: string;
          readonly target?: SemanticTarget;
        }
      | {
          readonly kind: "control-count";
          readonly target: SemanticTarget;
          readonly operator: "equals" | "at-least" | "at-most";
          readonly expected: number;
        };
    const input = rawInput as {
      readonly assertions?: readonly Assertion[];
      readonly expectedDocumentId?: string;
    };
    const assertions = Array.isArray(input?.assertions) ? input.assertions.slice(0, 128) : [];
    const live = read(false);
    if (live.fingerprint !== observedFingerprint) {
      revision++;
      observedFingerprint = live.fingerprint;
    }
    const freshness = {
      documentId,
      revision: `${documentId}:${revision}`,
      status:
        input?.expectedDocumentId !== undefined && input.expectedDocumentId !== documentId
          ? ("changed" as const)
          : ("current" as const),
    };
    const entries: Array<{
      readonly element: Element;
      readonly frameId: string;
      readonly frameDocument: Document;
      readonly frameElements: readonly Element[];
      readonly hidden: boolean;
    }> = [];
    let fullText = "";
    let textBoundReached = false;
    const addText = (text: string) => {
      if (textBoundReached) return;
      const next = `${fullText ? "\n" : ""}${text}`;
      if (fullText.length + next.length > 250_000) {
        fullText += next.slice(0, 250_000 - fullText.length);
        textBoundReached = true;
      } else {
        fullText += next;
      }
    };
    const traversal = collectComposed({
      includeFrames: true,
      maximumElements: 30_000,
      maximumFrames: 32,
      maximumShadowRoots: 256,
      onControl: () => {},
      onElement: ({ element, frameId, frameDocument, frameElements, offsetX, offsetY, hidden }) => {
        entries.push({ element, frameId, frameDocument, frameElements, hidden });
        const id = elementIdentity(element);
        nodes.set(id, element);
        nodeFrames.set(id, { frameId, frameDocument, frameElements, offsetX, offsetY });
      },
      onText: addText,
    });
    const coverage = {
      status: traversal.status,
      searchedScopes: traversal.searchedScopes,
      omittedScopes: traversal.omittedScopes,
      omissions: traversal.omissions,
    };
    const mainCoverage = traversal.main;
    const textCoverage = {
      status:
        coverage.status === "complete" && textBoundReached ? ("partial" as const) : coverage.status,
      searchedScopes: coverage.searchedScopes,
      omittedScopes: coverage.omittedScopes + (textBoundReached ? 1 : 0),
      omissions: [
        ...coverage.omissions,
        ...(textBoundReached ? ["targeted page text bound reached"] : []),
      ],
    };
    const limitedActual = (actual: unknown) =>
      typeof actual === "string" && actual.length > 512 ? actual.slice(0, 512) : actual;
    const base = (assertion: Assertion, resultCoverage = coverage) => ({
      assertion,
      passed: false,
      matchCount: 0,
      coverage: resultCoverage,
      document: freshness,
    });
    const indeterminate = (
      assertion: Assertion,
      reason: string,
      matchCount = 0,
      resultCoverage = coverage,
    ) => ({
      ...base(assertion, resultCoverage),
      verdict: "indeterminate" as const,
      reason,
      matchCount,
    });
    if (freshness.status !== "current") {
      const reason =
        freshness.status === "changed"
          ? "The document changed before verification."
          : "Document freshness is unknown until an observation is established.";
      return { results: assertions.map((assertion) => indeterminate(assertion, reason)) };
    }
    const selectorMatches = (element: Element, locator: string) => {
      try {
        return element.matches(locator);
      } catch {
        return null;
      }
    };
    const framePathMatches = (frameElements: readonly Element[], frame: SemanticScope["frame"]) => {
      const requested = frame ?? { kind: "main" as const };
      if (requested.kind === "main") return frameElements.length === 0;
      if (requested.kind === "all-authorized-frames") return true;
      if (requested.frames.length !== frameElements.length) return false;
      return requested.frames.every((selector, index) => {
        const frameElement = frameElements[index];
        if (!frameElement) return false;
        if (selector.kind === "semantic") return nameOf(frameElement) === selector.name;
        return selectorMatches(frameElement, selector.locator) === true;
      });
    };
    const exactFrameCoverage = new Map<string, typeof coverage>();
    const coverageForFramePath = (
      frame: Extract<NonNullable<SemanticScope["frame"]>, { kind: "frame-path" }>,
    ) => {
      const cacheKey = JSON.stringify(frame);
      const cached = exactFrameCoverage.get(cacheKey);
      if (cached) return cached;
      if (frame.frames.length === 0) return mainCoverage;
      let candidates: Array<{ frameDocument: Document; frameElements: readonly Element[] }> = [
        { frameDocument: document, frameElements: [] },
      ];
      for (const selector of frame.frames) {
        const matches: Array<{ element: Element; parent: (typeof candidates)[number] }> = [];
        let invalidLocator = false;
        for (const candidate of candidates) {
          const candidateCoverage = traversal.frameCoverage.get(
            documentIdentity(candidate.frameDocument),
          );
          if (!candidateCoverage) {
            const result = {
              status: "unsupported" as const,
              searchedScopes: 0,
              omittedScopes: 1,
              omissions: ["frame selector document was not traversed"],
            };
            exactFrameCoverage.set(cacheKey, result);
            return result;
          }
          if (candidateCoverage.omittedScopes > 0) {
            const result = {
              status: "partial" as const,
              searchedScopes: candidateCoverage.searchedScopes,
              omittedScopes: candidateCoverage.omittedScopes,
              omissions: candidateCoverage.omissions,
            };
            exactFrameCoverage.set(cacheKey, result);
            return result;
          }
          const candidateFrames = entries.filter(
            (entry) =>
              entry.frameDocument === candidate.frameDocument &&
              (entry.element.tagName === "IFRAME" || entry.element.tagName === "FRAME"),
          );
          for (const { element } of candidateFrames) {
            const matched =
              selector.kind === "semantic"
                ? nameOf(element) === selector.name
                : selectorMatches(element, selector.locator);
            if (matched === null) invalidLocator = true;
            else if (matched) matches.push({ element, parent: candidate });
          }
        }
        if (invalidLocator) {
          const result = {
            status: "unsupported" as const,
            searchedScopes: candidates.length,
            omittedScopes: 1,
            omissions: ["frame locator is invalid"],
          };
          exactFrameCoverage.set(cacheKey, result);
          return result;
        }
        if (matches.length === 0) {
          const result = {
            status: "complete" as const,
            searchedScopes: candidates.length,
            omittedScopes: 0,
            omissions: [],
          };
          exactFrameCoverage.set(cacheKey, result);
          return result;
        }
        if (matches.length > 1) {
          const result = {
            status: "partial" as const,
            searchedScopes: candidates.length,
            omittedScopes: matches.length,
            omissions: ["frame selector is ambiguous"],
          };
          exactFrameCoverage.set(cacheKey, result);
          return result;
        }
        const match = matches[0]!;
        try {
          const childDocument = (match.element as HTMLIFrameElement).contentDocument;
          if (!childDocument?.documentElement) throw new Error("frame document unavailable");
          candidates = [
            {
              frameDocument: childDocument,
              frameElements: [...match.parent.frameElements, match.element],
            },
          ];
        } catch {
          const result = {
            status: "unsupported" as const,
            searchedScopes: candidates.length,
            omittedScopes: 1,
            omissions: ["selected frame is cross-origin or detached"],
          };
          exactFrameCoverage.set(cacheKey, result);
          return result;
        }
      }
      const selected = candidates[0]!;
      const selectedFrameId = documentIdentity(selected.frameDocument);
      const selectedCoverage = traversal.frameCoverage.get(selectedFrameId);
      const result = selectedCoverage
        ? {
            status:
              selectedCoverage.omittedScopes > 0 ? ("partial" as const) : ("complete" as const),
            searchedScopes: selectedCoverage.searchedScopes,
            omittedScopes: selectedCoverage.omittedScopes,
            omissions: selectedCoverage.omissions,
          }
        : {
            status: "unsupported" as const,
            searchedScopes: 0,
            omittedScopes: 1,
            omissions: ["selected frame was not traversed"],
          };
      exactFrameCoverage.set(cacheKey, result);
      return result;
    };
    const ancestorMatches = (element: Element, ancestor: SemanticScope["ancestor"]) => {
      if (!ancestor) return true;
      let current = composedParent(element);
      while (current) {
        if (ancestor.kind === "semantic") {
          if (roleOf(current) === ancestor.role && nameOf(current) === ancestor.name) return true;
        } else if (selectorMatches(current, ancestor.locator) === true) {
          return true;
        }
        current = composedParent(current);
      }
      return false;
    };
    const coverageForTarget = (target: SemanticTarget) => {
      const frame = target.scope?.frame;
      if (!frame || frame.kind === "main") return mainCoverage;
      if (frame.kind === "frame-path") return coverageForFramePath(frame);
      return coverage;
    };
    const matchTarget = (target: SemanticTarget) =>
      entries.filter(
        ({ element, frameElements, hidden }) =>
          !hidden &&
          framePathMatches(frameElements, target.scope?.frame) &&
          ancestorMatches(element, target.scope?.ancestor) &&
          roleOf(element) === target.role &&
          nameOf(element) === target.name,
      );
    const hiddenTargetCount = (target: SemanticTarget) =>
      entries.filter(
        ({ element, frameElements, hidden }) =>
          hidden &&
          framePathMatches(frameElements, target.scope?.frame) &&
          ancestorMatches(element, target.scope?.ancestor) &&
          roleOf(element) === target.role &&
          nameOf(element) === target.name,
      ).length;
    const referenceFor = (entry: (typeof entries)[number]) => {
      const elementId = elementIdentity(entry.element);
      return { documentId, frameId: entry.frameId, elementId };
    };
    const compare = (actual: unknown, operator: "equals" | "contains", expected: unknown) => {
      if (operator === "equals") return JSON.stringify(actual) === JSON.stringify(expected);
      if (typeof actual === "string" && typeof expected === "string")
        return actual.includes(expected);
      if (Array.isArray(actual)) return actual.some((value) => value === expected);
      return false;
    };
    const actualFor = (
      element: Element,
      property: Extract<Assertion, { kind: "control" }>["property"],
    ) => {
      const inputElement = element as HTMLInputElement;
      if (property === "name") return nameOf(element);
      if (property === "text") return element.textContent?.trim() ?? "";
      if (property === "disabled")
        return element.matches(":disabled") || element.getAttribute("aria-disabled") === "true";
      if (property === "checked")
        return "checked" in element
          ? inputElement.checked
          : element.getAttribute("aria-checked") === "true";
      if (property === "selectedLabel") {
        if (element.tagName !== "SELECT") return undefined;
        return (element as HTMLSelectElement).selectedOptions[0]?.label ?? "";
      }
      if (inputElement.type === "password" || inputElement.type === "file") return undefined;
      if (isContentEditable(element))
        return String((element as HTMLElement).innerText ?? element.textContent ?? "");
      return "value" in element ? String(inputElement.value) : "";
    };
    const results = assertions.map((assertion) => {
      if (assertion.kind === "location") {
        const actual =
          assertion.property === "location"
            ? location.href
            : assertion.property === "title"
              ? document.title
              : fullText;
        const matched = compare(actual, assertion.operator, assertion.expected);
        const resultCoverage = assertion.property === "visibleText" ? textCoverage : mainCoverage;
        const complete =
          assertion.property !== "visibleText" || resultCoverage.status === "complete";
        if (!complete && matched)
          return {
            ...indeterminate(
              assertion,
              "A positive text match is not conclusive with partial coverage.",
              0,
              resultCoverage,
            ),
            actual: limitedActual(actual),
          };
        if (!complete && !matched)
          return {
            ...indeterminate(
              assertion,
              "The text query did not match within partial coverage.",
              0,
              resultCoverage,
            ),
            actual: limitedActual(actual),
          };
        if (!complete && assertion.operator === "equals")
          return {
            ...indeterminate(
              assertion,
              "Text equality requires complete coverage.",
              0,
              resultCoverage,
            ),
            actual: limitedActual(actual),
          };
        return {
          ...base(assertion, resultCoverage),
          verdict: matched ? ("passed" as const) : ("failed" as const),
          passed: matched,
          actual: limitedActual(actual),
        };
      }
      if (assertion.kind === "control-count") {
        const resultCoverage = coverageForTarget(assertion.target);
        const matches = matchTarget(assertion.target);
        const hidden = hiddenTargetCount(assertion.target);
        const count = matches.length;
        const adequate = resultCoverage.status === "complete" && hidden === 0;
        const matched =
          assertion.operator === "equals"
            ? count === assertion.expected
            : assertion.operator === "at-least"
              ? count >= assertion.expected
              : count <= assertion.expected;
        const conclusive =
          adequate ||
          (assertion.operator === "at-least" && matched) ||
          (assertion.operator === "at-most" && !matched) ||
          (assertion.operator === "equals" && count > assertion.expected);
        if (matched && !adequate)
          return {
            ...indeterminate(
              assertion,
              "A passing count requires complete coverage.",
              count,
              resultCoverage,
            ),
            actual: count,
            matches: matches.slice(0, 8).map(referenceFor),
          };
        if (!conclusive)
          return {
            ...indeterminate(
              assertion,
              hidden > 0
                ? "Matching controls exist on a hidden surface."
                : "The count requires complete coverage.",
              count,
              resultCoverage,
            ),
            actual: count,
            matches: matches.slice(0, 8).map(referenceFor),
          };
        return {
          ...base(assertion, resultCoverage),
          verdict: matched ? ("passed" as const) : ("failed" as const),
          passed: matched,
          actual: count,
          matchCount: count,
          matches: matches.slice(0, 8).map(referenceFor),
        };
      }
      let matches: typeof entries;
      let resultCoverage = coverage;
      if ("targetId" in assertion && assertion.targetId) {
        resultCoverage = {
          status: "complete" as const,
          searchedScopes: 1,
          omittedScopes: 0,
          omissions: [],
        };
        const element = nodes.get(assertion.targetId);
        const frame = nodeFrames.get(assertion.targetId);
        if (!element?.isConnected || !frame)
          return indeterminate(assertion, "The retained target is stale or unavailable.");
        matches = [
          {
            element,
            frameId: frame.frameId,
            frameDocument: frame.frameDocument,
            frameElements: frame.frameElements,
            hidden: renderedRect(element) === null,
          },
        ];
      } else if ("target" in assertion && assertion.target) {
        resultCoverage = coverageForTarget(assertion.target);
        matches = matchTarget(assertion.target);
        const hidden = hiddenTargetCount(assertion.target);
        if (matches.length === 0) {
          if (hidden > 0)
            return indeterminate(
              assertion,
              "A matching control exists but is not rendered.",
              0,
              resultCoverage,
            );
          if (resultCoverage.status !== "complete")
            return indeterminate(
              assertion,
              "No match was found within partial coverage.",
              0,
              resultCoverage,
            );
          return {
            ...base(assertion, resultCoverage),
            verdict: "failed" as const,
            reason: "No matching control was found.",
          };
        }
        if (matches.length > 1)
          return {
            ...base(assertion, resultCoverage),
            verdict: "failed" as const,
            reason: "The semantic target is ambiguous; narrow its scope.",
            matchCount: matches.length,
            matches: matches.slice(0, 8).map(referenceFor),
          };
      } else {
        return indeterminate(assertion, "The assertion has no supported target.");
      }
      const entry = matches[0]!;
      const reference = referenceFor(entry);
      if (resultCoverage.status !== "complete")
        return {
          ...indeterminate(
            assertion,
            "A matching control is not conclusive with partial coverage.",
            matches.length,
            resultCoverage,
          ),
          matches: matches.slice(0, 8).map(referenceFor),
        };
      if (assertion.kind === "control-exists")
        return {
          ...base(assertion, resultCoverage),
          verdict: "passed" as const,
          passed: true,
          matchCount: 1,
          matches: [reference],
        };
      const actual = actualFor(entry.element, assertion.property);
      if (actual === undefined)
        return {
          ...indeterminate(assertion, "The requested property is unsupported or sensitive.", 1),
          matches: [reference],
        };
      const matched = compare(actual, assertion.operator, assertion.expected);
      return {
        ...base(assertion, resultCoverage),
        verdict: matched ? ("passed" as const) : ("failed" as const),
        passed: matched,
        actual: limitedActual(actual),
        matchCount: 1,
        matches: [reference],
      };
    });
    const payload = { results };
    const encoder = new TextEncoder();
    if (encoder.encode(JSON.stringify(payload)).byteLength <= 48_000) return payload;
    const bounded = results.map((result, index) => ({
      assertion: result.assertion,
      verdict: "indeterminate" as const,
      passed: false,
      ...(index === 0 ? { reason: "output-budget" } : {}),
      matchCount: result.matchCount,
      coverage: {
        status: "partial" as const,
        searchedScopes: 0,
        omittedScopes: 1,
        omissions: index === 0 ? ["output-budget"] : [],
      },
      document: result.document,
    }));
    return { results: bounded };
  };
  const extract = (rawQuery: unknown) => {
    const query = rawQuery as {
      readonly source: {
        readonly kind: "region" | "list" | "table";
        readonly target: {
          readonly role: string;
          readonly name: string;
          readonly scope?: unknown;
        };
        readonly itemRole?: "listitem" | "option" | "row";
      };
      readonly fields: readonly {
        readonly kind: "container" | "descendant" | "table-column";
        readonly key: string;
        readonly property: "name" | "text" | "value" | "checked" | "href";
        readonly target?: {
          readonly role: string;
          readonly name: string;
          readonly scope?: { readonly frame?: unknown };
        };
        readonly columnName?: string;
      }[];
      readonly maxRows?: number;
      readonly maxFieldChars?: number;
      readonly expectedDocumentId?: string;
    };
    const sourceVerification = probe({
      assertions: [{ kind: "control-exists", target: query.source.target }],
      ...(query.expectedDocumentId ? { expectedDocumentId: query.expectedDocumentId } : {}),
    }) as { results: Array<Record<string, unknown>> };
    const sourceResult = sourceVerification.results[0] as
      | {
          verdict?: string;
          reason?: string;
          matches?: Array<{ elementId: string }>;
          coverage?: {
            status: "complete" | "partial" | "unsupported";
            searchedScopes: number;
            omittedScopes: number;
            omissions: string[];
          };
          document?: {
            documentId: string;
            revision: string;
            status: "current" | "changed" | "unknown";
          };
        }
      | undefined;
    const fallbackCoverage = {
      status: "unsupported" as const,
      searchedScopes: 0,
      omittedScopes: 1,
      omissions: [sourceResult?.reason ?? "Extraction source is unavailable."],
    };
    const freshness = sourceResult?.document ?? {
      documentId,
      revision: `${documentId}:${revision}`,
      status: "unknown" as const,
    };
    if (sourceResult?.verdict !== "passed" || sourceResult.matches?.length !== 1)
      return {
        rows: [],
        omittedRows: 0,
        omittedFields: 0,
        omissions: [sourceResult?.reason ?? "Extraction source is not uniquely available."],
        coverage: sourceResult?.coverage ?? fallbackCoverage,
        document: freshness,
      };
    const source = nodes.get(sourceResult.matches[0]!.elementId);
    if (!source)
      return {
        rows: [],
        omittedRows: 0,
        omittedFields: 0,
        omissions: ["Extraction source became stale."],
        coverage: fallbackCoverage,
        document: { ...freshness, status: "changed" as const },
      };
    const omissions: string[] = [];
    const composedDescendants = (root: Element) => {
      const output: Element[] = [];
      const roots: Array<Element | ShadowRoot> = [root];
      let visited = 0;
      while (roots.length > 0 && visited < 10_000) {
        const current = roots.shift()!;
        for (const element of current.querySelectorAll("*")) {
          visited++;
          output.push(element);
          if (element.shadowRoot) roots.push(element.shadowRoot);
          if (element.matches("iframe,frame")) {
            if (!omissions.includes("Nested frame extraction is unsupported."))
              omissions.push("Nested frame extraction is unsupported.");
          }
          if (visited >= 10_000) break;
        }
      }
      if (visited >= 10_000) omissions.push("Extraction traversal bound reached.");
      return output;
    };
    const descendants = composedDescendants(source);
    const roleMatches = (element: Element, target: { role: string; name: string }) =>
      roleOf(element) === target.role && nameOf(element) === target.name;
    let rowElements: Element[];
    if (query.source.kind === "region") rowElements = [source];
    else if (query.source.kind === "list") {
      const role = query.source.itemRole ?? "listitem";
      rowElements = descendants.filter((element) => roleOf(element) === role);
    } else {
      rowElements = descendants.filter(
        (element) => roleOf(element) === "row" || element.tagName === "TR",
      );
    }
    const maximumRows = Math.min(100, Math.max(1, query.maxRows ?? 25));
    const maximumChars = Math.min(4_000, Math.max(1, query.maxFieldChars ?? 1_000));
    let omittedRows = Math.max(0, rowElements.length - maximumRows);
    let omittedFields = 0;
    const propertyOf = (element: Element, property: string): string | boolean | null => {
      if (property === "name") return nameOf(element).slice(0, maximumChars);
      if (property === "text") return (element.textContent?.trim() ?? "").slice(0, maximumChars);
      if (property === "checked")
        return "checked" in element
          ? Boolean((element as HTMLInputElement).checked)
          : element.getAttribute("aria-checked") === "true";
      if (property === "href") {
        if (element.tagName !== "A" || !("href" in element)) return null;
        try {
          const href = new URL(String((element as HTMLAnchorElement).href));
          if (href.protocol !== "http:" && href.protocol !== "https:") return null;
          href.username = "";
          href.password = "";
          return href.href.slice(0, maximumChars);
        } catch {
          return null;
        }
      }
      if (
        (element as HTMLInputElement).type === "password" ||
        (element as HTMLInputElement).type === "file"
      )
        return null;
      return "value" in element
        ? String((element as HTMLInputElement).value).slice(0, maximumChars)
        : null;
    };
    const headers =
      query.source.kind === "table"
        ? descendants.filter(
            (element) => roleOf(element) === "columnheader" || element.tagName === "TH",
          )
        : [];
    const rows = rowElements.slice(0, maximumRows).map((container) => {
      const local = composedDescendants(container);
      const fields = query.fields.flatMap((field) => {
        let target: Element | undefined;
        if (field.kind === "container") target = container;
        else if (field.kind === "descendant" && field.target) {
          if (field.target.scope?.frame !== undefined) {
            omittedFields++;
            return [];
          }
          const found = local.filter((element) => roleMatches(element, field.target!));
          if (found.length !== 1) {
            omittedFields++;
            return [];
          }
          target = found[0];
        } else if (field.kind === "table-column") {
          const column = headers.findIndex((header) => nameOf(header) === field.columnName);
          const cells = local.filter(
            (element) => roleOf(element) === "cell" || ["TD", "TH"].includes(element.tagName),
          );
          if (column < 0 || !cells[column]) {
            omittedFields++;
            return [];
          }
          target = cells[column];
        }
        if (!target) {
          omittedFields++;
          return [];
        }
        return [{ key: field.key, value: propertyOf(target, field.property) }];
      });
      return { fields };
    });
    const baseCoverage = sourceResult.coverage ?? fallbackCoverage;
    const result = {
      rows,
      omittedRows,
      omittedFields,
      omissions: omissions.slice(0, 64),
      coverage:
        omissions.length === 0
          ? baseCoverage
          : {
              status: baseCoverage.status === "unsupported" ? "unsupported" : "partial",
              searchedScopes: baseCoverage.searchedScopes,
              omittedScopes: baseCoverage.omittedScopes + omissions.length,
              omissions: [...baseCoverage.omissions, ...omissions].slice(0, 64),
            },
      document: freshness,
    };
    const encoder = new TextEncoder();
    const encodedSize = () => encoder.encode(JSON.stringify(result)).byteLength;
    while (result.rows.length > 0 && encodedSize() > 48_000) {
      result.rows.pop();
      omittedRows++;
      result.omittedRows = omittedRows;
    }
    if (encodedSize() > 48_000) {
      for (const row of result.rows) {
        while (row.fields.length > 0 && encodedSize() > 48_000) {
          row.fields.pop();
          omittedFields++;
          result.omittedFields = omittedFields;
        }
      }
    }
    if (
      (omittedRows > 0 || omittedFields > 0) &&
      !result.omissions.includes("Extraction output budget reached.")
    )
      result.omissions.push("Extraction output budget reached.");
    if (result.omissions.includes("Extraction output budget reached.")) {
      result.coverage = {
        ...result.coverage,
        status: result.coverage.status === "unsupported" ? "unsupported" : "partial",
        omittedScopes: result.coverage.omittedScopes + 1,
        omissions: [...result.coverage.omissions, "Extraction output budget reached."].slice(0, 64),
      };
    }
    while (result.rows.length > 0 && encodedSize() > 48_000) {
      result.rows.pop();
      omittedRows++;
      result.omittedRows = omittedRows;
    }
    if (encodedSize() > 48_000) {
      for (const row of result.rows) {
        while (row.fields.length > 0 && encodedSize() > 48_000) {
          row.fields.pop();
          omittedFields++;
          result.omittedFields = omittedFields;
        }
      }
    }
    if (encodedSize() > 48_000) {
      result.omissions = ["Extraction output budget reached."];
      result.coverage = {
        ...result.coverage,
        status: result.coverage.status === "unsupported" ? "unsupported" : "partial",
        omissions: ["Extraction output budget reached."],
      };
    }
    return result;
  };
  const waitForAssertion = (rawQuery: unknown) => {
    const query = rawQuery as {
      readonly assertion: unknown;
      readonly timeoutMs: number;
      readonly expectedDocumentId?: string;
    };
    const evaluate = () =>
      (
        probe({
          assertions: [query.assertion],
          ...(query.expectedDocumentId ? { expectedDocumentId: query.expectedDocumentId } : {}),
        }) as { results: Array<{ verdict: string }> }
      ).results[0]!;
    const initial = evaluate();
    if (initial.verdict === "passed")
      return Promise.resolve({ status: "satisfied", result: initial });
    if (initial.verdict === "indeterminate")
      return Promise.resolve({ status: "indeterminate", result: initial });
    return new Promise((resolve) => {
      // @effect-diagnostics-next-line globalDate:off -- Serialized page code uses the document wall clock for an exact browser-side deadline.
      const deadline = Date.now() + Math.min(60_000, Math.max(1, query.timeoutMs));
      let settled = false;
      let queued = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const observers: MutationObserver[] = [];
      const documents = new Set<Document>([document]);
      for (const frame of nodeFrames.values()) documents.add(frame.frameDocument);
      const cleanup = () => {
        for (const observer of observers) observer.disconnect();
        for (const frameDocument of documents) {
          frameDocument.removeEventListener("input", schedule, true);
          frameDocument.removeEventListener("change", schedule, true);
        }
        window.removeEventListener("pagehide", departed, true);
        if (timer !== undefined) clearTimeout(timer);
      };
      const finish = (status: "satisfied" | "timed-out" | "indeterminate", result: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ status, result });
      };
      const documentChangedResult = () => ({
        ...initial,
        verdict: "indeterminate",
        passed: false,
        reason: "The document changed while waiting for the assertion.",
        document: {
          ...(initial as { document?: Record<string, unknown> }).document,
          status: "changed",
        },
      });
      const deadlineResult = (result: { verdict: string }) =>
        result.verdict === "passed"
          ? {
              ...result,
              verdict: "indeterminate",
              passed: false,
              reason: "The assertion was true at the deadline without an observable event.",
            }
          : result;
      const sample = () => {
        queued = false;
        // @effect-diagnostics-next-line globalDate:off -- Serialized page code checks the browser-side deadline before accepting a mutation result.
        if (Date.now() >= deadline) {
          let result;
          try {
            result = evaluate();
          } catch {
            finish("indeterminate", documentChangedResult());
            return;
          }
          finish(
            result.verdict === "indeterminate" ? "indeterminate" : "timed-out",
            deadlineResult(result),
          );
          return;
        }
        let result;
        try {
          result = evaluate();
        } catch {
          finish("indeterminate", documentChangedResult());
          return;
        }
        if (result.verdict === "passed") finish("satisfied", result);
        else if (result.verdict === "indeterminate") finish("indeterminate", result);
      };
      function schedule() {
        if (queued || settled) return;
        queued = true;
        queueMicrotask(sample);
      }
      const departed = () => finish("indeterminate", documentChangedResult());
      for (const frameDocument of documents) {
        const observer = new MutationObserver(schedule);
        observer.observe(frameDocument.documentElement, {
          attributes: true,
          characterData: true,
          childList: true,
          subtree: true,
        });
        observers.push(observer);
        frameDocument.addEventListener("input", schedule, true);
        frameDocument.addEventListener("change", schedule, true);
      }
      window.addEventListener("pagehide", departed, true);
      // @effect-diagnostics-next-line globalDate:off -- Compute remaining browser-side deadline without polling.
      const remainingMs = Math.max(0, deadline - Date.now());
      // @effect-diagnostics-next-line globalTimers:off -- Serialized page code needs one exact deadline timer and cleans it up on every terminal path.
      timer = setTimeout(() => {
        let result;
        try {
          result = evaluate();
        } catch {
          finish("indeterminate", documentChangedResult());
          return;
        }
        finish(
          result.verdict === "indeterminate" ? "indeterminate" : "timed-out",
          deadlineResult(result),
        );
      }, remainingMs);
    });
  };
  page.__t3JevBrowser = {
    observe,
    observeReady,
    guard,
    select,
    selectLabel,
    prepareText,
    setText,
    check,
    hover,
    scrollTarget,
    scrollIntoViewTarget,
    registerTarget,
    elementFor,
    probe,
    extract,
    waitForAssertion,
  };
  return observe();
}
