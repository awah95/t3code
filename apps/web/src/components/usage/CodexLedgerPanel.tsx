import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  CodexLedgerRateSnapshot,
  type CodexLedgerQuotaResult,
  type CodexLedgerTurn,
  type EnvironmentId,
} from "@t3tools/contracts";
import {
  ledgerCacheFraction,
  ledgerCoverageLabel,
  ledgerEstimate,
  ledgerTokenCount,
} from "@t3tools/client-runtime/state/codex-ledger-presentation";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useContext, useRef, useState } from "react";

import { serverEnvironment } from "../../state/server";
import { randomUUID } from "../../lib/utils";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";

const PAGE_SIZE = 40;
type QuotaItem = (typeof CodexLedgerQuotaResult.Type)["items"][number];

export function CodexLedgerPanel({
  environmentId,
  label,
}: {
  environmentId: EnvironmentId;
  label: string;
}) {
  const [cursor, setCursor] = useState<string | undefined>();
  const [history, setHistory] = useState<CodexLedgerTurn[]>([]);
  const [quotaCursor, setQuotaCursor] = useState<string | undefined>();
  const [quotaHistory, setQuotaHistory] = useState<readonly QuotaItem[]>([]);
  const [selected, setSelected] = useState<CodexLedgerTurn | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const exportCancelled = useRef(false);
  const [exporting, setExporting] = useState(false);
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const registry = useContext(RegistryContext);
  const summaryAtom = serverEnvironment.codexLedgerSummary({ environmentId, input: {} });
  const summaryResult = useAtomValue(summaryAtom);
  const summary = Option.getOrNull(AsyncResult.value(summaryResult));
  const pageResult = useAtomValue(
    serverEnvironment.codexLedgerTurns({
      environmentId,
      input: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) },
    }),
  );
  const page = Option.getOrNull(AsyncResult.value(pageResult));
  const quota = Option.getOrNull(
    AsyncResult.value(
      useAtomValue(
        serverEnvironment.codexLedgerQuota({
          environmentId,
          input: { limit: 20, ...(quotaCursor ? { cursor: quotaCursor } : {}) },
        }),
      ),
    ),
  );
  const rateSnapshots = Option.getOrNull(
    AsyncResult.value(
      useAtomValue(serverEnvironment.codexLedgerRateSnapshots({ environmentId, input: {} })),
    ),
  );
  const capture = useAtomCommand(serverEnvironment.setCodexLedgerCapture, { reportFailure: false });
  const exportPage = useAtomCommand(serverEnvironment.exportCodexLedger, { reportFailure: false });
  const turns = [...history, ...(page?.items ?? [])];
  const quotaItems = [...quotaHistory, ...(quota?.items ?? [])];

  const download = async () => {
    exportCancelled.current = false;
    setExporting(true);
    let next: string | null = null;
    let data = "";
    let pages = 0;
    do {
      if (exportCancelled.current) {
        setNotice("Export cancelled.");
        setExporting(false);
        return;
      }
      const result = await exportPage({
        environmentId,
        input: {
          format: "jsonl",
          limit: 200,
          ...(next ? { cursor: next } : {}),
          ...(exportFrom ? { from: `${exportFrom}T00:00:00.000Z` } : {}),
          ...(exportTo ? { to: `${exportTo}T23:59:59.999Z` } : {}),
        },
      });
      if (result._tag !== "Success") {
        setNotice("Export stopped before completion. Please retry.");
        setExporting(false);
        return;
      }
      data += result.value.data;
      next = result.value.nextCursor;
      pages += 1;
      setNotice(`Exporting facts · ${pages * 200} rows requested`);
    } while (next !== null);
    const url = URL.createObjectURL(new Blob([data], { type: "application/x-ndjson" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "codex-usage-ledger.jsonl";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Exported canonical ledger facts as JSONL.");
    setExporting(false);
  };

  return (
    <section className="space-y-5" aria-label={`Codex ledger for ${label}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Codex ledger · {label}</h2>
          <p className="text-sm text-muted-foreground">
            Reported model work and Standard API equivalent estimates. Subscription limits are
            account snapshots, not turn charges.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => (exporting ? (exportCancelled.current = true) : void download())}
          >
            {exporting ? "Cancel export" : "Export JSONL"}
          </Button>
          {summary ? (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const result = await capture({
                  environmentId,
                  input: { active: summary.captureState !== "active" },
                });
                setNotice(
                  result._tag === "Success"
                    ? `Capture ${result.value.captureState}.`
                    : "Could not update capture.",
                );
                if (result._tag === "Success") registry.refresh(summaryAtom);
              }}
            >
              {summary.captureState === "active" ? "Pause capture" : "Resume capture"}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <label>
          Export from{" "}
          <input
            type="date"
            className="rounded border px-2 py-1"
            value={exportFrom}
            onChange={(event) => setExportFrom(event.target.value)}
          />
        </label>
        <label>
          Export through{" "}
          <input
            type="date"
            className="rounded border px-2 py-1"
            value={exportTo}
            onChange={(event) => setExportTo(event.target.value)}
          />
        </label>
      </div>
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {summaryResult._tag === "Failure" && summary ? (
        <p role="alert" className="text-sm text-amber-600">
          Showing the last ledger result; this environment is currently unavailable.
        </p>
      ) : null}
      {summary === null ? (
        <p className="text-sm text-muted-foreground">
          {summaryResult._tag === "Failure"
            ? "This environment cannot report Codex ledger data. Check its server version or connection."
            : "Loading ledger…"}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <Fact
            label="API-equivalent estimate"
            value={ledgerEstimate(summary.valuation)}
            detail={
              summary.valuation.unpricedResponseCount > 0
                ? `${summary.valuation.unpricedResponseCount} unpriced responses`
                : "Standard API scenario"
            }
          />
          <Fact
            label="Processed tokens"
            value={ledgerTokenCount(summary.tokens.processedTokens)}
            detail={`${summary.responseCount} reported responses · ${summary.turnCount} turns`}
          />
          <Fact
            label="Cached input"
            value={ledgerCacheFraction(summary.tokens)}
            detail={`${ledgerTokenCount(summary.tokens.cachedInputTokens)} read tokens`}
          />
        </div>
      )}
      {summary ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>
            Coverage: {ledgerCoverageLabel(summary.coverage)}. {summary.missingUsageTurnCount} turns
            without usage; {summary.conflictCount} conflicts.
          </p>
          <p>
            Rate snapshot: {summary.valuation.snapshotId ?? "Unknown"}.{" "}
            {summary.valuation.missingPriceReasons.join("; ")}
          </p>
          {rateSnapshots?.items.find(
            (snapshot) => snapshot.snapshotId === summary.valuation.snapshotId,
          ) ? (
            <p>
              Pricing source:{" "}
              <a
                href={
                  rateSnapshots.items.find(
                    (snapshot) => snapshot.snapshotId === summary.valuation.snapshotId,
                  )?.sourceUrl
                }
                className="underline"
                target="_blank"
                rel="noreferrer"
              >
                published rates
              </a>{" "}
              · captured{" "}
              {
                rateSnapshots.items.find(
                  (snapshot) => snapshot.snapshotId === summary.valuation.snapshotId,
                )?.capturedAt
              }
            </p>
          ) : null}
          {summary.sources.map((source, index) => (
            <p key={source.sourceDomain}>
              Capture source {index + 1}: {source.state}
              {source.lastCapturedAt
                ? ` · captured ${new Date(source.lastCapturedAt).toLocaleString()}`
                : " · no capture yet"}
              {source.lastError ? ` · ${source.lastError}` : ""}
            </p>
          ))}
        </div>
      ) : null}
      <WebRateSnapshots
        environmentId={environmentId}
        snapshots={rateSnapshots?.items ?? []}
        onChanged={() => {
          registry.refresh(summaryAtom);
          registry.refresh(
            serverEnvironment.codexLedgerRateSnapshots({ environmentId, input: {} }),
          );
          registry.refresh(
            serverEnvironment.codexLedgerTurns({ environmentId, input: { limit: PAGE_SIZE } }),
          );
          setSelected(null);
          setHistory([]);
          setCursor(undefined);
        }}
      />
      <div className="space-y-2">
        <h3 className="font-medium">Turns</h3>
        {turns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {pageResult._tag === "Failure"
              ? "Could not load turns from this environment."
              : page === null
                ? "Loading turns…"
                : "No captured Codex turns yet."}
          </p>
        ) : (
          turns.map((turn) => (
            <button
              key={`${turn.identity.sourceDomain}:${turn.identity.codexThreadId}:${turn.identity.codexTurnId}`}
              type="button"
              onClick={() => setSelected(turn)}
              className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-left hover:bg-muted/40"
            >
              <span className="min-w-0">
                <strong className="block truncate text-sm">
                  {turn.model ?? "Model unknown"} · {turn.scope} · {turn.lifecycle}
                </strong>
                <span className="text-xs text-muted-foreground">
                  {new Date(turn.startedAt).toLocaleString()} · {turn.responseCount} responses ·{" "}
                  {turn.childTurnCount} children
                </span>
              </span>
              <span className="text-right text-sm tabular-nums">
                {ledgerEstimate(turn.valuation)}
                <span className="block text-xs text-muted-foreground">
                  {ledgerTokenCount(turn.tokens.processedTokens)} tokens
                </span>
              </span>
            </button>
          ))
        )}
        {page?.nextCursor ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setHistory(turns);
              setCursor(page.nextCursor ?? undefined);
            }}
          >
            Load more
          </Button>
        ) : null}
      </div>
      {selected ? (
        <LedgerTurnDetail
          key={`${selected.identity.codexThreadId}:${selected.identity.codexTurnId}`}
          environmentId={environmentId}
          turn={selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
      <div className="space-y-2">
        <h3 className="font-medium">Account allowance observations</h3>
        <p className="text-xs text-muted-foreground">
          Changes across resets or concurrent threads cannot be assigned to one turn.
        </p>
        {quotaItems.length ? (
          quotaItems.map((item) => (
            <p
              key={`${item.sourceDomain}:${item.bucketId}:${item.observedAt}`}
              className="rounded-md border px-3 py-2 text-sm"
            >
              {item.bucketId}: {item.usedPercent === null ? "Unknown" : `${item.usedPercent}% used`}{" "}
              · {new Date(item.observedAt).toLocaleString()} ·{" "}
              {item.windowDurationMins === null
                ? "window unknown"
                : `${item.windowDurationMins} minute window`}
              {item.resetsAt ? ` · resets ${new Date(item.resetsAt).toLocaleString()}` : ""}
            </p>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No allowance snapshots captured.</p>
        )}
        {quota?.nextCursor ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setQuotaHistory(quotaItems);
              setQuotaCursor(quota.nextCursor ?? undefined);
            }}
          >
            Older observations
          </Button>
        ) : null}
      </div>
      <LedgerExperiments environmentId={environmentId} turns={turns} />
    </section>
  );
}

function Fact({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function WebRateSnapshots({
  environmentId,
  snapshots,
  onChanged,
}: {
  environmentId: EnvironmentId;
  snapshots: readonly (typeof CodexLedgerRateSnapshot.Type)[];
  onChanged: () => void;
}) {
  const [rulesJson, setRulesJson] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const create = useAtomCommand(serverEnvironment.createCodexLedgerRateSnapshot, {
    reportFailure: false,
  });
  const select = useAtomCommand(serverEnvironment.selectCodexLedgerRateSnapshot, {
    reportFailure: false,
  });
  return (
    <section className="space-y-2 rounded-xl border p-3">
      <h3 className="font-medium">Rate scenario</h3>
      <p className="text-xs text-muted-foreground">
        Rates are immutable Standard API assumptions. Selecting an older snapshot restores its
        valuation without changing measured usage.
      </p>
      <div className="flex flex-wrap gap-2">
        {snapshots.map((snapshot) => (
          <Button
            key={snapshot.snapshotId}
            variant="outline"
            size="sm"
            disabled={snapshot.active}
            onClick={async () => {
              const result = await select({
                environmentId,
                input: { snapshotId: snapshot.snapshotId },
              });
              setNotice(
                result._tag === "Success"
                  ? "Rate scenario selected."
                  : "Could not select rate scenario.",
              );
              if (result._tag === "Success") onChanged();
            }}
          >
            {snapshot.snapshotId}
            {snapshot.active ? " · current" : " · select"}
          </Button>
        ))}
      </div>
      <details>
        <summary className="cursor-pointer text-sm">Create rate override</summary>
        <p className="text-xs text-muted-foreground">
          Copy a snapshot, assign a new ID and retrieval date, then edit model rates and source
          URLs. USD per million tokens; tier assumption must be standard.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const current = snapshots.find((snapshot) => snapshot.active) ?? snapshots[0];
            if (!current) return;
            const base = JSON.parse(current.rulesJson) as Record<string, unknown>;
            setRulesJson(
              JSON.stringify(
                {
                  ...base,
                  id: `${current.snapshotId}-override-${Date.now()}`,
                  retrievedOn: new Date().toISOString().slice(0, 10),
                },
                null,
                2,
              ),
            );
          }}
        >
          Copy current rules
        </Button>
        <textarea
          aria-label="Rate snapshot JSON"
          className="mt-2 h-52 w-full rounded border bg-background p-2 font-mono text-xs"
          value={rulesJson}
          onChange={(event) => setRulesJson(event.target.value)}
        />
        <Button
          size="sm"
          disabled={!rulesJson.trim()}
          onClick={async () => {
            try {
              const parsed = JSON.parse(rulesJson) as { id?: unknown };
              if (typeof parsed.id !== "string") throw new Error("A snapshot ID is required.");
              const result = await create({
                environmentId,
                input: { snapshotId: parsed.id, rulesJson },
              });
              setNotice(
                result._tag === "Success"
                  ? "Rate override saved. Select it to revalue the ledger."
                  : "Could not save rate override. Check rates, source URLs, date, and unique ID.",
              );
              if (result._tag === "Success") onChanged();
            } catch (error) {
              setNotice(error instanceof Error ? error.message : "Invalid JSON.");
            }
          }}
        >
          Save immutable snapshot
        </Button>
      </details>
      {notice ? (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

function LedgerTurnDetail({
  environmentId,
  turn,
  onClose,
}: {
  environmentId: EnvironmentId;
  turn: CodexLedgerTurn;
  onClose: () => void;
}) {
  const detailResult = useAtomValue(
    serverEnvironment.codexLedgerTurn({
      environmentId,
      input: {
        sourceDomain: turn.identity.sourceDomain,
        codexThreadId: turn.identity.codexThreadId,
        codexTurnId: turn.identity.codexTurnId,
      },
    }),
  );
  const detail = Option.getOrNull(AsyncResult.value(detailResult));
  const selectedTurn = detail?.turn ?? turn;
  return (
    <section className="rounded-xl border bg-muted/20 p-4" aria-label="Turn details">
      <div className="flex justify-between">
        <h3 className="font-medium">Turn detail</h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border bg-background p-3">
          <p className="text-xs text-muted-foreground">Selected turn, excluding children</p>
          <p className="text-lg font-semibold tabular-nums">
            {ledgerEstimate(selectedTurn.valuation)}
          </p>
          <p className="text-xs text-muted-foreground">
            {ledgerTokenCount(selectedTurn.tokens.processedTokens)} processed tokens ·{" "}
            {ledgerCoverageLabel(selectedTurn.coverage)}
          </p>
        </div>
        <div className="rounded-lg border bg-background p-3">
          <p className="text-xs text-muted-foreground">
            Task family, including root-linked child work
          </p>
          <p className="text-lg font-semibold tabular-nums">
            {detail
              ? ledgerEstimate(detail.family.valuation)
              : detailResult._tag === "Failure"
                ? "Unavailable"
                : "Loading…"}
          </p>
          {detail ? (
            <p className="text-xs text-muted-foreground">
              {ledgerTokenCount(detail.family.tokens.processedTokens)} processed tokens ·{" "}
              {detail.family.includedTurnCount} included turns, {detail.family.childTurnCount}{" "}
              linked children · {ledgerCoverageLabel(detail.family.coverage)}
            </p>
          ) : null}
        </div>
      </div>
      {detail ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {detail.family.unresolvedChildCount > 0
            ? `${detail.family.unresolvedChildCount} child links unresolved. `
            : ""}
          {detail.family.activeChildTurnCount > 0
            ? `${detail.family.activeChildTurnCount} children still active. `
            : ""}
          {detail.family.valuation.completeEstimateUsd === null
            ? "Family dollars are a priced subtotal or unknown while coverage is incomplete."
            : ""}
        </p>
      ) : null}
      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <span>Input: {ledgerTokenCount(selectedTurn.tokens.inputTokens)}</span>
        <span>
          Cached reads: {ledgerTokenCount(selectedTurn.tokens.cachedInputTokens)} (
          {ledgerCacheFraction(selectedTurn.tokens)})
        </span>
        <span>Cache writes: {ledgerTokenCount(selectedTurn.tokens.cacheWriteTokens)}</span>
        <span>Output: {ledgerTokenCount(selectedTurn.tokens.outputTokens)}</span>
        <span>Reasoning subset: {ledgerTokenCount(selectedTurn.tokens.reasoningTokens)}</span>
        <span>Children: {selectedTurn.childTurnCount}</span>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Source {turn.identity.sourceDomain} · Codex turn {turn.identity.codexTurnId} · T3 turn{" "}
        {turn.identity.t3TurnId ?? "unlinked"}
      </p>
      {detail === null ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {detailResult._tag === "Failure"
            ? "Could not load family and response facts from this environment."
            : "Loading response facts…"}
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          <h4 className="text-sm font-medium">Response facts</h4>
          {detail.responses.map((response) => (
            <p
              key={response.responseId}
              className="rounded-md border bg-background px-3 py-2 text-xs"
            >
              {response.kind} · {response.model ?? "model unknown"} (
              {response.modelProvenance === "turnContext"
                ? "turn selection"
                : response.modelProvenance === "response"
                  ? "reported response model"
                  : "source unknown"}
              ) · {ledgerEstimate(response.valuation)} · {response.status}
              <span className="mt-1 block">
                Input {ledgerTokenCount(response.tokens.inputTokens)} · cached reads{" "}
                {ledgerTokenCount(response.tokens.cachedInputTokens)} (
                {ledgerCacheFraction(response.tokens)}) · writes{" "}
                {ledgerTokenCount(response.tokens.cacheWriteTokens)} · output{" "}
                {ledgerTokenCount(response.tokens.outputTokens)} · reasoning subset{" "}
                {ledgerTokenCount(response.tokens.reasoningTokens)}
              </span>
            </p>
          ))}
          {detail.childTurns.map((child) => (
            <p
              key={child.identity.codexTurnId}
              className="rounded-md border bg-background px-3 py-2 text-xs"
            >
              Child {child.identity.codexTurnId} · {ledgerTokenCount(child.tokens.processedTokens)}{" "}
              tokens · {ledgerEstimate(child.valuation)}
            </p>
          ))}
          {detail.family.childPreviewTruncated ? (
            <p className="text-xs text-muted-foreground">
              Only the first linked children are shown here. The family total includes all observed
              root-linked turns.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function LedgerExperiments({
  environmentId,
  turns,
}: {
  environmentId: EnvironmentId;
  turns: readonly CodexLedgerTurn[];
}) {
  const [name, setName] = useState("");
  const [experimentId, setExperimentId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const create = useAtomCommand(serverEnvironment.upsertCodexLedgerExperiment, {
    reportFailure: false,
  });
  const registry = useContext(RegistryContext);
  const listAtom = serverEnvironment.codexLedgerExperiments({ environmentId, input: {} });
  const experiments = Option.getOrNull(AsyncResult.value(useAtomValue(listAtom)));
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <h3 className="font-medium">Optimization experiments</h3>
      <p className="text-xs text-muted-foreground">
        Group comparable tasks and record acceptance evidence. API estimates alone do not establish
        subscription savings.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          className="min-w-48 rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="Experiment name"
          aria-label="Experiment name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button
          size="sm"
          disabled={!name.trim()}
          onClick={async () => {
            const id = randomUUID();
            const result = await create({
              environmentId,
              input: {
                experimentId: id,
                name: name.trim(),
                manifestJson: JSON.stringify({
                  acceptanceChecks: [],
                  taskCorpus: null,
                  baselineCohort: null,
                  comparisonCohort: null,
                  rateSnapshotId: null,
                }),
              },
            });
            if (result._tag === "Success") {
              setExperimentId(id);
              registry.refresh(listAtom);
              setNotice(
                "Experiment created. Define cases and acceptance checks before comparing runs.",
              );
            } else setNotice("Could not create experiment.");
          }}
        >
          Create experiment
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {experiments?.items.map((experiment) => (
          <Button
            key={experiment.experimentId}
            size="sm"
            variant="outline"
            onClick={() => setExperimentId(experiment.experimentId)}
          >
            {experiment.name}
          </Button>
        ))}
      </div>
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {experimentId ? (
        <ExperimentDetail
          key={experimentId}
          environmentId={environmentId}
          experimentId={experimentId}
          turns={turns}
        />
      ) : null}
    </section>
  );
}

function ExperimentDetail({
  environmentId,
  experimentId,
  turns,
}: {
  environmentId: EnvironmentId;
  experimentId: string;
  turns: readonly CodexLedgerTurn[];
}) {
  const registry = useContext(RegistryContext);
  const [editingRunId, setEditingRunId] = useState<string | null>(null);
  const [caseId, setCaseId] = useState("");
  const [cohort, setCohort] = useState("");
  const [rootTurnId, setRootTurnId] = useState("");
  const [sourceDomain, setSourceDomain] = useState("");
  const [rootLinks, setRootLinks] = useState<{ sourceDomain: string; rootTurnId: string }[]>([]);
  const [runMetadata, setRunMetadata] = useState<Record<string, unknown>>({});
  const [qualityAccepted, setQualityAccepted] = useState<boolean | null>(null);
  const [humanIntervention, setHumanIntervention] = useState<boolean | null>(null);
  const [jevEnabled, setJevEnabled] = useState<boolean | null>(null);
  const [wallTimeMs, setWallTimeMs] = useState("");
  const [status, setStatus] = useState<"planned" | "running" | "accepted" | "failed" | "unknown">(
    "planned",
  );
  const [evidence, setEvidence] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const detailAtom = serverEnvironment.codexLedgerExperiment({
    environmentId,
    input: { experimentId },
  });
  const detail = Option.getOrNull(AsyncResult.value(useAtomValue(detailAtom)));
  const upsertRun = useAtomCommand(serverEnvironment.upsertCodexLedgerRun, {
    reportFailure: false,
  });
  if (!detail) return <p className="text-sm text-muted-foreground">Loading experiment…</p>;
  const report = JSON.parse(detail.reportJson) as {
    cohorts: {
      cohort: string;
      caseCount: number;
      acceptedCaseCount: number;
      firstPassAcceptedCount: number;
      costPerAcceptedCaseUsd: string | null;
      combinedCostPerAcceptedCaseUsd: string | null;
      apiSubtotalUsd: string | null;
      unpricedResponseCount: number;
      coverageReasons: string[];
    }[];
    cases: {
      caseId: string;
      cohort: string;
      apiSubtotalUsd: string | null;
      jevReportedUsd: string | null;
      jevEstimatedUsd: string | null;
      jevUnknownCount: number;
      coverageReasons: string[];
    }[];
    pairedCaseCount: number;
    comparable: boolean;
    comparisonReasons: string[];
  };
  return (
    <div className="space-y-3 border-t pt-3">
      <h4 className="font-medium">{detail.experiment.name}</h4>
      <ExperimentManifestEditor
        key={detail.experiment.experimentId}
        environmentId={environmentId}
        experiment={detail.experiment}
        runCount={detail.runs.length}
        onSaved={() => registry.refresh(detailAtom)}
      />
      <div className="rounded-md border p-3 text-sm">
        <strong>Case outcomes under one rate snapshot</strong>
        <p className="text-xs text-muted-foreground">
          Paired cases are descriptive; they are not an independently random sample. Failed attempts
          and repair are included in accepted-case cost. Jev overhead remains separate.
        </p>
        {report.cohorts.map((item) => (
          <p key={item.cohort}>
            {item.cohort}: {item.acceptedCaseCount}/{item.caseCount} accepted,{" "}
            {item.firstPassAcceptedCount} first pass · API + Jev scenario cost per accepted case{" "}
            {item.combinedCostPerAcceptedCaseUsd === null
              ? "Unknown"
              : `$${item.combinedCostPerAcceptedCaseUsd}`}{" "}
            · Codex API component{" "}
            {item.costPerAcceptedCaseUsd === null ? "Unknown" : `$${item.costPerAcceptedCaseUsd}`}
            {item.unpricedResponseCount ? ` · ${item.unpricedResponseCount} unpriced` : ""}
          </p>
        ))}
        {report.cases.map((item) => (
          <p key={`${item.cohort}:${item.caseId}`} className="text-xs text-muted-foreground">
            {item.caseId} · {item.cohort} · Codex API subtotal{" "}
            {item.apiSubtotalUsd === null ? "Unknown" : `$${item.apiSubtotalUsd}`} · Jev billed{" "}
            {item.jevReportedUsd === null ? "Unknown" : `$${item.jevReportedUsd}`} · Jev estimated{" "}
            {item.jevEstimatedUsd === null ? "Unknown" : `$${item.jevEstimatedUsd}`}
            {item.jevUnknownCount ? ` · ${item.jevUnknownCount} overhead unknown` : ""}
            {item.coverageReasons.length ? ` · ${item.coverageReasons.join(", ")}` : ""}
          </p>
        ))}
        <p className="text-xs text-muted-foreground">
          {report.pairedCaseCount} paired cases ·{" "}
          {report.comparable ? "Comparable under declared coverage" : "Comparison inconclusive"}
          {report.comparisonReasons.length ? ` · ${report.comparisonReasons.join(", ")}` : ""}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          aria-label="Case ID"
          placeholder="Case ID"
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={caseId}
          onChange={(event) => setCaseId(event.target.value)}
        />
        <input
          aria-label="Cohort"
          placeholder="Cohort (baseline or candidate)"
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={cohort}
          onChange={(event) => setCohort(event.target.value)}
        />
        <select
          aria-label="Link captured turn"
          className="rounded-md border bg-background px-3 py-2 text-sm sm:col-span-2"
          value={`${sourceDomain}:${rootTurnId}`}
          onChange={(event) => {
            const turn = turns.find(
              (item) =>
                `${item.identity.sourceDomain}:${item.identity.rootTurnId ?? item.identity.codexTurnId}` ===
                event.target.value,
            );
            const rootTurnId = turn?.identity.rootTurnId ?? turn?.identity.codexTurnId ?? "";
            const sourceDomain = turn?.identity.sourceDomain ?? "";
            setRootTurnId(rootTurnId);
            setSourceDomain(sourceDomain);
            if (
              rootTurnId &&
              !rootLinks.some(
                (link) => link.sourceDomain === sourceDomain && link.rootTurnId === rootTurnId,
              )
            )
              setRootLinks([...rootLinks, { sourceDomain, rootTurnId }]);
          }}
        >
          <option value=":">No linked turn</option>
          {turns.map((turn) => (
            <option
              key={`${turn.identity.sourceDomain}:${turn.identity.codexTurnId}`}
              value={`${turn.identity.sourceDomain}:${turn.identity.rootTurnId ?? turn.identity.codexTurnId}`}
            >
              {turn.model ?? "Unknown model"} · {new Date(turn.startedAt).toLocaleString()} ·{" "}
              {turn.identity.codexTurnId}
            </option>
          ))}
        </select>
        <input
          aria-label="Source domain"
          placeholder="Source domain for an older turn"
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={sourceDomain}
          onChange={(event) => setSourceDomain(event.target.value)}
        />
        <input
          aria-label="Root turn ID"
          placeholder="Root turn ID"
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={rootTurnId}
          onChange={(event) => setRootTurnId(event.target.value)}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={!sourceDomain.trim() || !rootTurnId.trim()}
          onClick={() => {
            if (
              !rootLinks.some(
                (link) =>
                  link.sourceDomain === sourceDomain.trim() &&
                  link.rootTurnId === rootTurnId.trim(),
              )
            )
              setRootLinks([
                ...rootLinks,
                { sourceDomain: sourceDomain.trim(), rootTurnId: rootTurnId.trim() },
              ]);
          }}
        >
          Add root link
        </Button>
        <div className="flex flex-wrap gap-1 sm:col-span-2">
          {rootLinks.map((link) => (
            <Button
              key={`${link.sourceDomain}:${link.rootTurnId}`}
              variant="outline"
              size="sm"
              onClick={() => {
                setRootLinks(rootLinks.filter((item) => item !== link));
                if (rootTurnId === link.rootTurnId) {
                  setRootTurnId("");
                  setSourceDomain("");
                }
              }}
            >
              {link.rootTurnId} · detach
            </Button>
          ))}
        </div>
        <select
          aria-label="Run outcome"
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}
        >
          <option value="planned">Planned</option>
          <option value="running">Running</option>
          <option value="accepted">Accepted</option>
          <option value="failed">Failed</option>
          <option value="unknown">Unknown</option>
        </select>
        <textarea
          aria-label="Acceptance evidence"
          placeholder="Acceptance checks and evidence"
          className="rounded-md border bg-background px-3 py-2 text-sm sm:col-span-2"
          value={evidence}
          onChange={(event) => setEvidence(event.target.value)}
        />
        <select
          aria-label="Quality verdict"
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={qualityAccepted === null ? "unknown" : String(qualityAccepted)}
          onChange={(event) =>
            setQualityAccepted(
              event.target.value === "unknown" ? null : event.target.value === "true",
            )
          }
        >
          <option value="unknown">Quality unknown</option>
          <option value="true">Quality accepted</option>
          <option value="false">Quality failed</option>
        </select>
        <select
          aria-label="Human intervention"
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={humanIntervention === null ? "unknown" : String(humanIntervention)}
          onChange={(event) =>
            setHumanIntervention(
              event.target.value === "unknown" ? null : event.target.value === "true",
            )
          }
        >
          <option value="unknown">Human intervention unknown</option>
          <option value="true">Human intervention</option>
          <option value="false">No human intervention</option>
        </select>
        <select
          aria-label="Jev routing"
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={jevEnabled === null ? "unknown" : String(jevEnabled)}
          onChange={(event) =>
            setJevEnabled(event.target.value === "unknown" ? null : event.target.value === "true")
          }
        >
          <option value="unknown">Jev use unknown</option>
          <option value="true">Jev enabled</option>
          <option value="false">Jev disabled</option>
        </select>
        <input
          aria-label="Wall time milliseconds"
          type="number"
          min="0"
          placeholder="Wall time ms (optional)"
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={wallTimeMs}
          onChange={(event) => setWallTimeMs(event.target.value)}
        />
      </div>
      <Button
        size="sm"
        disabled={!caseId.trim() || !cohort.trim()}
        onClick={async () => {
          const result = await upsertRun({
            environmentId,
            input: {
              runId: editingRunId ?? randomUUID(),
              experimentId,
              caseId: caseId.trim(),
              cohort: cohort.trim(),
              rootTurnId: rootTurnId.trim() || null,
              sourceDomain: sourceDomain || null,
              status,
              metadataJson: JSON.stringify({
                ...runMetadata,
                rootTurns: rootLinks,
                jevEnabled,
                wallTimeMs: wallTimeMs.trim() ? Number(wallTimeMs) : null,
              }),
              outcomeJson:
                status === "planned" || status === "running"
                  ? null
                  : JSON.stringify({
                      acceptanceEvidence: evidence.trim() || null,
                      qualityAccepted,
                      humanIntervention,
                    }),
            },
          });
          setNotice(result._tag === "Success" ? "Run recorded." : "Could not record run.");
          if (result._tag === "Success") registry.refresh(detailAtom);
        }}
      >
        {editingRunId ? "Update run" : "Record run"}
      </Button>
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {detail.runs.map((run) => (
        <button
          type="button"
          key={run.runId}
          onClick={() => {
            setEditingRunId(run.runId);
            setCaseId(run.caseId);
            setCohort(run.cohort);
            setRootTurnId(run.rootTurnId ?? "");
            setSourceDomain(run.sourceDomain ?? "");
            try {
              const metadata = JSON.parse(run.metadataJson) as Record<string, unknown>;
              setRunMetadata(metadata);
              setRootLinks(
                Array.isArray(metadata.rootTurns)
                  ? (metadata.rootTurns as { sourceDomain: string; rootTurnId: string }[])
                  : run.sourceDomain && run.rootTurnId
                    ? [{ sourceDomain: run.sourceDomain, rootTurnId: run.rootTurnId }]
                    : [],
              );
              setWallTimeMs(
                typeof metadata.wallTimeMs === "number" ? String(metadata.wallTimeMs) : "",
              );
              setJevEnabled(typeof metadata.jevEnabled === "boolean" ? metadata.jevEnabled : null);
            } catch {
              setRunMetadata({});
              setRootLinks([]);
              setWallTimeMs("");
              setJevEnabled(null);
            }
            setStatus(run.status);
            try {
              setEvidence(
                (JSON.parse(run.outcomeJson ?? "null") as { acceptanceEvidence?: string } | null)
                  ?.acceptanceEvidence ?? "",
              );
              const outcome = JSON.parse(run.outcomeJson ?? "null") as {
                qualityAccepted?: boolean;
                humanIntervention?: boolean;
              } | null;
              setQualityAccepted(
                typeof outcome?.qualityAccepted === "boolean" ? outcome.qualityAccepted : null,
              );
              setHumanIntervention(
                typeof outcome?.humanIntervention === "boolean" ? outcome.humanIntervention : null,
              );
            } catch {
              setEvidence("");
              setQualityAccepted(null);
              setHumanIntervention(null);
            }
          }}
          className="block w-full rounded-md border p-2 text-left text-sm"
        >
          {run.caseId} · {run.cohort} · {run.status} · root {run.rootTurnId ?? "unlinked"}
        </button>
      ))}
    </div>
  );
}

function ExperimentManifestEditor({
  environmentId,
  experiment,
  runCount,
  onSaved,
}: {
  environmentId: EnvironmentId;
  experiment: import("@t3tools/contracts").CodexLedgerExperimentInput;
  runCount: number;
  onSaved: () => void;
}) {
  let initial: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(experiment.manifestJson);
    if (typeof value === "object" && value !== null && !Array.isArray(value))
      initial = value as Record<string, unknown>;
  } catch {
    /* Preserve the original payload when saving. */
  }
  const [hypothesis, setHypothesis] = useState(
    typeof initial.hypothesis === "string" ? initial.hypothesis : "",
  );
  const [taskCorpus, setTaskCorpus] = useState(
    typeof initial.taskCorpus === "string" ? initial.taskCorpus : "",
  );
  const [acceptanceChecks, setAcceptanceChecks] = useState(
    Array.isArray(initial.acceptanceChecks)
      ? initial.acceptanceChecks
          .filter((value): value is string => typeof value === "string")
          .join("\n")
      : "",
  );
  const [rateSnapshotId, setRateSnapshotId] = useState(
    typeof initial.rateSnapshotId === "string" ? initial.rateSnapshotId : "",
  );
  const [harnessVersion, setHarnessVersion] = useState(
    typeof initial.harnessVersion === "string" ? initial.harnessVersion : "",
  );
  const [notice, setNotice] = useState<string | null>(null);
  const save = useAtomCommand(serverEnvironment.upsertCodexLedgerExperiment, {
    reportFailure: false,
  });
  const rates = Option.getOrNull(
    AsyncResult.value(
      useAtomValue(serverEnvironment.codexLedgerRateSnapshots({ environmentId, input: {} })),
    ),
  );
  return (
    <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
      <p className="text-xs text-muted-foreground sm:col-span-2">
        {runCount > 0
          ? "Plan frozen after the first run. Create a new experiment to revise checks."
          : "Declare the task corpus and acceptance checks before runs."}{" "}
        The saved rate snapshot makes comparisons reproducible.
      </p>
      <input
        aria-label="Hypothesis"
        placeholder="Hypothesis"
        className="rounded-md border bg-background px-3 py-2 text-sm"
        value={hypothesis}
        onChange={(event) => setHypothesis(event.target.value)}
      />
      <input
        aria-label="Task corpus"
        placeholder="Task corpus or snapshot ID"
        className="rounded-md border bg-background px-3 py-2 text-sm"
        value={taskCorpus}
        onChange={(event) => setTaskCorpus(event.target.value)}
      />
      <input
        aria-label="Harness version"
        placeholder="Harness version or revision"
        className="rounded-md border bg-background px-3 py-2 text-sm"
        value={harnessVersion}
        onChange={(event) => setHarnessVersion(event.target.value)}
      />
      <select
        aria-label="Rate snapshot"
        className="rounded-md border bg-background px-3 py-2 text-sm"
        value={rateSnapshotId}
        onChange={(event) => setRateSnapshotId(event.target.value)}
      >
        <option value="">Rate snapshot unknown</option>
        {rates?.items.map((rate) => (
          <option key={rate.snapshotId} value={rate.snapshotId}>
            {rate.snapshotId} · {rate.capturedAt}
          </option>
        ))}
      </select>
      <textarea
        aria-label="Acceptance checks"
        placeholder="One acceptance check per line"
        className="rounded-md border bg-background px-3 py-2 text-sm sm:col-span-2"
        value={acceptanceChecks}
        onChange={(event) => setAcceptanceChecks(event.target.value)}
      />
      <Button
        size="sm"
        disabled={runCount > 0}
        className="justify-self-start"
        onClick={async () => {
          const result = await save({
            environmentId,
            input: {
              experimentId: experiment.experimentId,
              name: experiment.name,
              manifestJson: JSON.stringify({
                ...initial,
                hypothesis: hypothesis.trim() || null,
                taskCorpus: taskCorpus.trim() || null,
                acceptanceChecks: acceptanceChecks
                  .split("\n")
                  .map((check) => check.trim())
                  .filter(Boolean),
                rateSnapshotId: rateSnapshotId || null,
                harnessVersion: harnessVersion.trim() || null,
              }),
            },
          });
          setNotice(
            result._tag === "Success"
              ? "Experiment plan saved."
              : "Could not save experiment plan.",
          );
          if (result._tag === "Success") onSaved();
        }}
      >
        Save experiment plan
      </Button>
      {notice ? (
        <p role="status" className="self-center text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
