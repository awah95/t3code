import type { JevRouteRequest } from "@t3tools/contracts";
import { JEV_MAX_REQUEST_CHARS } from "@t3tools/shared/jevRouting";

export function isValidJevRouteRequest(request: JevRouteRequest): boolean {
  return Boolean(
    request.requestId &&
    request.requestId.length <= 128 &&
    JSON.stringify(request).length <= JEV_MAX_REQUEST_CHARS &&
    request.candidates.length >= 1 &&
    request.candidates.length <= 128 &&
    new Set(request.candidates.map((candidate) => candidate.key)).size ===
      request.candidates.length &&
    request.candidates.every(
      (candidate) =>
        /^[a-zA-Z0-9_-]{1,128}$/.test(candidate.key) && candidate.description.length <= 1000,
    ),
  );
}
