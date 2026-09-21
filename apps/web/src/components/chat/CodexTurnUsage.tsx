import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import type { CodexLedgerTurn, EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import {
  ledgerCompactEstimate,
  ledgerTokenCount,
} from "@t3tools/client-runtime/state/codex-ledger-presentation";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useState } from "react";

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
  return (
    <div className="text-left text-xs text-muted-foreground" data-scroll-anchor-ignore>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="rounded-md px-1 hover:text-foreground"
        aria-expanded={expanded}
        aria-label="Codex turn usage"
      >
        {ledgerCompactEstimate(turn.valuation)} · {ledgerTokenCount(turn.tokens.processedTokens)}{" "}
        tokens
      </button>
      {expanded ? (
        <div className="mt-1 space-y-1 px-1">
          <p>
            {turn.model ?? "Model unknown"} · {countLabel(turn.responseCount, "response")} ·{" "}
            {countLabel(turn.childTurnCount, "child", "children")}
          </p>
          {turn.childTurnCount > 0 ? (
            <CodexTurnFamilyDetails environmentId={environmentId} turn={turn} />
          ) : null}
          <Link to="/usage" className="inline-block underline hover:text-foreground">
            Open ledger
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function CodexTurnFamilyDetails({
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
    return <p>{result._tag === "Failure" ? "Child details unavailable" : "Loading children…"}</p>;
  }
  return (
    <div className="space-y-1 border-s border-border ps-2">
      {detail.childTurns.map((child, index) => (
        <p key={`${child.identity.codexThreadId}:${child.identity.codexTurnId}`}>
          Child {index + 1} · {child.model ?? "Model unknown"} ·{" "}
          {ledgerTokenCount(child.tokens.processedTokens)} tokens ·{" "}
          {ledgerCompactEstimate(child.valuation)}
        </p>
      ))}
      <p>
        Family total · {ledgerCompactEstimate(detail.family.valuation)} ·{" "}
        {ledgerTokenCount(detail.family.tokens.processedTokens)} tokens
      </p>
      {detail.family.childPreviewTruncated ? (
        <p>More children are available in the ledger.</p>
      ) : null}
    </div>
  );
}
