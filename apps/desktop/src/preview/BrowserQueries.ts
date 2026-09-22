import type { BrowserExtractQuery, BrowserWaitForAssertionQuery } from "@t3tools/contracts";

import { buildJevBrowserObservationExpression } from "./JevBrowserObservation.ts";

const withObserver = (call: string) =>
  `globalThis.__t3JevBrowser ? (${call}) : ((${buildJevBrowserObservationExpression()}), ${call})`;

export function buildBrowserExtractExpression(query: BrowserExtractQuery): string {
  return withObserver(
    `globalThis.__t3JevBrowser?.extract?.(${JSON.stringify(query)}) ?? { rows: [], omittedRows: 0, omittedFields: 0, omissions: ['observer unavailable'], coverage: { status: 'unsupported', searchedScopes: 0, omittedScopes: 1, omissions: ['observer unavailable'] }, document: { documentId: '', revision: '', status: 'unknown' } }`,
  );
}

export function buildBrowserWaitForAssertionExpression(
  query: BrowserWaitForAssertionQuery,
): string {
  return withObserver(`globalThis.__t3JevBrowser?.waitForAssertion?.(${JSON.stringify(query)})`);
}
