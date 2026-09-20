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
import { Pressable, TextInput, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";

type QuotaItem = (typeof CodexLedgerQuotaResult.Type)["items"][number];

export function CodexLedgerSection({
  environments,
}: {
  environments: readonly { environmentId: EnvironmentId; label: string }[];
}) {
  if (environments.length === 0)
    return (
      <Text className="text-sm text-foreground-muted">
        Connect an environment to see the Codex ledger.
      </Text>
    );
  return (
    <View className="gap-6">
      {environments.map((environment) => (
        <EnvironmentLedger key={environment.environmentId} {...environment} />
      ))}
    </View>
  );
}

function EnvironmentLedger({
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
      input: { limit: 30, ...(cursor ? { cursor } : {}) },
    }),
  );
  const page = Option.getOrNull(AsyncResult.value(pageResult));
  const quota = Option.getOrNull(
    AsyncResult.value(
      useAtomValue(
        serverEnvironment.codexLedgerQuota({
          environmentId,
          input: { limit: 10, ...(quotaCursor ? { cursor: quotaCursor } : {}) },
        }),
      ),
    ),
  );
  const capture = useAtomCommand(serverEnvironment.setCodexLedgerCapture, { reportFailure: false });
  const exportPage = useAtomCommand(serverEnvironment.exportCodexLedger, { reportFailure: false });
  const exportFacts = async () => {
    if (
      (exportFrom && !/^\d{4}-\d{2}-\d{2}$/.test(exportFrom)) ||
      (exportTo && !/^\d{4}-\d{2}-\d{2}$/.test(exportTo))
    ) {
      setNotice("Use YYYY-MM-DD for export dates.");
      return;
    }
    if (exporting) {
      exportCancelled.current = true;
      return;
    }
    exportCancelled.current = false;
    setExporting(true);
    let next: string | null = null;
    let data = "";
    let pages = 0;
    try {
      do {
        if (exportCancelled.current) {
          setNotice("Export cancelled.");
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
          return;
        }
        data += result.value.data;
        next = result.value.nextCursor;
        pages += 1;
        setNotice(`Exporting facts · ${pages * 200} rows requested`);
      } while (next !== null);
      const { File, Paths } = await import("expo-file-system");
      const { shareAsync } = await import("expo-sharing");
      const file = new File(Paths.cache, `codex-usage-${uuidv4()}.jsonl`);
      file.create();
      file.write(data);
      await shareAsync(file.uri, { mimeType: "application/x-ndjson" });
      setNotice("Exported canonical ledger facts as JSONL.");
    } catch {
      setNotice("Could not share this export on this device.");
    } finally {
      setExporting(false);
    }
  };
  const turns = [...history, ...(page?.items ?? [])];
  const quotaItems = [...quotaHistory, ...(quota?.items ?? [])];
  return (
    <View className="gap-4">
      <View className="gap-1">
        <Text className="text-lg font-t3-bold text-foreground">Codex ledger · {label}</Text>
        <Text className="text-xs text-foreground-muted">
          Reported model work and Standard API equivalent estimates. Subscription limits are account
          observations, not turn charges.
        </Text>
      </View>
      {summaryResult._tag === "Failure" && summary ? (
        <Text className="text-sm text-amber-600">
          Showing the last ledger result; this environment is currently unavailable.
        </Text>
      ) : null}
      {summary ? (
        <View className="gap-2 rounded-2xl border-continuous bg-card p-4">
          <Text className="text-xs text-foreground-muted">API-equivalent estimate</Text>
          <Text className="text-2xl font-t3-bold tabular-nums text-foreground">
            {ledgerEstimate(summary.valuation)}
          </Text>
          <Text className="text-sm text-foreground-muted">
            {ledgerTokenCount(summary.tokens.processedTokens)} processed tokens ·{" "}
            {ledgerCacheFraction(summary.tokens)} cached input
          </Text>
          <Text className="text-xs text-foreground-muted">
            {summary.responseCount} responses · {summary.missingUsageTurnCount} turns without usage
            · {summary.conflictCount} conflicts
          </Text>
          <Text className="text-xs text-foreground-muted">
            {ledgerCoverageLabel(summary.coverage)} · rate snapshot{" "}
            {summary.valuation.snapshotId ?? "unknown"}
          </Text>
          {summary.sources.map((source, index) => (
            <Text key={source.sourceDomain} className="text-xs text-foreground-muted">
              Capture source {index + 1}: {source.state}
              {source.lastError ? ` · ${source.lastError}` : ""}
            </Text>
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={async () => {
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
            className="self-start rounded-full bg-subtle px-4 py-2"
          >
            <Text className="text-sm text-foreground">
              {summary.captureState === "active" ? "Pause capture" : "Resume capture"}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => void exportFacts()}
            className="self-start rounded-full bg-subtle px-4 py-2"
          >
            <Text className="text-sm text-foreground">
              {exporting ? "Cancel export" : "Export JSONL"}
            </Text>
          </Pressable>
          <TextInput
            accessibilityLabel="Export from date"
            placeholder="From YYYY-MM-DD"
            value={exportFrom}
            onChangeText={setExportFrom}
            className="rounded-xl border-continuous bg-background px-3 py-2 text-foreground"
          />
          <TextInput
            accessibilityLabel="Export through date"
            placeholder="Through YYYY-MM-DD"
            value={exportTo}
            onChangeText={setExportTo}
            className="rounded-xl border-continuous bg-background px-3 py-2 text-foreground"
          />
        </View>
      ) : (
        <Text className="text-sm text-foreground-muted">
          {summaryResult._tag === "Failure"
            ? "This environment cannot report Codex ledger data. Check its server version or connection."
            : "Loading ledger…"}
        </Text>
      )}
      {notice ? <Text className="text-sm text-foreground-muted">{notice}</Text> : null}
      <MobileRateSnapshots
        environmentId={environmentId}
        onChanged={() => {
          registry.refresh(summaryAtom);
          registry.refresh(
            serverEnvironment.codexLedgerTurns({ environmentId, input: { limit: 30 } }),
          );
          setSelected(null);
          setHistory([]);
          setCursor(undefined);
        }}
      />
      <View className="gap-2">
        <Text className="font-t3-medium text-foreground">Turns</Text>
        {turns.length === 0 ? (
          <Text className="text-sm text-foreground-muted">
            {pageResult._tag === "Failure"
              ? "Could not load turns from this environment."
              : page === null
                ? "Loading turns…"
                : "No captured Codex turns yet."}
          </Text>
        ) : (
          turns.map((turn) => (
            <Pressable
              accessibilityRole="button"
              key={`${turn.identity.sourceDomain}:${turn.identity.codexThreadId}:${turn.identity.codexTurnId}`}
              onPress={() => setSelected(turn)}
              className="gap-1 rounded-2xl border-continuous bg-card p-4"
            >
              <Text className="font-t3-medium text-foreground">
                {turn.model ?? "Model unknown"} · {turn.scope} · {turn.lifecycle}
              </Text>
              <Text className="text-sm text-foreground-muted">
                {ledgerEstimate(turn.valuation)} · {ledgerTokenCount(turn.tokens.processedTokens)}{" "}
                tokens
              </Text>
              <Text className="text-xs text-foreground-muted">
                {new Date(turn.startedAt).toLocaleString()} · {turn.responseCount} responses ·{" "}
                {turn.childTurnCount} children
              </Text>
            </Pressable>
          ))
        )}
        {page?.nextCursor ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setHistory(turns);
              setCursor(page.nextCursor ?? undefined);
            }}
            className="self-start rounded-full bg-subtle px-4 py-2"
          >
            <Text className="text-sm text-foreground">Load more</Text>
          </Pressable>
        ) : null}
      </View>
      {selected ? (
        <TurnDetail
          key={`${selected.identity.codexThreadId}:${selected.identity.codexTurnId}`}
          environmentId={environmentId}
          turn={selected}
          onClose={() => setSelected(null)}
        />
      ) : null}
      <View className="gap-2">
        <Text className="font-t3-medium text-foreground">Allowance observations</Text>
        <Text className="text-xs text-foreground-muted">
          A change across resets or concurrent chats cannot be assigned to one turn.
        </Text>
        {quotaItems.length ? (
          quotaItems.map((item) => (
            <Text
              key={`${item.sourceDomain}:${item.bucketId}:${item.observedAt}`}
              className="rounded-xl border-continuous bg-card p-3 text-sm text-foreground"
            >
              {item.bucketId}: {item.usedPercent === null ? "Unknown" : `${item.usedPercent}% used`}{" "}
              · {new Date(item.observedAt).toLocaleString()} ·{" "}
              {item.windowDurationMins === null
                ? "window unknown"
                : `${item.windowDurationMins} minute window`}
              {item.resetsAt ? ` · resets ${new Date(item.resetsAt).toLocaleString()}` : ""}
            </Text>
          ))
        ) : (
          <Text className="text-sm text-foreground-muted">No allowance snapshots captured.</Text>
        )}
        {quota?.nextCursor ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setQuotaHistory(quotaItems);
              setQuotaCursor(quota.nextCursor ?? undefined);
            }}
            className="self-start rounded-full bg-subtle px-4 py-2"
          >
            <Text className="text-sm text-foreground">Older observations</Text>
          </Pressable>
        ) : null}
      </View>
      <MobileExperiments environmentId={environmentId} turns={turns} />
    </View>
  );
}

