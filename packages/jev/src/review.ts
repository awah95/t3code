import type { JevRouteRequest, JevRouteResult } from "@t3tools/contracts";

export type JevReviewAction = "suggestion" | "current" | "alternative" | "cancel";
export type JevReviewSelection = {
  action: Exclude<JevReviewAction, "cancel">;
  choice: string | null;
};

/** An automatic send requires an actual policy route to a candidate in this request. */
export function isAutomaticJevRoute(request: JevRouteRequest, result: JevRouteResult): boolean {
  return (
    result.choice !== null &&
    (!result.policyOutcome || result.policyOutcome === "route") &&
    request.candidates.some((candidate) => candidate.key === result.choice) &&
    (!result.admissibleCandidateKeys || result.admissibleCandidateKeys.includes(result.choice))
  );
}

/** `undefined` rejects an invalid choice; `null` cancels the unsent turn. */
export function resolveJevReviewSelection(
  request: JevRouteRequest,
  result: JevRouteResult | null,
  action: JevReviewAction,
  choice?: string,
): JevReviewSelection | null | undefined {
  if (action === "cancel") return null;
  if (action === "current") return { action, choice: null };
  const selected = action === "suggestion" ? (result?.recommendedChoice ?? result?.choice) : choice;
  if (!selected || !request.candidates.some((candidate) => candidate.key === selected))
    return undefined;
  if (
    action === "suggestion" &&
    result?.admissibleCandidateKeys &&
    !result.admissibleCandidateKeys.includes(selected)
  )
    return undefined;
  return { action, choice: selected };
}
