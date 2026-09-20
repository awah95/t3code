import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import {
  ledgerEstimate,
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
    <span className="ms-auto text-xs text-muted-foreground" data-scroll-anchor-ignore>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="rounded-md px-1 hover:text-foreground"
        aria-expanded={expanded}
        aria-label="Codex turn usage"
      >
        Own turn {ledgerEstimate(turn.valuation)} · {ledgerTokenCount(turn.tokens.processedTokens)}{" "}
        tokens
      </button>
      {expanded ? (
        <span className="block text-right">
          {turn.model ?? "Model unknown"} · {turn.responseCount} responses · {turn.childTurnCount}{" "}
          children · {turn.coverage.usage} usage · {turn.coverage.pricing} pricing. Child work is
          excluded.{" "}
          <Link to="/usage" className="underline hover:text-foreground">
            Open ledger
          </Link>
        </span>
      ) : null}
    </span>
  );
}
