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

/**
 * Removes only intermediate assistant updates from older completed exchanges. Every user message,
 * every exchange's last assistant message, and both most-recent exchanges remain byte-for-byte.
 */
export function compactJevDecisionBody(body: JevDecisionBody): JevDecisionBody {
  if (isWithinCompactionTargets(body)) return body;

  const history = body.state.history;
  if (!history?.length) return body;
  const exchanges = historyExchanges(history);
  const protectedExchangeStart = Math.max(0, exchanges.length - 2);
  const omittedIndices = new Set<number>();
  const affectedExchanges = new Set<number>();
  const omissions = body.state.omissions ?? [];

  const compactedBody = (): JevDecisionBody => {
    const retainedHistory = history.filter((_, index) => !omittedIndices.has(index));
    const receipt = `${OMISSION_PREFIX}${omittedIndices.size} intermediate assistant update${omittedIndices.size === 1 ? "" : "s"} from ${affectedExchanges.size} older exchange${affectedExchanges.size === 1 ? "" : "s"}; all user messages, each exchange's last assistant message, and the two most-recent exchanges were preserved.`;
    const nextOmissions = omissions.some((item) => item.startsWith(OMISSION_PREFIX))
      ? omissions
      : [...omissions, receipt];
    return {
      ...body,
      state: {
        ...body.state,
        history: retainedHistory,
        omissions: nextOmissions,
      },
    };
  };

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
  if (omittedIndices.size === 0) return body;
  return compactedBody();
}
