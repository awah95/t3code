import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  browserRunIsActive,
  deriveBrowserRunProjection,
} from "@t3tools/client-runtime/browser-run";
import type {
  BrowserRunStatus,
  BrowserRunSummary,
  OrchestrationThreadActivity,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { BotIcon, CircleAlertIcon, Globe2Icon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { MenuItem } from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";
import { useRightPanelStore } from "~/rightPanelStore";
import { previewEnvironment } from "~/state/preview";
import { useAtomCommand } from "~/state/use-atom-command";
import { hasJevBrowserHost } from "~/components/preview/previewAutomationHostCapabilities";

import { useJevBrowserStore } from "./jevBrowserStore";

function formatUsd(value: number): string {
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

function statusLabel(status: "pending" | "succeeded" | "failed" | "cancelled") {
  switch (status) {
    case "pending":
      return "Running";
    case "succeeded":
      return "Done";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

function runStatusLabel(status: BrowserRunStatus) {
  switch (status) {
    case "observing":
      return "Observing";
    case "acting":
      return "Acting";
    case "verifying":
      return "Checking";
    case "needs-agent":
      return "Needs agent";
    case "completed":
      return "Task completed";
    case "cancelled":
      return "Task cancelled";
    case "failed":
      return "Task failed";
    case "interrupted":
      return "Task interrupted";
  }
}

function browserLabel(run: BrowserRunSummary): string {
  return run.browserBackend === "external-chrome" ? "External Chrome" : "Embedded browser";
}

function assertionLabel(run: BrowserRunSummary): string {
  const counts = run.assertionCounts;
  if (counts.total === 0) return "No assertions yet";
  const details = [`${counts.passed} of ${counts.total} passed`];
  if (counts.failed > 0) details.push(`${counts.failed} failed`);
  if (counts.indeterminate > 0) details.push(`${counts.indeterminate} uncertain`);
  if (counts.outstanding > 0) details.push(`${counts.outstanding} remaining`);
  return details.join(" · ");
}

function runCostLabel(run: BrowserRunSummary): string {
  if (run.reportedCostUsd === null) {
    return run.hasUnknownCost ? "Decision cost unknown" : "No reported decision cost";
  }
  return run.hasUnknownCost
    ? `Reported ${formatUsd(run.reportedCostUsd)} + unknown`
    : `Reported ${formatUsd(run.reportedCostUsd)}`;
}

interface JevBrowserControlProps {
  readonly scope: ScopedThreadRef;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly presentation?: "toolbar" | "menu";
}

export function JevBrowserControl(props: JevBrowserControlProps) {
  return <ScopedJevBrowserControl key={scopedThreadKey(props.scope)} {...props} />;
}

function ScopedJevBrowserControl({
  scope,
  activities,
  presentation = "toolbar",
}: JevBrowserControlProps) {
  const key = scopedThreadKey(scope);
  const state = useJevBrowserStore((store) => store.byScope[key]);
  const enable = useJevBrowserStore((store) => store.enable);
  const disable = useJevBrowserStore((store) => store.disable);
  const setNotice = useJevBrowserStore((store) => store.setNotice);
  const clearHistory = useJevBrowserStore((store) => store.clearHistory);
  const cancelLocalRun = useJevBrowserStore((store) => store.cancelRun);
  const cancelBrowserRun = useAtomCommand(previewEnvironment.cancelBrowserRun, {
    reportFailure: false,
  });
  const [checkingCredential, setCheckingCredential] = useState(false);
  const [stoppingRunIds, setStoppingRunIds] = useState<ReadonlySet<string>>(() => new Set());
  const enableGenerationRef = useRef(0);
  const jevHostAvailable = hasJevBrowserHost();
  const enabled = state?.enabled ?? false;
  const history = state?.history ?? [];
  const pendingCount = history.filter((entry) => entry.status === "pending").length;
  const runProjection = useMemo(
    () =>
      deriveBrowserRunProjection(activities, {
        environmentId: scope.environmentId,
        threadId: scope.threadId,
      }),
    [activities, scope.environmentId, scope.threadId],
  );
  const actionCost = useMemo(
    () => ({
      reportedUsd: history.reduce(
        (total, entry) => total + (entry.cost.kind === "reported" ? entry.cost.usd : 0),
        0,
      ),
      unknownCount: history.filter(
        (entry) => entry.status !== "pending" && entry.cost.kind === "unknown",
      ).length,
    }),
    [history],
  );
  const runCount = runProjection.activeRuns.length;
  const visiblePendingCount = runCount > 0 ? runCount : pendingCount;
  const cost =
    runProjection.runs.length > 0
      ? {
          reportedUsd: runProjection.reportedCostUsd,
          unknownCount: runProjection.runs.filter((run) => run.hasUnknownCost).length,
        }
      : actionCost;
  useEffect(
    () => () => {
      enableGenerationRef.current += 1;
    },
    [],
  );

  const requestRunStop = async (run: BrowserRunSummary) => {
    const stoppingKey = `${key}\u0000${run.runId}`;
    setStoppingRunIds((current) => new Set(current).add(stoppingKey));
    cancelLocalRun(scope, run.runId, "Stop requested for this browser task.");
    const result = await cancelBrowserRun({
      environmentId: scope.environmentId,
      input: {
        environmentId: scope.environmentId,
        threadId: scope.threadId,
        runId: run.runId,
      },
    });
    if (result._tag === "Success" && result.value.cancelled) return;
    setStoppingRunIds((current) => {
      const next = new Set(current);
      next.delete(stoppingKey);
      return next;
    });
    setNotice(
      scope,
      result._tag === "Success"
        ? "This browser task had already stopped."
        : "The browser task could not be stopped.",
    );
  };

  const setEnabled = async (nextEnabled: boolean) => {
    const generation = ++enableGenerationRef.current;
    if (!nextEnabled) {
      setCheckingCredential(false);
      disable(scope);
      const results = await Promise.all(
        runProjection.activeRuns.map((run) =>
          cancelBrowserRun({
            environmentId: scope.environmentId,
            input: {
              environmentId: scope.environmentId,
              threadId: scope.threadId,
              runId: run.runId,
            },
          }),
        ),
      );
      if (results.some((result) => result._tag === "Failure" || result.value.cancelled === false)) {
        setNotice(scope, "Jev is off, but one browser task could not be stopped.");
      }
      return;
    }
    setCheckingCredential(true);
    try {
      const getCredentialStatus = window.desktopBridge?.getJevStatus;
      if (!getCredentialStatus || !hasJevBrowserHost()) {
        setNotice(scope, "Jev is unavailable on this client. Regular browser tools still work.");
        return;
      }
      const credentialStatus = await getCredentialStatus();
      if (generation !== enableGenerationRef.current) return;
      if (!credentialStatus.hasKey) {
        setNotice(
          scope,
          credentialStatus.secureStorageAvailable
            ? "Add an OpenRouter key in Settings > General > Jev Auto routing first."
            : "Secure OS credential storage is unavailable.",
        );
        return;
      }
      enable(scope);
    } catch {
      if (generation !== enableGenerationRef.current) return;
      setNotice(scope, "The Jev credential could not be verified.");
    } finally {
      if (generation === enableGenerationRef.current) setCheckingCredential(false);
    }
  };

  const activeStatusLabel = `${visiblePendingCount} running`;
  const controlLabel = `Jev browser: ${visiblePendingCount > 0 ? activeStatusLabel : enabled ? "on for this thread" : "off"}`;
  const controlStatus = visiblePendingCount > 0 ? "Running" : enabled ? "Jev" : "Direct";

  return (
    <Popover>
      <PopoverTrigger
        render={
          presentation === "menu" ? (
            <MenuItem
              closeOnClick={false}
              density="touch"
              aria-label={controlLabel}
              className="w-full"
            />
          ) : (
            <Button type="button" variant="ghost-muted" size="compact" aria-label={controlLabel} />
          )
        }
      >
        <Globe2Icon className="size-3.5" />
        <span className={presentation === "menu" ? "min-w-0 flex-1" : undefined}>
          {presentation === "menu" ? "Jev browser" : "Browser"}
        </span>
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            visiblePendingCount > 0
              ? "bg-warning"
              : enabled
                ? "bg-success"
                : "bg-muted-foreground/50",
          )}
        />
        <span
          className={cn(
            "font-normal text-muted-foreground",
            presentation === "menu" ? "text-xs" : "text-[11px]",
          )}
        >
          {controlStatus}
        </span>
      </PopoverTrigger>
      <PopoverPopup
        side={presentation === "menu" ? "left" : "bottom"}
        align="end"
        className="w-96 max-w-[calc(100vw-2rem)]"
        aria-label="Jev browser controls"
      >
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <PopoverTitle>
                <span className="flex items-center gap-2">
                  <BotIcon className="size-4" />
                  Jev browser
                </span>
              </PopoverTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Let Jev choose browser actions for this thread only.
              </p>
            </div>
            <Switch
              size="sm"
              checked={enabled}
              disabled={checkingCredential || !jevHostAvailable}
              aria-label="Use Jev for browser actions in this thread"
              onCheckedChange={(checked) => void setEnabled(checked)}
            />
          </div>

          {!jevHostAvailable ? (
            <div className="flex items-start gap-2 rounded-md bg-muted/60 px-2.5 py-2 text-xs">
              <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span>
                Jev is unavailable on this client. Regular browser tools still use Direct mode.
              </span>
            </div>
          ) : checkingCredential ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <LoaderCircleIcon className="size-3.5 animate-spin" />
              Checking credential…
            </div>
          ) : state?.notice ? (
            <div className="flex items-start gap-2 rounded-md bg-muted/60 px-2.5 py-2 text-xs">
              <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span>{state.notice}</span>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border border-border/70 px-2.5 py-2">
              <div className="text-muted-foreground">Status</div>
              <div className="mt-0.5 font-medium">
                {visiblePendingCount > 0 ? activeStatusLabel : enabled ? "Ready" : "Off"}
              </div>
            </div>
            <div className="rounded-md border border-border/70 px-2.5 py-2">
              <div className="text-muted-foreground">Recent decision cost</div>
              <div className="mt-0.5 font-medium">Reported {formatUsd(cost.reportedUsd)}</div>
              <div className="text-[11px] text-muted-foreground">{cost.unknownCount} unknown</div>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium">Browser tasks</span>
              <span className="text-[10px] text-muted-foreground">
                {runProjection.activeRuns.length} active
              </span>
            </div>
            {runProjection.runs.length === 0 ? (
              <p className="rounded-md border border-dashed border-border/70 px-2.5 py-3 text-center text-xs text-muted-foreground">
                No browser tasks yet.
              </p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label="Browser task history">
                {runProjection.runs.map((run) => {
                  const active = browserRunIsActive(run.status);
                  const stopping = stoppingRunIds.has(`${key}\u0000${run.runId}`);
                  return (
                    <li key={run.runId} className="rounded-md border border-border/70 px-2.5 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-medium">{runStatusLabel(run.status)}</div>
                          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {browserLabel(run)}
                            {run.hostClientId ? ` · Host ${run.hostClientId}` : ""}
                            {run.tabId ? ` · Tab ${run.tabId}` : ""}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {(active || run.status === "needs-agent") && run.tabId ? (
                            <Button
                              type="button"
                              variant="ghost-muted"
                              size="xs"
                              onClick={() =>
                                useRightPanelStore.getState().openBrowser(scope, run.tabId ?? null)
                              }
                            >
                              Take over
                            </Button>
                          ) : null}
                          {active ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              disabled={stopping}
                              onClick={() => void requestRunStop(run)}
                            >
                              {stopping ? "Stopping…" : "Stop"}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                        <div>{assertionLabel(run)}</div>
                        <div>
                          {run.executedSteps} action{run.executedSteps === 1 ? "" : "s"} ·{" "}
                          {run.decisionCalls} decision{run.decisionCalls === 1 ? "" : "s"}
                        </div>
                        {run.lastAction ? (
                          <div className="truncate">Last action: {run.lastAction}</div>
                        ) : null}
                        {run.handoffReason ? (
                          <div className="text-foreground">
                            Needs attention: {run.handoffReason}
                          </div>
                        ) : run.detail ? (
                          <div>{run.detail}</div>
                        ) : null}
                        <div>{runCostLabel(run)}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Recent task reports are restored after reconnect. Billing receipts remain
              authoritative.
            </p>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium">Recent browser actions</span>
              {history.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost-muted"
                  size="xs"
                  onClick={() => clearHistory(scope)}
                >
                  Clear
                </Button>
              ) : null}
            </div>
            {history.length === 0 ? (
              <p className="rounded-md border border-dashed border-border/70 px-2.5 py-3 text-center text-xs text-muted-foreground">
                No Jev browser actions yet.
              </p>
            ) : (
              <ul className="max-h-48 space-y-1 overflow-y-auto" aria-label="Jev browser history">
                {history.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-start justify-between gap-3 rounded-md px-2 py-1.5 text-xs hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{entry.label}</div>
                      {entry.detail ? (
                        <div className="truncate text-[11px] text-muted-foreground">
                          {entry.detail}
                        </div>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <div>{statusLabel(entry.status)}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {entry.cost.kind === "reported"
                          ? formatUsd(entry.cost.usd)
                          : entry.cost.kind === "unknown"
                            ? "Cost unknown"
                            : "No decision cost"}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Clearing this list does not remove durable billing receipts.
            </p>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
