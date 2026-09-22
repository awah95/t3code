import type {
  JevBrowserVerificationResult,
  PreviewAutomationCheckInput,
  PreviewAutomationHoverInput,
  PreviewAutomationSelectInput,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export {
  buildJevBrowserGuardExpression as buildBrowserSemanticGuardExpression,
  buildJevBrowserSelectExpression as buildBrowserSemanticSelectExpression,
} from "./JevBrowserObservation.ts";

export const BrowserSemanticActionFailure = Schema.Struct({
  ok: Schema.Literal(false),
  reason: Schema.String,
});

export const BrowserSemanticCheckResult = Schema.Union([
  BrowserSemanticActionFailure,
  Schema.Struct({
    ok: Schema.Literal(true),
    changed: Schema.Boolean,
    checked: Schema.Boolean,
  }),
]);
export type BrowserSemanticCheckResult = typeof BrowserSemanticCheckResult.Type;

export const BrowserSemanticHoverResult = Schema.Union([
  BrowserSemanticActionFailure,
  Schema.Struct({ ok: Schema.Literal(true) }),
]);
export type BrowserSemanticHoverResult = typeof BrowserSemanticHoverResult.Type;

const BrowserScrollPosition = Schema.Struct({ x: Schema.Finite, y: Schema.Finite });

export const BrowserSemanticScrollResult = Schema.Union([
  BrowserSemanticActionFailure,
  Schema.Struct({
    ok: Schema.Literal(true),
    before: BrowserScrollPosition,
    after: BrowserScrollPosition,
    progressed: Schema.Boolean,
  }),
]);
export type BrowserSemanticScrollResult = typeof BrowserSemanticScrollResult.Type;

export type BrowserSemanticScrollDirection = "up" | "down" | "left" | "right";

export type BrowserSemanticActionTarget =
  | {
      readonly ok: true;
      readonly revision: string;
      readonly targetId: string;
    }
  | { readonly ok: false; readonly reason: string };

type BrowserDirectAction =
  | {
      readonly operation: "select";
      readonly input: Pick<
        PreviewAutomationSelectInput,
        "selector" | "locator" | "semanticTarget" | "value" | "label"
      >;
    }
  | {
      readonly operation: "check";
      readonly input: Pick<
        PreviewAutomationCheckInput,
        "selector" | "locator" | "semanticTarget" | "checked"
      >;
    }
  | {
      readonly operation: "hover";
      readonly input: Pick<PreviewAutomationHoverInput, "selector" | "locator" | "semanticTarget">;
    }
  | {
      readonly operation: "resolve";
      readonly input: Pick<PreviewAutomationHoverInput, "selector" | "locator" | "semanticTarget">;
    };

export const decodeBrowserSemanticCheckResult = Schema.decodeUnknownEffect(
  BrowserSemanticCheckResult,
);
export const decodeBrowserSemanticHoverResult = Schema.decodeUnknownEffect(
  BrowserSemanticHoverResult,
);
export const decodeBrowserSemanticScrollResult = Schema.decodeUnknownEffect(
  BrowserSemanticScrollResult,
);

export function uniqueBrowserSemanticActionTarget(
  result: JevBrowserVerificationResult,
): BrowserSemanticActionTarget {
  if (result.document.status !== "current") return { ok: false, reason: "document-changed" };
  if (result.coverage.status !== "complete")
    return { ok: false, reason: "semantic-scope-incomplete" };
  if (result.verdict !== "passed" || result.matchCount !== 1 || result.matches?.length !== 1)
    return { ok: false, reason: result.reason ?? "semantic-target-not-unique" };
  const match = result.matches[0];
  if (!match) return { ok: false, reason: "semantic-target-not-unique" };
  if (match.documentId !== result.document.documentId)
    return { ok: false, reason: "document-changed" };
  return {
    ok: true,
    revision: result.document.revision,
    targetId: match.elementId,
  };
}

export function buildBrowserSemanticCheckExpression(
  revision: string,
  targetId: string,
  checked: boolean,
): string {
  return `globalThis.__t3JevBrowser?.check(${JSON.stringify(revision)}, ${JSON.stringify(targetId)}, ${JSON.stringify(checked)}) ?? { ok: false, reason: 'document-changed' }`;
}

export function buildBrowserSemanticHoverExpression(revision: string, targetId: string): string {
  return `globalThis.__t3JevBrowser?.hover(${JSON.stringify(revision)}, ${JSON.stringify(targetId)}) ?? { ok: false, reason: 'document-changed' }`;
}

export function buildBrowserSemanticSelectLabelExpression(
  revision: string,
  targetId: string,
  label: string,
): string {
  return `globalThis.__t3JevBrowser?.selectLabel(${JSON.stringify(revision)}, ${JSON.stringify(targetId)}, ${JSON.stringify(label)}) ?? { ok: false, reason: 'document-changed' }`;
}

export function buildBrowserSemanticScrollExpression(
  revision: string,
  targetId: string,
  direction: BrowserSemanticScrollDirection,
): string {
  return `globalThis.__t3JevBrowser?.scrollTarget(${JSON.stringify(revision)}, ${JSON.stringify(targetId)}, ${JSON.stringify(direction)}) ?? { ok: false, reason: 'document-changed' }`;
}

/**
 * Resolves and performs one direct typed action inside the shared isolated
 * world. The caller installs the observer and Playwright runtime first, then
 * uses a returned hover point for native CDP mouse movement.
 */
export function buildBrowserDirectActionExpression(action: BrowserDirectAction): string {
  const encoded = JSON.stringify(action);
  return `(() => {
    const request = ${encoded};
    const runtime = globalThis.__t3JevBrowser;
    if (!runtime) return { ok: false, reason: "observer-unavailable" };
    const resolveSemantic = (semanticTarget) => {
      const probed = runtime.probe({
        assertions: [{ kind: "control-exists", target: semanticTarget }]
      });
      const result = probed?.results?.[0];
      if (!result || result.document?.status !== "current")
        return { ok: false, reason: "document-changed" };
      if (result.coverage?.status !== "complete")
        return { ok: false, reason: "semantic-scope-incomplete" };
      if (result.verdict !== "passed" || result.matchCount !== 1 || result.matches?.length !== 1)
        return { ok: false, reason: result.reason || "semantic-target-not-unique" };
      return {
        ok: true,
        revision: result.document.revision,
        targetId: result.matches[0].elementId
      };
    };
    const resolveSelector = () => {
      try {
        const find = () => {
          if (request.input.locator !== undefined) {
            const injected = globalThis.__t3PlaywrightInjected;
            if (!injected) return { error: "locator-runtime-unavailable" };
            const parsed = injected.parseSelector(request.input.locator);
            return { elements: Array.from(injected.querySelectorAll(parsed, document)) };
          }
          return { elements: Array.from(document.querySelectorAll(request.input.selector)) };
        };
        const first = find();
        if (first.error) return { ok: false, reason: first.error };
        if (first.elements.length !== 1)
          return { ok: false, reason: first.elements.length === 0 ? "target-not-found" : "target-not-unique" };
        const element = first.elements[0];
        const registered = runtime.registerTarget(element);
        if (!registered.ok) return registered;
        return registered;
      } catch {
        return { ok: false, reason: "invalid-selector" };
      }
    };
    let target = request.input.semanticTarget !== undefined
      ? resolveSemantic(request.input.semanticTarget)
      : resolveSelector();
    if (!target.ok) return target;
    target = runtime.scrollIntoViewTarget(target.revision, target.targetId);
    if (!target.ok) return target;
    const guarded = runtime.guard(target.revision, target.targetId);
    if (!guarded.ok) return guarded;
    if (request.operation === "hover" || request.operation === "resolve") {
      if (typeof guarded.x !== "number" || typeof guarded.y !== "number")
        return { ok: false, reason: "target-geometry-unavailable" };
      if (request.operation === "resolve") return {
        ok: true,
        targetId: target.targetId,
        revision: target.revision,
        framePath: Array.isArray(target.framePath) ? target.framePath : [],
        point: { x: guarded.x, y: guarded.y },
        ...(typeof target.href === "string" ? { href: target.href } : {})
      };
      return { ok: true, point: { x: guarded.x, y: guarded.y } };
    }
    if (request.operation === "check") {
      const checked = runtime.check(target.revision, target.targetId, request.input.checked);
      return checked.ok ? { ok: true } : checked;
    }
    const selected = request.input.label !== undefined
      ? runtime.selectLabel(target.revision, target.targetId, request.input.label)
      : runtime.select(target.revision, target.targetId, request.input.value);
    return selected.ok ? { ok: true } : selected;
  })()`;
}
