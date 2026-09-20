import type {
  JevRoutingContext,
  ModelSelection,
  OrchestrationMessageContext,
  ServerProviderUsageLimits,
} from "@t3tools/contracts";
import { JEV_HISTORY_CHAR_BUDGET, sanitizeJevText } from "@t3tools/shared/jevRouting";

type Message = {
  role: string;
  text: string;
  model?: string;
  effort?: string;
  createdAt?: string;
  turnId?: string | null;
  context?: OrchestrationMessageContext | undefined;
};
const newTask = /^(?:please\s+)?(?:new task|different task|start over)\b/i;
function directFeedback(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .split("\n")
    .filter(
      (line) =>
        !/^\s*>/.test(line) &&
        !/\b(?:if I say|if (?:it|this|that)|for example|hypothetically|example feedback)\b/i.test(
          line,
        ),
    )
    .join("\n")
    .replace(/"[^"\n]*"|“[^”\n]*”/g, "")
    .trim();
}
const reset = /\b(?:that worked|it works now|fixed now|new task|different task|start over)\b/i;
const environmentFailure =
  /\b(?:permission denied|rate limit|quota exhausted|network (?:error|unavailable)|connection refused|missing (?:dependency|credentials)|not installed|authentication failed)\b/i;
const specificFailure =
  /\b(?:still (?:not fixed|broken|failing|wrong|duplicated)|(?:bug|issue|problem) is still there)\b/i;
const failure =
  /\b(?:still (?:not fixed|broken|failing|wrong|doesn['’]t work)|(?:this|that) (?:didn['’]t fix it|didn['’]t work|is wrong)|you (?:missed|failed to)|your (?:fix|solution|implementation|answer) (?:fails|is wrong|doesn['’]t work)|tests? (?:still )?fail(?:ing)? (?:after|with) (?:your|the) (?:fix|change))\b/i;