function MobileRateSnapshots({
  environmentId,
  onChanged,
}: {
  environmentId: EnvironmentId;
  onChanged: () => void;
}) {
  const registry = useContext(RegistryContext);
  const snapshotsAtom = serverEnvironment.codexLedgerRateSnapshots({ environmentId, input: {} });
  const snapshots = Option.getOrNull(AsyncResult.value(useAtomValue(snapshotsAtom)));
  const create = useAtomCommand(serverEnvironment.createCodexLedgerRateSnapshot, {
    reportFailure: false,
  });
  const select = useAtomCommand(serverEnvironment.selectCodexLedgerRateSnapshot, {
    reportFailure: false,
  });
  const [rulesJson, setRulesJson] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const items: readonly (typeof CodexLedgerRateSnapshot.Type)[] = snapshots?.items ?? [];
  const changed = () => {
    registry.refresh(snapshotsAtom);
    onChanged();
  };
  return (
    <View className="gap-2 rounded-2xl border-continuous bg-card p-4">
      <Text className="font-t3-medium text-foreground">Rate scenario</Text>
      <Text className="text-xs text-foreground-muted">
        Immutable Standard API assumptions. Select an older snapshot to restore its valuation.
      </Text>
      {items.map((snapshot) => (
        <Pressable
          key={snapshot.snapshotId}
          accessibilityRole="button"
          disabled={snapshot.active}
          onPress={async () => {
            const result = await select({
              environmentId,
              input: { snapshotId: snapshot.snapshotId },
            });
            setNotice(
              result._tag === "Success"
                ? "Rate scenario selected."
                : "Could not select rate scenario.",
            );
            if (result._tag === "Success") changed();
          }}
          className="rounded-lg bg-subtle px-3 py-2"
        >
          <Text className="text-xs text-foreground">
            {snapshot.snapshotId}
            {snapshot.active ? " · current" : " · select"}
          </Text>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          const current = items.find((item) => item.active) ?? items[0];
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
        className="self-start rounded-full bg-subtle px-3 py-2"
      >
        <Text className="text-xs text-foreground">Copy current rules</Text>
      </Pressable>
      <Text className="text-xs text-foreground-muted">
        Edit rates in USD per million tokens, source URLs, date, and unique ID.
      </Text>
      <TextInput
        accessibilityLabel="Rate snapshot JSON"
        multiline
        value={rulesJson}
        onChangeText={setRulesJson}
        className="min-h-32 rounded-xl border-continuous bg-background px-3 py-2 text-xs text-foreground"
      />
      <Pressable
        accessibilityRole="button"
        disabled={!rulesJson.trim()}
        onPress={async () => {
          try {
            const value = JSON.parse(rulesJson) as { id?: unknown };
            if (typeof value.id !== "string") throw new Error("A snapshot ID is required.");
            const result = await create({
              environmentId,
              input: { snapshotId: value.id, rulesJson },
            });
            setNotice(
              result._tag === "Success"
                ? "Override saved. Select it to revalue the ledger."
                : "Could not save override. Check rules and source URLs.",
            );
            if (result._tag === "Success") changed();
          } catch (error) {
            setNotice(error instanceof Error ? error.message : "Invalid JSON.");
          }
        }}
        className="self-start rounded-full bg-subtle px-3 py-2"
      >
        <Text className="text-xs text-foreground">Save snapshot</Text>
      </Pressable>
      {notice ? <Text className="text-xs text-foreground-muted">{notice}</Text> : null}
    </View>
  );
}

function TurnDetail({
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
    <View className="gap-2 rounded-2xl border-continuous bg-card p-4">
      <Pressable accessibilityRole="button" onPress={onClose}>
        <Text className="font-t3-medium text-foreground">Turn detail · Close</Text>
      </Pressable>
      <View className="gap-1 rounded-xl border-continuous bg-background p-3">
        <Text className="text-xs text-foreground-muted">Selected turn, excluding children</Text>
        <Text className="text-lg font-t3-bold text-foreground">
          {ledgerEstimate(selectedTurn.valuation)}
        </Text>
        <Text className="text-xs text-foreground-muted">
          {ledgerTokenCount(selectedTurn.tokens.processedTokens)} processed tokens ·{" "}
          {ledgerCoverageLabel(selectedTurn.coverage)}
        </Text>
      </View>
      <View className="gap-1 rounded-xl border-continuous bg-background p-3">
        <Text className="text-xs text-foreground-muted">
          Task family, including root-linked child work
        </Text>
        <Text className="text-lg font-t3-bold text-foreground">
          {detail
            ? ledgerEstimate(detail.family.valuation)
            : detailResult._tag === "Failure"
              ? "Unavailable"
              : "Loading…"}
        </Text>
        {detail ? (
          <Text className="text-xs text-foreground-muted">
            {ledgerTokenCount(detail.family.tokens.processedTokens)} processed tokens ·{" "}
            {detail.family.includedTurnCount} included turns, {detail.family.childTurnCount} linked
            children · {ledgerCoverageLabel(detail.family.coverage)}
          </Text>
        ) : null}
      </View>
      {detail ? (
        <Text className="text-xs text-foreground-muted">
          {detail.family.unresolvedChildCount > 0
            ? `${detail.family.unresolvedChildCount} child links unresolved. `
            : ""}
          {detail.family.activeChildTurnCount > 0
            ? `${detail.family.activeChildTurnCount} children still active. `
            : ""}
          {detail.family.valuation.completeEstimateUsd === null
            ? "Family dollars are a priced subtotal or unknown while coverage is incomplete."
            : ""}
        </Text>
      ) : null}
      {detailResult._tag === "Failure" && !detail ? (
        <Text className="text-xs text-foreground-muted">
          Could not load family and response facts from this environment.
        </Text>
      ) : null}
      <Text className="text-sm text-foreground">
        Input {ledgerTokenCount(selectedTurn.tokens.inputTokens)} · cached reads{" "}
        {ledgerTokenCount(selectedTurn.tokens.cachedInputTokens)} (
        {ledgerCacheFraction(selectedTurn.tokens)}) · writes{" "}
        {ledgerTokenCount(selectedTurn.tokens.cacheWriteTokens)}
      </Text>
      <Text className="text-sm text-foreground">
        Output {ledgerTokenCount(selectedTurn.tokens.outputTokens)} · reasoning subset{" "}
        {ledgerTokenCount(selectedTurn.tokens.reasoningTokens)}
      </Text>
      <Text className="text-xs text-foreground-muted">
        Codex turn {turn.identity.codexTurnId} · T3 turn {turn.identity.t3TurnId ?? "unlinked"}
      </Text>
      {detail?.responses.map((response) => (
        <Text key={response.responseId} className="text-xs text-foreground-muted">
          {response.kind} · {response.model ?? "model unknown"} (
          {response.modelProvenance === "turnContext"
            ? "turn selection"
            : response.modelProvenance === "response"
              ? "reported response model"
              : "source unknown"}
          ) · {ledgerEstimate(response.valuation)} · input{" "}
          {ledgerTokenCount(response.tokens.inputTokens)} · cached{" "}
          {ledgerTokenCount(response.tokens.cachedInputTokens)} (
          {ledgerCacheFraction(response.tokens)}) · writes{" "}
          {ledgerTokenCount(response.tokens.cacheWriteTokens)} · output{" "}
          {ledgerTokenCount(response.tokens.outputTokens)} · reasoning subset{" "}
          {ledgerTokenCount(response.tokens.reasoningTokens)}
        </Text>
      ))}
      {detail?.childTurns.map((child) => (
        <Text key={child.identity.codexTurnId} className="text-xs text-foreground-muted">
          Child {child.identity.codexTurnId} · {ledgerTokenCount(child.tokens.processedTokens)}{" "}
          tokens · {ledgerEstimate(child.valuation)}
        </Text>
      ))}
      {detail?.family.childPreviewTruncated ? (
        <Text className="text-xs text-foreground-muted">
          Only the first linked children are shown here. The family total includes all observed
          root-linked turns.
        </Text>
      ) : null}
    </View>
  );
}

function MobileExperiments({
  environmentId,
  turns,
}: {
  environmentId: EnvironmentId;
  turns: readonly CodexLedgerTurn[];
}) {
  const registry = useContext(RegistryContext);
  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [caseId, setCaseId] = useState("");
  const [cohort, setCohort] = useState("");
  const [rootTurnId, setRootTurnId] = useState("");
  const [sourceDomain, setSourceDomain] = useState("");
  const [editingRunId, setEditingRunId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"unknown" | "accepted" | "failed">("unknown");
  const [evidence, setEvidence] = useState("");
  const [qualityAccepted, setQualityAccepted] = useState<boolean | null>(null);
  const [rootLinks, setRootLinks] = useState<{ sourceDomain: string; rootTurnId: string }[]>([]);
  const [runMetadata, setRunMetadata] = useState<Record<string, unknown>>({});
  const [jevEnabled, setJevEnabled] = useState<boolean | null>(null);
  const [humanIntervention, setHumanIntervention] = useState<boolean | null>(null);
  const [wallTimeMs, setWallTimeMs] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const listAtom = serverEnvironment.codexLedgerExperiments({ environmentId, input: {} });
  const list = Option.getOrNull(AsyncResult.value(useAtomValue(listAtom)));
  const create = useAtomCommand(serverEnvironment.upsertCodexLedgerExperiment, {
    reportFailure: false,
  });
  return (
    <View className="gap-2">
      <Text className="font-t3-medium text-foreground">Optimization experiments</Text>
      <Text className="text-xs text-foreground-muted">
        Compare accepted task outcomes, including failed attempts. An API estimate alone does not
        show subscription savings.
      </Text>
      <TextInput
        accessibilityLabel="Experiment name"
        placeholder="Experiment name"
        value={name}
        onChangeText={setName}
        className="rounded-xl border-continuous bg-card px-3 py-2 text-foreground"
      />
      <Pressable
        accessibilityRole="button"
        disabled={!name.trim()}
        onPress={async () => {
          const id = uuidv4();
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
          setNotice(
            result._tag === "Success"
              ? "Experiment created. Define checks before comparing runs."
              : "Could not create experiment.",
          );
          if (result._tag === "Success") {
            setSelectedId(id);
            registry.refresh(listAtom);
          }
        }}
        className="self-start rounded-full bg-subtle px-4 py-2"
      >
        <Text className="text-sm text-foreground">Create experiment</Text>
      </Pressable>
      {list?.items.map((experiment) => (
        <Pressable
          key={experiment.experimentId}
          accessibilityRole="button"
          onPress={() => setSelectedId(experiment.experimentId)}
          className="rounded-xl border-continuous bg-card p-3"
        >
          <Text className="text-sm text-foreground">{experiment.name}</Text>
        </Pressable>
      ))}
      {selectedId ? (
        <MobileExperimentDetail
          environmentId={environmentId}
          experimentId={selectedId}
          turns={turns}
          caseId={caseId}
          setCaseId={setCaseId}
          cohort={cohort}
          setCohort={setCohort}
          rootTurnId={rootTurnId}
          setRootTurnId={setRootTurnId}
          sourceDomain={sourceDomain}
          setSourceDomain={setSourceDomain}
          outcome={outcome}
          setOutcome={setOutcome}
          evidence={evidence}
          setEvidence={setEvidence}
          editingRunId={editingRunId}
          setEditingRunId={setEditingRunId}
          qualityAccepted={qualityAccepted}
          setQualityAccepted={setQualityAccepted}
          rootLinks={rootLinks}
          setRootLinks={setRootLinks}
          runMetadata={runMetadata}
          setRunMetadata={setRunMetadata}
          jevEnabled={jevEnabled}
          setJevEnabled={setJevEnabled}
          humanIntervention={humanIntervention}
          setHumanIntervention={setHumanIntervention}
          wallTimeMs={wallTimeMs}
          setWallTimeMs={setWallTimeMs}
          setNotice={setNotice}
        />
      ) : null}
      {notice ? <Text className="text-xs text-foreground-muted">{notice}</Text> : null}
    </View>
  );
}

function MobileExperimentDetail(props: {
  environmentId: EnvironmentId;
  experimentId: string;
  turns: readonly CodexLedgerTurn[];
  caseId: string;
  setCaseId: (value: string) => void;
  cohort: string;
  setCohort: (value: string) => void;
  rootTurnId: string;
  setRootTurnId: (value: string) => void;
  sourceDomain: string;
  setSourceDomain: (value: string) => void;
  outcome: "unknown" | "accepted" | "failed";
  setOutcome: (value: "unknown" | "accepted" | "failed") => void;
  evidence: string;
  setEvidence: (value: string) => void;
  editingRunId: string | null;
  setEditingRunId: (value: string | null) => void;
  qualityAccepted: boolean | null;
  setQualityAccepted: (value: boolean | null) => void;
  rootLinks: readonly { sourceDomain: string; rootTurnId: string }[];
  setRootLinks: (value: { sourceDomain: string; rootTurnId: string }[]) => void;
  runMetadata: Record<string, unknown>;
  setRunMetadata: (value: Record<string, unknown>) => void;
  jevEnabled: boolean | null;
  setJevEnabled: (value: boolean | null) => void;
  humanIntervention: boolean | null;
  setHumanIntervention: (value: boolean | null) => void;
  wallTimeMs: string;
  setWallTimeMs: (value: string) => void;
  setNotice: (value: string | null) => void;
}) {
  const registry = useContext(RegistryContext);
  const upsertRun = useAtomCommand(serverEnvironment.upsertCodexLedgerRun, {
    reportFailure: false,
  });
  const detailAtom = serverEnvironment.codexLedgerExperiment({
    environmentId: props.environmentId,
    input: { experimentId: props.experimentId },
  });
  const detail = Option.getOrNull(AsyncResult.value(useAtomValue(detailAtom)));
  const report = detail
    ? (JSON.parse(detail.reportJson) as {
        cohorts: {
          cohort: string;
          caseCount: number;
          acceptedCaseCount: number;
          firstPassAcceptedCount: number;
          costPerAcceptedCaseUsd: string | null;
          combinedCostPerAcceptedCaseUsd: string | null;
          unpricedResponseCount: number;
        }[];
        cases: {
          caseId: string;
          cohort: string;
          apiSubtotalUsd: string | null;
          jevReportedUsd: string | null;
          jevEstimatedUsd: string | null;
          jevUnknownCount: number;
        }[];
        pairedCaseCount: number;
        comparable: boolean;
        comparisonReasons: string[];
      })
    : null;
  return (
    <View className="gap-2 rounded-xl border-continuous bg-card p-3">
      <Text className="font-t3-medium text-foreground">
        {detail?.experiment.name ?? "Loading experiment…"}
      </Text>
      <Text className="text-xs text-foreground-muted">
        Set acceptance checks and a fixed task corpus before comparing runs.
      </Text>
      {report ? (
        <View className="gap-1">
          <Text className="text-xs text-foreground-muted">
            Paired cases are descriptive, not an independently random sample. Failed attempts and
            repair count toward accepted-case cost; Jev overhead is separate.
          </Text>
          {report.cohorts.map((item) => (
            <Text key={item.cohort} className="text-xs text-foreground">
              {item.cohort}: {item.acceptedCaseCount}/{item.caseCount} accepted ·{" "}
              {item.firstPassAcceptedCount} first pass · API + Jev scenario per accepted case{" "}
              {item.combinedCostPerAcceptedCaseUsd === null
                ? "Unknown"
                : `$${item.combinedCostPerAcceptedCaseUsd}`}{" "}
              · API component{" "}
              {item.costPerAcceptedCaseUsd === null ? "Unknown" : `$${item.costPerAcceptedCaseUsd}`}
              {item.unpricedResponseCount ? ` · ${item.unpricedResponseCount} unpriced` : ""}
            </Text>
          ))}
          {report.cases.map((item) => (
            <Text key={`${item.cohort}:${item.caseId}`} className="text-xs text-foreground-muted">
              {item.caseId} · {item.cohort} · API subtotal{" "}
              {item.apiSubtotalUsd === null ? "Unknown" : `$${item.apiSubtotalUsd}`} · Jev billed{" "}
              {item.jevReportedUsd === null ? "Unknown" : `$${item.jevReportedUsd}`} · Jev estimated{" "}
              {item.jevEstimatedUsd === null ? "Unknown" : `$${item.jevEstimatedUsd}`}
              {item.jevUnknownCount ? ` · ${item.jevUnknownCount} unknown overhead` : ""}
            </Text>
          ))}
          <Text className="text-xs text-foreground-muted">
            {report.pairedCaseCount} paired cases ·{" "}
            {report.comparable
              ? "Comparable under declared coverage"
              : `Inconclusive: ${report.comparisonReasons.join(", ")}`}
          </Text>
        </View>
      ) : null}
      {detail ? (
        <MobileManifestEditor
          key={detail.experiment.experimentId}
          environmentId={props.environmentId}
          experiment={detail.experiment}
          runCount={detail.runs.length}
          onSaved={() => registry.refresh(detailAtom)}
        />
      ) : null}
      <TextInput
        accessibilityLabel="Case ID"
        placeholder="Case ID"
        value={props.caseId}
        onChangeText={props.setCaseId}
        className="rounded-xl border-continuous bg-background px-3 py-2 text-foreground"
      />
      <TextInput
        accessibilityLabel="Cohort"
        placeholder="Baseline or candidate"
        value={props.cohort}
        onChangeText={props.setCohort}
        className="rounded-xl border-continuous bg-background px-3 py-2 text-foreground"
      />
      <Text className="text-xs text-foreground-muted">Link captured turn</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          props.setRootTurnId("");
          props.setSourceDomain("");
        }}
        className="self-start rounded-full bg-subtle px-3 py-2"
      >
        <Text className="text-xs text-foreground">Clear linked turn</Text>
      </Pressable>
      <View className="gap-1">
        {props.turns.slice(0, 20).map((turn) => (
          <Pressable
            key={`${turn.identity.sourceDomain}:${turn.identity.codexTurnId}`}
            accessibilityRole="button"
            onPress={() => {
              const rootTurnId = turn.identity.rootTurnId ?? turn.identity.codexTurnId;
              props.setRootTurnId(rootTurnId);
              props.setSourceDomain(turn.identity.sourceDomain);
              if (
                !props.rootLinks.some(
                  (link) =>
                    link.sourceDomain === turn.identity.sourceDomain &&
                    link.rootTurnId === rootTurnId,
                )
              )
                props.setRootLinks([
                  ...props.rootLinks,
                  { sourceDomain: turn.identity.sourceDomain, rootTurnId },
                ]);
            }}
            className="rounded-lg bg-subtle px-2 py-1"
          >
            <Text className="text-xs text-foreground">
              {turn.model ?? "Unknown model"} · {new Date(turn.startedAt).toLocaleString()}
              {props.rootTurnId === (turn.identity.rootTurnId ?? turn.identity.codexTurnId)
                ? " · linked"
                : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        accessibilityLabel="Source domain"
        placeholder="Source domain for older turn"
        value={props.sourceDomain}
        onChangeText={props.setSourceDomain}
        className="rounded-xl border-continuous bg-background px-3 py-2 text-foreground"
      />
      <TextInput
        accessibilityLabel="Root turn ID"
        placeholder="Root turn ID"
        value={props.rootTurnId}
        onChangeText={props.setRootTurnId}
        className="rounded-xl border-continuous bg-background px-3 py-2 text-foreground"
      />
      <Pressable
        accessibilityRole="button"
        disabled={!props.sourceDomain.trim() || !props.rootTurnId.trim()}
        onPress={() => {
          if (
            !props.rootLinks.some(
              (link) =>
                link.sourceDomain === props.sourceDomain.trim() &&
                link.rootTurnId === props.rootTurnId.trim(),
            )
          )
            props.setRootLinks([
              ...props.rootLinks,
              { sourceDomain: props.sourceDomain.trim(), rootTurnId: props.rootTurnId.trim() },
            ]);
        }}
        className="self-start rounded-full bg-subtle px-3 py-2"
      >
        <Text className="text-xs text-foreground">Add root link</Text>
      </Pressable>
      {props.rootLinks.map((link) => (
        <Pressable
          key={`${link.sourceDomain}:${link.rootTurnId}`}
          accessibilityRole="button"
          onPress={() => {
            props.setRootLinks(props.rootLinks.filter((item) => item !== link));
            if (props.rootTurnId === link.rootTurnId) {
              props.setRootTurnId("");
              props.setSourceDomain("");
            }
          }}
          className="self-start rounded-full bg-subtle px-2 py-1"
        >
          <Text className="text-xs text-foreground">{link.rootTurnId} · detach</Text>
        </Pressable>
      ))}
      <View className="flex-row gap-2">
        {(["unknown", "accepted", "failed"] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: props.outcome === value }}
            onPress={() => props.setOutcome(value)}
            className="rounded-full bg-subtle px-3 py-2"
          >
            <Text className="text-xs text-foreground">{value}</Text>
          </Pressable>
        ))}
      </View>
      <View className="flex-row flex-wrap gap-2">
        {([null, true, false] as const).map((value) => (
          <Pressable
            key={String(value)}
            accessibilityRole="button"
            onPress={() => props.setQualityAccepted(value)}
            className="rounded-full bg-subtle px-3 py-2"
          >
            <Text className="text-xs text-foreground">
              {value === null ? "Quality unknown" : value ? "Quality accepted" : "Quality failed"}
              {props.qualityAccepted === value ? " · selected" : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      <View className="flex-row flex-wrap gap-2">
        {([null, true, false] as const).map((value) => (
          <Pressable
            key={String(value)}
            accessibilityRole="button"
            onPress={() => props.setJevEnabled(value)}
            className="rounded-full bg-subtle px-3 py-2"
          >
            <Text className="text-xs text-foreground">
              {value === null ? "Jev unknown" : value ? "Jev enabled" : "Jev disabled"}
              {props.jevEnabled === value ? " · selected" : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      <View className="flex-row flex-wrap gap-2">
        {([null, true, false] as const).map((value) => (
          <Pressable
            key={String(value)}
            accessibilityRole="button"
            onPress={() => props.setHumanIntervention(value)}
            className="rounded-full bg-subtle px-3 py-2"
          >
            <Text className="text-xs text-foreground">
              {value === null
                ? "Intervention unknown"
                : value
                  ? "Human intervention"
                  : "No human intervention"}
              {props.humanIntervention === value ? " · selected" : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        accessibilityLabel="Wall time milliseconds"
        placeholder="Wall time ms (optional)"
        keyboardType="numeric"
        value={props.wallTimeMs}
        onChangeText={props.setWallTimeMs}
        className="rounded-xl border-continuous bg-background px-3 py-2 text-foreground"
      />
      <TextInput
        accessibilityLabel="Acceptance evidence"
        placeholder="Acceptance evidence"
        value={props.evidence}
        onChangeText={props.setEvidence}
        className="rounded-xl border-continuous bg-background px-3 py-2 text-foreground"
      />
      <Pressable
        accessibilityRole="button"
        disabled={!props.caseId.trim() || !props.cohort.trim()}
        onPress={async () => {
          const result = await upsertRun({
            environmentId: props.environmentId,
            input: {
              runId: props.editingRunId ?? uuidv4(),
              experimentId: props.experimentId,
              caseId: props.caseId.trim(),
              cohort: props.cohort.trim(),
              rootTurnId: props.rootTurnId || null,
              sourceDomain: props.sourceDomain || null,
              status: props.outcome,
              metadataJson: JSON.stringify({
                ...props.runMetadata,
                rootTurns: props.rootLinks,
                jevEnabled: props.jevEnabled,
                wallTimeMs: props.wallTimeMs.trim() ? Number(props.wallTimeMs) : null,
              }),
              outcomeJson: JSON.stringify({
                acceptanceEvidence: props.evidence.trim() || null,
                qualityAccepted: props.qualityAccepted,
                humanIntervention: props.humanIntervention,
              }),
            },
          });
          props.setNotice(result._tag === "Success" ? "Run recorded." : "Could not record run.");
          if (result._tag === "Success") registry.refresh(detailAtom);
        }}
        className="self-start rounded-full bg-subtle px-4 py-2"
      >
        <Text className="text-sm text-foreground">
          {props.editingRunId ? "Update run" : "Record run"}
        </Text>
      </Pressable>
      {detail?.runs.map((run) => (
        <Pressable
          accessibilityRole="button"
          key={run.runId}
          onPress={() => {
            props.setEditingRunId(run.runId);
            props.setCaseId(run.caseId);
            props.setCohort(run.cohort);
            props.setRootTurnId(run.rootTurnId ?? "");
            props.setSourceDomain(run.sourceDomain ?? "");
            try {
              const metadata = JSON.parse(run.metadataJson) as Record<string, unknown>;
              props.setRunMetadata(metadata);
              props.setRootLinks(
                Array.isArray(metadata.rootTurns)
                  ? (metadata.rootTurns as { sourceDomain: string; rootTurnId: string }[])
                  : run.sourceDomain && run.rootTurnId
                    ? [{ sourceDomain: run.sourceDomain, rootTurnId: run.rootTurnId }]
                    : [],
              );
              props.setJevEnabled(
                typeof metadata.jevEnabled === "boolean" ? metadata.jevEnabled : null,
              );
              props.setWallTimeMs(
                typeof metadata.wallTimeMs === "number" ? String(metadata.wallTimeMs) : "",
              );
            } catch {
              props.setRunMetadata({});
              props.setRootLinks([]);
              props.setJevEnabled(null);
              props.setWallTimeMs("");
            }
            props.setOutcome(
              run.status === "accepted" || run.status === "failed" ? run.status : "unknown",
            );
            try {
              props.setEvidence(
                (JSON.parse(run.outcomeJson ?? "null") as { acceptanceEvidence?: string } | null)
                  ?.acceptanceEvidence ?? "",
              );
              const recorded = JSON.parse(run.outcomeJson ?? "null") as {
                qualityAccepted?: boolean;
              } | null;
              props.setQualityAccepted(
                typeof recorded?.qualityAccepted === "boolean" ? recorded.qualityAccepted : null,
              );
              props.setHumanIntervention(
                typeof (recorded as { humanIntervention?: boolean } | null)?.humanIntervention ===
                  "boolean"
                  ? (recorded as { humanIntervention: boolean }).humanIntervention
                  : null,
              );
            } catch {
              props.setEvidence("");
              props.setQualityAccepted(null);
              props.setHumanIntervention(null);
            }
          }}
          className="rounded-lg border-continuous bg-background p-2"
        >
          <Text className="text-xs text-foreground">
            {run.caseId} · {run.cohort} · {run.status}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function MobileManifestEditor({
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
    /* Retain original payload in the editor. */
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
  const rates = Option.getOrNull(
    AsyncResult.value(
      useAtomValue(serverEnvironment.codexLedgerRateSnapshots({ environmentId, input: {} })),
    ),
  );
  const save = useAtomCommand(serverEnvironment.upsertCodexLedgerExperiment, {
    reportFailure: false,
  });
  return (
    <View className="gap-2 border-b border-continuous pb-3">
      <Text className="text-xs text-foreground-muted">
        Experiment plan{runCount > 0 ? " · frozen; create a new experiment to revise checks" : ""}
      </Text>
      <TextInput
        accessibilityLabel="Hypothesis"
        placeholder="Hypothesis"
        value={hypothesis}
        onChangeText={setHypothesis}
        className="rounded-xl border-continuous bg-background px-3 py-2 text-foreground"
      />
      <TextInput
        accessibilityLabel="Task corpus"
        placeholder="Task corpus or snapshot ID"
        value={taskCorpus}
        onChangeText={setTaskCorpus}
        className="rounded-xl border-continuous bg-background px-3 py-2 text-foreground"
      />
      <TextInput
        accessibilityLabel="Harness version"
        placeholder="Harness version or revision"
        value={harnessVersion}
        onChangeText={setHarnessVersion}
        className="rounded-xl border-continuous bg-background px-3 py-2 text-foreground"
      />
      <Text className="text-xs text-foreground-muted">Rate snapshot</Text>
      <View className="gap-1">
        {rates?.items.map((rate) => (
          <Pressable
            key={rate.snapshotId}
            accessibilityRole="button"
            onPress={() => setRateSnapshotId(rate.snapshotId)}
            className="rounded-lg bg-subtle px-2 py-1"
          >
            <Text className="text-xs text-foreground">
              {rate.snapshotId} · {rate.capturedAt}
              {rateSnapshotId === rate.snapshotId ? " · selected" : ""}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        accessibilityLabel="Acceptance checks"
        placeholder="One acceptance check per line"
        multiline
        value={acceptanceChecks}
        onChangeText={setAcceptanceChecks}
        className="rounded-xl border-continuous bg-background px-3 py-2 text-foreground"
      />
      <Pressable
        accessibilityRole="button"
        disabled={runCount > 0}
        onPress={async () => {
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
        className="self-start rounded-full bg-subtle px-3 py-2"
      >
        <Text className="text-xs text-foreground">Save experiment plan</Text>
      </Pressable>
      {notice ? <Text className="text-xs text-foreground-muted">{notice}</Text> : null}
    </View>
  );
}
