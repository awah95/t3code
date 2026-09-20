/** Pure, content-free accounting observations from a Codex rollout. */

export const CODEX_COUNTERS = [
  "input_tokens",
  "cached_input_tokens",
  "cache_write_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
] as const;
export type CodexCounter = (typeof CODEX_COUNTERS)[number];
export type CodexCounters = Record<CodexCounter, number | null>;

export interface CodexUsageEvidence {
  readonly counters: CodexCounters;
  readonly invalid: readonly string[];
  /** Numeric malformed values remain available for audit; other types are described, not retained. */
  readonly invalidRaw: Readonly<Partial<Record<CodexCounter, number | string>>>;
}

export interface CodexResponseObservation {
  readonly kind: "response";
  readonly sourceId: string;
  readonly observationId: string;
  readonly origin: "token_usage_record" | "compacted";
  readonly responseId: string;
  readonly threadId: string | null;
  readonly turnId: string | null;
  readonly rootTurnId: string | null;
  readonly sessionId: string | null;
  readonly model: string | null;
  readonly modelProvenance: "receipt" | "turn_context" | "unknown";
  readonly effort: string | null;
  readonly timestampMs: number | null;
  readonly usage: CodexUsageEvidence;
  readonly turnCheckpoint: CodexUsageEvidence | null;
  readonly threadCheckpoint: CodexUsageEvidence | null;
}

export type CodexLedgerEvent =
  | CodexResponseObservation
  | {
      readonly kind: "opening";
      readonly sourceId: string;
      readonly observationId: string;
      readonly threadId: string;
      readonly forkedFromId: string | null;
      readonly parentThreadId: string | null;
      readonly threadSource: string | null;
      readonly scope: "main" | "child" | "guardian" | "unknown";
      readonly cliVersion: string | null;
    }
  | {
      readonly kind: "started";
      readonly sourceId: string;
      readonly observationId: string;
      readonly threadId: string | null;
      readonly turnId: string;
      readonly timestampMs: number | null;
    }
  | {
      readonly kind: "context";
      readonly sourceId: string;
      readonly observationId: string;
      readonly threadId: string | null;
      readonly turnId: string;
      readonly rootTurnId: string | null;
      readonly model: string | null;
      readonly effort: string | null;
      readonly timestampMs: number | null;
    }
  | {
      readonly kind: "lifecycle";
      readonly sourceId: string;
      readonly observationId: string;
      readonly threadId: string | null;
      readonly turnId: string | null;
      readonly status: "completed" | "aborted";
      readonly timestampMs: number | null;
      readonly copied: boolean;
    }
  | {
      readonly kind: "tool";
      readonly sourceId: string;
      readonly observationId: string;
      readonly threadId: string | null;
      readonly turnId: string | null;
      readonly callId: string;
      readonly name: string | null;
      readonly status: string | null;
      readonly outputBytes: number | null;
      readonly timestampMs: number | null;
    }
  | {
      readonly kind: "quota";
      readonly sourceId: string;
      readonly observationId: string;
      readonly timestampMs: number | null;
      readonly limitId: string | null;
      readonly planType: string | null;
      readonly primary: CodexQuotaBucket | null;
      readonly secondary: CodexQuotaBucket | null;
    }
  | {
      readonly kind: "provisional";
      readonly sourceId: string;
      readonly observationId: string;
      readonly threadId: string | null;
      readonly turnId: string | null;
      readonly model: string | null;
      readonly usage: CodexUsageEvidence;
      readonly reset: boolean;
      readonly timestampMs: number | null;
    };

export interface CodexQuotaBucket {
  readonly usedPercent: number | null;
  readonly windowMinutes: number | null;
  readonly resetsAt: number | null;
}

/** JSON-serializable state. Keep one instance per physical rollout file. */
export interface CodexLedgerScanState {
  sessionId: string | null;
  threadId: string | null;
  ownMetaSeen: boolean;
  activeTurnId: string | null;
  modelByTurn: Record<
    string,
    { model: string | null; effort: string | null; rootTurnId: string | null }
  >;
  previousCumulative: CodexCounters | null;
  lastCumulativeSignature: string | null;
}