/** Uses the outgoing send snapshot and visible history, with explicit evidence omissions. */
export function buildJevContext(input: {
  messages: readonly Message[];
  priorAttempts?: JevRoutingContext["priorAttempts"];
  prompt: string;
  current: ModelSelection;
  existingSession: boolean;
  hasAttachments?: boolean;
  interactionMode: string;
  plans?: readonly { planMarkdown: string; implementedAt: string | null }[];
  usageLimits?: ServerProviderUsageLimits;
  outgoingContext?: OrchestrationMessageContext | undefined;
  historyCompleteness?: JevRoutingContext["historyCompleteness"];
}): JevRoutingContext {
  const visibleMessages = input.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => {
      const attempt = input.priorAttempts?.find((entry) => entry.turnId === message.turnId);
      return attempt
        ? {
            ...message,
            ...(attempt.model ? { model: attempt.model } : {}),
            ...(attempt.effort ? { effort: attempt.effort } : {}),
          }
        : message;
    });
  const latestTaskIndex = visibleMessages.findLastIndex(
    (message) => message.role === "user" && newTask.test(directFeedback(message.text)),
  );
  const currentIsNewTask = newTask.test(directFeedback(input.prompt));
  const messages = currentIsNewTask ? [] : visibleMessages.slice(Math.max(0, latestTaskIndex));
  const changedTask = currentIsNewTask || latestTaskIndex >= 0;
  const taskStartedAt = currentIsNewTask ? undefined : messages[0]?.createdAt;
  const effort = input.current.options?.find((option) => option.id === "reasoningEffort")?.value;
  const currentEffort = typeof effort === "string" ? effort : undefined;
  const exchanges: Message[][] = [];
  for (const message of messages) {
    if (message.role === "user" || exchanges.length === 0) exchanges.push([]);
    exchanges[exchanges.length - 1]!.push(message);
  }
  const omissions: string[] = [];
  const missingContext: string[] = [];
  const historyCompleteness =
    input.historyCompleteness ?? (input.existingSession ? "windowed" : "complete");
  if (historyCompleteness !== "complete" && !changedTask)
    omissions.push(
      "Earlier history may be unavailable; the first available message is not a verified original task.",
    );
  const evidence: NonNullable<JevRoutingContext["evidence"]>[number][] = [];
  let evidenceBudget = 40_000;
  const appendEvidence = (
    context: OrchestrationMessageContext | undefined,
    sourceTurnId?: string | null,
  ) => {
    for (const record of context?.records ?? []) {
      if (record.kind === "image" || record.kind === "file") {
        missingContext.push(
          `${record.kind} ${record.contextId}: attachment contents unavailable to routing.`,
        );
        continue;
      }
      const text = sanitizeJevText(JSON.stringify(record));
      if (text.length > evidenceBudget) {
        missingContext.push(
          `${record.kind} ${record.contextId}: evidence omitted to fit routing budget.`,
        );
        continue;
      }
      evidenceBudget -= text.length;
      evidence.push({
        id: record.contextId,
        kind: record.kind,
        text,
        ...(sourceTurnId ? { sourceTurnId } : {}),
      });
    }
  };
  appendEvidence(input.outgoingContext);
  for (const message of messages.slice(-30).toReversed())
    appendEvidence(message.context, message.turnId);
  if (
    input.hasAttachments &&
    !missingContext.some((entry) => entry.includes("attachment contents"))
  )
    missingContext.push("Attachment contents unavailable to routing.");
  if (changedTask) omissions.push("Context before the explicit new task was excluded.");
  if (exchanges.length > 10)
    omissions.push(
      `${exchanges.length - 10} older exchanges omitted; original task retained separately.`,
    );
  const recent = exchanges.slice(-10);
  let remaining = JEV_HISTORY_CHAR_BUDGET;
  // Allocate newest-first, but preserve chronological presentation and name every omission.
  const history: NonNullable<JevRoutingContext["history"]>[number][] = [];
  for (const message of recent.flat().toReversed()) {
    const text = sanitizeJevText(message.text);
    const retained = text.length <= remaining ? text : remaining > 0 ? text.slice(-remaining) : "";
    if (text.length > remaining)
      omissions.push(
        `Historical ${message.role} text omitted ${text.length - remaining} characters to fit history budget.`,
      );
    if (remaining > 0)
      history.unshift({
        role: message.role as "user" | "assistant",
        text: retained,
        ...(message.model ? { model: message.model } : {}),
        ...(message.effort ? { effort: message.effort } : {}),
      });
    remaining = Math.max(0, remaining - text.length);
  }
  let unresolved: JevRoutingContext["failure"];
  let previousAssistant: Message | undefined;
  for (const message of [...messages, { role: "user", text: input.prompt }]) {
    if (message.role === "assistant") {
      previousAssistant = message;
      continue;
    }
    const feedback = directFeedback(message.text);
    const solutionFailed =
      specificFailure.test(feedback) ||
      (failure.test(feedback) && !environmentFailure.test(feedback));
    if (reset.test(feedback) && !solutionFailed && !/\b(?:but|still|however)\b/i.test(feedback))
      unresolved = undefined;
    if (solutionFailed)
      unresolved = {
        unresolved: true,
        signals: [sanitizeJevText(message.text)],
        ...(previousAssistant?.model ? { model: previousAssistant.model } : {}),
        ...(previousAssistant?.effort ? { effort: previousAssistant.effort } : {}),
      };
  }
  if (unresolved && !unresolved.model)
    omissions.push(
      "Historical model attribution unavailable; failed attempt model and effort are unknown.",
    );
  const plan = input.plans?.findLast(
    (entry) =>
      entry.implementedAt !== null &&
      (!changedTask || (taskStartedAt !== undefined && entry.implementedAt >= taskStartedAt)),
  );
  if (changedTask && !plan && input.plans?.length)
    omissions.push("Earlier plans excluded; no accepted plan tied to the new task is available.");
  const usage = input.usageLimits;
  return {
    existingSession: input.existingSession,
    hasAttachments: input.hasAttachments ?? false,
    interactionMode: input.interactionMode,
    currentModel: input.current.model,
    ...(currentEffort ? { currentEffort } : {}),
    originalTask: sanitizeJevText(
      messages.find((message) => message.role === "user")?.text ?? input.prompt,
    ),
    ...(plan ? { activePlan: sanitizeJevText(plan.planMarkdown) } : {}),
    objectiveProvenance:
      changedTask || historyCompleteness === "complete" ? "user_message" : "first_available",
    historyCompleteness,
    evidence,
    ...(input.priorAttempts ? { priorAttempts: input.priorAttempts } : {}),
    missingContext,
    target: { kind: "turn", inheritedContext: input.existingSession ? "bounded" : "none" },
    history,
    historyExchangeCount: recent.filter((exchange) =>
      exchange.some((message) => message.role === "user"),
    ).length,
    omissions,
    ...(unresolved ? { failure: unresolved } : {}),
    ...(usage
      ? {
          budget: {
            checkedAt: usage.checkedAt,
            windows: usage.windows
              .filter((window) => Number.isFinite(window.usedPercent))
              .map((window) => ({
                label: window.label,
                remainingPercent: Math.max(0, Math.min(100, 100 - window.usedPercent)),
                ...(window.resetsAt ? { resetsAt: window.resetsAt } : {}),
              })),
            ...(usage.unavailable
              ? { unavailableReason: usage.unavailable.reason }
              : !usage.windows.some((window) => Number.isFinite(window.usedPercent))
                ? { unavailableReason: "No quota windows available" }
                : {}),
          },
        }
      : {}),
  };
}
