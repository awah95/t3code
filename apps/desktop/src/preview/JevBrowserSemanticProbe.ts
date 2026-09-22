import type { JevBrowserVerifyInput } from "@t3tools/contracts";

import { buildJevBrowserObservationExpression } from "./JevBrowserObservation.ts";

export type JevBrowserSemanticProbeInput = {
  readonly assertions: JevBrowserVerifyInput["assertions"];
  readonly expectedDocumentId?: JevBrowserVerifyInput["expectedDocumentId"] | undefined;
};

/**
 * Builds a value-only page expression. The observer owns all DOM access and
 * retained references; assertions and results remain plain serializable data.
 */
export function buildJevBrowserSemanticProbeExpression(
  input: JevBrowserSemanticProbeInput,
): string {
  const serializedInput = JSON.stringify(input);
  return `globalThis.__t3JevBrowser?.probe?.(${serializedInput}) ?? ((${buildJevBrowserObservationExpression()}), globalThis.__t3JevBrowser?.probe?.(${serializedInput}) ?? { results: [] })`;
}
