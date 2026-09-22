import type { BrowserArtifactTarget } from "@t3tools/contracts";

/**
 * Returns a transient CDP remote object in the isolated world. The host releases
 * it after setFileInputFiles; no node object or desktop path reaches the agent.
 * File inputs may be hidden, but must still be unique, connected and enabled.
 */
export function buildBrowserUploadTargetExpression(target: BrowserArtifactTarget): string {
  return `(() => {
    const target = ${JSON.stringify(target)};
    let element;
    if (target.semanticTarget !== undefined) {
      const runtime = globalThis.__t3JevBrowser;
      const result = runtime?.probe({assertions:[{kind:"control-exists",target:target.semanticTarget}]})?.results?.[0];
      if (!result || result.verdict !== "passed" || result.coverage.status !== "complete" ||
          result.document.status !== "current" || result.matchCount !== 1 || result.matches?.length !== 1)
        throw new Error("File input must have one verified semantic match.");
      element = runtime.elementFor(result.document.revision, result.matches[0].elementId);
    } else {
      const injected = globalThis.__t3PlaywrightInjected;
      const matches = target.locator !== undefined
        ? injected.querySelectorAll(injected.parseSelector(target.locator), document)
        : document.querySelectorAll(target.selector);
      if (matches.length !== 1) throw new Error("File input must match exactly one element.");
      element = matches[0];
    }
    if (!element?.isConnected || element.localName !== "input" || element.type !== "file" ||
        element.matches(":disabled") || element.getAttribute("aria-disabled") === "true")
      throw new Error("The selected target is not an enabled file input.");
    return element;
  })()`;
}
