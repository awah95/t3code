const textEncoder = new TextEncoder();

export const JEV_PROTOCOL_BYTE_RESERVE = 1024;
export const JEV_REQUEST_BYTE_LIMIT = 64_000;
export const JEV_STATE_QUESTION_BYTE_LIMIT = 32_000;

// A soft trigger leaves room for UTF-8 growth and future question changes. Protected context may
// use the remaining hard capacity; the transport still refuses rather than truncating it.
export const JEV_REQUEST_COMPACTION_TARGET = 56_000;
export const JEV_STATE_QUESTION_COMPACTION_TARGET = 27_000;

type HistoryMessage = {
  role: "user" | "assistant";
  text: string;
  model?: string;
  effort?: string;
};

export type JevDecisionBody = {
  model: string;
  state: Record<string, unknown> & {
    task?: string;
    originalTask?: string;
    history?: readonly HistoryMessage[];
    omissions?: readonly string[];
  };
  questions: Record<
    string,
    { type: "choice"; instructions: string; criteria: Record<string, string> }
  >;
};

const jsonBytes = (value: unknown) => textEncoder.encode(JSON.stringify(value)).length;

export function measureJevDecisionBody(body: JevDecisionBody) {
  const payloadBytes = jsonBytes(body);
  const stateBytes = jsonBytes(body.state);
  const longestQuestionBytes = Math.max(
    0,
    ...Object.values(body.questions).map((question) => jsonBytes(question)),
  );
  return {
    payloadBytes,
    stateBytes,
    longestQuestionBytes,
    requestEnvelopeBytes: payloadBytes + JEV_PROTOCOL_BYTE_RESERVE,
    stateQuestionEnvelopeBytes: stateBytes + longestQuestionBytes + JEV_PROTOCOL_BYTE_RESERVE,
  };
}

export function isWithinJevHardLimits(body: JevDecisionBody): boolean {
  const size = measureJevDecisionBody(body);
  return (
    size.requestEnvelopeBytes <= JEV_REQUEST_BYTE_LIMIT &&
    size.stateQuestionEnvelopeBytes <= JEV_STATE_QUESTION_BYTE_LIMIT
  );
}

type IndexedMessage = { index: number; message: HistoryMessage };

function historyExchanges(history: readonly HistoryMessage[]): IndexedMessage[][] {
  const exchanges: IndexedMessage[][] = [];
  for (const [index, message] of history.entries()) {
    if (message.role === "user" || exchanges.length === 0) exchanges.push([]);
    exchanges.at(-1)!.push({ index, message });
  }
  return exchanges;
}

const OMISSION_PREFIX = "Router brief omitted ";

function isWithinCompactionTargets(body: JevDecisionBody): boolean {
  const size = measureJevDecisionBody(body);
  return (
    size.requestEnvelopeBytes <= JEV_REQUEST_COMPACTION_TARGET &&
    size.stateQuestionEnvelopeBytes <= JEV_STATE_QUESTION_COMPACTION_TARGET
  );
}

/** Keep the original goal once, then pack older assistant history around protected task context. */
export function compactJevDecisionBody(body: JevDecisionBody): JevDecisionBody {
  const originalTask = body.state.originalTask;
  const originalTaskHistoryIndex = body.state.history?.findIndex(
    (message) => message.role === "user" && message.text === originalTask,
  );
  const originalTaskReference =
    originalTask !== undefined && originalTask === body.state.task
      ? "task"
      : originalTaskHistoryIndex !== undefined && originalTaskHistoryIndex >= 0
        ? `history[${originalTaskHistoryIndex}]`
        : null;
  const { originalTask: _originalTask, ...stateWithoutOriginalTask } = body.state;
  const deduplicated: JevDecisionBody = originalTaskReference
    ? {
        ...body,
        state: {
          ...stateWithoutOriginalTask,
          originalTaskReference,
        },
      }
    : body;
  if (isWithinCompactionTargets(deduplicated)) return deduplicated;

  const history = deduplicated.state.history;
  if (!history?.length) return deduplicated;
  const exchanges = historyExchanges(history);
  const protectedExchangeStart = Math.max(0, exchanges.length - 2);
  const omittedIndices = new Set<number>();
  const affectedExchanges = new Set<number>();
  const omissions = deduplicated.state.omissions ?? [];

  const compactedBody = (): JevDecisionBody => {
    const retainedHistory = history.filter((_, index) => !omittedIndices.has(index));
    const receipt = `${OMISSION_PREFIX}${omittedIndices.size} older assistant message${omittedIndices.size === 1 ? "" : "s"} from ${affectedExchanges.size} exchange${affectedExchanges.size === 1 ? "" : "s"}; all user messages and the two most-recent exchanges were preserved.`;
    const retainedOriginalIndex = retainedHistory.findIndex(
      (message) => message.role === "user" && message.text === originalTask,
    );
    return {
      ...deduplicated,
      state: {
        ...deduplicated.state,
        ...(originalTaskReference?.startsWith("history[") && retainedOriginalIndex >= 0
          ? { originalTaskReference: `history[${retainedOriginalIndex}]` }
          : {}),
        history: retainedHistory,
        omissions: [...omissions, receipt],
      },
    };
  };

  // Progress updates go first. Older terminal assistant messages are expendable only when
  // they remain too large; the original goal, user corrections, and recent work stay intact.
  for (const [exchangeIndex, exchange] of exchanges.entries()) {
    if (exchangeIndex >= protectedExchangeStart) continue;
    const lastAssistant = exchange.findLast(({ message }) => message.role === "assistant");
    for (const entry of exchange) {
      if (entry.message.role !== "assistant" || entry.index === lastAssistant?.index) continue;
      omittedIndices.add(entry.index);
      affectedExchanges.add(exchangeIndex);
      const candidate = compactedBody();
      if (isWithinCompactionTargets(candidate)) return candidate;
    }
  }
  for (const [exchangeIndex, exchange] of exchanges.entries()) {
    if (exchangeIndex >= protectedExchangeStart) continue;
    const lastAssistant = exchange.findLast(({ message }) => message.role === "assistant");
    if (!lastAssistant) continue;
    omittedIndices.add(lastAssistant.index);
    affectedExchanges.add(exchangeIndex);
    const candidate = compactedBody();
    if (isWithinCompactionTargets(candidate)) return candidate;
  }
  if (omittedIndices.size === 0) return deduplicated;
  return compactedBody();
}
