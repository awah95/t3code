import type { ReactNode } from "react";
import type { DiviWorkspaceOperation, DiviWorkspaceRunResult } from "@t3tools/contracts";
import {
  ArrowUpRightIcon,
  ExternalLinkIcon,
  PlayIcon,
  RefreshCwIcon,
  RotateCwIcon,
  SquareIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { cleanLogTail, readinessLabel, watcherLabel, workspaceHeading } from "./diviWorkspaceView";

export interface DiviWorkspacePanelProps {
  workspaceId: string;
  workspace: DiviWorkspaceRunResult | null;
  loading?: boolean;
  busy: boolean;
  busyResources: Readonly<Record<string, boolean>>;
  error?: string | null;
  onRefresh: () => void;
  onOperation: (operation: DiviWorkspaceOperation, profileId?: string) => void;
  onLogRequest: (profileId: string) => void;
  logs: Readonly<Record<string, string>>;
  loadingLogId: string | null;
  onOpenInApp: (url: string) => void;
  onOpenExternal: (url: string) => void;
  onRestartWebsite?: () => void;
  renderEditor?: (taskPath: string) => ReactNode;
}

function serviceState(service: { state: string; health: string } | undefined): {
  label: string;
  tone: string;
} {
  if (!service) return { label: "Status not checked", tone: "text-muted-foreground" };
  if (service.state === "missing") return { label: "Not created", tone: "text-muted-foreground" };
  if (service.state === "stopped") return { label: "Stopped", tone: "text-muted-foreground" };
  if (service.state === "error" || service.health === "unhealthy")
    return { label: "Needs attention", tone: "text-destructive" };
  if (service.health === "starting") return { label: "Starting", tone: "text-amber-600" };
  if (service.state === "running" && service.health === "healthy")
    return { label: "Running · healthy", tone: "text-emerald-600" };
  return { label: "Running · health unconfirmed", tone: "text-amber-600" };
}

function observedAt(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString();
}

export function DiviWorkspacePanel(props: DiviWorkspacePanelProps) {
  const {
    workspaceId,
    workspace,
    loading,
    busy,
    busyResources,
    error,
    onRefresh,
    onOperation,
    onLogRequest,
    logs,
    loadingLogId,
    onOpenInApp,
    onOpenExternal,
    onRestartWebsite,
    renderEditor,
  } = props;
  if (!workspace) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 p-6 text-center">
        {loading ? (
          <>
            <RefreshCwIcon className="size-5 animate-spin text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">Checking Divi Workspace…</p>
          </>
        ) : (
          <>
            <p className="font-medium">Workspace status unavailable</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {error ?? "Refresh to check this replica."}
            </p>
            <Button size="sm" variant="outline" onClick={onRefresh}>
              Refresh
            </Button>
          </>
        )}
      </div>
    );
  }

  const website = workspace.runtimeStatus?.website;
  const database = workspace.runtimeStatus?.database;
  const webState = serviceState(website);
  const dbState = serviceState(database);
  const previewRecord = workspace.preview;
  const previewCandidate =
    previewRecord && typeof previewRecord === "object" && !Array.isArray(previewRecord)
      ? (previewRecord as Record<string, unknown>).url
      : undefined;
  const previewUrl =
    (typeof previewCandidate === "string" && /^https?:\/\//i.test(previewCandidate)
      ? previewCandidate
      : undefined) ??
    (typeof workspace.previewUrl === "string" && /^https?:\/\//i.test(workspace.previewUrl)
      ? workspace.previewUrl
      : undefined);
  const websiteReadiness = workspace.readiness?.website;
  const hasWebsite = websiteReadiness !== undefined && websiteReadiness !== "not-requested";
  const websiteReady = websiteReadiness === "ready";
  const changedAt = observedAt(workspace.runtimeStatus?.observedAt);
  const operationInProgress = Boolean(workspace.operationInProgress);
  const siteBusy = busy || operationInProgress || Boolean(busyResources.site);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Divi Workspace replica</p>
          <h2 className="truncate font-semibold">{workspaceId}</h2>
          <span
            className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs ${
              workspace.operationInProgress
                ? "bg-muted text-muted-foreground"
                : workspaceHeading(workspace.readiness).includes("attention")
                  ? "bg-destructive/10 text-destructive"
                  : workspaceHeading(workspace.readiness).includes("Ready")
                    ? "bg-emerald-500/10 text-emerald-700"
                    : "bg-amber-500/10 text-amber-700"
            }`}
            role="status"
          >
            {workspaceHeading(workspace.readiness, workspace.operationInProgress)}
          </span>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Refresh workspace status"
          disabled={loading}
          onClick={onRefresh}
        >
          <RefreshCwIcon aria-hidden />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        )}
        {workspace.operationInProgress && (
          <div role="status" className="rounded-md border bg-muted/40 p-3 text-sm">
            A workspace operation is in progress. Controls will be available when it finishes.
          </div>
        )}
        <section className="space-y-3 rounded-lg border p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-medium">Website</h3>
              <p className={`mt-1 text-xs ${webState.tone}`} role="status">
                {webState.label}
              </p>
            </div>
            {changedAt && (
              <span className="text-right text-xs text-muted-foreground">Checked {changedAt}</span>
            )}
          </div>
          {previewUrl && (
            <p className="truncate text-xs text-muted-foreground" title={previewUrl}>
              {previewUrl}
            </p>
          )}
          {!hasWebsite ? (
            <p className="text-xs text-muted-foreground">
              This source-only replica has no website service configured.
            </p>
          ) : (
            !previewUrl && (
              <p className="text-xs text-muted-foreground">
                No website URL is available for this replica.
              </p>
            )
          )}
          {hasWebsite && (
            <div className="flex flex-wrap gap-2">
              {previewUrl && (
                <>
                  <Button
                    size="sm"
                    disabled={!websiteReady || siteBusy}
                    onClick={() => onOpenInApp(previewUrl)}
                  >
                    <ArrowUpRightIcon aria-hidden />
                    Open in T3
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!websiteReady || siteBusy}
                    onClick={() => onOpenExternal(previewUrl)}
                  >
                    <ExternalLinkIcon aria-hidden />
                    Open externally
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={siteBusy || workspace.readiness?.website === "ready"}
                onClick={() => onOperation("start")}
              >
                <PlayIcon aria-hidden />
                Start
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  siteBusy || !["ready", "degraded"].includes(String(workspace.readiness?.website))
                }
                onClick={() => onOperation("stop")}
              >
                <SquareIcon aria-hidden />
                Stop
              </Button>
              {onRestartWebsite && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={siteBusy || !websiteReady}
                  onClick={onRestartWebsite}
                >
                  <RotateCwIcon aria-hidden />
                  Restart
                </Button>
              )}
            </div>
          )}
          <div className="flex items-start justify-between gap-3 border-t pt-3 text-xs">
            <div>
              <p className="font-medium">Shared database</p>
              <p className="text-muted-foreground">Shared by Divi replicas · status only</p>
            </div>
            <span className={dbState.tone}>{dbState.label}</span>
          </div>
        </section>
        <section className="space-y-3 rounded-lg border p-3">
          <div>
            <h3 className="font-medium">Build watchers</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Watchers rebuild assets as you edit. Ownership checks can limit which processes are
              controllable.
            </p>
          </div>
          {workspace.watcherProfiles?.length ? (
            workspace.watcherProfiles.map((id) => {
              const detail = workspace.watcherDetails?.[id];
              const state = detail?.state;
              const watcherBusy =
                busy || operationInProgress || Boolean(busyResources[`watcher-${id}`]);
              const canStart = state === "stopped" || state === "not-requested";
              const canRestart = ["ready", "running-unverified", "degraded"].includes(
                String(state),
              );
              const canStop = canRestart || state === "stopping-unverified";
              return (
                <div
                  key={id}
                  className="space-y-2 border-t pt-3"
                  role="group"
                  aria-label={`${watcherLabel(id)} watcher`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm">{watcherLabel(id)}</strong>
                    <span className="text-xs text-muted-foreground" role="status">
                      {watcherBusy ? "Updating…" : readinessLabel(state)}
                    </span>
                  </div>
                  {state === "ownership-uncertain" && (
                    <p className="text-xs text-amber-700">
                      Process ownership could not be verified. Refresh the status and inspect the
                      log before trying again.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={watcherBusy || !canStart}
                      onClick={() => onOperation("watcher-start", id)}
                    >
                      <PlayIcon aria-hidden />
                      Start
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={watcherBusy || !canRestart}
                      onClick={() => onOperation("watcher-restart", id)}
                    >
                      <RotateCwIcon aria-hidden />
                      Restart
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={watcherBusy || !canStop}
                      onClick={() => onOperation("watcher-stop", id)}
                    >
                      <SquareIcon aria-hidden />
                      Stop
                    </Button>
                  </div>
                  <details
                    onToggle={(event) => {
                      if (event.currentTarget.open && !busy && !operationInProgress)
                        onLogRequest(id);
                    }}
                  >
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      Recent log
                    </summary>
                    {loadingLogId === id ? (
                      <p className="mt-2 text-xs">Loading log…</p>
                    ) : (
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-xs">
                        {logs[id] ? cleanLogTail(logs[id]) : "No log output yet."}
                      </pre>
                    )}
                  </details>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground">No watchers are configured.</p>
          )}
        </section>
        {renderEditor &&
          Boolean(workspace.repositoryDetails) &&
          typeof workspace.repositoryDetails === "object" &&
          !Array.isArray(workspace.repositoryDetails) && (
            <section className="space-y-2 rounded-lg border p-3">
              <h3 className="font-medium">Code checkouts</h3>
              {Object.entries(workspace.repositoryDetails as Record<string, unknown>).flatMap(
                ([id, raw]) => {
                  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
                  const taskPath = (raw as Record<string, unknown>).taskPath;
                  if (typeof taskPath !== "string" || !taskPath.trim()) return [];
                  return [
                    <div key={id} className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm">{id}</span>
                      {renderEditor(taskPath)}
                    </div>,
                  ];
                },
              )}
            </section>
          )}
      </div>
    </div>
  );
}
