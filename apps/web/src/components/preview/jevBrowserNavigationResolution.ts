import type {
  EnvironmentId,
  JevBrowserObserveInput,
  JevBrowserResolvedNavigation,
} from "@t3tools/contracts";

import { resolveBrowserNavigationTarget } from "~/browser/browserTargetResolver";

const readHttpOrigin = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
};

export const resolveJevBrowserNavigations = (
  environmentId: EnvironmentId,
  input: JevBrowserObserveInput,
): readonly JevBrowserResolvedNavigation[] => {
  const explicitlyAllowedOrigins = input.allowedOrigins.flatMap((value) => {
    const origin = readHttpOrigin(value);
    return origin === undefined ? [] : [origin];
  });

  return input.inputs.flatMap((candidate) => {
    if (candidate.kind !== "navigation") return [];
    const resolution = resolveBrowserNavigationTarget(environmentId, candidate.target);
    const resolvedOrigin = readHttpOrigin(resolution.resolvedUrl);
    if (resolvedOrigin === undefined) {
      throw new Error("The browser host could not resolve an HTTP(S) navigation target.");
    }
    return [
      {
        inputId: candidate.id,
        resolvedUrl: resolution.resolvedUrl,
        logicalLocation: resolution.requestedUrl,
        allowedOrigins: [...new Set([resolvedOrigin, ...explicitlyAllowedOrigins])],
      },
    ];
  });
};
