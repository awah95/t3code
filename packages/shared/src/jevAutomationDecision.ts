import type {
  JevAutomationDecision,
  JevAutomationDecisionClient,
  JevAutomationDecisionResult,
  JevAutomationInput,
  JevAutomationObservation,
  JevAutomationReceipt,
  JevAutomationAssertionResult,
} from "./jevAutomation.ts";

export const JEV_AUTOMATION_MODEL = "typesafe/jev-1.13";
export const JEV_SYSTEM_ONE_URL = "https://openrouter.ai/api/v1/systemone";
export const JEV_AUTOMATION_REQUEST_BYTE_LIMIT = 128_000;
export const JEV_AUTOMATION_RESPONSE_BYTE_LIMIT = 128_000;

type ChoiceQuestion = {
  readonly type: "choice";
  readonly instructions: string;
  readonly criteria: Readonly<Record<string, string>>;
};

type HeadMaps = {
  readonly actions: ReadonlyMap<string, string>;
};

export interface JevAutomationDecisionBody {
  readonly model: typeof JEV_AUTOMATION_MODEL;
  readonly state: {
    readonly task: string;
    readonly policy: string;
    readonly observation: JevAutomationObservation;
    readonly suppliedInputs: readonly JevAutomationInput[];
    readonly unmetConditions: readonly JevAutomationAssertionResult[];
    readonly recentReceipts: readonly JevAutomationReceipt[];
  };
  readonly questions: {
    readonly next: ChoiceQuestion;
  };
}

const encoder = new TextEncoder();
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const nonnegativeFinite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const tokenCount = (value: unknown): value is number =>
  nonnegativeFinite(value) && Number.isSafeInteger(value);

function indexedCriteria<T>(
  prefix: string,
  entries: readonly (readonly [T, string])[],
): { criteria: Record<string, string>; map: Map<string, T> } {
  const criteria: Record<string, string> = {};
  const map = new Map<string, T>();
  entries.forEach(([value, description], index) => {
    const key = `${prefix}_${index}`;
    criteria[key] = description;
    map.set(key, value);
  });
  return { criteria, map };
}

export function buildJevAutomationDecisionBody(input: {
  readonly task: string;
  readonly observation: JevAutomationObservation;
  readonly inputs: readonly JevAutomationInput[];
  readonly unmetConditions: readonly JevAutomationAssertionResult[];
  readonly priorReceipts: readonly JevAutomationReceipt[];
}): { readonly body: JevAutomationDecisionBody; readonly heads: HeadMaps } {
  const observation = {
    ...input.observation,
    ...(input.observation.inputs
      ? {
          inputs: input.observation.inputs.map((entry) =>
            entry.kind === "navigation"
              ? entry
              : {
                  id: entry.id,
                  kind: entry.kind,
                  value: "[host-held value]",
                  description: entry.description,
                },
          ),
        }
      : {}),
  };
  const actionHead = indexedCriteria(
    "action",
    input.observation.candidates.map((candidate) => {
      const control = candidate.targetId
        ? input.observation.controls.find(({ id }) => id === candidate.targetId)
        : undefined;
      const supplied = candidate.inputId
        ? input.inputs.find(({ id }) => id === candidate.inputId)
        : undefined;
      const target = control
        ? `${control.role} ${control.name ?? control.text ?? control.description ?? control.id}`
        : "the surface";
      const value = supplied ? ` using supplied ${supplied.kind} ${supplied.description}` : "";
      return [
        candidate.id,
        `${candidate.operation} on ${target}${value}. ${candidate.description}`,
      ] as const;
    }),
  );
  return {
    body: {
      model: JEV_AUTOMATION_MODEL,
      state: {
        task: input.task,
        policy:
          "Choose only one exact legal host action. Listed inputs are available to the host even though their values are deliberately hidden from you. Choose an action that references a listed input when it fits the task; do not request novel text merely because its value is shown as host-held. Values, URLs and keys must not be invented. Choose needs_agent for genuinely missing text, visual understanding, unsupported work or ambiguity. A done proposal never proves completion: the host independently evaluates assertions.",
        observation,
        suppliedInputs: input.inputs.map((entry) =>
          entry.kind === "navigation"
            ? entry
            : {
                id: entry.id,
                kind: entry.kind,
                value: "[host-held value]",
                description: entry.description,
              },
        ),
        unmetConditions: input.unmetConditions,
        recentReceipts: input.priorReceipts.slice(-8),
      },
      questions: {
        next: {
          type: "choice",
          instructions:
            "Choose one exact host action, propose done, or request an agent. Host assertions independently determine completion.",
          criteria: {
            ...actionHead.criteria,
            done: "Propose that the task is complete; the host must still verify it independently.",
            needs_novel_text:
              "Request an agent only when required text has no listed supplied input. A redacted host-held value is already supplied.",
            needs_visual_understanding:
              "Request an agent because the step requires interpreting pixels or visual evidence.",
            needs_unsupported_operation:
              "Request an agent because no host candidate supports the required operation.",
            needs_ambiguous_state:
              "Request an agent because the semantic state is too ambiguous to act safely.",
          },
        },
      },
    },
    heads: {
      actions: actionHead.map,
    },
  };
}

