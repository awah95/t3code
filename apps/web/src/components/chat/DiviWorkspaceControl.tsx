import type {
  DiviWorkspaceOperation,
  DiviWorkspaceRunResult,
  EditorId,
  EnvironmentId,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef, useState } from "react";
import { onOpenDiviWorkspacePanel } from "../../diviWorkspacePanelBus";
import { isElectron } from "../../env";
import { useDiviWorkspaceControls } from "../../hooks/useDiviWorkspaceControls";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { newProjectId } from "../../lib/utils";
import { diviWorkspaceRun } from "../../state/diviWorkspace";
import { useProjects } from "../../state/entities";
import { useEnvironment } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  elapsedLabel,
  isLocalDiviEnvironment,
  needsBuildFollowup,
  readinessLabel,
  setupProgress,
  setupStageLabel,
  watcherFollowupLabel,
  watcherLabel,
  workspaceHeading,
} from "./diviWorkspaceView";
import { DiviWorkspaceOverview } from "./DiviWorkspaceOverview";
import { OpenInPicker } from "./OpenInPicker";

type DiviWorkspacePreset = "divi" | "fluent-forms";

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function objectField(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function receiptTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : time.toLocaleString();
}

function durationLabel(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  if (value < 1000) return `${Math.round(value)} ms`;
  const seconds = Math.round(value / 1000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} m ${seconds % 60} s`;
}

function operationLabel(operation: DiviWorkspaceOperation): string {
  const labels: Record<DiviWorkspaceOperation, string> = {
    list: "Loading workspaces",
    identify: "Finding workspace",
    "main-info": "Checking original checkout",
    "main-create": "Duplicating main checkout",
    "main-repair": "Repairing main checkout",
    "main-site-status": "Checking checkout website",
    "main-site-start": "Starting checkout website",
    "main-site-stop": "Stopping checkout website",
    inspect: "Inspecting workspace",
    destroy: "Destroying workspace",
    validate: "Checking setup file",
    create: "Setting up workspace",
    doctor: "Checking workspace",
    status: "Refreshing workspace",
    start: "Starting website",
    stop: "Stopping website",
    restart: "Restarting website",
    "watcher-start": "Starting background task",
    "watcher-stop": "Stopping background task",
    "watcher-restart": "Restarting background task",
    "watcher-log": "Loading task log",
    test: "Running check",
    "transfer-preview": "Reviewing changes",
    "transfer-apply": "Copying reviewed changes",
    "review-record": "Recording review",
    "cleanup-review": "Checking cleanup",
  };
  return labels[operation];
}

export function DiviWorkspaceControl({
  environmentId,
  availableEditors,
}: {
  environmentId: EnvironmentId;
  availableEditors: readonly EditorId[];
}) {
  const [open, setOpen] = useState(false);
  const [manifestPath, setManifestPath] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [selectedMainId, setSelectedMainId] = useState("original");
  const [selectedPreset, setSelectedPreset] = useState<DiviWorkspacePreset>("divi");
  const [result, setResult] = useState<DiviWorkspaceRunResult | null>(null);
  const [workspaceResult, setWorkspaceResult] = useState<DiviWorkspaceRunResult | null>(null);
  const [list, setList] = useState<DiviWorkspaceRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { busyResources, runResource } = useDiviWorkspaceControls(
    `${environmentId}:${workspaceId}:${open}`,
  );
  const [loadingOperation, setLoadingOperation] = useState<DiviWorkspaceOperation | null>(null);
  const [reviewPlanId, setReviewPlanId] = useState("");
  const [reviewFile, setReviewFile] = useState("");
  const [logs, setLogs] = useState<Record<string, string>>({});
  const [loadingLogId, setLoadingLogId] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [followingBuild, setFollowingBuild] = useState(false);
  const [followupProfileId, setFollowupProfileId] = useState<string | null>(null);
  const [buildFollowupTimedOut, setBuildFollowupTimedOut] = useState(false);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressGeneration = useRef(0);
  const progressInFlight = useRef(false);
  const followupDeadline = useRef<number | null>(null);
  const logGeneration = useRef(0);
  const panelOpen = useRef(false);
  const runRpc = useAtomCommand(diviWorkspaceRun, { reportFailure: false });
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const newThread = useNewThreadHandler();
  const projects = useProjects();
  const environment = useEnvironment(environmentId);
  const target = environment?.entry.target;
  const localClient = isLocalDiviEnvironment(
    window.location.hostname,
    isElectron,
    target?._tag,
    target?._tag === "PrimaryConnectionTarget" ? target.httpBaseUrl : undefined,
  );

  useEffect(
    () => () => {
      progressGeneration.current++;
      if (progressTimer.current) clearInterval(progressTimer.current);
    },
    [],
  );

  function changeOpen(nextOpen: boolean) {
    panelOpen.current = nextOpen;
    setOpen(nextOpen);
    if (!nextOpen) {
      progressGeneration.current++;
      logGeneration.current++;
      if (progressTimer.current) clearInterval(progressTimer.current);
      progressTimer.current = null;
      setBusy(false);
      setLoadingOperation(null);
      setLoadingLogId(null);
      setFollowingBuild(false);
      setFollowupProfileId(null);
      followupDeadline.current = null;
    }
  }

  async function requestLog(profileId: string) {
    const selectedId = workspaceResult?.workspaceId;
    if (!selectedId || !panelOpen.current) return;
    const generation = ++logGeneration.current;
    setLoadingLogId(profileId);
    const response = await runRpc({
      environmentId,
      input: { operation: "watcher-log", workspaceId: selectedId, profileId },
    });
    if (generation !== logGeneration.current || !panelOpen.current) return;
    setLoadingLogId(null);
    if (response._tag === "Success" && response.value.watcherLog?.profileId === profileId) {
      setLogs((current) => ({
        ...current,
        [profileId]: response.value.watcherLog?.logTail ?? "",
      }));
    } else if (response._tag === "Failure") {
      const failure = squashAtomCommandFailure(response);
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  async function runResourceControl(operation: DiviWorkspaceOperation, profileId?: string) {
    const selectedId = workspaceResult?.workspaceId;
    const resource = profileId ? `watcher-${profileId}` : "site";
    if (!selectedId || busy || !panelOpen.current) return;
    await runResource(resource, async (isCurrent) => {
      setError(null);
      const response = await runRpc({
        environmentId,
        input: { operation, workspaceId: selectedId, ...(profileId ? { profileId } : {}) },
      });
      if (!isCurrent()) return;
      const actionError = response._tag === "Failure" ? squashAtomCommandFailure(response) : null;
      const checked = await runRpc({
        environmentId,
        input: { operation: "status", workspaceId: selectedId },
      });
      if (!isCurrent()) return;
      if (checked._tag === "Success" && checked.value.workspaceId === selectedId) {
        setWorkspaceResult((previous) => ({ ...previous, ...checked.value }));
        setResult(checked.value);
      }
      const failure =
        actionError ?? (checked._tag === "Failure" ? squashAtomCommandFailure(checked) : null);
      if (failure) setError(failure instanceof Error ? failure.message : String(failure));
    });
  }

  useEffect(
    () =>
      onOpenDiviWorkspacePanel((request) => {
        if (!localClient || request.environmentId !== environmentId) return;
        changeOpen(true);
        setSelectedMainId(request.mainId ?? "original");
        if (request.workspaceId) {
          setWorkspaceId(request.workspaceId);
          setWorkspaceResult(null);
          setResult(null);
          setReviewPlanId("");
          setError(null);
          setLogs({});
          logGeneration.current++;
          void run("status", undefined, undefined, undefined, request.workspaceId);
        } else {
          void run("list");
        }
      }),
    [environmentId, localClient, run],
  );

  async function run(
    operation: DiviWorkspaceOperation,
    planId?: string,
    profileId?: string,
    preset?: DiviWorkspacePreset,
    targetWorkspaceId?: string,
    evidenceFile?: string,
  ) {
    const generation = ++progressGeneration.current;
    const watcherAction = operation === "watcher-start" || operation === "watcher-restart";
    if (progressTimer.current) clearInterval(progressTimer.current);
    setBusy(true);
    setLoadingOperation(operation);
    setElapsedSeconds(0);
    setFollowingBuild(false);
    setFollowupProfileId(watcherAction ? (profileId ?? null) : null);
    setBuildFollowupTimedOut(false);
    followupDeadline.current = null;
    setError(null);
    if (operation !== "list") setResult(null);
    const selectedId = (
      targetWorkspaceId ??
      (operation === "create" ? workspaceId : (workspaceResult?.workspaceId ?? ""))
    ).trim();
    const startedAt = Date.now();
    let lastPollCompletedAt = startedAt;
    progressTimer.current = setInterval(() => {
      if (generation !== progressGeneration.current || !panelOpen.current) return;
      if (document.visibilityState !== "visible") return;
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
      if (followupDeadline.current !== null && Date.now() >= followupDeadline.current) {
        if (progressTimer.current) clearInterval(progressTimer.current);
        progressTimer.current = null;
        followupDeadline.current = null;
        setFollowingBuild(false);
        setBuildFollowupTimedOut(true);
        return;
      }
      if (
        (operation !== "create" && !watcherAction) ||
        !selectedId ||
        progressInFlight.current ||
        Date.now() - lastPollCompletedAt < 5_000
      )
        return;
      progressInFlight.current = true;
      void runRpc({
        environmentId,
        input: { operation: "status", workspaceId: selectedId },
      })
        .then((status) => {
          if (
            generation === progressGeneration.current &&
            panelOpen.current &&
            status._tag === "Success" &&
            status.value.workspaceId === selectedId &&
            !(followupDeadline.current !== null && status.value.operationInProgress)
          ) {
            setResult(status.value);
            setWorkspaceResult(status.value);
            if (
              followupDeadline.current !== null &&
              !needsBuildFollowup(status.value, watcherAction ? profileId : undefined)
            ) {
              if (progressTimer.current) clearInterval(progressTimer.current);
              progressTimer.current = null;
              followupDeadline.current = null;
              setFollowingBuild(false);
            }
          }
        })
        .finally(() => {
          progressInFlight.current = false;
          lastPollCompletedAt = Date.now();
        });
    }, 1_000);
    const response = await runRpc({
      environmentId,
      input: {
        operation,
        ...(preset ? { preset } : {}),
        ...(operation === "create" ? { mainId: selectedMainId } : {}),
        ...((operation === "create" || operation === "validate") && !preset
          ? { manifestPath: manifestPath.trim() }
          : {}),
        ...(operation !== "list" && operation !== "validate" && selectedId
          ? { workspaceId: selectedId }
          : {}),
        ...(planId ? { planId } : {}),
        ...(profileId ? { profileId } : {}),
        ...(evidenceFile ? { reviewFile: evidenceFile } : {}),
      },
    });
    if (generation !== progressGeneration.current || !panelOpen.current) return;
    const followBuild =
      (operation === "create" || watcherAction) &&
      response._tag === "Success" &&
      needsBuildFollowup(response.value, watcherAction ? profileId : undefined);
    if (!followBuild && progressTimer.current) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
    if (followBuild) {
      followupDeadline.current = Date.now() + 150_000;
      setFollowingBuild(true);
    }
    setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    setBusy(false);
    setLoadingOperation(null);
    if (response._tag === "Failure") {
      const failure = squashAtomCommandFailure(response);
      const message =
        failure && typeof failure === "object" && "message" in failure
          ? String(failure.message)
          : String(failure);
      setError(
        message.includes("operation in progress")
          ? "A check or setup is already running for this workspace. Refresh after it finishes, then try again."
          : message,
      );
      const structured =
        failure && typeof failure === "object" && "result" in failure ? failure.result : null;
      if (objectField(structured)) setResult(structured as DiviWorkspaceRunResult);
      return;
    }
    if (operation === "list") setList(response.value);
    else {
      setResult(response.value);
      if (response.value.readiness) setWorkspaceResult(response.value);
      if (response.value.workspaceId) setWorkspaceId(response.value.workspaceId);
      if (response.value.planId) setReviewPlanId(response.value.planId);
    }
  }

  async function attachThread(cwd: string, repositoryId: string) {
    setBusy(true);
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
          title: `${workspaceResult?.workspaceId ?? "Divi workspace"} · ${repositoryId}`,
          workspaceRoot: cwd,
          createWorkspaceRootIfMissing: false,
          defaultModelSelection: null,
        },
      });
      if (created._tag === "Failure") {
        setBusy(false);
        setError(String(squashAtomCommandFailure(created)));
        return;
      }
    }
    try {
      await newThread(scopeProjectRef(environmentId, projectId));
      changeOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const workspace = result?.readiness ? result : workspaceResult;
  const workspaceOperationInProgress = workspace?.operationInProgress === true;
  const paths = objectField(workspace?.paths);
  const preview = objectField(workspace?.preview);
  const planId = stringField(result?.planId);
  const workspaceRoot = stringField(paths?.workspaceRoot);
  const sitePath = stringField(paths?.sitePath);
  const previewUrl = stringField(preview?.url);
  const listed = Array.isArray(list?.workspaces) ? list.workspaces : [];
  const repositoryDetails = objectField(workspace?.repositoryDetails);
  const receipts = objectField(workspace?.receipts);
  const milestones = objectField(workspace?.milestones);
  const verification = objectField(result?.verification);
  const verificationStatus = stringField(verification?.status);
  const plannedRepositories = Array.isArray(result?.repositories) ? result.repositories : [];
  const progress = setupProgress(workspace);

  return (
    <>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogPopup className="w-full max-w-4xl">
          <DialogHeader>
            <DialogTitle>Divi workspaces</DialogTitle>
            <DialogDescription>
              Give each task its own code workspace, with a website when configured.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-4 text-sm">
              <details className="rounded border p-3 text-xs">
                <summary className="cursor-pointer font-medium">How this works</summary>
                <ol className="mt-2 list-decimal space-y-1 ps-5 text-muted-foreground">
                  <li>Name a workspace and set it up, or open one you already made.</li>
                  <li>Open its code, then start a T3 thread in the folder you want to edit.</li>
                  <li>Run checks after editing. Background tasks can run while you work.</li>
                  <li>Review changed files before copying verified work back to your main code.</li>
                </ol>
                {workspace?.readiness?.website !== "not-requested" && workspace && (
                  <p className="mt-2 text-muted-foreground">
                    Each site has its own database. Uploaded files are shared, but Media Library
                    entries are not synced.
                  </p>
                )}
              </details>
              <section className="space-y-2">
                <h3 className="font-medium">1. Create or open</h3>
                <p className="text-xs text-muted-foreground">
                  Creating from main checkout: <strong>{selectedMainId}</strong>. Replicas start
                  from its latest commits.
                </p>
                <p className="text-xs text-muted-foreground">
                  Use a short name for each separate task. Reusing a name opens the same workspace.
                </p>
                <div className="flex gap-2">
                  <input
                    aria-label="Workspace ID"
                    className="min-w-0 flex-1 rounded border bg-background px-2 py-1 font-mono text-xs"
                    placeholder="New workspace name, e.g. fluent-feedback-a"
                    value={workspaceId}
                    disabled={busy}
                    onChange={(event) => {
                      setWorkspaceId(event.target.value);
                      setWorkspaceResult(null);
                      setResult(null);
                      setReviewPlanId("");
                      setError(null);
                      setLogs({});
                      logGeneration.current++;
                    }}
                  />
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run("list")}
                  >
                    Show existing
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Select
                    value={selectedPreset}
                    onValueChange={(value) => {
                      if (value === "divi" || value === "fluent-forms") setSelectedPreset(value);
                    }}
                  >
                    <SelectTrigger
                      aria-label="Workspace profile"
                      className="min-w-0 flex-1"
                      disabled={busy}
                      size="xs"
                    >
                      <SelectValue>
                        {selectedPreset === "divi" ? "Divi" : "Divi with Fluent Forms"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="divi">Divi</SelectItem>
                      <SelectItem value="fluent-forms">Divi with Fluent Forms</SelectItem>
                    </SelectPopup>
                  </Select>
                  <Button
                    size="xs"
                    disabled={busy || !workspaceId.trim()}
                    onClick={() => void run("create", undefined, undefined, selectedPreset)}
                  >
                    Set up workspace
                  </Button>
                </div>
                {listed.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="me-1 text-xs text-muted-foreground">Existing:</span>
                    {listed.map((item, index) => {
                      const entry = objectField(item);
                      const id = stringField(entry?.workspaceId) ?? stringField(item);
                      return id ? (
                        <Button
                          key={`${id}-${index}`}
                          size="xs"
                          variant="outline"
                          onClick={() => {
                            setWorkspaceId(id);
                            setWorkspaceResult(null);
                            setResult(null);
                            setReviewPlanId("");
                            setError(null);
                            setLogs({});
                            logGeneration.current++;
                            void run("status", undefined, undefined, undefined, id);
                          }}
                          disabled={busy}
                        >
                          {id}
                        </Button>
                      ) : null;
                    })}
                  </div>
                )}
              </section>
              <details>
                <summary className="cursor-pointer">Advanced: create from a setup file</summary>
                <p className="my-2 text-muted-foreground">
                  For a custom workspace, enter an absolute JSON setup file path on this Mac.
                </p>
                <div className="flex gap-2">
                  <input
                    aria-label="Manifest path"
                    className="min-w-0 flex-1 rounded border bg-background px-2 py-1 font-mono"
                    placeholder="Absolute setup file path"
                    value={manifestPath}
                    onChange={(event) => setManifestPath(event.target.value)}
                  />
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy || !manifestPath.trim() || !workspaceId.trim()}
                    onClick={() => void run("create")}
                  >
                    Set up
                  </Button>
                </div>
              </details>
              {(loadingOperation || followingBuild || buildFollowupTimedOut) && (
                <div role="status" className="rounded border bg-muted p-3 text-xs">
                  <strong>
                    {loadingOperation === "create"
                      ? setupStageLabel(workspace)
                      : followingBuild && followupProfileId
                        ? watcherFollowupLabel(
                            followupProfileId,
                            workspace?.readiness?.website !== "not-requested",
                          )
                        : followingBuild
                          ? setupStageLabel(workspace)
                          : buildFollowupTimedOut
                            ? workspace?.readiness?.website === "not-requested"
                              ? "Background task still unverified"
                              : "Live build still unverified"
                            : operationLabel(loadingOperation ?? "status")}
                  </strong>
                  {(loadingOperation === "create" || (followingBuild && !followupProfileId)) &&
                    progress && (
                      <div className="space-y-1">
                        <p>
                          {progress.completed} of {progress.requested} requested setup steps ready
                        </p>
                        <progress
                          aria-label="Setup steps completed"
                          className="h-2 w-full accent-primary"
                          value={progress.completed}
                          max={progress.requested}
                        />
                      </div>
                    )}
                  {followupProfileId &&
                    (followingBuild ||
                      loadingOperation === "watcher-start" ||
                      loadingOperation === "watcher-restart") && (
                      <div className="space-y-1">
                        <p>
                          {watcherLabel(followupProfileId)}:{" "}
                          {workspace?.readiness?.website === "not-requested" ? "task" : "build"}{" "}
                          verification pending
                        </p>
                        <progress
                          aria-label={`${watcherLabel(followupProfileId)} ${workspace?.readiness?.website === "not-requested" ? "task" : "build"} verification`}
                          className="h-2 w-full accent-primary"
                          value={0}
                          max={1}
                        />
                      </div>
                    )}
                  {(loadingOperation || followingBuild) && (
                    <p className="text-muted-foreground">
                      Elapsed: {elapsedLabel(elapsedSeconds)} · Updates while this panel is open
                    </p>
                  )}
                  {buildFollowupTimedOut && (
                    <p className="text-muted-foreground">
                      The task has not reported a final result yet. Use Refresh to check again.
                    </p>
                  )}
                </div>
              )}
              {error && (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              )}
              {workspace && (
                <div className="space-y-4 rounded border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-medium">
                        {workspace.workspaceId ?? "Workspace"} ·{" "}
                        {workspaceHeading(workspace.readiness, workspace.operationInProgress)}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Code: {readinessLabel(workspace.readiness?.code)} · Website:{" "}
                        {readinessLabel(workspace.readiness?.website)} · Checks:{" "}
                        {readinessLabel(workspace.readiness?.tests)}
                      </p>
                      {workspaceOperationInProgress && (
                        <p className="text-xs text-muted-foreground">
                          A check or setup is running. Refresh after it finishes to use workspace
                          controls.
                        </p>
                      )}
                    </div>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void run("status")}
                    >
                      Refresh
                    </Button>
                  </div>

                  <section className="space-y-2">
                    <h4 className="font-medium">2. Open your workspace</h4>
                    <p className="text-xs text-muted-foreground">
                      Choose a code folder for your editor or a new T3 thread. Open the website when
                      one is configured.
                    </p>
                    <DiviWorkspaceOverview
                      workspace={workspace}
                      busy={busy || workspaceOperationInProgress}
                      busyResources={busyResources}
                      previewUrl={previewUrl}
                      onOperation={(operation, profileId) =>
                        void runResourceControl(operation, profileId)
                      }
                      onLogRequest={(profileId) => void requestLog(profileId)}
                      logs={logs}
                      loadingLogId={loadingLogId}
                    />
                    {repositoryDetails &&
                      Object.entries(repositoryDetails).map(([id, detail]) => {
                        const record = objectField(detail);
                        const taskPath = stringField(record?.taskPath);
                        return (
                          <div
                            key={id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded bg-muted p-2 text-xs"
                          >
                            <strong>{id}</strong>
                            <div className="flex flex-wrap gap-1">
                              {taskPath && availableEditors.length > 0 && (
                                <OpenInPicker
                                  environmentId={environmentId}
                                  keybindings={keybindings}
                                  availableEditors={availableEditors}
                                  openInCwd={taskPath}
                                  compact
                                  enableShortcut={false}
                                />
                              )}
                              {taskPath && (
                                <Button
                                  size="xs"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() => void attachThread(taskPath, id)}
                                >
                                  New thread
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">
                        Code locations
                      </summary>
                      {workspaceRoot && (
                        <p className="mt-2 select-text break-all">
                          Workspace: <span className="font-mono">{workspaceRoot}</span>
                        </p>
                      )}
                      {sitePath && (
                        <p className="select-text break-all">
                          Website: <span className="font-mono">{sitePath}</span>
                        </p>
                      )}
                      {previewUrl && (
                        <p className="select-text break-all">
                          Website address: <span className="font-mono">{previewUrl}</span>
                        </p>
                      )}
                      {repositoryDetails &&
                        Object.entries(repositoryDetails).map(([id, detail]) => {
                          const record = objectField(detail);
                          return (
                            <div key={id} className="mt-2">
                              <strong>{id}</strong>
                              <p className="select-text break-all">
                                Task code:{" "}
                                <span className="font-mono">
                                  {stringField(record?.taskPath) ?? "Unavailable"}
                                </span>
                              </p>
                              <p className="select-text break-all">
                                Main code:{" "}
                                <span className="font-mono">
                                  {stringField(record?.mainPath) ?? "Unavailable"}
                                </span>
                              </p>
                              <p className="select-text break-all">
                                Starting revision:{" "}
                                <span className="font-mono">
                                  {stringField(record?.baseCommit) ?? "Unavailable"}
                                </span>
                              </p>
                            </div>
                          );
                        })}
                      {sitePath && availableEditors.length > 0 && (
                        <div className="flex items-center gap-2">
                          <span>Open whole website folder</span>
                          <OpenInPicker
                            environmentId={environmentId}
                            keybindings={keybindings}
                            availableEditors={availableEditors}
                            openInCwd={sitePath}
                            compact
                            enableShortcut={false}
                          />
                        </div>
                      )}
                    </details>
                  </section>

                  <details className="space-y-2 border-t pt-3">
                    <summary className="cursor-pointer font-medium">
                      3. Checks · {readinessLabel(workspace.readiness?.tests)}
                    </summary>
                    <p className="text-xs text-muted-foreground">
                      Checks test the code you changed. Run the relevant checks before copying work
                      to main.
                    </p>
                    <p className="text-xs">
                      Current checks: <strong>{readinessLabel(workspace.readiness?.tests)}</strong>
                    </p>
                    {workspace.testProfiles?.map((id) => (
                      <div key={id} className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="min-w-0 flex-1 break-all">{id}</span>
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={busy || workspaceOperationInProgress}
                          onClick={() => void run("test", undefined, id)}
                        >
                          Run check
                        </Button>
                      </div>
                    ))}
                    {receipts &&
                      Object.entries(receipts).map(([id, receipt]) => {
                        const record = objectField(receipt);
                        const endedAt = receiptTime(record?.endedAt);
                        return (
                          <p key={id} className="text-xs text-muted-foreground">
                            {id}: {readinessLabel(record?.status)}
                            {workspace.readiness?.tests === "stale"
                              ? " · rerun after code changes"
                              : ""}
                            {endedAt ? " · " + endedAt : ""}
                          </p>
                        );
                      })}
                  </details>

                  <section className="space-y-2 border-t pt-3">
                    <h4 className="font-medium">4. Review and copy changes</h4>
                    <p className="text-xs text-muted-foreground">
                      Preview the changed files first. Copying them to main leaves them uncommitted
                      for final review.
                    </p>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy || workspaceOperationInProgress}
                      onClick={() => void run("transfer-preview")}
                    >
                      Preview changed files
                    </Button>
                    {result?.operation === "transfer-apply" &&
                      result.status === "transferred-uncommitted" && (
                        <p role="status" className="text-xs">
                          Reviewed changes were copied to main and remain uncommitted.
                        </p>
                      )}
                    {planId && (
                      <div className="space-y-2 rounded border p-2 text-xs">
                        <p className="font-medium">Review these changed files</p>
                        <p>
                          Workspace checks for these code changes:{" "}
                          <strong>
                            {verificationStatus === "ready"
                              ? "Passed for current code"
                              : readinessLabel(verificationStatus)}
                          </strong>
                          {verificationStatus !== "ready"
                            ? " · Run the required checks, then preview again."
                            : ""}
                        </p>
                        {plannedRepositories.map((item, index) => {
                          const repo = objectField(item);
                          const files = Array.isArray(repo?.paths) ? repo.paths : [];
                          return (
                            <div key={index}>
                              <strong>{stringField(repo?.id) ?? "Code folder"}</strong>
                              <ul className="list-disc ps-5">
                                {files.map((file, fileIndex) => (
                                  <li key={fileIndex} className="select-text break-all font-mono">
                                    {String(file)}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        })}
                        <Button
                          size="xs"
                          disabled={
                            busy ||
                            workspaceOperationInProgress ||
                            verificationStatus !== "ready" ||
                            result?.operation !== "transfer-preview"
                          }
                          onClick={() => void run("transfer-apply", planId)}
                        >
                          Copy reviewed changes to main
                        </Button>
                      </div>
                    )}
                  </section>

                  <details className="border-t pt-3 text-xs">
                    <summary className="cursor-pointer font-medium">Advanced</summary>
                    <div className="mt-3 space-y-3">
                      <details>
                        <summary className="cursor-pointer">Setup times</summary>
                        <div className="mt-2 space-y-1">
                          {["code", "website", "tests", "watchers", "testPrerequisites"].map(
                            (key) => {
                              const duration = durationLabel(
                                objectField(milestones?.[key])?.durationMs,
                              );
                              return duration ? (
                                <p key={key}>
                                  {key === "testPrerequisites" ? "Test setup" : key}: {duration}
                                </p>
                              ) : null;
                            },
                          )}
                          <p className="text-muted-foreground">
                            Times are per step, not total elapsed.
                          </p>
                        </div>
                      </details>
                      <div className="flex flex-wrap gap-1">
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void run("doctor")}
                        >
                          Check setup
                        </Button>
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={busy || workspaceOperationInProgress}
                          onClick={() => void run("cleanup-review")}
                        >
                          Review cleanup
                        </Button>
                      </div>
                      <p className="text-muted-foreground">
                        Review only; no site, database, or upload files are deleted.
                      </p>
                      {result?.issues && (
                        <div className="rounded border p-2">
                          <strong>
                            {result.eligible ? "Cleanup review clear" : "Before cleanup"}
                          </strong>
                          {result.issues.length > 0 && (
                            <ul className="mt-1 list-disc ps-5">
                              {result.issues.map((issue) => (
                                <li key={issue}>{issue}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                      <details>
                        <summary className="cursor-pointer">
                          Record checks completed on main files
                        </summary>
                        <p className="my-2 text-muted-foreground">
                          Use an existing JSON evidence file after running focused checks on main.
                          This records your checks; T3 does not run them.
                        </p>
                        <input
                          aria-label="Transferred plan ID"
                          className="mb-2 w-full rounded border bg-background px-2 py-1 font-mono"
                          placeholder="Transferred plan ID"
                          value={reviewPlanId}
                          onChange={(event) => setReviewPlanId(event.target.value)}
                        />
                        <input
                          aria-label="Review evidence file path"
                          className="mb-2 w-full rounded border bg-background px-2 py-1 font-mono"
                          placeholder="Absolute path to review evidence JSON"
                          value={reviewFile}
                          onChange={(event) => setReviewFile(event.target.value)}
                        />
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={
                            busy ||
                            workspaceOperationInProgress ||
                            !workspaceId.trim() ||
                            !reviewPlanId.trim() ||
                            !reviewFile.trim()
                          }
                          onClick={() =>
                            void run(
                              "review-record",
                              reviewPlanId.trim(),
                              undefined,
                              undefined,
                              undefined,
                              reviewFile.trim(),
                            )
                          }
                        >
                          Record review
                        </Button>
                      </details>
                      <details>
                        <summary className="cursor-pointer">Technical details</summary>
                        <pre className="mt-2 max-h-56 overflow-auto rounded bg-muted p-2">
                          {JSON.stringify(
                            {
                              resources: workspace.resources,
                              milestones: workspace.milestones,
                              baseline: workspace.baseline,
                              prepareProfiles: workspace.prepareProfiles,
                              prepareReceipts: workspace.prepareReceipts,
                              receipts: workspace.receipts,
                              testReceipt: result?.testReceipt,
                              planId,
                              verification: result?.verification,
                              repositories: result?.repositories,
                              journal: result?.journal,
                              issues: result?.issues,
                              eligible: result?.eligible,
                              sourceDigest: result?.sourceDigest,
                              mainSnapshot: result?.mainSnapshot,
                              taskChanges: result?.taskChanges,
                              error: result?.error,
                            },
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    </div>
                  </details>
                </div>
              )}
            </div>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
}
