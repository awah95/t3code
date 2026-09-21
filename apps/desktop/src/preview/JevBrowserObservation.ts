/**
 * Trusted page code. Run every expression from this module in the same isolated world;
 * models only see the serialized observation and opaque control IDs.
 */
export function buildJevBrowserObservationExpression(): string {
  return `(${installJevBrowserObserver.toString()})()`;
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
      guard: (revision: string, id: string | null) => unknown;
      select: (revision: string, id: string, value: string) => unknown;
      prepareText: (revision: string, id: string) => unknown;
      setText: (revision: string, id: string, value: string) => unknown;
    };
  };
  if (page.__t3JevBrowser) return page.__t3JevBrowser.observe();
  // @effect-diagnostics-next-line cryptoRandomUUID:off -- This function is serialized into an isolated browser world, outside the desktop Effect runtime.
  const documentId = crypto.randomUUID();
  const ids = new WeakMap<Element, string>();
  const nodes = new Map<string, Element>();
  let sequence = 0;
  let observedFingerprint = "";
  let revision = 0;
  const renderedRect = (element: Element) => {
    if (element.closest('[aria-hidden="true"],[inert]')) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
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
  const nameOf = (element: Element) => {
    const labelled = element.getAttribute("aria-labelledby");
    if (labelled) {
      const text = labelled
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ")
        .trim();
      if (text) return text.slice(0, 240);
    }
    const labels = "labels" in element ? (element as HTMLInputElement).labels : null;
    const inputType = element.tagName === "INPUT" ? (element as HTMLInputElement).type : "";
    const sensitive = inputType === "password" || inputType === "file";
    return (
      element.getAttribute("aria-label") ||
      (labels
        ? Array.from(labels)
            .map((label) => label.textContent)
            .join(" ")
            .trim()
        : "") ||
      element.getAttribute("alt") ||
      (element.tagName === "INPUT" && !sensitive && "value" in element
        ? String((element as HTMLInputElement).value)
        : "") ||
      element.textContent?.trim() ||
      element.getAttribute("placeholder") ||
      element.getAttribute("title") ||
      element.getAttribute("name") ||
      ""
    ).slice(0, 240);
  };
  const roleOf = (element: Element) => {
    const explicit = element.getAttribute("role");
    if (explicit) return explicit;
    const tag = element.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a") return "link";
    if (tag === "select") return "combobox";
    if (tag === "textarea" || element.getAttribute("contenteditable") === "true") return "textbox";
    if (tag === "input") {
      const type = (element as HTMLInputElement).type;
      if (["checkbox", "radio"].includes(type)) return type;
      if (["button", "submit", "reset"].includes(type)) return "button";
      if (type === "search") return "searchbox";
      if (type === "number") return "spinbutton";
      return "textbox";
    }
    return "generic";
  };
  const selectorFor = (element: Element) => {
    if (element.id && document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1)
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
  const hasOpenShadowRoot = () => {
    const walker = document.createTreeWalker(document.documentElement, 1);
    let current: Node | null = document.documentElement;
    while (current) {
      if (current instanceof Element && current.shadowRoot) return true;
      current = walker.nextNode();
    }
    return false;
  };
  const read = (includeOmissions: boolean) => {
    const candidates = document.querySelectorAll(
      "a[href],button,input:not([type=hidden]),textarea,select,[role],[tabindex],[contenteditable=true]",
    );
    const visibleControls: Array<{ element: Element; rect: DOMRect }> = [];
    let offscreenControls = 0;
    let omittedControls = 0;
    for (const element of candidates) {
      const rect = renderedRect(element);
      if (!rect) continue;
      if (!intersectsViewport(rect)) {
        offscreenControls++;
        continue;
      }
      if (visibleControls.length >= 180) {
        omittedControls++;
        continue;
      }
      visibleControls.push({ element, rect });
    }
    let omittedOptions = 0;
    const controls = visibleControls.map(({ element, rect }) => {
      let id = ids.get(element);
      if (!id) {
        id = `e${sequence++}`;
        ids.set(element, id);
      }
      nodes.set(id, element);
      const input = element as HTMLInputElement;
      const sensitive = input.type === "password" || input.type === "file";
      const select = element instanceof HTMLSelectElement ? element : null;
      if (element instanceof HTMLSelectElement)
        omittedOptions += Math.max(0, element.options.length - 100);
      return {
        id,
        tag: element.tagName.toLowerCase(),
        role: roleOf(element),
        name: nameOf(element),
        value: sensitive ? "" : "value" in element ? String(input.value).slice(0, 2000) : "",
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
        ...(element.tagName === "A" && "href" in element
          ? { href: String((element as HTMLAnchorElement).href) }
          : {}),
        selector: selectorFor(element),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    });
    const rawText = document.body?.innerText ?? "";
    const text = rawText.slice(0, 12000);
    const omissions = includeOmissions
      ? [
          ...(omittedControls > 0 ? [`${omittedControls} viewport controls omitted`] : []),
          ...(offscreenControls > 0
            ? [`${offscreenControls} offscreen controls not observed`]
            : []),
          ...(omittedOptions > 0 ? [`${omittedOptions} native select options omitted`] : []),
          ...(rawText.length > text.length ? ["page text truncated"] : []),
          ...(document.querySelector("iframe,frame")
            ? ["frame contents require agent inspection"]
            : []),
          ...(document.querySelector("canvas") ? ["canvas requires visual inspection"] : []),
          ...(hasOpenShadowRoot() ? ["shadow root contents require agent inspection"] : []),
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
    ]);
    return { controls, text, omissions, fingerprint };
  };
  const observe = () => {
    nodes.clear();
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
    if (!rect || !intersectsViewport(rect))
      return { ok: false, reason: "target-covered-or-offscreen" };
    const x =
      Math.max(0, rect.left) + (Math.min(innerWidth, rect.right) - Math.max(0, rect.left)) / 2;
    const y =
      Math.max(0, rect.top) + (Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top)) / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !(hit === node || node.contains(hit)))
      return { ok: false, reason: "target-covered-or-offscreen" };
    return { ok: true, selector: selectorFor(node), x, y };
  };
  const select = (expected: string, id: string, value: string) => {
    const checked = guard(expected, id);
    if (!checked.ok) return checked;
    const node = nodes.get(id);
    if (!(node instanceof HTMLSelectElement) || node.multiple)
      return { ok: false, reason: "unsupported-select" };
    const option = Array.from(node.options).find((candidate) => candidate.value === value);
    if (!option || option.disabled || option.parentElement?.matches("optgroup:disabled"))
      return { ok: false, reason: "option-unavailable" };
    node.value = value;
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  };
  const prepareText = (expected: string, id: string) => {
    const checked = guard(expected, id);
    if (!checked.ok) return checked;
    const node = nodes.get(id);
    if (!node) return { ok: false, reason: "target-unavailable" };
    const textInput =
      node instanceof HTMLInputElement &&
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
      ]).has(node.type);
    const textArea = node instanceof HTMLTextAreaElement;
    const contentEditable = node?.getAttribute("contenteditable") === "true";
    if (
      (!textInput && !textArea && !contentEditable) ||
      ("readOnly" in node && (node as HTMLInputElement).readOnly)
    )
      return { ok: false, reason: "unsupported-text-target" };
    (node as HTMLElement).focus({ preventScroll: true });
    const retained = () =>
      node.isConnected && nodes.get(id) === node && document.activeElement === node;
    if (!retained()) return { ok: false, reason: "target-unavailable" };
    const beforeInput = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "deleteContentBackward",
      data: null,
    });
    if (!node.dispatchEvent(beforeInput)) return { ok: false, reason: "text-edit-cancelled" };
    if (!retained()) return { ok: false, reason: "target-unavailable" };
    if (textInput || textArea) {
      const prototype = textArea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (!setter) return { ok: false, reason: "unsupported-text-target" };
      setter.call(node, "");
    } else {
      node.replaceChildren();
    }
    node.dispatchEvent(
      new InputEvent("input", {
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
      node?.isConnected && nodes.get(id) === node && document.activeElement === node;
    if (!retained()) return { ok: false, reason: "target-unavailable" };
    if (value.length > 0 && !document.execCommand("insertText", false, value))
      return { ok: false, reason: "unsupported-text-target" };
    if (!retained()) return { ok: false, reason: "target-unavailable" };
    node?.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  };
  page.__t3JevBrowser = { observe, guard, select, prepareText, setText };
  return observe();
}