export function createCodexLedgerScanState(): CodexLedgerScanState {
  return {
    sessionId: null,
    threadId: null,
    ownMetaSeen: false,
    activeTurnId: null,
    modelByTurn: {},
    previousCumulative: null,
    lastCumulativeSignature: null,
  };
}

function obj(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function nonnegative(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function timestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

export function readCodexUsage(value: unknown): CodexUsageEvidence {
  const source = obj(value);
  const counters = {} as CodexCounters;
  const invalid: string[] = [];
  const invalidRaw: Partial<Record<CodexCounter, number | string>> = {};
  for (const key of CODEX_COUNTERS) {
    const raw = source?.[key];
    counters[key] = raw === undefined || raw === null ? null : nonnegative(raw);
    if (raw !== undefined && raw !== null && counters[key] === null) {
      invalid.push(`${key}:invalid`);
      invalidRaw[key] = typeof raw === "number" ? raw : typeof raw;
    }
  }
  const {
    input_tokens: input,
    cached_input_tokens: cached,
    cache_write_input_tokens: write,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
    total_tokens: total,
  } = counters;
  if (input !== null && cached !== null && cached > input) invalid.push("cache_exceeds_input");
  else if (input !== null && cached !== null && write !== null && cached + write > input)
    invalid.push("cache_exceeds_input");
  if (output !== null && reasoning !== null && reasoning > output)
    invalid.push("reasoning_exceeds_output");
  if (input !== null && output !== null && total !== null && input + output !== total)
    invalid.push("total_mismatch");
  if (source === null) invalid.push("usage_missing");
  return { counters, invalid, invalidRaw };
}

function bucket(value: unknown): CodexQuotaBucket | null {
  const data = obj(value);
  if (!data) return null;
  const used = data["used_percent"];
  return {
    usedPercent:
      typeof used === "number" && Number.isFinite(used) && used >= 0 && used <= 100 ? used : null,
    windowMinutes: nonnegative(data["window_minutes"]),
    resetsAt: nonnegative(data["resets_at"]),
  };
}

/** Caller supplies source/observation IDs, such as account fingerprint and file byte offset. */
export function ingestCodexLedgerRecord(
  state: CodexLedgerScanState,
  record: unknown,
  identity: { sourceId: string; observationId: string },
): readonly CodexLedgerEvent[] {
  const row = obj(record);
  const payload = obj(row?.["payload"]);
  if (!row || !payload) return [];
  const { sourceId, observationId } = identity;
  const timestampMs = timestamp(row["timestamp"]);
  const type = row["type"];

  if (type === "session_meta") {
    // A fork embeds its ancestors' metadata. Only the first describes this file.
    if (state.ownMetaSeen) return [];
    state.ownMetaSeen = true;
    state.threadId = str(payload["id"]) ?? str(payload["session_id"]);
    state.sessionId = str(payload["session_id"]) ?? state.threadId;
    const spawn = obj(obj(obj(payload["source"])?.["subagent"])?.["thread_spawn"]);
    return state.threadId
      ? [
          {
            kind: "opening",
            sourceId,
            observationId,
            threadId: state.threadId,
            forkedFromId: str(payload["forked_from_id"]),
            parentThreadId: str(payload["parent_thread_id"]) ?? str(spawn?.["parent_thread_id"]),
            threadSource: str(payload["thread_source"]),
            scope:
              payload["thread_source"] === "guardian_review"
                ? "guardian"
                : payload["thread_source"] === "subagent"
                  ? "child"
                  : str(payload["thread_source"])
                    ? "main"
                    : "unknown",
            cliVersion: str(payload["cli_version"]),
          },
        ]
      : [];
  }
  if (type === "turn_context") {
    const turnId = str(payload["turn_id"]);
    if (!turnId) return [];
    state.activeTurnId = turnId;
    state.modelByTurn[turnId] = {
      model: str(payload["model"]),
      effort: str(payload["effort"]),
      rootTurnId: str(payload["root_turn_id"]),
    };
    return [
      {
        kind: "context",
        sourceId,
        observationId,
        threadId: state.threadId,
        turnId,
        rootTurnId: str(payload["root_turn_id"]),
        model: str(payload["model"]),
        effort: str(payload["effort"]),
        timestampMs,
      },
    ];
  }

  const makeResponse = (
    data: Record<string, unknown>,
    origin: CodexResponseObservation["origin"],
  ): CodexResponseObservation | null => {
    const responseId = str(data["response_id"]);
    if (!responseId) return null;
    const turnId = str(data["turn_id"]);
    const context = turnId ? state.modelByTurn[turnId] : undefined;
    return {
      kind: "response",
      sourceId,
      observationId,
      origin,
      responseId,
      threadId: str(data["thread_id"]) ?? state.threadId,
      turnId,
      rootTurnId: str(data["root_turn_id"]) ?? context?.rootTurnId ?? null,
      sessionId: str(data["session_id"]) ?? state.sessionId,
      model: str(data["model"]) ?? context?.model ?? null,
      modelProvenance: str(data["model"]) ? "receipt" : context?.model ? "turn_context" : "unknown",
      effort: context?.effort ?? null,
      timestampMs,
      usage: readCodexUsage(data["usage"]),
      turnCheckpoint:
        data["turn_token_usage"] === undefined ? null : readCodexUsage(data["turn_token_usage"]),
      threadCheckpoint:
        data["thread_token_usage"] === undefined
          ? null
          : readCodexUsage(data["thread_token_usage"]),
    };
  };
  if (type === "token_usage_record") {
    const result = makeResponse(payload, "token_usage_record");
    return result ? [result] : [];
  }
  if (type === "compacted") {
    const embedded = obj(payload["latest_token_usage_record"]);
    const result = embedded ? makeResponse(embedded, "compacted") : null;
    return result ? [result] : [];
  }
  if (type === "event_msg") {
    if (payload["type"] === "task_started") {
      const turnId = str(payload["turn_id"]);
      if (!turnId) return [];
      state.activeTurnId = turnId;
      return [
        { kind: "started", sourceId, observationId, threadId: state.threadId, turnId, timestampMs },
      ];
    }
    if (payload["type"] === "task_complete" || payload["type"] === "turn_aborted") {
      const turnId = str(payload["turn_id"]);
      return [
        {
          kind: "lifecycle",
          sourceId,
          observationId,
          threadId: state.threadId,
          turnId,
          status: payload["type"] === "task_complete" ? "completed" : "aborted",
          timestampMs,
          copied:
            turnId !== null && turnId !== state.activeTurnId && !(turnId in state.modelByTurn),
        },
      ];
    }
    if (payload["type"] !== "token_count") return [];
    const events: CodexLedgerEvent[] = [];
    const limits = obj(payload["rate_limits"]);
    if (limits)
      events.push({
        kind: "quota",
        sourceId,
        observationId,
        timestampMs,
        limitId: str(limits["limit_id"]),
        planType: str(limits["plan_type"]),
        primary: bucket(limits["primary"]),
        secondary: bucket(limits["secondary"]),
      });
    const info = obj(payload["info"]);
    if (!info) return events;
    const cumulative = readCodexUsage(info["total_token_usage"]);
    const last = readCodexUsage(info["last_token_usage"]);
    const signature = JSON.stringify(cumulative.counters);
    if (!state.previousCumulative) {
      state.previousCumulative = cumulative.counters;
      state.lastCumulativeSignature = signature;
      // First cumulative notification is still usable as a provisional amount.
      if (last.counters.input_tokens !== null)
        events.push({
          kind: "provisional",
          sourceId,
          observationId,
          threadId: state.threadId,
          turnId: state.activeTurnId,
          model: state.activeTurnId ? (state.modelByTurn[state.activeTurnId]?.model ?? null) : null,
          usage: last,
          reset: false,
          timestampMs,
        });
      return events;
    }
    if (signature === state.lastCumulativeSignature) return events;
    let reset = false;
    const delta = {} as CodexCounters;
    for (const key of CODEX_COUNTERS) {
      const next = cumulative.counters[key];
      const prior = state.previousCumulative[key];
      if (next !== null && prior !== null && next < prior) reset = true;
      delta[key] = next !== null && prior !== null && next >= prior ? next - prior : null;
    }
    state.previousCumulative = cumulative.counters;
    state.lastCumulativeSignature = signature;
    const usage = reset ? last : readCodexUsage(delta);
    if (usage.counters.input_tokens !== null)
      events.push({
        kind: "provisional",
        sourceId,
        observationId,
        threadId: state.threadId,
        turnId: state.activeTurnId,
        model: state.activeTurnId ? (state.modelByTurn[state.activeTurnId]?.model ?? null) : null,
        usage,
        reset,
        timestampMs,
      });
    return events;
  }
  if (type === "response_item") {
    const part = str(payload["type"]);
    if (
      part !== "custom_tool_call" &&
      part !== "function_call" &&
      part !== "custom_tool_call_output" &&
      part !== "function_call_output"
    )
      return [];
    const callId = str(payload["call_id"]);
    if (!callId) return [];
    const output = payload["output"];
    const observedBytes = nonnegative(payload["output_utf8_bytes"]);
    const outputBytes =
      observedBytes ??
      (typeof output === "string" ? new TextEncoder().encode(output).length : null);
    return [
      {
        kind: "tool",
        sourceId,
        observationId,
        threadId: state.threadId,
        turnId: state.activeTurnId,
        callId,
        name: str(payload["name"]),
        status: str(payload["status"]) ?? (part.endsWith("_output") ? "completed" : null),
        outputBytes,
        timestampMs,
      },
    ];
  }
  return [];
}

export interface CodexResponseReconciliation {
  readonly responses: readonly CodexResponseObservation[];
  readonly conflicts: Readonly<Record<string, readonly CodexResponseObservation[]>>;
  readonly duplicateObservations: number;
}

/** Account/source domain must be stable across environments reading the same Codex home. */
export function reconcileCodexResponses(
  observations: readonly CodexResponseObservation[],
  domain: (observation: CodexResponseObservation) => string = (observation) => observation.sourceId,
): CodexResponseReconciliation {
  const grouped = new Map<string, CodexResponseObservation[]>();
  for (const observation of observations) {
    const key = `${domain(observation)}\u0000${observation.responseId}`;
    const group = grouped.get(key) ?? [];
    group.push(observation);
    grouped.set(key, group);
  }
  const responses: CodexResponseObservation[] = [];
  const conflicts: Record<string, CodexResponseObservation[]> = {};
  let duplicateObservations = 0;
  for (const [key, group] of grouped) {
    const facts = new Set(
      group.map((item) =>
        JSON.stringify({
          usage: item.usage.counters,
          invalid: item.usage.invalid,
          invalidRaw: item.usage.invalidRaw,
          threadId: item.threadId,
          turnId: item.turnId,
          rootTurnId: item.rootTurnId,
        }),
      ),
    );
    const observedModels = new Set(
      group.map((item) => item.model).filter((model) => model !== null),
    );
    if (facts.size > 1 || observedModels.size > 1) {
      conflicts[key] = group;
      continue;
    }
    duplicateObservations += group.length - 1;
    const best =
      group.find(
        (item) => item.origin === "token_usage_record" && item.modelProvenance === "receipt",
      ) ??
      group.find((item) => item.origin === "token_usage_record" && item.model !== null) ??
      group.find((item) => item.model !== null) ??
      group.find((item) => item.origin === "token_usage_record") ??
      group[0]!;
    responses.push(best);
  }
  return { responses, conflicts, duplicateObservations };
}

export interface CodexCheckpointResult {
  readonly responseId: string;
  readonly turnMismatches: readonly CodexCounter[];
  readonly threadMismatches: readonly CodexCounter[];
  readonly unknownTurnCounters: readonly CodexCounter[];
  readonly unknownThreadCounters: readonly CodexCounter[];
}

export interface CodexCheckpointReconciliation {
  readonly checkpoints: readonly CodexCheckpointResult[];
  /** Keys are source domain + NUL + Codex thread ID. Never include these in new-work totals. */
  readonly openingByThread: Readonly<Record<string, CodexCounters>>;
  readonly openingStatusByThread: Readonly<
    Record<string, "zero" | "confirmed_inherited" | "unexplained" | "unknown">
  >;
}

/** Reconcile disjoint responses in source order; pass canonical observations only. */
export function reconcileCodexCheckpoints(
  responses: readonly CodexResponseObservation[],
  inheritedThreadKeys: ReadonlySet<string> = new Set(),
): CodexCheckpointReconciliation {
  const turnRunning = new Map<string, CodexCounters>();
  const threadRunning = new Map<string, CodexCounters>();
  const openingByThread: Record<string, CodexCounters> = {};
  const openingStatusByThread: Record<
    string,
    "zero" | "confirmed_inherited" | "unexplained" | "unknown"
  > = {};
  const checkpoints: CodexCheckpointResult[] = [];
  const empty = (): CodexCounters =>
    Object.fromEntries(CODEX_COUNTERS.map((key) => [key, 0])) as CodexCounters;
  for (const response of responses) {
    const threadKey = response.threadId ? `${response.sourceId}\u0000${response.threadId}` : null;
    const turnKey = threadKey && response.turnId ? `${threadKey}\u0000${response.turnId}` : null;
    const turnPrior = turnKey ? (turnRunning.get(turnKey) ?? empty()) : null;
    const threadPrior = threadKey ? (threadRunning.get(threadKey) ?? empty()) : null;
    const turnNext = turnPrior ? empty() : null;
    const threadNext = threadPrior ? empty() : null;
    const turnMismatches: CodexCounter[] = [];
    const threadMismatches: CodexCounter[] = [];
    const unknownTurnCounters: CodexCounter[] = [];
    const unknownThreadCounters: CodexCounter[] = [];
    for (const key of CODEX_COUNTERS) {
      const amount = response.usage.counters[key];
      const turnObserved = response.turnCheckpoint?.counters[key] ?? null;
      const threadObserved = response.threadCheckpoint?.counters[key] ?? null;
      const previousTurn = turnPrior?.[key] ?? null;
      const previousThread = threadPrior?.[key] ?? null;
      if (turnNext)
        turnNext[key] = amount === null || previousTurn === null ? null : previousTurn + amount;
      if (threadNext)
        threadNext[key] =
          amount === null || previousThread === null ? null : previousThread + amount;
      if (turnObserved === null || turnNext?.[key] === null || !turnNext)
        unknownTurnCounters.push(key);
      else if (turnObserved !== turnNext[key]) turnMismatches.push(key);
      if (!threadKey || threadObserved === null || amount === null || !threadNext) {
        unknownThreadCounters.push(key);
      } else if (!(threadKey in openingByThread)) {
        // Filled below after all first-response counter differences are known.
      } else {
        const opening = openingByThread[threadKey]?.[key] ?? null;
        const expected = threadNext[key];
        if (opening === null || expected === null) unknownThreadCounters.push(key);
        else if (threadObserved !== expected + opening) threadMismatches.push(key);
      }
    }
    if (threadKey && !(threadKey in openingByThread)) {
      const opening = empty();
      for (const key of CODEX_COUNTERS) {
        const checkpoint = response.threadCheckpoint?.counters[key] ?? null;
        const current = threadNext?.[key] ?? null;
        opening[key] = checkpoint === null || current === null ? null : checkpoint - current;
        if (opening[key] === null || opening[key]! < 0) unknownThreadCounters.push(key);
      }
      openingByThread[threadKey] = opening;
      openingStatusByThread[threadKey] = CODEX_COUNTERS.some((key) => opening[key] === null)
        ? "unknown"
        : CODEX_COUNTERS.every((key) => opening[key] === 0)
          ? "zero"
          : inheritedThreadKeys.has(threadKey)
            ? "confirmed_inherited"
            : "unexplained";
    }
    if (turnKey && turnNext) turnRunning.set(turnKey, turnNext);
    if (threadKey && threadNext) threadRunning.set(threadKey, threadNext);
    checkpoints.push({
      responseId: response.responseId,
      turnMismatches,
      threadMismatches,
      unknownTurnCounters,
      unknownThreadCounters,
    });
  }
  return { checkpoints, openingByThread, openingStatusByThread };
}
