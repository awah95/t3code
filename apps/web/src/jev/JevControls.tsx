import { JevEvaluation } from "./JevEvaluation";
import { JEV_POLICY_VERSION, JEV_MODEL_PROFILES } from "@t3tools/shared/jevRouting";
import { useEffect, useState } from "react";
import { EllipsisIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { isElectron } from "../env";
import { listenForJevSubagents, useJevStore, type JevCall } from "./jevStore";

export function JevControls() {
  const { enabled, setEnabled, panelOpen, setPanelOpen, calls, mode } = useJevStore();
  const [checkingStatus, setCheckingStatus] = useState(false);
  useEffect(listenForJevSubagents, []);
  useEffect(() => {
    if (!isElectron || !enabled) return;
    let active = true;
    void window.desktopBridge
      ?.getJevStatus?.()
      .then((status) => {
        if (!active || status.hasKey) return;
        setEnabled(false);
        useJevStore.setState({
          panelOpen: true,
          notice: status.secureStorageAvailable
            ? "Add an OpenRouter key in Settings > General > Jev Auto routing before enabling Jev."
            : "Jev was turned off because secure OS credential storage is unavailable.",
        });
      })
      .catch(() => {
        if (!active) return;
        setEnabled(false);
        useJevStore.setState({
          panelOpen: true,
          notice: "Jev was turned off because its OpenRouter credential could not be verified.",
        });
      });
    return () => {
      active = false;
    };
  }, [enabled, setEnabled]);
  if (!isElectron) return null;
  const pending = calls.some((call) => call.status === "pending");
  const toggleEnabled = async () => {
    if (enabled) {
      setEnabled(false);
      return;
    }
    setCheckingStatus(true);
    try {
      const status = await window.desktopBridge?.getJevStatus?.();
      if (!status?.hasKey) {
        useJevStore.setState({
          panelOpen: true,
          notice: status?.secureStorageAvailable
            ? "Add an OpenRouter key in Settings > General > Jev Auto routing before enabling Jev."
            : "Jev cannot be enabled because secure OS credential storage is unavailable.",
        });
        return;
      }
      setEnabled(true);
    } catch {
      useJevStore.setState({
        panelOpen: true,
        notice: "Could not verify Jev's OpenRouter credential. Jev remains off.",
      });
    } finally {
      setCheckingStatus(false);
    }
  };
  return (
    <>
      <button
        type="button"
        aria-pressed={enabled}
        disabled={checkingStatus}
        onClick={() => void toggleEnabled()}
        aria-label="Jev Auto: choose a compatible model within the selected provider. Task text, recent chat history and plan context are sent to OpenRouter."
        className={`rounded-md border px-2 py-1 text-xs ${enabled ? "border-primary text-primary" : "text-muted-foreground"}`}
      >
        Jev {mode === "guided" ? "Guided" : "Auto"}{" "}
        {checkingStatus ? "Checking…" : enabled ? "On" : "Off"}
      </button>
      <button
        type="button"
        onClick={() => setPanelOpen(!panelOpen)}
        aria-expanded={panelOpen}
        aria-controls="jev-routing-panel"
        className="rounded-md px-2 py-1 text-xs text-muted-foreground"
      >
        {calls.some((call) => call.status === "awaiting-review")
          ? "Review pick"
          : pending
            ? "Routing…"
            : "Jev calls"}
      </button>
    </>
  );
}

function proposalLabel(call: JevCall) {
  const candidate = call.request.candidates.find(
    (entry) => entry.key === call.result?.proposedChoice,
  );
  return candidate ? `${candidate.model} / ${candidate.effort ?? "default effort"}` : "unavailable";
}

function callModelLabel(call: JevCall) {
  if (call.dispatch) {
    return `${call.dispatch.model} / ${call.dispatch.effort ?? "default"}`;
  }
  if (call.decision === "current") {
    return `${call.request.context.currentModel ?? "current model"} / ${call.request.context.currentEffort ?? "default"}`;
  }
  const choice = call.approvedChoice ?? call.result?.recommendedChoice ?? call.result?.choice;
  const candidate = call.request.candidates.find((entry) => entry.key === choice);
  if (!candidate) return "No model selected";
  const label = `${candidate.model ?? candidate.key} / ${candidate.effort ?? "default"}`;
  return call.decision || call.status === "routed" ? label : `Suggested: ${label}`;
}

function reasonLabel(reason: string) {
  const labels: Record<string, string> = {
    established_procedure_and_direct_check: "The procedure and direct check are established.",
    local_judgment: "Some local judgment is required.",
    approach_requires_discovery: "The approach must be investigated.",
    evidence_synthesis: "The task requires combining evidence into a coherent understanding.",
    conflicting_evidence: "Conflicting evidence must be reconciled.",
    local_correctness_reasoning: "Correctness requires local reasoning.",
    interacting_correctness_invariant: "Correctness depends on interacting components or states.",
    verification_must_be_designed: "The verification method must be designed.",
    high_consequence: "A wrong result could have serious consequences.",
    proposal_adjusted_by_capability_policy:
      "The model and effort were adjusted using the assessed requirements and the selected model's effort proposal.",
    uncertainty_changes_required_capability:
      "Uncertainty could require a stronger pair or more context; review before sending.",
    uncertainty_within_selected_capability:
      "The checked uncertain interpretations fit the selected pair.",
    model_demand_disagreement:
      "Jev's raw proposal and the assessed requirements disagree substantially; review before sending.",
    uncertain_task_demands: "The task demands are uncertain; review before sending.",
    failed_attempt_model_unknown: "The model used for the failed attempt is unknown.",
    context_omissions_require_review: "Some context is unavailable; review before sending.",
    missing_material_context: "Essential task context is missing.",
    no_admissible_pair: "No available pair meets the task requirements.",
    invalid_assessment: "Jev did not return a complete valid assessment.",
  };
  return labels[reason] ?? reason;
}

function JevReviewCard({ call }: { call: JevCall }) {
  const [alternative, setAlternative] = useState("");
  const { resolveReview, cancelPending } = useJevStore();
  const suggestedKey = call.result?.recommendedChoice ?? call.result?.choice;
  const suggested = call.request.candidates.find((candidate) => candidate.key === suggestedKey);
  const unavailable = call.result?.policyOutcome === "unavailable";
  const missingKey = call.result?.error?.includes("OpenRouter key") ?? false;
  return (
    <section
      aria-label="Review Jev recommendation"
      className="space-y-3 rounded-md border border-primary/50 p-3 text-xs"
    >
      <p className="font-medium">
        {unavailable ? "Jev routing unavailable" : "Review before sending"}
      </p>
      <p className="whitespace-pre-wrap">
        {call.request.prompt.slice(0, 240)}
        {call.request.prompt.length > 240 ? "… (full prompt in log)" : ""}
      </p>
      {unavailable ? (
        <div role="alert" className="space-y-2 rounded border border-warning/40 bg-warning/10 p-2">
          <p>{call.result?.error ?? "Jev could not produce a routing decision."}</p>
          {missingKey && (
            <p>
              Add the key in Settings &gt; General &gt; Jev Auto routing, then enable Jev again.
            </p>
          )}
        </div>
      ) : (
        <>
          <p>
            Suggested:{" "}
            {suggested
              ? `${suggested.model ?? suggested.description} · ${suggested.effort ?? "default effort"}`
              : "No valid recommendation"}
          </p>
          <p>
            Raw model-proposal confidence:{" "}
            {call.result?.modelConfidence?.toFixed(2) ?? "unavailable"}; raw effort-proposal
            confidence: {call.result?.effortConfidence?.toFixed(2) ?? "unavailable"}. This is not
            task success probability.
          </p>
          <p>Task-assessment confidence: {call.result?.confidence?.toFixed(2) ?? "unavailable"}</p>
          {call.result?.conditionalEffort && (
            <p>
              For {call.result.conditionalEffort.model}, Jev proposed{" "}
              {call.result.conditionalEffort.effort} effort (confidence{" "}
              {call.result.conditionalEffort.confidence.toFixed(2)}). The policy can raise this to
              meet the task requirements.
            </p>
          )}
          <p>Policy outcome: {call.result?.policyOutcome ?? "unknown"}</p>
          <p>Model proposal: {proposalLabel(call)}</p>
          {call.result?.reasons?.map((reason) => (
            <p key={reason}>{reasonLabel(reason)}</p>
          ))}
        </>
      )}
      {call.request.context.missingContext?.map((missing) => (
        <p key={missing}>Missing: {missing}</p>
      ))}
      {call.result?.explanation && <p>{call.result.explanation}</p>}
      <p>
        Current: {call.request.context.currentModel ?? "your selected model"} ·{" "}
        {call.request.context.currentEffort ?? "default effort"}
      </p>
      <div className="flex flex-wrap gap-2">
        {suggested && (
          <Button
            size="sm"
            disabled={Boolean(
              call.result?.admissibleCandidateKeys &&
              !call.result.admissibleCandidateKeys.includes(suggested.key),
            )}
            onClick={() => resolveReview(call.id, "suggestion")}
          >
            Use suggestion
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => resolveReview(call.id, "current")}>
          Use current selection
        </Button>
      </div>
      <label className="flex flex-col gap-1">
        {unavailable ? "Choose a model and effort manually" : "Choose another model and effort"}
        <select
          className="min-w-0 rounded border bg-background p-2"
          value={alternative}
          onChange={(event) => setAlternative(event.target.value)}
        >
          <option value="">Choose a compatible pair</option>
          {call.request.candidates.map((candidate) => (
            <option key={candidate.key} value={candidate.key}>
              {candidate.model ?? candidate.description} · {candidate.effort ?? "default effort"}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!alternative}
          onClick={() => resolveReview(call.id, "alternative", alternative)}
        >
          Use chosen model
        </Button>
        <Button size="sm" variant="ghost" onClick={cancelPending}>
          Cancel send
        </Button>
      </div>
    </section>
  );
}

export function JevPanel() {
  const {
    panelOpen,
    setPanelOpen,
    mode,
    setMode,
    calls,
    clearCalls,
    notice,
    cancelPending,
    billedUsd,
    estimatedUsd,
    unknownCostCalls,
    subagentsEnabled,
    setSubagentsEnabled,
  } = useJevStore();
  if (!isElectron || !panelOpen) return null;
  const pending = calls.some((call) => call.status === "pending");
  return (
    <aside
      id="jev-routing-panel"
      aria-label="Jev routing calls"
      className="flex h-full min-h-0 min-w-0 w-[min(24rem,40%)] shrink-0 flex-col gap-3 overflow-y-auto overscroll-contain border-l bg-background p-4 pt-[calc(var(--workspace-topbar-height,3rem)+1rem)] [overflow-wrap:anywhere]"
    >
      <div className="flex items-center justify-between text-sm font-medium">
        <span>Jev routing · session log</span>
        <div className="flex items-center gap-2">
          <Menu>
            <MenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Jev log actions"
                  className="text-muted-foreground hover:text-foreground"
                />
              }
            >
              <EllipsisIcon className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem
                variant="destructive"
                disabled={
                  !calls.some(
                    (call) => call.status !== "pending" && call.status !== "awaiting-review",
                  )
                }
                onClick={clearCalls}
              >
                Clear completed logs
              </MenuItem>
            </MenuPopup>
          </Menu>
          <button type="button" onClick={() => setPanelOpen(false)} aria-label="Close Jev calls">
            Close
          </button>
        </div>
      </div>
      <label className="flex items-center justify-between gap-2 text-xs">
        Routing mode
        <select
          aria-label="Jev routing mode"
          className="rounded border bg-background p-1"
          value={mode}
          onChange={(event) => setMode(event.target.value as "guided" | "auto")}
        >
          <option value="guided">Guided — review every pick</option>
          <option value="auto">Automatic</option>
        </select>
      </label>
      {notice && (
        <p role="status" className="text-xs">
          {notice}
        </p>
      )}
      {calls
        .filter((call) => call.status === "awaiting-review")
        .map((call) => (
          <JevReviewCard key={call.id} call={call} />
        ))}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Context sharing &amp; log retention</summary>
        <p className="mt-2">
          Latest 50 calls, kept in memory. Full current prompts, up to ten recent chat exchanges,
          task provenance, attached textual evidence and agreed plan context are shared with
          OpenRouter. Common credentials are redacted; review sensitive content before sending.
        </p>
      </details>
      <details className="text-xs">
        <summary>Routing policy · {JEV_POLICY_VERSION}</summary>
        <p>
          Capability first, then expected completion time and rework, then remaining quota. Profiles
          are starting guidance, not measured success rates or speed benchmarks.
        </p>
        {JEV_MODEL_PROFILES.map((profile) => (
          <p key={profile.model} className="mt-2">
            {profile.model}: {profile.summary}
          </p>
        ))}
      </details>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={subagentsEnabled}
          onChange={(event) => setSubagentsEnabled(event.target.checked)}
        />
        Route Codex subagents
      </label>
      <p className="text-xs text-muted-foreground">
        Requires Jev Auto and a local Codex thread. Enabling trusts T3's exact session-scoped
        routing hook in Codex settings. The independent child task and declared context scope are
        sent to OpenRouter. Explicit child model or effort choices are preserved. Turning either
        toggle off stops routing calls. Full-history forks retain their parent model. Child routing
        remains automatic with its policy guard, even in Guided mode; guided review applies to your
        messages. Other providers are unsupported.
      </p>
      <div className="space-y-2">
        <dl aria-label="Jev session statistics" className="grid grid-cols-2 gap-2 text-xs">
          <div className="min-w-0 rounded-md border bg-muted/30 p-2.5">
            <dt className="text-muted-foreground">Billed</dt>
            <dd className="mt-1 font-medium tabular-nums">${billedUsd.toFixed(8)}</dd>
          </div>
          <div className="min-w-0 rounded-md border bg-muted/30 p-2.5">
            <dt className="text-muted-foreground">Estimated</dt>
            <dd className="mt-1 font-medium tabular-nums">${estimatedUsd.toFixed(8)}</dd>
          </div>
          <div className="col-span-2 flex items-center justify-between gap-2 rounded-md border bg-muted/30 p-2.5">
            <dt className="text-muted-foreground">Calls with unknown cost</dt>
            <dd className="font-medium tabular-nums">{unknownCostCalls}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">Session totals survive clearing the log.</p>
      </div>
      <div className="flex gap-3 text-xs">
        {pending && (
          <button
            type="button"
            onClick={() => {
              cancelPending();
              if (calls.some((call) => call.status === "pending" && call.kind === "subagent"))
                setSubagentsEnabled(false);
            }}
          >
            Cancel routing
          </button>
        )}
      </div>
      <JevEvaluation />
      {calls.length === 0 && (
        <p className="text-xs text-muted-foreground">No routing calls this session.</p>
      )}
      {calls.map((call) => (
        <details key={call.id} className="rounded border p-2 text-xs">
          <summary className="cursor-pointer">
            {new Date(call.createdAt).toLocaleTimeString()} ·{" "}
            {call.request.context.interactionMode === "subagent-status"
              ? "local setup · "
              : call.kind === "subagent"
                ? "subagent · "
                : ""}
            {call.status} {call.result && `· ${call.result.latencyMs} ms · ${callModelLabel(call)}`}
          </summary>
          {call.notice && <p className="mt-2">{call.notice}</p>}
          {(call.result?.recommendedChoice ?? call.result?.choice) && (
            <p className="mt-2">
              Policy recommendation:{" "}
              {
                call.request.candidates.find(
                  (candidate) =>
                    candidate.key === (call.result?.recommendedChoice ?? call.result?.choice),
                )?.description
              }
            </p>
          )}
          <p className="mt-2">
            Proposal: {proposalLabel(call)} · Policy outcome:{" "}
            {call.result?.policyOutcome ?? "unknown"}
          </p>
          {call.result?.reasons?.map((reason) => (
            <p key={reason}>{reasonLabel(reason)}</p>
          ))}
          {call.request.context.missingContext?.map((missing) => (
            <p key={missing}>Missing: {missing}</p>
          ))}
          {call.dispatch && (
            <p>
              Dispatched: {call.dispatch.model} / {call.dispatch.effort ?? "default"} ·{" "}
              {call.dispatch.succeeded ? "accepted" : "failed"}
            </p>
          )}
          {call.decision && (
            <p className="mt-2">
              Your decision: {call.decision}. Approved for send:{" "}
              {call.approvedChoice
                ? call.request.candidates.find((candidate) => candidate.key === call.approvedChoice)
                    ?.description
                : `${call.request.context.currentModel ?? "current model"} / ${call.request.context.currentEffort ?? "default effort"}`}
              .
            </p>
          )}
          <p className="mt-2">
            Policy: {call.result?.policyVersion ?? JEV_POLICY_VERSION} · History:{" "}
            {call.request.context.historyExchangeCount ?? 0} exchanges
          </p>
          {[...new Set(call.request.context.omissions ?? [])].map((omission) => (
            <p key={omission} className="mt-1">
              {omission}
            </p>
          ))}
          <p className="mt-2">
            {call.request.context.budget
              ? `Quota checked ${new Date(call.request.context.budget.checkedAt).toLocaleString()}${call.request.context.budget.unavailableReason ? ` (${call.request.context.budget.unavailableReason})` : ""}`
              : "Quota unavailable"}
          </p>
          {call.result?.explanation && (
            <p className="mt-2">Assessment: {call.result.explanation}</p>
          )}
          {call.result && (
            <p className="mt-2">
              Cost:{" "}
              {call.result.costKind === "unknown"
                ? "unknown"
                : `${call.result.costKind} $${call.result.costUsd?.toFixed(8)}`}{" "}
              · Raw model-proposal confidence: {call.result.modelConfidence ?? "unknown"} · Raw
              effort-proposal confidence: {call.result.effortConfidence ?? "unknown"} (not task
              success probabilities)
            </p>
          )}
          {call.result?.conditionalEffort && (
            <p>
              For {call.result.conditionalEffort.model}, Jev proposed{" "}
              {call.result.conditionalEffort.effort} effort (confidence{" "}
              {call.result.conditionalEffort.confidence.toFixed(2)}).
            </p>
          )}
          <p className="mt-2 font-medium">Sanitized request / state</p>
          <pre className="whitespace-pre-wrap break-all">
            {JSON.stringify(call.request, null, 2)}
          </pre>
          {call.result && (
            <>
              <p className="mt-2 font-medium">Response</p>
              <pre className="whitespace-pre-wrap break-all">
                {JSON.stringify(call.result, null, 2)}
              </pre>
            </>
          )}
        </details>
      ))}
    </aside>
  );
}

export function JevSettings() {
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!isElectron) return;
    void window.desktopBridge
      ?.getJevStatus?.()
      .then((status) => {
        setHasKey(status.hasKey);
        setAvailable(status.secureStorageAvailable);
      })
      .catch(() => setMessage("Could not read secure credential status."));
  }, []);
  if (!isElectron) return null;
  const save = async (value: string | null) => {
    setBusy(true);
    setMessage("");
    try {
      if (!window.desktopBridge?.setJevApiKey) throw new Error();
      await window.desktopBridge.setJevApiKey(value);
      setKey("");
      setHasKey(value !== null);
      setMessage(
        value === null
          ? "OpenRouter key removed."
          : "OpenRouter key saved in encrypted OS storage.",
      );
      if (value === null) useJevStore.getState().setEnabled(false);
    } catch {
      setMessage("Could not update the key. Check secure OS storage availability.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section id="jev-routing" className="space-y-3 rounded-lg border p-4">
      <h2 className="text-sm font-medium">Jev Auto routing</h2>
      <p className="text-sm text-muted-foreground">
        Jev chooses a supported Codex model and reasoning effort within your selected provider
        instance. Enable it in the chat header. OpenRouter receives the full current task, up to ten
        recent user/assistant exchanges, original task, agreed plan, failure feedback, model
        profiles and available quota snapshots. Attached terminal excerpts, review comments and
        preview annotations are included. Internal reasoning and file/image bodies are excluded and
        named as missing context. History may be shortened with explicit omissions; current prompts
        are never silently shortened.
      </p>
      <p className="text-xs">
        {hasKey ? "API key saved" : "No API key saved"} ·{" "}
        {available ? "Secure storage available" : "Secure storage unavailable"}
      </p>
      <label className="block text-sm">
        OpenRouter API key
        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder={hasKey ? "Enter a replacement key" : "sk-or-…"}
          className="mt-1 block w-full rounded border bg-transparent p-2"
        />
      </label>
      <div className="flex gap-3 text-sm">
        <button
          type="button"
          disabled={busy || !available || !key.trim()}
          onClick={() => void save(key)}
          className="rounded border px-3 py-1 disabled:opacity-50"
        >
          Save key
        </button>
        <button
          type="button"
          disabled={busy || !hasKey}
          onClick={() => void save(null)}
          className="rounded border px-3 py-1 disabled:opacity-50"
        >
          Remove key
        </button>
      </div>
      {message && (
        <p role="status" className="text-xs">
          {message}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Routing usage is separate from the selected coding provider. Estimates use $0.042 per
        million input tokens and free output; only a reported cost is labeled billed. Auto starts
        off each app session. Manual model selection turns Auto off.
      </p>
    </section>
  );
}
