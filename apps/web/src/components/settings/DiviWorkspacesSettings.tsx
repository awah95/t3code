import type { DiviWorkspaceOperation, DiviWorkspaceRunResult } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleIcon,
  CircleXIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  GitBranchIcon,
  PlayIcon,
  RotateCwIcon,
  ServerIcon,
  SquareIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { openDiviWorkspacePanel } from "../../diviWorkspacePanelBus";
import { isElectron } from "../../env";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { newProjectId } from "../../lib/utils";
import { diviWorkspaceRun } from "../../state/diviWorkspace";
import { useProjects } from "../../state/entities";
import { useEnvironment, usePrimaryEnvironmentId } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import {
  primaryServerAvailableEditorsAtom,
  primaryServerKeybindingsAtom,
} from "../../state/server";
import { shellEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { isLocalDiviEnvironment, watcherLabel } from "../chat/diviWorkspaceView";
import { OpenInPicker } from "../chat/OpenInPicker";
import { Button } from "../ui/button";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

function errorText(failure: unknown): string {
  return String(
    squashAtomCommandFailure(failure as Parameters<typeof squashAtomCommandFailure>[0]),
  );
}

function serverNeedsUpdate(message: string): boolean {
  return message.includes('at ["operation"]') && message.includes('Expected "list"');
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

type StatusTone = "good" | "warn" | "bad" | "quiet";

function StatusBadge({ label, tone }: { label: string; tone: StatusTone }) {
  const Icon =
    tone === "good"
      ? CircleCheckIcon
      : tone === "bad"
        ? CircleXIcon
        : tone === "quiet"
          ? CircleIcon
          : CircleAlertIcon;
  const colors = {
    good: "bg-emerald-500/10 text-emerald-400",
    warn: "bg-amber-500/10 text-amber-400",
    bad: "bg-red-500/10 text-red-400",
    quiet: "bg-muted/50 text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs ${colors[tone]}`}
    >
      <Icon aria-hidden className="size-3.5" />
      {label}
    </span>
  );
}

interface OriginalRepository {
  id: string;
  status: string;
  branch?: string | null;
  trackingBranch?: string | null;
  head?: string | null;
  path?: string | null;
}

interface MainCheckout {
  id: string;
  status: string;
  repositories?: OriginalRepository[];
  issues?: string[];
}

interface WorkspaceOperationRecord {
  workspaceId: string;
  operation: string;
  phase: string;
  status: string;
  startedAt?: string;
  updatedAt?: string;
}

function operationRows(value: unknown): WorkspaceOperationRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is WorkspaceOperationRecord =>
        Boolean(
          record(item) &&
          typeof item.workspaceId === "string" &&
          typeof item.phase === "string" &&
          typeof item.status === "string",
        ),
      )
    : [];
}

