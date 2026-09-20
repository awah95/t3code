import { useEffect, useState } from "react";
import { isElectron } from "../env";
import { listenForJevSubagents, useJevStore } from "./jevStore";

export function JevControls() {
  const {
    enabled,
    setEnabled,
    panelOpen,
    setPanelOpen,
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
  useEffect(listenForJevSubagents, []);
  if (!isElectron) return null;
  const pending = calls.some((call) => call.status === "pending");
  return (
    <>
      <button
        type="button"
        aria-pressed={enabled}
        onClick={() => setEnabled(!enabled)}
        aria-label="Jev Auto: choose a compatible model within the selected provider. Task text is sent to OpenRouter."
        className={`rounded-md border px-2 py-1 text-xs ${enabled ? "border-primary text-primary" : "text-muted-foreground"}`}
      >
        Jev Auto {enabled ? "On" : "Off"}
      </button>
      <button
        type="button"
        onClick={() => setPanelOpen(!panelOpen)}
        aria-expanded={panelOpen}
        className="rounded-md px-2 py-1 text-xs text-muted-foreground"
      >
        {pending ? "Routing…" : "Jev calls"}
      </button>
      {panelOpen && (
        <aside
          aria-label="Jev routing calls"
          className="fixed right-3 top-14 z-50 flex max-h-[80vh] w-96 max-w-[90vw] flex-col gap-3 overflow-auto rounded-lg border bg-background p-4 shadow-xl"
        >
          <div className="flex items-center justify-between text-sm font-medium">
            <span>Jev routing · session log</span>
            <button type="button" onClick={() => setPanelOpen(false)} aria-label="Close Jev calls">
              Close
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Latest 50 calls, kept in memory. Task text is truncated and common credentials are
            redacted; review prompts before sending sensitive content.
          </p>
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
            routing hook in Codex settings. Subagent task text is sent to OpenRouter. Turning either
            toggle off stops routing calls. Full-history forks retain their parent model. Other
            providers are unsupported.
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
            <button type="button" onClick={clearCalls}>
              Clear log
            </button>
          </div>
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
              {call.result?.choice && (
                <p className="mt-2">
                  Selected:{" "}
                  {call.request.candidates.find(
                    (candidate) => candidate.key === call.result?.choice,
                  )?.description ?? call.result.choice}
                </p>
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
      )}
    </>
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
        Jev chooses among configured models within your selected provider instance. Enable it in the
        chat header. OpenRouter receives task text and eligible model descriptions; attachments,
        terminal output and conversation history are excluded.
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