function parseChoice(
  answers: Record<string, unknown>,
  name: string,
  allowed: ReadonlySet<string>,
): string | null {
  const answer = answers[name];
  if (!isRecord(answer) || answer.type !== "choice" || typeof answer.choice !== "string")
    return null;
  return allowed.has(answer.choice) ? answer.choice : null;
}

function accountingFrom(raw: unknown) {
  const usage = isRecord(raw) && isRecord(raw.usage) ? raw.usage : {};
  return {
    inputTokens: tokenCount(usage.input_tokens) ? usage.input_tokens : null,
    outputTokens: tokenCount(usage.output_tokens) ? usage.output_tokens : null,
    costUsd: nonnegativeFinite(usage.cost) ? usage.cost : null,
    ...(isRecord(raw) && typeof raw.model === "string" && raw.model
      ? { responseModel: raw.model }
      : {}),
    ...(isRecord(raw) && typeof raw.provider === "string" && raw.provider
      ? { provider: raw.provider }
      : {}),
  };
}

export function parseJevAutomationDecision(
  raw: unknown,
  heads: HeadMaps,
): JevAutomationDecisionResult {
  const accounting = accountingFrom(raw);
  const invalid = (reason: string): JevAutomationDecisionResult => ({
    decision: { outcome: "unavailable", reason },
    accounting,
  });
  if (!isRecord(raw) || typeof raw.model !== "string" || !raw.model || !isRecord(raw.answers))
    return invalid("Jev returned an invalid response envelope.");
  const terminalChoices = [
    "done",
    "needs_novel_text",
    "needs_visual_understanding",
    "needs_unsupported_operation",
    "needs_ambiguous_state",
  ] as const;
  const next = parseChoice(
    raw.answers,
    "next",
    new Set([...heads.actions.keys(), ...terminalChoices]),
  );
  if (!next) return invalid("Jev returned an invalid next-action answer.");
  if (next === "done") return { decision: { outcome: "done" }, accounting };
  if (next.startsWith("needs_")) {
    const reasons = {
      needs_novel_text: "novel-text",
      needs_visual_understanding: "visual-understanding",
      needs_unsupported_operation: "unsupported-operation",
      needs_ambiguous_state: "ambiguous-state",
    } as const;
    return {
      decision: { outcome: "needs-agent", reason: reasons[next as keyof typeof reasons] },
      accounting,
    };
  }
  const candidateId = heads.actions.get(next);
  if (!candidateId) return invalid("Jev selected an unknown action.");
  const decision: JevAutomationDecision = { outcome: "act", candidateId };
  return { decision, accounting };
}

export interface OpenRouterJevAutomationDecisionOptions {
  /** Injected by the caller. This module never reads process environment or credential stores. */
  readonly apiKey: string;
  readonly transport?: typeof fetch;
  readonly endpoint?: string;
}

export function createOpenRouterJevAutomationDecision(
  options: OpenRouterJevAutomationDecisionOptions,
): JevAutomationDecisionClient {
  const transport = options.transport ?? fetch;
  const endpoint = options.endpoint ?? JEV_SYSTEM_ONE_URL;
  return {
    async decide(input) {
      if (input.signal.aborted)
        return {
          decision: { outcome: "unavailable", reason: "The Jev request was cancelled." },
          accounting: { inputTokens: null, outputTokens: null, costUsd: null },
        };
      const compiled = buildJevAutomationDecisionBody(input);
      const payload = JSON.stringify(compiled.body);
      if (encoder.encode(payload).length > JEV_AUTOMATION_REQUEST_BYTE_LIMIT)
        return {
          decision: { outcome: "unavailable", reason: "The Jev request exceeded its byte limit." },
          accounting: { inputTokens: null, outputTokens: null, costUsd: null },
        };
      let response: Response;
      try {
        response = await transport(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: payload,
          signal: input.signal,
        });
      } catch {
        return {
          decision: {
            outcome: "unavailable",
            reason: input.signal.aborted
              ? "The Jev request was cancelled."
              : "The Jev request failed during transport.",
          },
          accounting: { inputTokens: null, outputTokens: null, costUsd: null },
        };
      }
      if (!response.ok)
        return {
          decision: {
            outcome: "unavailable",
            reason: `The Jev request failed with HTTP ${response.status}.`,
          },
          accounting: { inputTokens: null, outputTokens: null, costUsd: null },
        };
      let responseText: string;
      try {
        responseText = await response.text();
      } catch {
        return {
          decision: {
            outcome: "unavailable",
            reason: input.signal.aborted
              ? "The Jev request was cancelled."
              : "The Jev response body could not be read.",
          },
          accounting: { inputTokens: null, outputTokens: null, costUsd: null },
        };
      }
      if (encoder.encode(responseText).length > JEV_AUTOMATION_RESPONSE_BYTE_LIMIT)
        return {
          decision: { outcome: "unavailable", reason: "The Jev response was too large." },
          accounting: { inputTokens: null, outputTokens: null, costUsd: null },
        };
      let raw: unknown;
      try {
        raw = JSON.parse(responseText) as unknown;
      } catch {
        return {
          decision: { outcome: "unavailable", reason: "The Jev response was not valid JSON." },
          accounting: { inputTokens: null, outputTokens: null, costUsd: null },
        };
      }
      return parseJevAutomationDecision(raw, compiled.heads);
    },
  };
}
