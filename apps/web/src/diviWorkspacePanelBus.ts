import type { EnvironmentId } from "@t3tools/contracts";

const OPEN_EVENT = "t3code:open-divi-workspace";

export interface DiviWorkspaceOpenRequest {
  readonly environmentId: EnvironmentId;
  readonly workspaceId?: string;
  readonly mainId?: string;
}

export function openDiviWorkspacePanel(request: DiviWorkspaceOpenRequest): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: request }));
}

export function onOpenDiviWorkspacePanel(listener: (request: DiviWorkspaceOpenRequest) => void) {
  const handler = (event: Event) =>
    listener((event as CustomEvent<DiviWorkspaceOpenRequest>).detail);
  window.addEventListener(OPEN_EVENT, handler);
  return () => window.removeEventListener(OPEN_EVENT, handler);
}
