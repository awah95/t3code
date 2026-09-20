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
  useEffect(listenForJevSubagents, []);
  if (!isElectron) return null;
  const pending = calls.some((call) => call.status === "pending");
  return (
    <>
      <button
        type="button"
        aria-pressed={enabled}
        onClick={() => setEnabled(!enabled)}
        aria-label="Jev Auto: choose a compatible model within the selected provider. Task text, recent chat history and plan context are sent to OpenRouter."
        className={`rounded-md border px-2 py-1 text-xs ${enabled ? "border-primary text-primary" : "text-muted-foreground"}`}
      >
        Jev {mode === "guided" ? "Guided" : "Auto"} {enabled ? "On" : "Off"}
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

function JevReviewCard({ call }: { call: JevCall }) {
  const [alternative, setAlternative] = useState("");
  const { resolveReview, cancelPending } = useJevStore();
  const suggestedKey = call.result?.recommendedChoice ?? call.result?.choice;
  const suggested = call.request.candidates.find((candidate) => candidate.key === suggestedKey);
  return (
    <section
      aria-label="Review Jev recommendation"
      className="space-y-3 rounded-md border border-primary/50 p-3 text-xs"
    >
      <p className="font-medium">Review before sending</p>
      <p className="whitespace-pre-wrap">
        {call.request.prompt.slice(0, 240)}
        {call.request.prompt.length > 240 ? "… (full prompt in log)" : ""}
      </p>
      <p>
        Suggested:{" "}
        {suggested
          ? `${suggested.model ?? suggested.description} · ${suggested.effort ?? "default effort"}`
          : "No valid recommendation"}
      </p>
      <p>
        Selection confidence: {call.result?.confidence?.toFixed(2) ?? "unavailable"}. This is not
        task success probability.
      </p>
      {call.result?.explanation && <p>{call.result.explanation}</p>}
      <p>
        Current: {call.request.context.currentModel ?? "your selected model"} ·{" "}
        {call.request.context.currentEffort ?? "default effort"}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!suggested}
          onClick={() => resolveReview(call.id, "suggestion")}
        >
          Use suggestion
        </Button>
        <Button size="sm" variant="outline" onClick={() => resolveReview(call.id, "current")}>
          Use current selection
        </Button>
      </div>
      <label className="flex flex-col gap-1">
        Choose another model and effort
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
      {calls
        .filter((call) => call.status === "awaiting-review")
        .map((call) => (
          <JevReviewCard key={call.id} call={call} />
        ))}
      <p className="text-xs text-muted-foreground">
        Latest 50 calls, kept in memory. Full current prompts, up to ten recent chat exchanges,
        original task and agreed plan context are shared with OpenRouter. Common credentials are
        redacted; review sensitive content before sending.
      </p>
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
        routing hook in Codex settings. Subagent task text and parent chat context are sent to
        OpenRouter. Turning either toggle off stops routing calls. Full-history forks retain their
        parent model. Child routing remains automatic with its confidence guard, even in Guided
        mode; guided review applies to your messages. Other providers are unsupported.
      </p>
      <p className="text-xs">
        Session: billed ${billedUsd.toFixed(8)} · estimated ${estimatedUsd.toFixed(8)} ·{" "}
        {unknownCostCalls} calls with unknown cost. Totals survive clearing the log.
      </p>
      {notice && (
        <p role="status" className="text-xs">
          {notice}
        </p>
      )}
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
            {call.status} {call.result && `· ${call.result.latencyMs} ms`}
          </summary>
          {call.notice && <p className="mt-2">{call.notice}</p>}
          {(call.result?.recommendedChoice ?? call.result?.choice) && (
            <p className="mt-2">
              Jev recommendation:{" "}
              {
                call.request.candidates.find(
                  (candidate) =>
                    candidate.key === (call.result?.recommendedChoice ?? call.result?.choice),
                )?.description
              }
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
              · Confidence: {call.result.confidence ?? "unknown"} (model statistic)
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
        profiles and available quota snapshots. Raw tool logs, internal reasoning and attachment
        bodies are excluded. History may be shortened with explicit omissions; current prompts are
        never silently shortened.
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