export function DiviWorkspacesSettings() {
  const environmentId = usePrimaryEnvironmentId();
  const environment = useEnvironment(environmentId);
  const target = environment?.entry.target;
  const local = isLocalDiviEnvironment(
    window.location.hostname,
    isElectron,
    target?._tag,
    target?._tag === "PrimaryConnectionTarget" ? target.httpBaseUrl : undefined,
  );
  const runRpc = useAtomCommand(diviWorkspaceRun, { reportFailure: false });
  const createProject = useAtomCommand(projectEnvironment.create, {
    reportFailure: false,
  });
  const openFolder = useAtomCommand(shellEnvironment.openInEditor, "open site folder");
  const availableEditors = useAtomValue(primaryServerAvailableEditorsAtom);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const projects = useProjects();
  const newThread = useNewThreadHandler();
  const [ids, setIds] = useState<string[]>([]);
  const [details, setDetails] = useState<Record<string, DiviWorkspaceRunResult>>({});
  const [originalRepositories, setOriginalRepositories] = useState<OriginalRepository[]>([]);
  const [mainCheckouts, setMainCheckouts] = useState<MainCheckout[]>([]);
  const [operationRecords, setOperationRecords] = useState<WorkspaceOperationRecord[]>([]);
  const seenCompletions = useRef(new Set<string>());
  const [newMainId, setNewMainId] = useState("");
  const [originalStatus, setOriginalStatus] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  const [inspectionErrors, setInspectionErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cardBusy, setCardBusy] = useState<
    Record<string, "refresh" | "measure" | "control" | "destroy">
  >({});
  const cardBusyRef = useRef(new Set<string>());
  const [stopAllProgress, setStopAllProgress] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outdatedServer, setOutdatedServer] = useState(false);

  useEffect(() => {
    if (!environmentId || !local) return;
    let current = true;
    setLoading(true);
    setError(null);
    setOutdatedServer(false);
    setDetails({});
    setOriginalRepositories([]);
    setMainCheckouts([]);
    setOriginalStatus("loading");
    setInspectionErrors({});
    void (async () => {
      let response = await runRpc({
        environmentId,
        input: { operation: "main-info" },
      });
      if (response._tag === "Failure" && current) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        if (!current) return;
        response = await runRpc({
          environmentId,
          input: { operation: "main-info" },
        });
      }
      if (!current) return;
      if (response._tag !== "Success") {
        setOriginalStatus("unavailable");
        return;
      }
      const rows = response.value.originalRepositories;
      const mains = response.value.mainCheckouts;
      if (Array.isArray(mains))
        setMainCheckouts(
          mains.filter((item): item is MainCheckout =>
            Boolean(record(item) && typeof item.id === "string" && typeof item.status === "string"),
          ),
        );
      if (Array.isArray(rows)) {
        setOriginalRepositories(
          rows.filter((item): item is OriginalRepository =>
            Boolean(record(item) && typeof item.id === "string" && typeof item.status === "string"),
          ),
        );
        setOriginalStatus("ready");
      } else {
        setOriginalStatus("unavailable");
      }
    })();
    void (async () => {
      let response = await runRpc({
        environmentId,
        input: { operation: "list" },
      });
      if (response._tag === "Failure" && current) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        if (!current) return;
        response = await runRpc({
          environmentId,
          input: { operation: "list" },
        });
      }
      if (!current) return;
      setLoading(false);
      if (response._tag === "Failure") {
        setError(errorText(response));
        return;
      }
      const names = Array.isArray(response.value.workspaces)
        ? response.value.workspaces.filter((id): id is string => typeof id === "string")
        : [];
      setIds(names);
      const operations = operationRows(response.value.operations);
      setOperationRecords(operations);
      for (const row of operations.filter((item) => item.status === "completed"))
        seenCompletions.current.add(`${row.workspaceId}:${row.operation}:${row.updatedAt}`);
      for (let index = 0; index < names.length; index += 2) {
        if (!current) return;
        const results = await Promise.all(
          names.slice(index, index + 2).map(async (id) => ({
            id,
            response: await runRpc({
              environmentId,
              input: { operation: "inspect", workspaceId: id },
            }),
          })),
        );
        if (!current) return;
        for (const { id, response: inspected } of results) {
          if (inspected._tag === "Success") {
            setDetails((previous) => ({ ...previous, [id]: inspected.value }));
          } else {
            const message = errorText(inspected);
            if (serverNeedsUpdate(message)) {
              setOutdatedServer(true);
              return;
            }
            setInspectionErrors((previous) => ({ ...previous, [id]: message }));
          }
        }
      }
    })();
    return () => {
      current = false;
    };
  }, [environmentId, local, refreshVersion, runRpc]);

  useEffect(() => {
    if (!environmentId || !local) return;
    let current = true;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void runRpc({ environmentId, input: { operation: "list" } }).then((response) => {
        if (!current || response._tag !== "Success") return;
        const rows = operationRows(response.value.operations);
        setOperationRecords(rows);
        for (const row of rows) {
          if (row.status !== "completed") continue;
          const key = `${row.workspaceId}:${row.operation}:${row.updatedAt}`;
          if (seenCompletions.current.has(key)) continue;
          seenCompletions.current.add(key);
          setRefreshVersion((value) => value + 1);
        }
      });
    }, 3_000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [environmentId, local, runRpc]);

  const inspectedCount = ids.filter((id) => details[id] || inspectionErrors[id]).length;
  const changedCount = ids.filter((id) => details[id]?.changed === true).length;
  const runningSites = ids.filter(
    (id) => details[id]?.runtimeStatus?.website?.state === "running",
  ).length;
  const unknownSites = ids.filter((id) => !details[id]?.runtimeStatus?.website).length;
  const sharedDatabase = ids.map((id) => details[id]?.runtimeStatus?.database).find(Boolean);
  const diskBytes = ids.reduce((total, id) => total + (details[id]?.diskBytes ?? 0), 0);
  const measuredCount = ids.filter((id) => typeof details[id]?.diskBytes === "number").length;

  function beginCard(
    id: string,
    resource: string,
    kind: "refresh" | "measure" | "control" | "destroy",
  ) {
    const key = `${id}:${resource}`;
    if (
      busyId ||
      cardBusyRef.current.has(key) ||
      cardBusyRef.current.has(`${id}:destroy`) ||
      (resource === "destroy" &&
        [...cardBusyRef.current].some((active) => active.startsWith(`${id}:`)))
    )
      return false;
    cardBusyRef.current.add(key);
    setCardBusy((previous) => ({ ...previous, [key]: kind }));
    return true;
  }

  function endCard(id: string, resource: string) {
    const key = `${id}:${resource}`;
    cardBusyRef.current.delete(key);
    setCardBusy((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
  }

  async function createMain() {
    if (
      !environmentId ||
      newMainId === "original" ||
      !/^[a-z][a-z0-9_-]{0,62}$/.test(newMainId) ||
      busyId
    )
      return;
    setBusyId("__main");
    setError(null);
    const response = await runRpc({
      environmentId,
      input: { operation: "main-create", mainId: newMainId },
    });
    setBusyId(null);
    if (response._tag === "Failure") {
      setError(errorText(response));
      return;
    }
    const mains = response.value.mainCheckouts;
    if (Array.isArray(mains))
      setMainCheckouts(
        mains.filter((item): item is MainCheckout =>
          Boolean(record(item) && typeof item.id === "string" && typeof item.status === "string"),
        ),
      );
    setNewMainId("");
  }

  async function repairMain(mainId: string) {
    if (!environmentId || busyId) return;
    setBusyId(`main:${mainId}`);
    setError(null);
    const response = await runRpc({
      environmentId,
      input: { operation: "main-repair", mainId },
    });
    setBusyId(null);
    if (response._tag === "Failure") {
      setError(`${mainId}: ${errorText(response)}`);
      return;
    }
    const mains = response.value.mainCheckouts;
    if (Array.isArray(mains))
      setMainCheckouts(
        mains.filter((item): item is MainCheckout =>
          Boolean(record(item) && typeof item.id === "string" && typeof item.status === "string"),
        ),
      );
  }

  async function attachMainThread(cwd: string, mainId: string, repositoryId: string) {
    if (!environmentId || busyId) return;
    setBusyId(`thread:${mainId}:${repositoryId}`);
    setError(null);
    const existing = projects.find(
      (project) => project.environmentId === environmentId && project.workspaceRoot === cwd,
    );
    let projectId = existing?.id;
    if (!projectId) {
      projectId = newProjectId();
      const created = await createProject({
        environmentId,
        input: {
          projectId,
          title: `${mainId} · ${repositoryId}`,
          workspaceRoot: cwd,
          createWorkspaceRootIfMissing: false,
          defaultModelSelection: null,
        },
      });
      if (created._tag === "Failure") {
        setBusyId(null);
        setError(`${mainId}: ${errorText(created)}`);
        return;
      }
    }
    try {
      await newThread(scopeProjectRef(environmentId, projectId));
    } catch (cause) {
      setError(`${mainId}: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setBusyId(null);
    }
  }

  async function runControl(id: string, operation: DiviWorkspaceOperation, profileId?: string) {
    const resource = profileId ? `watcher-${profileId}` : "site";
    if (!environmentId || !beginCard(id, resource, "control")) return;
    setError(null);
    const response = await runRpc({
      environmentId,
      input: {
        operation,
        workspaceId: id,
        ...(profileId ? { profileId } : {}),
      },
    });
    if (response._tag === "Failure") {
      setError(`${id}: ${errorText(response)}`);
    } else {
      const refreshed = await runRpc({
        environmentId,
        input: { operation: "inspect", workspaceId: id },
      });
      if (refreshed._tag === "Success")
        setDetails((previous) => ({
          ...previous,
          [id]: {
            ...refreshed.value,
            diskBytes: previous[id]?.diskBytes,
            containerUsage:
              operation === "start" || operation === "stop"
                ? undefined
                : previous[id]?.containerUsage,
          },
        }));
      else setError(`${id}: ${errorText(refreshed)}`);
    }
    endCard(id, resource);
  }

  async function refreshCard(id: string, includeDiskUsage = false) {
    if (!environmentId || !beginCard(id, "inspection", includeDiskUsage ? "measure" : "refresh"))
      return;
    const response = await runRpc({
      environmentId,
      input: { operation: "inspect", workspaceId: id, includeDiskUsage },
    });
    if (response._tag === "Success") {
      setDetails((previous) => ({
        ...previous,
        [id]: includeDiskUsage
          ? response.value
          : {
              ...response.value,
              diskBytes: previous[id]?.diskBytes,
              containerUsage: previous[id]?.containerUsage,
            },
      }));
      setInspectionErrors((previous) => {
        if (!previous[id]) return previous;
        const next = { ...previous };
        delete next[id];
        return next;
      });
    } else {
      setInspectionErrors((previous) => ({
        ...previous,
        [id]: errorText(response),
      }));
    }
    endCard(id, "inspection");
  }

  async function stopAll() {
    if (!environmentId || busyId || cardBusyRef.current.size) return;
    setBusyId("__all");
    setError(null);
    const failures: string[] = [];
    for (let index = 0; index < ids.length; index += 2) {
      setStopAllProgress(`Processing ${Math.min(index + 2, ids.length)} of ${ids.length} replicas`);
      const batch = await Promise.all(
        ids.slice(index, index + 2).map(async (id) => {
          const problems: string[] = [];
          const checked = await runRpc({
            environmentId,
            input: { operation: "status", workspaceId: id },
          });
          if (checked._tag === "Failure" || checked.value.operationInProgress)
            return [
              `${id}: ${checked._tag === "Failure" ? errorText(checked) : "another operation is in progress"}`,
            ];
          const detail = checked.value;
          const actions = Object.entries(detail.watcherDetails ?? {})
            .filter(([, watcher]) => !["stopped", "not-requested"].includes(watcher.state))
            .map(async ([profileId]) => {
              const response = await runRpc({
                environmentId,
                input: {
                  operation: "watcher-stop",
                  workspaceId: id,
                  profileId,
                },
              });
              if (response._tag === "Failure")
                problems.push(`${id} ${profileId}: ${errorText(response)}`);
            });
          if (detail.runtimeStatus?.website?.state === "running")
            actions.push(
              (async () => {
                const response = await runRpc({
                  environmentId,
                  input: { operation: "stop", workspaceId: id },
                });
                if (response._tag === "Failure")
                  problems.push(`${id} website: ${errorText(response)}`);
              })(),
            );
          if (!detail.runtimeStatus?.website || detail.runtimeStatus.website.state === "error")
            problems.push(`${id}: website state could not be confirmed`);
          await Promise.all(actions);
          const refreshed = await runRpc({
            environmentId,
            input: { operation: "inspect", workspaceId: id },
          });
          if (refreshed._tag === "Success")
            setDetails((previous) => ({
              ...previous,
              [id]: {
                ...refreshed.value,
                diskBytes: previous[id]?.diskBytes,
                containerUsage: undefined,
              },
            }));
          else problems.push(`${id}: ${errorText(refreshed)}`);
          return problems;
        }),
      );
      failures.push(...batch.flat());
    }
    setStopAllProgress(null);
    setBusyId(null);
    if (failures.length) setError(failures.join(" · "));
  }

  async function destroy(id: string, changed: boolean) {
    if (!environmentId || confirmId !== id || !beginCard(id, "destroy", "destroy")) return;
    setError(null);
    const response = await runRpc({
      environmentId,
      input: {
        operation: "destroy",
        workspaceId: id,
        confirmWorkspaceId: id,
        discardChanges: changed,
      },
    });
    endCard(id, "destroy");
    if (response._tag === "Failure") {
      setError(errorText(response));
      return;
    }
    setIds((previous) => previous.filter((name) => name !== id));
    setDetails((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
    setSelectedId(null);
    setConfirmId("");
  }

  return (
    <SettingsPageContainer>
      <SettingsSection
        id="divi-workspaces"
        title="Divi Workspaces"
        variant="plain"
        headerAction={
          local && environmentId ? (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busyId !== null || Object.keys(cardBusy).length > 0}
                onClick={() => setRefreshVersion((value) => value + 1)}
              >
                Refresh
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  busyId !== null || Object.keys(cardBusy).length > 0 || loading || ids.length === 0
                }
                onClick={() => void stopAll()}
              >
                <SquareIcon aria-hidden />
                Stop all
              </Button>
              <Button
                size="sm"
                onClick={() => openDiviWorkspacePanel({ environmentId, mainId: "original" })}
              >
                Create copy
              </Button>
            </div>
          ) : null
        }
      >
        <div className="px-3 sm:px-4">
          <div className="space-y-1 rounded-lg bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-2">
              <h3 className="font-medium">Original Divi checkout</h3>
              <span className="rounded-full bg-background/60 px-2 py-0.5 text-xs text-muted-foreground">
                Protected main
              </span>
              <span className="text-xs text-muted-foreground">
                {ids.filter((id) => details[id]?.mainCheckoutId === "original").length} replicas
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Your ongoing work and commits stay here. This checkout cannot be deleted from this
              page.
            </p>
            {originalRepositories.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-border/40 pt-2.5">
                {originalRepositories.map((repo) => (
                  <div
                    key={repo.id}
                    className="flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                      <GitBranchIcon aria-hidden className="size-3.5 text-muted-foreground" />
                      <span className="font-medium">{repo.id}</span>
                      <span className="text-muted-foreground">
                        {repo.status === "ready"
                          ? `Active branch: ${repo.branch ?? "detached"} · Base branch (upstream): ${repo.trackingBranch ?? "none configured"}`
                          : "Checkout unavailable"}
                      </span>
                    </div>
                    {repo.path && local && environmentId && (
                      <div className="flex items-center gap-1">
                        {availableEditors.length > 0 && (
                          <OpenInPicker
                            environmentId={environmentId}
                            keybindings={keybindings}
                            availableEditors={availableEditors}
                            openInCwd={repo.path}
                            compact
                            enableShortcut={false}
                          />
                        )}
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={busyId !== null || repo.status !== "ready"}
                          onClick={() => void attachMainThread(repo.path!, "original", repo.id)}
                        >
                          {busyId === `thread:original:${repo.id}` ? "Opening…" : "New thread"}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {originalStatus === "unavailable" && (
              <p className="mt-2 text-xs text-muted-foreground">
                Branch details unavailable. Refresh to retry.
              </p>
            )}
            {local && environmentId && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/40 pt-3">
                <input
                  aria-label="New main checkout name"
                  className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  placeholder="New main name, e.g. forms-module"
                  value={newMainId}
                  onChange={(event) => setNewMainId(event.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    busyId !== null ||
                    newMainId === "original" ||
                    !/^[a-z][a-z0-9_-]{0,62}$/.test(newMainId)
                  }
                  onClick={() => void createMain()}
                >
                  Create main checkout
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    openDiviWorkspacePanel({
                      environmentId,
                      mainId: "original",
                    })
                  }
                >
                  Create replica
                </Button>
              </div>
            )}
          </div>
          {mainCheckouts.map((main) => {
            const mainIssues = main.issues ?? [];
            return (
              <div
                key={main.id}
                className="mt-3 rounded-lg border border-border/50 bg-muted/20 px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium">{main.id}</h3>
                      <StatusBadge
                        label={main.status === "ready" ? "Ready" : "Setup needs attention"}
                        tone={main.status === "ready" ? "good" : "bad"}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Paired Builder and Builder 5 main checkout ·{" "}
                      {ids.filter((id) => details[id]?.mainCheckoutId === main.id).length} replicas
                    </p>
                  </div>
                  {local && environmentId && (
                    <div className="flex flex-wrap items-center gap-2">
                      {(main.status !== "ready" || mainIssues.length > 0) && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId !== null}
                          onClick={() => void repairMain(main.id)}
                        >
                          <RotateCwIcon aria-hidden />
                          {busyId === `main:${main.id}` ? "Repairing…" : "Repair setup"}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={main.status !== "ready" || mainIssues.length > 0}
                        onClick={() =>
                          openDiviWorkspacePanel({
                            environmentId,
                            mainId: main.id,
                          })
                        }
                      >
                        Create replica
                      </Button>
                    </div>
                  )}
                </div>
                {mainIssues.length > 0 && (
                  <div className="mt-2 space-y-1 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {mainIssues.map((issue) => (
                      <p key={issue}>{issue}</p>
                    ))}
                  </div>
                )}
                <div className="mt-2 space-y-1.5">
                  {main.repositories?.map((repo) => (
                    <div
                      key={repo.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background/40 px-2 py-1.5 text-xs"
                    >
                      <p className="min-w-0 text-muted-foreground">
                        <GitBranchIcon aria-hidden className="mr-1 inline size-3.5" />
                        <span className="font-medium text-foreground">{repo.id}</span>:{" "}
                        {repo.branch ?? "detached"}
                        {" at "}
                        {repo.head ?? "unknown"}
                      </p>
                      {repo.path && local && environmentId && (
                        <div className="flex items-center gap-1">
                          {availableEditors.length > 0 && (
                            <OpenInPicker
                              environmentId={environmentId}
                              keybindings={keybindings}
                              availableEditors={availableEditors}
                              openInCwd={repo.path}
                              compact
                              enableShortcut={false}
                            />
                          )}
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={busyId !== null || repo.status !== "ready"}
                            onClick={() => void attachMainThread(repo.path!, main.id, repo.id)}
                          >
                            {busyId === `thread:${main.id}:${repo.id}` ? "Opening…" : "New thread"}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {!local || !environmentId ? (
          <p className="text-sm text-muted-foreground">
            Manage Divi workspaces from the local T3 server Mac.
          </p>
        ) : (
          <div className="px-3 pt-5 sm:px-4">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
              <strong>{ids.length} replicas</strong>
              <span className="text-muted-foreground">
                {runningSites} confirmed running
                {unknownSites ? ` · ${unknownSites} unchecked` : ""}
              </span>
              <span className="text-muted-foreground">
                {outdatedServer
                  ? "Source changes unavailable"
                  : inspectedCount < ids.length
                    ? `Checking changes (${inspectedCount}/${ids.length})`
                    : `${changedCount} with source changes${Object.keys(inspectionErrors).length ? ` · ${Object.keys(inspectionErrors).length} unavailable` : ""}`}
              </span>
              <span className="text-muted-foreground">
                {outdatedServer
                  ? "Local size unavailable"
                  : measuredCount
                    ? `${(diskBytes / 1024 ** 3).toFixed(2)} GB measured across ${measuredCount}/${ids.length} replicas`
                    : "Storage size not measured"}
              </span>
            </div>
            {operationRecords
              .filter(
                (item) =>
                  item.status === "running" ||
                  item.status === "failed" ||
                  (item.updatedAt && Date.now() - Date.parse(item.updatedAt) < 10 * 60_000),
              )
              .map((item) => (
                <div
                  key={`${item.workspaceId}:${item.operation}`}
                  role="status"
                  className="mt-2 flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 text-xs"
                >
                  <StatusBadge
                    label={item.status === "running" ? "In progress" : item.status}
                    tone={
                      item.status === "failed"
                        ? "bad"
                        : item.status === "completed"
                          ? "good"
                          : "warn"
                    }
                  />
                  <strong>{item.workspaceId}</strong>
                  <span className="text-muted-foreground">{item.phase}</span>
                </div>
              ))}
            {sharedDatabase && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs">
                <ServerIcon aria-hidden className="size-4 text-muted-foreground" />
                <span className="font-medium">Shared database container</span>
                <StatusBadge
                  label={
                    sharedDatabase.state === "running"
                      ? sharedDatabase.health
                      : sharedDatabase.state
                  }
                  tone={
                    sharedDatabase.state === "running" && sharedDatabase.health === "healthy"
                      ? "good"
                      : sharedDatabase.state === "running"
                        ? "warn"
                        : "bad"
                  }
                />
                <span className="font-mono text-muted-foreground">
                  {sharedDatabase.containerName}
                </span>
                <span className="text-muted-foreground">
                  Used by all replicas. Stop a site without stopping this container.
                </span>
              </div>
            )}
            {outdatedServer && (
              <p
                role="status"
                className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
              >
                The running desktop server is older than this page. Restart the development desktop
                app once to load inspection and cleanup controls.
              </p>
            )}
            {(loading || (!outdatedServer && inspectedCount < ids.length)) && (
              <div className="mt-3 space-y-1.5" role="status">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{loading ? "Finding replicas" : "Checking replicas"}</span>
                  {!loading && (
                    <span>
                      {inspectedCount} / {ids.length} checks
                    </span>
                  )}
                </div>
                <div
                  role="progressbar"
                  aria-label="Workspace inspection progress"
                  aria-valuemin={0}
                  aria-valuemax={Math.max(1, ids.length)}
                  aria-valuenow={inspectedCount}
                  className="h-1.5 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                    style={{
                      width: `${ids.length ? (inspectedCount / ids.length) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {stopAllProgress && (
              <p role="status" className="mt-2 text-xs text-muted-foreground">
                {stopAllProgress}…
              </p>
            )}
            <div className="mt-5 space-y-4">
              {ids.map((id) => {
                const detail = details[id];
                const operationRecord = operationRecords.find(
                  (item) => item.workspaceId === id && item.status === "running",
                );
                const cardIsBusy =
                  busyId !== null || Object.keys(cardBusy).some((key) => key.startsWith(`${id}:`));
                const destroying = Boolean(cardBusy[`${id}:destroy`]);
                const inspectionBusy =
                  busyId !== null || destroying || Boolean(cardBusy[`${id}:inspection`]);
                const siteBusy = busyId !== null || destroying || Boolean(cardBusy[`${id}:site`]);
                const issues = detail?.issues ?? [];
                const website = detail?.runtimeStatus?.website;
                const readiness = record(detail?.siteReadiness);
                const sitePath = string(record(detail?.paths)?.sitePath);
                const usage = record(detail?.containerUsage);
                const git = record(detail?.repositoryGit);
                const watchers = Object.entries(detail?.watcherDetails ?? {});
                const runningWatcher = watchers.some(([, watcher]) =>
                  ["ready", "running-unverified"].includes(watcher.state),
                );
                const siteConflict = website?.state !== "running" && runningWatcher;
                return (
                  <article
                    key={id}
                    className="space-y-3 rounded-xl border border-border/60 bg-card/60 p-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/50 pb-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold tracking-tight">{id}</h3>
                          {website && (
                            <StatusBadge
                              label={
                                website.state === "running" && readiness?.website === true
                                  ? "Site running"
                                  : website.state === "running"
                                    ? "Site needs attention"
                                    : website.state === "stopped"
                                      ? "Site stopped"
                                      : website.state === "missing"
                                        ? "Site missing"
                                        : "Site status unavailable"
                              }
                              tone={
                                website.state === "running" && readiness?.website === true
                                  ? "good"
                                  : website.state === "running"
                                    ? "warn"
                                    : website.state === "stopped" && !siteConflict
                                      ? "quiet"
                                      : "bad"
                              }
                            />
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {detail
                            ? typeof detail.diskBytes === "number"
                              ? `${(detail.diskBytes / 1024 ** 3).toFixed(2)} GB local files`
                              : "Storage size not measured"
                            : outdatedServer
                              ? "Inspection available after server restart"
                              : inspectionErrors[id]
                                ? "Inspection needs attention"
                                : "Inspecting…"}
                        </p>
                        {detail && (
                          <p className="text-xs text-muted-foreground">
                            Source:{" "}
                            {detail.mainCheckoutId
                              ? `${detail.mainCheckoutId} main checkout`
                              : "existing baseline"}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={inspectionBusy || (!detail && !inspectionErrors[id])}
                          onClick={() => void refreshCard(id)}
                        >
                          <RotateCwIcon aria-hidden />
                          {cardBusy[`${id}:inspection`] === "refresh" ? "Refreshing" : "Refresh"}
                        </Button>
                        {detail && (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={inspectionBusy}
                            onClick={() => void refreshCard(id, true)}
                          >
                            {cardBusy[`${id}:inspection`] === "measure"
                              ? "Measuring…"
                              : "Measure storage"}
                          </Button>
                        )}
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() =>
                            openDiviWorkspacePanel({
                              environmentId,
                              workspaceId: id,
                            })
                          }
                        >
                          Open / new thread
                        </Button>
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={!detail || cardIsBusy}
                          onClick={() => {
                            setSelectedId(selectedId === id ? null : id);
                            setConfirmId("");
                          }}
                        >
                          Review deletion
                        </Button>
                      </div>
                    </div>
                    {operationRecord && (
                      <p role="status" className="text-xs text-muted-foreground">
                        {operationRecord.phase}
                      </p>
                    )}
                    {detail && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge
                          label={
                            detail.changed === null
                              ? "Changes unknown"
                              : detail.changed
                                ? "Source changed"
                                : "Source clean"
                          }
                          tone={detail.changed === null ? "warn" : detail.changed ? "warn" : "good"}
                        />
                        {website?.state === "running" && (
                          <StatusBadge
                            label={`WordPress/PHP ${readiness?.website === true ? "responding" : "needs attention"}`}
                            tone={readiness?.website === true ? "good" : "warn"}
                          />
                        )}
                      </div>
                    )}
                    {detail && (website || watchers.length > 0) && (
                      <div className={watchers.length ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"}>
                        {website && (
                          <section
                            className={`flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border/50 bg-muted/20 p-3 ${watchers.length > 1 ? "sm:col-span-2" : ""}`}
                          >
                            <div className="min-w-0 space-y-1.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <ServerIcon aria-hidden className="size-4 text-muted-foreground" />
                                <h4 className="font-medium">Site container</h4>
                                <StatusBadge
                                  label={website.state}
                                  tone={
                                    website.state === "running" && readiness?.website === true
                                      ? "good"
                                      : website.state === "running"
                                        ? "warn"
                                        : website.state === "stopped" && !siteConflict
                                          ? "quiet"
                                          : "bad"
                                  }
                                />
                              </div>
                              <div className="text-2xs text-muted-foreground">
                                <span>Docker container name</span>
                                <p className="break-all font-mono">{website.containerName}</p>
                              </div>
                              {website.state === "running" &&
                                (string(usage?.cpu) || string(usage?.memory)) && (
                                  <p className="text-2xs text-muted-foreground">
                                    Snapshot: {string(usage?.cpu) ?? "CPU unavailable"} CPU ·{" "}
                                    {string(usage?.memory) ?? "memory unavailable"} memory
                                  </p>
                                )}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {string(detail.previewUrl) && readiness?.website === true && (
                                <Button
                                  size="xs"
                                  variant="outline"
                                  render={
                                    <a href={detail.previewUrl} target="_blank" rel="noreferrer" />
                                  }
                                >
                                  <ExternalLinkIcon aria-hidden />
                                  Open site
                                </Button>
                              )}
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={!sitePath || !availableEditors.includes("file-manager")}
                                onClick={() =>
                                  sitePath &&
                                  void openFolder({
                                    environmentId,
                                    input: {
                                      cwd: sitePath,
                                      editor: "file-manager",
                                    },
                                  })
                                }
                              >
                                <FolderOpenIcon aria-hidden />
                                Open in Finder
                              </Button>
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={siteBusy || website.state === "running"}
                                onClick={() => void runControl(id, "start")}
                              >
                                <PlayIcon aria-hidden />
                                Start
                              </Button>
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={siteBusy || website.state !== "running"}
                                onClick={() => void runControl(id, "stop")}
                              >
                                <SquareIcon aria-hidden />
                                Stop
                              </Button>
                            </div>
                          </section>
                        )}
                        {watchers.map(([name, watcher]) => (
                          <section
                            key={name}
                            className="flex min-w-0 flex-col gap-3 rounded-lg border border-border/50 bg-muted/20 p-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <RotateCwIcon aria-hidden className="size-4 text-muted-foreground" />
                              <h4 className="font-medium">{watcherLabel(name)} watcher</h4>
                              <StatusBadge
                                label={
                                  watcher.state === "ready"
                                    ? "running"
                                    : watcher.state === "not-requested"
                                      ? "off"
                                      : watcher.state.replaceAll("-", " ")
                                }
                                tone={
                                  watcher.state === "ready"
                                    ? "good"
                                    : watcher.state === "stopped" ||
                                        watcher.state === "not-requested"
                                      ? "quiet"
                                      : watcher.state === "degraded"
                                        ? "bad"
                                        : "warn"
                                }
                              />
                            </div>
                            <p className="text-2xs text-muted-foreground">
                              Watches code edits and rebuilds assets automatically.
                            </p>
                            <div className="mt-auto flex flex-wrap items-center gap-1.5">
                              {cardBusy[`${id}:watcher-${name}`] && (
                                <span role="status" className="text-xs text-muted-foreground">
                                  Updating…
                                </span>
                              )}
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={
                                  busyId !== null ||
                                  destroying ||
                                  Boolean(cardBusy[`${id}:watcher-${name}`]) ||
                                  !["stopped", "not-requested"].includes(watcher.state)
                                }
                                onClick={() => void runControl(id, "watcher-start", name)}
                              >
                                <PlayIcon aria-hidden />
                                Start
                              </Button>
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={
                                  busyId !== null ||
                                  destroying ||
                                  Boolean(cardBusy[`${id}:watcher-${name}`]) ||
                                  !["ready", "running-unverified", "degraded"].includes(
                                    watcher.state,
                                  )
                                }
                                onClick={() => void runControl(id, "watcher-restart", name)}
                              >
                                <RotateCwIcon aria-hidden />
                                Restart
                              </Button>
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={
                                  busyId !== null ||
                                  destroying ||
                                  Boolean(cardBusy[`${id}:watcher-${name}`]) ||
                                  ["stopped", "not-requested"].includes(watcher.state)
                                }
                                onClick={() => void runControl(id, "watcher-stop", name)}
                              >
                                <SquareIcon aria-hidden />
                                Stop
                              </Button>
                            </div>
                          </section>
                        ))}
                      </div>
                    )}
                    {inspectionErrors[id] && (
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer">
                          Inspection unavailable. Refresh to try again.
                        </summary>
                        <p className="mt-1 break-words">{inspectionErrors[id]}</p>
                      </details>
                    )}
                    {git && (
                      <details className="border-t border-border/50 pt-2 text-xs text-muted-foreground">
                        <summary className="cursor-pointer font-medium">Code and branches</summary>
                        <div className="mt-2 space-y-1">
                          {Object.entries(git).map(([name, value]) => {
                            const repo = record(value);
                            if (!repo) return null;
                            return (
                              <div
                                key={name}
                                className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
                              >
                                <GitBranchIcon aria-hidden className="size-3.5" />
                                <span className="font-medium text-foreground">{name}</span>
                                <span>
                                  {string(repo.branch) ?? "Detached"} at{" "}
                                  {string(repo.head) ?? "unknown revision"}
                                </span>
                                <span>
                                  · copied from {string(repo.sourceBranch) ?? "detached source"} at{" "}
                                  {string(repo.baseCommit) ?? "unknown revision"}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    )}
                    {selectedId === id && detail && (
                      <div className="space-y-2 rounded border border-destructive/40 p-3">
                        <p className="text-sm">
                          This removes the replica's worktrees, private website, databases and port
                          reservation. Existing chats pointing to it will lose their code path. The
                          original checkout and shared media stay in place.
                        </p>
                        {detail.changed && (
                          <p className="text-sm text-destructive">
                            This replica has source changes. Open a thread to investigate before
                            discarding them.
                          </p>
                        )}
                        {issues.length > 0 && (
                          <div className="space-y-1 text-sm">
                            <p>Resolve these before deletion:</p>
                            {issues.map((issue) => (
                              <p key={issue} className="text-muted-foreground">
                                • {issue}
                              </p>
                            ))}
                          </div>
                        )}
                        <input
                          aria-label={`Type ${id} to confirm deletion`}
                          className="w-full rounded border bg-background px-2 py-1 text-sm"
                          placeholder={`Type ${id} to confirm`}
                          value={confirmId}
                          onChange={(event) => setConfirmId(event.target.value)}
                        />
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={
                            cardIsBusy ||
                            issues.length > 0 ||
                            detail.changed === null ||
                            confirmId !== id
                          }
                          onClick={() => void destroy(id, detail.changed === true)}
                        >
                          {cardBusy[`${id}:destroy`]
                            ? "Destroying replica…"
                            : detail.changed
                              ? "Discard changes and destroy replica"
                              : "Destroy replica"}
                        </Button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            {!loading && ids.length === 0 && (
              <p className="text-sm text-muted-foreground">No replicas found.</p>
            )}
          </div>
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
