import { JevEvaluation } from "./JevEvaluation";
import { JEV_POLICY_VERSION, JEV_MODEL_PROFILES } from "@t3tools/shared/jevRouting";
import { useEffect, useState } from "react";
import { ChevronDownIcon, CircleAlertIcon, EllipsisIcon, RouteIcon, XIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { isElectron } from "../env";
import { listenForJevSubagents, useJevStore, type JevCall } from "./jevStore";

type JevControlsProps = {
  readonly presentation?: "toolbar" | "menu";
  readonly onRequestMenuClose?: () => void;
};

export function JevControls({
  presentation = "toolbar",
  onRequestMenuClose,
}: JevControlsProps = {}) {
  const { enabled, setEnabled, panelOpen, setPanelOpen, calls, mode } = useJevStore();
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
  const reviewCount = calls.filter((call) => call.status === "awaiting-review").length;
  const status =
    reviewCount > 0
      ? "Review"
      : pending
        ? "Routing…"
        : enabled
          ? mode === "guided"
            ? "Guided"
            : "Auto"
          : "Off";
  const togglePanel = () => {
    setPanelOpen(!panelOpen);
    onRequestMenuClose?.();
  };
  if (presentation === "menu") {
    return (
      <MenuItem density="touch" onClick={togglePanel}>
        <RouteIcon />
        <span className="min-w-0 flex-1">Jev routing</span>
        <span className="text-xs text-muted-foreground">{status}</span>
        {reviewCount > 0 && (
          <span className="min-w-4 rounded-sm bg-warning/15 px-1 text-center text-[10px] tabular-nums text-warning-foreground">
            {reviewCount}
          </span>
        )}
      </MenuItem>
    );
  }
  return (
    <Button
      type="button"
      variant={reviewCount > 0 ? "warning-outline" : "ghost-muted"}
      size="compact"
      onClick={togglePanel}
      aria-expanded={panelOpen}
      aria-controls="jev-routing-panel"
      aria-label={`Jev routing: ${reviewCount > 0 ? `${reviewCount} recommendation${reviewCount === 1 ? "" : "s"} awaiting review` : pending ? "routing in progress" : enabled ? `${mode} mode enabled` : "off"}`}
    >
      <RouteIcon className="size-3.5" />
      <span>Jev</span>
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${reviewCount > 0 ? "bg-warning" : enabled ? "bg-success" : "bg-muted-foreground/50"}`}
      />
      <span className="text-[11px] font-normal">{status}</span>
      {reviewCount > 0 && (
        <span className="min-w-4 rounded-sm bg-warning/15 px-1 text-[10px] tabular-nums text-warning-foreground">
          {reviewCount}
        </span>
      )}
    </Button>
  );
}

function modelLabel(model: string | undefined) {
  if (!model) return "Selected model";
  const match = /^gpt-([\d.]+)-(.+)$/.exec(model);
  if (!match) return model;
  return `GPT-${match[1]} ${match[2]![0]!.toUpperCase()}${match[2]!.slice(1)}`;
}

function effortLabel(effort: string | undefined) {
  if (!effort) return "Default effort";
  return `${effort[0]!.toUpperCase()}${effort.slice(1)} effort`;
}

function pairLabel(model: string | undefined, effort: string | undefined) {
  return `${modelLabel(model)} · ${effortLabel(effort)}`;
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
    continuation_retained_model: "The current model was retained for task continuity.",
    unclear_continuity_retained_model:
      "The current model was retained while task continuity remains uncertain.",
    current_model_effort_adjusted: "The current model's effort was adjusted for this task.",
    independent_child_selected_model: "The independent child received its own model assessment.",
    new_task_selected_model: "This new task received a fresh model assessment.",
    new_phase_reassessed_model: "This new phase received a fresh model assessment.",
    current_model_below_requirements_or_unavailable:
      "The current model was unavailable or below the task requirements.",
    uncertainty_changes_model_continuity:
      "Uncertainty about task continuity could change the model selection.",
    router_unavailable: "Jev routing is unavailable.",
    context_budget_exceeded: "The routing context exceeded Jev's safe request budget.",
    unsupported_or_failed_attempt_downgrade:
      "The recommendation would be an unsupported downgrade after a failed attempt.",
  };
  return labels[reason] ?? reason;
}

function recommendationReason(call: JevCall) {
  const reasons = new Set(call.result?.reasons ?? []);
  if (reasons.has("established_procedure_and_direct_check"))
    return "This follows an established procedure with a direct check.";
  if (reasons.has("interacting_correctness_invariant"))
    return "Correctness depends on several components or states working together.";
  if (reasons.has("conflicting_evidence"))
    return "The task requires reconciling conflicting evidence.";
  if (reasons.has("evidence_synthesis"))
    return "The task requires combining evidence into a coherent answer.";
  if (reasons.has("approach_requires_discovery"))
    return "The approach still needs to be investigated.";
  if (reasons.has("local_judgment")) return "The task requires some local judgment.";
  return "The recommendation meets the capability and effort required for this task.";
}

function reviewReason(call: JevCall) {
  const reasons = new Set(call.result?.reasons ?? []);
  if (reasons.has("uncertainty_changes_model_continuity"))
    return "Jev was unsure whether this continues the current task, and that could change the model choice.";
  if (reasons.has("uncertainty_changes_required_capability"))
    return "Different plausible interpretations could require a stronger model or more context.";
  if (reasons.has("model_demand_disagreement"))
    return "The raw classifier proposal and the assessed task requirements disagreed.";
  if (reasons.has("context_omissions_require_review"))
    return "Some relevant context was unavailable to the routing assessment.";
  if (reasons.has("failed_attempt_model_unknown"))
    return "Jev could not identify the model used for the earlier failed attempt.";
  return call.result?.error ?? "Jev needs you to confirm the model before sending.";
}

function JevReviewCard({ call }: { call: JevCall }) {
  const [alternative, setAlternative] = useState("");
  const [choosingAlternative, setChoosingAlternative] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const { resolveReview, cancelPending } = useJevStore();
  const suggestedKey = call.result?.recommendedChoice ?? call.result?.choice;
  const suggested = call.request.candidates.find((candidate) => candidate.key === suggestedKey);
  const unavailable = call.result?.policyOutcome === "unavailable";
  const missingKey = call.result?.error?.includes("OpenRouter key") ?? false;
  const currentModel = call.request.context.currentModel;
  const currentEffort = call.request.context.currentEffort;
  const sameModel = suggested?.model === currentModel;
  const recommendationTitle = suggested
    ? sameModel
      ? `Keep ${modelLabel(suggested.model)}`
      : `Switch to ${modelLabel(suggested.model)}`
    : "No recommendation available";
  const recommendationDelta = suggested
    ? sameModel
      ? currentEffort === suggested.effort
        ? effortLabel(suggested.effort)
        : `${effortLabel(currentEffort)} → ${effortLabel(suggested.effort)}`
      : `${pairLabel(currentModel, currentEffort)} → ${pairLabel(suggested.model, suggested.effort)}`
    : null;
  const alternativeCandidate = call.request.candidates.find(
    (candidate) => candidate.key === alternative,
  );
  return (
    <section
      aria-label="Review Jev recommendation"
      className="flex max-h-[calc(100dvh-var(--workspace-topbar-height,3rem)-8rem)] min-h-0 flex-col overflow-hidden rounded-xl border border-primary/35 bg-muted/15 shadow-xs"
    >
      <div
        data-testid="jev-review-scroll-body"
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4"
      >
        <div className="flex items-center gap-2 text-warning-foreground">
          <CircleAlertIcon className="size-4 shrink-0" />
          <p className="text-sm font-semibold">
            {unavailable ? "Jev routing unavailable" : "Review required"}
          </p>
        </div>
        {call.receiptContext && (
          <p className="text-xs font-medium text-muted-foreground">
            {call.threadLabel ?? `Thread ${call.receiptContext.threadId.slice(0, 8)}`}
          </p>
        )}

        <div className="rounded-lg border border-border/70 bg-background/70 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-medium text-muted-foreground">Message to send</p>
            {call.request.prompt.length > 240 && (
              <button
                type="button"
                className="text-[11px] font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => setPromptExpanded(!promptExpanded)}
              >
                {promptExpanded ? "Show less" : "Show more"}
              </button>
            )}
          </div>
          <p
            className={`mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/85 ${promptExpanded ? "" : "line-clamp-4"}`}
          >
            {call.request.prompt}
          </p>
        </div>

        {unavailable ? (
          <div role="alert" className="space-y-2 rounded-lg bg-warning/10 p-3 text-xs">
            <p>{call.result?.error ?? "Jev could not produce a routing decision."}</p>
            {missingKey && (
              <p>
                Add the key in Settings &gt; General &gt; Jev Auto routing, then enable Jev again.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Recommendation</p>
              <p className="mt-1 text-base font-semibold tracking-tight">{recommendationTitle}</p>
              {recommendationDelta && (
                <p className="mt-0.5 text-xs text-secondary-label">{recommendationDelta}</p>
              )}
            </div>
            <div className="grid gap-3 border-t border-border/60 pt-3 text-xs">
              <div>
                <p className="font-medium">Why</p>
                <p className="mt-1 leading-relaxed text-secondary-label">
                  {recommendationReason(call)}
                </p>
              </div>
              <div>
                <p className="font-medium text-warning-foreground">Why review is needed</p>
                <p className="mt-1 leading-relaxed text-secondary-label">{reviewReason(call)}</p>
              </div>
            </div>
          </div>
        )}

        {choosingAlternative && (
          <div className="space-y-2 rounded-lg bg-muted/35 p-3">
            <Select
              value={alternative || null}
              onValueChange={(value) => setAlternative(value ?? "")}
            >
              <SelectTrigger size="sm" aria-label="Choose another model and effort">
                <SelectValue>Choose a compatible pair</SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {call.request.candidates.map((candidate) => (
                  <SelectItem key={candidate.key} value={candidate.key}>
                    {pairLabel(candidate.model, candidate.effort)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <Button
              className="w-full"
              size="sm"
              variant="outline"
              disabled={!alternativeCandidate}
              onClick={() => resolveReview(call.id, "alternative", alternative)}
            >
              {alternativeCandidate
                ? `Send with ${pairLabel(alternativeCandidate.model, alternativeCandidate.effort)}`
                : "Select a model and effort"}
            </Button>
          </div>
        )}

        <details className="text-xs text-secondary-label">
          <summary className="cursor-pointer rounded-sm py-1 font-medium text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
            How Jev decided
          </summary>
          <div className="mt-2 space-y-2 rounded-lg bg-muted/30 p-3 leading-relaxed">
            <p>
              Policy recommendation:{" "}
              {suggested ? pairLabel(suggested.model, suggested.effort) : "Unavailable"}
            </p>
            <p>Raw classifier proposal: {proposalLabel(call)}</p>
            <p>
              Classifier confidence: model{" "}
              {call.result?.modelConfidence?.toFixed(2) ?? "unavailable"}
              {" · "}effort {call.result?.effortConfidence?.toFixed(2) ?? "unavailable"}
              {" · "}task assessment {call.result?.confidence?.toFixed(2) ?? "unavailable"}
            </p>
            <p>Policy outcome: {call.result?.policyOutcome ?? "unknown"}</p>
            {call.result?.reasons?.map((reason) => (
              <p key={reason}>{reasonLabel(reason)}</p>
            ))}
            {call.request.context.missingContext?.map((missing) => (
              <p key={missing}>Missing: {missing}</p>
            ))}
            {call.result?.explanation && <p>{call.result.explanation}</p>}
            <p>These confidence values are classifier signals, not task-success probabilities.</p>
          </div>
        </details>
      </div>
      <div
        data-testid="jev-review-actions"
        className="shrink-0 space-y-2 border-t border-border/60 bg-background px-4 py-3 shadow-[0_-8px_20px_-16px_rgba(0,0,0,0.8)]"
      >
        {suggested && (
          <Button
            className="w-full"
            size="sm"
            disabled={Boolean(
              call.result?.admissibleCandidateKeys &&
              !call.result.admissibleCandidateKeys.includes(suggested.key),
            )}
            onClick={() => resolveReview(call.id, "suggestion")}
          >
            Send with {pairLabel(suggested.model, suggested.effort)}
          </Button>
        )}
        <Button
          className="w-full"
          size="sm"
          variant="outline"
          onClick={() => resolveReview(call.id, "current")}
        >
          Keep {pairLabel(currentModel, currentEffort)}
        </Button>
        <div className="flex items-center justify-between gap-2">
          <Button
            size="sm"
            variant="ghost-muted"
            aria-expanded={choosingAlternative}
            onClick={() => setChoosingAlternative(!choosingAlternative)}
          >
            {unavailable ? "Choose model" : "Choose another"}
          </Button>
          <Button
            size="sm"
            variant="ghost-muted"
            onClick={() => cancelPending({ requestId: call.id })}
          >
            Cancel send
          </Button>
        </div>
      </div>
    </section>
  );
}

export function JevPanel() {
  const {
    enabled,
    setEnabled,
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
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  if (!isElectron || !panelOpen) return null;
  const pending = calls.some((call) => call.status === "pending");
  const reviewCalls = calls.filter((call) => call.status === "awaiting-review");
  const logCalls = calls.filter((call) => call.status !== "awaiting-review");
  const failedLogCount = logCalls.filter(
    (call) => call.status === "blocked" || call.status === "dispatch-failed",
  ).length;
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
          notice: status?.secureStorageAvailable
            ? "Add an OpenRouter key in Settings > General > Jev Auto routing before enabling Jev."
            : "Jev cannot be enabled because secure OS credential storage is unavailable.",
        });
        return;
      }
      setEnabled(true);
    } catch {
      useJevStore.setState({
        notice: "Could not verify Jev's OpenRouter credential. Jev remains off.",
      });
    } finally {
      setCheckingStatus(false);
    }
  };
  return (
    <aside
      id="jev-routing-panel"
      aria-label="Jev routing calls"
      className="flex h-full min-h-0 min-w-0 w-[min(25rem,42%)] shrink-0 flex-col gap-4 overflow-hidden border-l bg-background p-4 pt-[calc(var(--workspace-topbar-height,3rem)+1rem)] [overflow-wrap:anywhere]"
    >
      <div className="shrink-0 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <RouteIcon className="size-4 text-primary" />
              <h2 className="text-sm font-semibold tracking-tight">Jev</h2>
              <span
                className={`size-1.5 rounded-full ${enabled ? "bg-success" : "bg-muted-foreground/50"}`}
              />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {enabled
                ? `${mode === "guided" ? "Guided" : "Automatic"} routing is on`
                : "Routing is off"}
            </p>
          </div>
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
            <Button
              type="button"
              variant="ghost-muted"
              size="icon-xs"
              onClick={() => setPanelOpen(false)}
              aria-label="Close Jev panel"
            >
              <XIcon className="size-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-muted/35 p-2">
          <Button
            className="min-w-20"
            size="sm"
            variant={enabled ? "secondary" : "outline"}
            disabled={checkingStatus}
            aria-pressed={enabled}
            onClick={() => void toggleEnabled()}
          >
            {checkingStatus ? "Checking…" : enabled ? "Jev on" : "Turn on"}
          </Button>
          <Select value={mode} onValueChange={(value) => setMode(value as "guided" | "auto")}>
            <SelectTrigger size="sm" aria-label="Jev routing mode">
              <SelectValue>
                {mode === "guided" ? "Guided · review every pick" : "Automatic"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              <SelectItem value="guided">Guided · review every pick</SelectItem>
              <SelectItem value="auto">Automatic</SelectItem>
            </SelectPopup>
          </Select>
        </div>
        {notice && (
          <p role="status" className="text-xs">
            {notice}
          </p>
        )}
        {pending && (
          <button
            type="button"
            className="text-xs"
            onClick={() => {
              cancelPending();
              if (calls.some((call) => call.status === "pending" && call.kind === "subagent"))
                setSubagentsEnabled(false);
            }}
          >
            Cancel all routing
          </button>
        )}
      </div>
      {reviewCalls.length > 0 && (
        <div className="flex min-h-0 max-h-[35%] shrink-0 flex-col gap-3 overflow-y-auto overscroll-contain">
          {reviewCalls.map((call) => (
            <JevReviewCard key={call.id} call={call} />
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain">
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
            Capability first, then expected completion time and rework, then remaining quota.
            Profiles are starting guidance, not measured success rates or speed benchmarks.
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
          toggle off stops routing calls. Full-history forks retain their parent model. Child
          routing remains automatic with its policy guard, even in Guided mode; guided review
          applies to your messages. Other providers are unsupported.
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
      </div>
      <div
        className={`flex min-h-0 ${reviewCalls.length > 0 ? "max-h-[25%]" : "max-h-[45%]"} shrink-0 flex-col gap-3 overflow-hidden`}
      >
        <section
          className="flex min-h-8 flex-1 flex-col border-t border-border/60 pt-3"
          aria-label="Routing logs"
        >
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-sm text-left text-xs font-semibold focus-visible:outline-2 focus-visible:outline-ring"
            aria-expanded={logsOpen}
            aria-controls="jev-routing-logs"
            onClick={() => setLogsOpen((open) => !open)}
          >
            <span>Routing logs ({logCalls.length})</span>
            <span className="flex items-center gap-2">
              {failedLogCount > 0 && (
                <span className="font-normal text-warning-foreground">{failedLogCount} failed</span>
              )}
              <ChevronDownIcon
                className={`size-3.5 transition-transform ${logsOpen ? "rotate-180" : ""}`}
              />
            </span>
          </button>
          <div id="jev-routing-logs" className="min-h-0 overflow-y-auto overscroll-contain">
            {logsOpen && (
              <div className="mt-3 space-y-2 pr-1">
                {logCalls.length === 0 && (
                  <p className="text-xs text-muted-foreground">No routing calls this session.</p>
                )}
                {logCalls.map((call) => (
                  <details key={call.id} className="rounded border p-2 text-xs">
                    <summary className="cursor-pointer">
                      {new Date(call.createdAt).toLocaleTimeString()} ·{" "}
                      {call.receiptContext &&
                        `${call.threadLabel ?? `Thread ${call.receiptContext.threadId.slice(0, 8)}`} · `}
                      {call.request.context.interactionMode === "subagent-status"
                        ? "local setup · "
                        : call.kind === "subagent"
                          ? "subagent · "
                          : ""}
                      {call.status}{" "}
                      {call.result && `· ${call.result.latencyMs} ms · ${callModelLabel(call)}`}
                    </summary>
                    {call.notice && <p className="mt-2">{call.notice}</p>}
                    {(call.result?.recommendedChoice ?? call.result?.choice) && (
                      <p className="mt-2">
                        Policy recommendation:{" "}
                        {
                          call.request.candidates.find(
                            (candidate) =>
                              candidate.key ===
                              (call.result?.recommendedChoice ?? call.result?.choice),
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
                          ? call.request.candidates.find(
                              (candidate) => candidate.key === call.approvedChoice,
                            )?.description
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
                        · Raw model-proposal confidence: {call.result.modelConfidence ?? "unknown"}{" "}
                        · Raw effort-proposal confidence:{" "}
                        {call.result.effortConfidence ?? "unknown"} (not task success probabilities)
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
              </div>
            )}
          </div>
        </section>
        <div className="min-h-8 max-h-32 overflow-y-auto overscroll-contain border-t border-border/60 pt-3">
          <JevEvaluation />
        </div>
      </div>
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
