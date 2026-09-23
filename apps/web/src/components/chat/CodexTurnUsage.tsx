import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import type {
  CodexLedgerTurn,
  CodexLedgerTurnDetail,
  CodexLedgerValuation,
  EnvironmentId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import {
  ledgerCacheFraction,
  ledgerCompactEstimate,
  ledgerTokenCount,
} from "@t3tools/client-runtime/state/codex-ledger-presentation";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { serverEnvironment } from "../../state/server";

/** Query by T3 ownership IDs so a client never guesses a Codex turn ID. */
export function CodexTurnUsage({
  environmentId,
  threadId,
  turnId,
  isLatestTurn,
  isUnsettled,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  turnId: TurnId;
  isLatestTurn: boolean;
  isUnsettled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const query = serverEnvironment.codexLedgerTurns({
    environmentId,
    input: { t3ThreadId: threadId, t3TurnId: turnId, limit: 1 },
  });
  const result = useAtomValue(query);
  const refresh = useAtomRefresh(query);
  const turn = Option.getOrNull(AsyncResult.value(result))?.items[0];
  useEffect(() => {
    if (!isLatestTurn) return;
    // Child work can finish after the parent response is exact. Keep one latest
    // turn fresh for a bounded period while background capture catches up.
    let remaining = isUnsettled ? Number.POSITIVE_INFINITY : 20;
    const timer = window.setInterval(() => {
      refresh();
      remaining -= 1;
      if (remaining <= 0) window.clearInterval(timer);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [isLatestTurn, isUnsettled, refresh]);
  if (!turn) return null;

  const cache = ledgerCacheFraction(turn.tokens);
  const costDelta = compactCostDelta(turn);
  return (
    <div className="max-w-full text-left text-xs text-muted-foreground" data-scroll-anchor-ignore>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="group flex max-w-full items-center gap-2 rounded-lg border border-transparent bg-muted/20 px-2 py-1.5 text-left transition-colors hover:border-border/70 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        aria-expanded={expanded}
        aria-label="Codex turn usage"
      >
        <CostComparisonGlyph turn={turn} />
        <span className="min-w-0">
          <span className="flex flex-wrap items-baseline gap-x-1 font-medium text-foreground/80 tabular-nums">
            <span>{ledgerCompactEstimate(turn.valuation)} est.</span>
            <span aria-hidden className="text-muted-foreground/60">
              ·
            </span>
            <span>{ledgerTokenCount(turn.tokens.processedTokens)} processed</span>
            {cache === "Unknown" ? null : (
              <>
                <span aria-hidden className="text-muted-foreground/60">
                  ·
                </span>
                <span>{cache} cached</span>
              </>
            )}
          </span>
          <span className="mt-0.5 block truncate text-[11px] leading-4">
            {compactRoutingSummary(turn)} · {countLabel(turn.responseCount, "model call")}
            {costDelta ? ` · ${costDelta}` : ""}
          </span>
        </span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "ms-auto size-3.5 shrink-0 transition-transform duration-200",
            expanded && "rotate-180",
          )}
        />
      </button>
      {expanded ? <CodexTurnReceipt environmentId={environmentId} turn={turn} /> : null}
    </div>
  );
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function titleCase(value: string | null): string | null {
  if (!value) return null;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function modelLabel(model: string | null): string {
  if (!model) return "Model unavailable";
  const known: Record<string, string> = {
    "gpt-5.5": "GPT-5.5",
    "gpt-5.6-luna": "GPT-5.6 Luna",
    "gpt-5.6-sol": "GPT-5.6 Sol",
    "gpt-5.6-terra": "GPT-5.6 Terra",
    "gpt-6-sol": "GPT-6 Sol",
    "gpt-6-luna": "GPT-6 Luna",
    "gpt-6-astra": "GPT-6 Astra",
  };
  return known[model] ?? model;
}

function selectionLabel(model: string | null, effort: string | null): string {
  return [modelLabel(model), titleCase(effort)].filter(Boolean).join(" · ");
}

function compactRoutingSummary(turn: CodexLedgerTurn): string {
  const used = selectionLabel(turn.model, turn.effort);
  const before = turn.routingBefore;
  if (!before) return used;
  const prior = selectionLabel(before.model, before.effort);
  return before.model === turn.model && before.effort === turn.effort
    ? `${used} · selection unchanged`
    : `${prior} → ${used}`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] leading-4 text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium text-foreground/90 tabular-nums">{value}</dd>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

function completeValuationNumber(valuation: CodexLedgerValuation): number | null {
  if (valuation.completeEstimateUsd === null) return null;
  const numeric = Number(valuation.completeEstimateUsd);
  return Number.isFinite(numeric) ? numeric : null;
}

function CostComparisonGlyph({ turn }: { turn: CodexLedgerTurn }) {
  const comparisons = turn.sameTokenComparisons ?? [];
  const points = [
    { label: "Used", valuation: turn.valuation, tone: "bg-primary/80" },
    ...comparisons.map((comparison) => ({
      label: comparison.reason === "beforeJev" ? "Before Jev" : "Astra Medium",
      valuation: comparison.valuation,
      tone: comparison.reason === "beforeJev" ? "bg-foreground/45" : "bg-foreground/25",
    })),
  ]
    .map((point) => ({ ...point, value: completeValuationNumber(point.valuation) }))
    .filter((point): point is typeof point & { value: number } => point.value !== null);
  if (points.length < 2) return null;
  const maximum = Math.max(...points.map((point) => point.value), Number.EPSILON);
  const description = points
    .map((point) => `${point.label} ${ledgerCompactEstimate(point.valuation)}`)
    .join(", ");

  return (
    <Tooltip>
      <TooltipTrigger
        tabIndex={-1}
        render={
          <span
            role="img"
            aria-label={`Estimated cost comparison: ${description}`}
            className="flex h-7 w-9 shrink-0 items-end gap-1"
          />
        }
      >
        {points.map((point) => (
          <span
            key={point.label}
            aria-hidden
            className="flex h-full min-w-0 flex-1 items-end overflow-hidden rounded-full bg-foreground/10"
          >
            <span
              className={cn("w-full rounded-full", point.tone)}
              style={{ height: `${Math.max(12, (point.value / maximum) * 100)}%` }}
            />
          </span>
        ))}
      </TooltipTrigger>
      <TooltipPopup side="top" className="font-mono text-[11px]">
        {description}
      </TooltipPopup>
    </Tooltip>
  );
}

function compactCostDelta(turn: CodexLedgerTurn): string | null {
  const before = turn.sameTokenComparisons?.find((comparison) => comparison.reason === "beforeJev");
  if (!before) return null;
  const actualCost = completeValuationNumber(turn.valuation);
  const beforeCost = completeValuationNumber(before.valuation);
  if (actualCost === null || beforeCost === null || beforeCost === 0) return null;
  const percent = ((actualCost - beforeCost) / beforeCost) * 100;
  if (Math.abs(percent) < 0.5) return "0% vs before";
  return `${percent < 0 ? "−" : "+"}${Math.abs(percent).toFixed(0)}% vs before`;
}

function formatUsd(value: number): string {
  return `$${new Intl.NumberFormat(undefined, { maximumSignificantDigits: 3 }).format(value)}`;
}

function comparisonDelta(
  comparison: CodexLedgerValuation,
  actual: CodexLedgerValuation,
): string | null {
  const comparisonCost = completeValuationNumber(comparison);
  const actualCost = completeValuationNumber(actual);
  if (comparisonCost === null || actualCost === null) return null;
  const delta = comparisonCost - actualCost;
  const percent = actualCost === 0 ? null : (delta / actualCost) * 100;
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const amount = formatUsd(Math.abs(delta));
  if (percent === null) return `${sign}${amount} vs used`;
  const percentSign = percent > 0 ? "+" : percent < 0 ? "−" : "";
  return `${sign}${amount} (${percentSign}${Math.abs(percent).toFixed(0)}%) vs used`;
}

function CodexTurnReceipt({
  environmentId,
  turn,
}: {
  environmentId: EnvironmentId;
  turn: CodexLedgerTurn;
}) {
  const result = useAtomValue(
    serverEnvironment.codexLedgerTurn({
      environmentId,
      input: {
        sourceDomain: turn.identity.sourceDomain,
        codexThreadId: turn.identity.codexThreadId,
        codexTurnId: turn.identity.codexTurnId,
      },
    }),
  );
  const detail = Option.getOrNull(AsyncResult.value(result));
  if (!detail) {
    return (
      <div className="mt-1.5 rounded-lg border border-border/70 bg-muted/15 px-3 py-2">
        {result._tag === "Failure" ? "Usage details unavailable." : "Loading usage details…"}
      </div>
    );
  }
  return <TurnReceiptContent detail={detail} />;
}

function TurnReceiptContent({ detail }: { detail: CodexLedgerTurnDetail }) {
  const { turn } = detail;
  const ordinaryInput =
    turn.tokens.inputTokens === null ||
    turn.tokens.cachedInputTokens === null ||
    turn.tokens.cacheWriteTokens === null
      ? null
      : Math.max(
          0,
          turn.tokens.inputTokens - turn.tokens.cachedInputTokens - turn.tokens.cacheWriteTokens,
        );
  const used = selectionLabel(
    detail.routing?.used.model ?? turn.model,
    detail.routing?.used.effort ?? turn.effort,
  );
  const before = detail.routing?.before
    ? selectionLabel(detail.routing.before.model, detail.routing.before.effort)
    : null;
  const changed =
    detail.routing?.before !== null &&
    detail.routing?.before !== undefined &&
    (detail.routing.before.model !== detail.routing.used.model ||
      detail.routing.before.effort !== detail.routing.used.effort);
  const turnCost = completeValuationNumber(turn.valuation);
  const threadCost = detail.threadThroughTurn
    ? completeValuationNumber(detail.threadThroughTurn.valuation)
    : null;
  const threadShare =
    turnCost !== null && threadCost !== null && threadCost > 0
      ? `${((turnCost / threadCost) * 100).toFixed(1)}%`
      : "Unavailable";

  return (
    <section className="mt-1.5 max-w-xl overflow-hidden rounded-xl border border-border/70 bg-background/70 text-xs shadow-sm shadow-background/20">
      <div className="space-y-3 p-3">
        <section aria-label="Usage this turn">
          <SectionHeading>Usage this turn</SectionHeading>
          <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            <Metric label="Processed" value={ledgerTokenCount(turn.tokens.processedTokens)} />
            <Metric label="Fresh input" value={ledgerTokenCount(ordinaryInput)} />
            <Metric
              label="Cached input"
              value={`${ledgerTokenCount(turn.tokens.cachedInputTokens)} (${ledgerCacheFraction(turn.tokens)})`}
            />
            <Metric label="Cache writes" value={ledgerTokenCount(turn.tokens.cacheWriteTokens)} />
            <Metric label="Output" value={ledgerTokenCount(turn.tokens.outputTokens)} />
            <Metric
              label="Reasoning subset"
              value={ledgerTokenCount(turn.tokens.reasoningTokens)}
            />
          </dl>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {countLabel(turn.responseCount, "model call")} · reasoning is included in output
          </p>
        </section>

        <section className="border-t border-border/60 pt-3" aria-label="Routing">
          <SectionHeading>Routing</SectionHeading>
          <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
            <dt className="text-muted-foreground">Before Jev</dt>
            <dd className="font-medium text-foreground/90">{before ?? "Unavailable"}</dd>
            <dt className="text-muted-foreground">Actually used</dt>
            <dd className="font-medium text-foreground/90">
              {used}
              {before ? (changed ? "" : " · selection unchanged") : ""}
            </dd>
            <dt className="text-muted-foreground">Children</dt>
            <dd className="font-medium text-foreground/90">
              {turn.childTurnCount === 0
                ? "None"
                : countLabel(turn.childTurnCount, "linked child", "linked children")}
            </dd>
          </dl>
          {detail.childTurns.length > 0 ? (
            <div className="mt-2 space-y-1 border-s border-border ps-2 text-[11px]">
              {detail.childTurns.map((child, index) => (
                <p key={`${child.identity.codexThreadId}:${child.identity.codexTurnId}`}>
                  Child {index + 1} · {selectionLabel(child.model, child.effort)} ·{" "}
                  {ledgerTokenCount(child.tokens.processedTokens)} processed ·{" "}
                  {ledgerCompactEstimate(child.valuation)} est.
                </p>
              ))}
              <p className="font-medium text-foreground/80">
                Task family · {ledgerCompactEstimate(detail.family.valuation)} est. ·{" "}
                {ledgerTokenCount(detail.family.tokens.processedTokens)} processed
              </p>
            </div>
          ) : null}
        </section>

        <section className="border-t border-border/60 pt-3" aria-label="Estimated cost">
          <SectionHeading>Estimated cost</SectionHeading>
          <div className="mt-1.5 flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">Est. cost</span>
            <strong className="text-base font-semibold text-foreground tabular-nums">
              {ledgerCompactEstimate(turn.valuation)}
            </strong>
          </div>
          {detail.sameTokenComparisons.length > 0 ? (
            <div className="mt-2 rounded-lg bg-muted/35 px-2.5 py-2">
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                Same observed tokens with
              </p>
              <div className="space-y-1.5">
                {detail.sameTokenComparisons.map((comparison) => {
                  const delta = comparisonDelta(comparison.valuation, turn.valuation);
                  return (
                    <div
                      key={`${comparison.reason}:${comparison.model}:${comparison.effort ?? ""}`}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3"
                    >
                      <span className="truncate text-foreground/85">
                        {selectionLabel(comparison.model, comparison.effort)}
                        {comparison.reason === "beforeJev" ? " · before Jev" : ""}
                      </span>
                      <span className="font-medium text-foreground tabular-nums">
                        {ledgerCompactEstimate(comparison.valuation)}
                      </span>
                      <span className="col-start-2 text-right text-[10px] text-muted-foreground tabular-nums">
                        {delta ?? "Difference unavailable"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
            Standard API-equivalent estimates, not subscription charges. Comparisons reprice the
            recorded tokens; another model could produce different usage.
          </p>
        </section>

        <section className="border-t border-border/60 pt-3" aria-label="Thread through here">
          <SectionHeading>Thread through here</SectionHeading>
          {detail.threadThroughTurn ? (
            <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              <Metric
                label="Estimated total"
                value={ledgerCompactEstimate(detail.threadThroughTurn.valuation)}
              />
              <Metric
                label="Added by this turn"
                value={`${ledgerCompactEstimate(turn.valuation)} (${threadShare})`}
              />
              <Metric
                label="Turns included"
                value={String(detail.threadThroughTurn.includedTurnCount)}
              />
              <Metric
                label="Processed"
                value={ledgerTokenCount(detail.threadThroughTurn.tokens.processedTokens)}
              />
              <Metric
                label="Cached input"
                value={`${ledgerTokenCount(detail.threadThroughTurn.tokens.cachedInputTokens)} (${ledgerCacheFraction(detail.threadThroughTurn.tokens)})`}
              />
            </dl>
          ) : (
            <p className="mt-1.5 text-muted-foreground">Cumulative thread totals unavailable.</p>
          )}
        </section>
      </div>
      <div className="border-t border-border/60 bg-muted/20 px-3 py-2">
        <Link
          to="/usage"
          className="font-medium text-foreground/80 underline decoration-border underline-offset-2 transition-colors hover:text-foreground"
        >
          Open full ledger
        </Link>
      </div>
    </section>
  );
}
