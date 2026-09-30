import type { DiviWorkspaceOperation, DiviWorkspaceRunResult } from "@t3tools/contracts";
import { PlayIcon, RotateCwIcon, SquareIcon } from "lucide-react";
import { Button } from "../ui/button";
import { cleanLogTail, readinessLabel, watcherLabel } from "./diviWorkspaceView";

function serviceLabel(
  service: NonNullable<DiviWorkspaceRunResult["runtimeStatus"]>["website" | "database"] | undefined,
): string {
  if (!service) return "Status not checked";
  if (service.state === "missing") return "Not created";
  if (service.state === "stopped") return "Stopped";
  if (service.state === "error" || service.health === "unhealthy") return "Needs attention";
  if (service.health === "starting") return "Starting";
  if (service.state === "running" && service.health === "healthy") return "Running";
  return "Running · health not confirmed";
}

function observedLabel(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

export function DiviWorkspaceOverview({
  workspace,
  busy,
  busyResources,
  previewUrl,
  onOperation,
  onLogRequest,
  logs,
  loadingLogId,
}: {
  workspace: DiviWorkspaceRunResult;
  busy: boolean;
  busyResources: Readonly<Record<string, boolean>>;
  previewUrl: string | null;
  onOperation: (operation: DiviWorkspaceOperation, profileId?: string) => void;
  onLogRequest: (profileId: string) => void;
  logs: Readonly<Record<string, string>>;
  loadingLogId: string | null;
}) {
  const runtime = workspace.runtimeStatus;
  const observed = observedLabel(runtime?.observedAt);
  const websiteReadiness = workspace.readiness?.website;
  const hasWebsite = websiteReadiness !== undefined && websiteReadiness !== "not-requested";
  return (
    <div className={hasWebsite ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"}>
      {hasWebsite && (
        <section className="min-w-0 space-y-2 rounded border p-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-medium">Website</h4>
            <span className="text-xs">{serviceLabel(runtime?.website)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Database: {serviceLabel(runtime?.database)}
          </p>
          <p className="text-xs text-muted-foreground">
            {observed ? `Last checked: ${observed}.` : "Service status has not been checked yet."}{" "}
            Use Refresh to check again.
          </p>
          <div className="flex flex-wrap gap-1">
            {previewUrl && (
              <Button
                size="xs"
                disabled={busy || busyResources.site || workspace.readiness?.website !== "ready"}
                onClick={() => window.open(previewUrl, "_blank", "noopener,noreferrer")}
              >
                Open website
              </Button>
            )}
            <Button
              size="xs"
              variant="outline"
              aria-label="Start website"
              disabled={busy || busyResources.site || workspace.readiness?.website === "ready"}
              onClick={() => onOperation("start")}
            >
              <PlayIcon aria-hidden />
              Start
            </Button>
            <Button
              size="xs"
              variant="outline"
              aria-label="Stop website"
              disabled={
                busy ||
                busyResources.site ||
                (websiteReadiness !== "ready" && websiteReadiness !== "degraded")
              }
              onClick={() => onOperation("stop")}
            >
              <SquareIcon aria-hidden />
              Stop
            </Button>
          </div>
        </section>
      )}
      <section className="min-w-0 space-y-2 rounded border p-3">
        <h4 className="font-medium">Watchers</h4>
        <p className="text-xs text-muted-foreground">
          Watchers run while you edit code and rebuild assets when files change.
        </p>
        {workspace.watcherProfiles?.length ? (
          workspace.watcherProfiles.map((id) => {
            const watcherBusy = busy || busyResources[`watcher-${id}`];
            const label = watcherLabel(id);
            const taskLabel = "watcher";
            const detail = workspace.watcherDetails?.[id];
            const state = detail?.state;
            const canStart = state === "stopped" || state === "not-requested";
            const canRestart =
              state === "ready" || state === "running-unverified" || state === "degraded";
            const canStop = canRestart || state === "stopping-unverified";
            return (
              <div
                key={id}
                role="group"
                aria-label={label + " " + taskLabel}
                className="min-w-0 space-y-1 border-t pt-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="break-all">{label}</strong>
                  <span role="status">{watcherBusy ? "Updating…" : readinessLabel(state)}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="xs"
                    variant="outline"
                    aria-label={"Start " + taskLabel + " for " + label}
                    disabled={watcherBusy || !canStart}
                    onClick={() => onOperation("watcher-start", id)}
                  >
                    <PlayIcon aria-hidden />
                    Start
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    aria-label={"Restart " + taskLabel + " for " + label}
                    disabled={watcherBusy || !canRestart}
                    onClick={() => onOperation("watcher-restart", id)}
                  >
                    <RotateCwIcon aria-hidden />
                    Restart
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    aria-label={"Stop " + taskLabel + " for " + label}
                    disabled={watcherBusy || !canStop}
                    onClick={() => onOperation("watcher-stop", id)}
                  >
                    <SquareIcon aria-hidden />
                    Stop
                  </Button>
                </div>
                <details
                  onToggle={(event) => {
                    if (event.currentTarget.open) onLogRequest(id);
                  }}
                >
                  <summary className="cursor-pointer">Recent watcher log for {label}</summary>
                  <p className="text-muted-foreground">
                    Loaded when opened; close and reopen to refresh.
                  </p>
                  {loadingLogId === id ? (
                    <p>Loading log…</p>
                  ) : (
                    <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-xs">
                      {logs[id] ? cleanLogTail(logs[id]) : "No log output yet."}
                    </pre>
                  )}
                </details>
              </div>
            );
          })
        ) : (
          <p className="text-xs text-muted-foreground">No watchers configured.</p>
        )}
      </section>
    </div>
  );
}
