// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import type { JevRouteResult, JevSubagentDecision } from "@t3tools/contracts";

const MAX_RECEIPTS = 1024;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function accountingResult(result: JevRouteResult): JevRouteResult {
  return {
    choice: result.choice,
    proposedChoice: result.proposedChoice ?? result.recommendedChoice ?? result.choice,
    confidence: result.confidence,
    probabilities: {},
    latencyMs: result.latencyMs,
    error: result.error ? "Routing failed" : null,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
    costKind: result.costKind,
    ...(result.policyOutcome ? { policyOutcome: result.policyOutcome } : {}),
    ...(result.policyVersion ? { policyVersion: result.policyVersion } : {}),
    ...(result.responseModel ? { responseModel: result.responseModel } : {}),
    ...(result.requestFingerprint ? { requestFingerprint: result.requestFingerprint } : {}),
  };
}

function accountingEvent(event: JevSubagentDecision): JevSubagentDecision {
  return {
    threadId: event.threadId,
    providerInstanceId: event.providerInstanceId,
    ...(event.toolUseId ? { toolUseId: event.toolUseId } : {}),
    ...(event.attemptId ? { attemptId: event.attemptId } : {}),
    ...(event.parentProviderTurnId ? { parentProviderTurnId: event.parentProviderTurnId } : {}),
    ...(event.dispatchModel ? { dispatchModel: event.dispatchModel } : {}),
    ...(event.dispatchEffort ? { dispatchEffort: event.dispatchEffort } : {}),
    ...(event.ledgerContext ? { ledgerContext: event.ledgerContext } : {}),
    request: {
      requestId: event.request.requestId,
      prompt: "",
      candidates: [],
      context: { existingSession: false, hasAttachments: false, interactionMode: "subagent" },
    },
    result: event.result ? accountingResult(event.result) : null,
  };
}

function receiptKey(event: Pick<JevSubagentDecision, "request" | "attemptId">): string {
  return `${event.request.requestId}\u0000${event.attemptId ?? event.request.requestId}`;
}

/** The desktop writes before notifying renderers; replay is removed only after server acknowledgement. */
export function createJevSubagentReceiptOutbox(filePath: string) {
  const gapPath = `${filePath}.gap`;
  function writeGaps(events: JevSubagentDecision[]): void {
    NodeFS.mkdirSync(NodePath.dirname(gapPath), { recursive: true });
    const temporary = `${gapPath}.${process.pid}.tmp`;
    NodeFS.writeFileSync(
      temporary,
      JSON.stringify(
        events.map((event) => ({
          threadId: event.threadId,
          ledgerContext: event.ledgerContext,
          requestId: event.request.requestId,
        })),
      ),
      { mode: 0o600 },
    );
    NodeFS.renameSync(temporary, gapPath);
  }
  function gapEvents(): JevSubagentDecision[] {
    try {
      const threads: unknown = JSON.parse(NodeFS.readFileSync(gapPath, "utf8"));
      if (!Array.isArray(threads)) return [];
      const events: JevSubagentDecision[] = [];
      for (const raw of threads) {
        const entry = object(raw);
        const threadId = typeof raw === "string" ? raw : entry?.["threadId"];
        if (typeof threadId !== "string") continue;
        const context = object(entry?.["ledgerContext"]);
        const ledgerContext =
          context &&
          typeof context["environmentId"] === "string" &&
          typeof context["threadId"] === "string" &&
          (context["sourceScope"] === "turn" || context["sourceScope"] === "subagent")
            ? {
                environmentId: context["environmentId"],
                projectId: typeof context["projectId"] === "string" ? context["projectId"] : null,
                threadId: context["threadId"],
                sourceScope: context["sourceScope"] as "turn" | "subagent",
              }
            : null;
        const requestId =
          typeof entry?.["requestId"] === "string"
            ? entry["requestId"]
            : `jev-storage-gap:${threadId}`;
        events.push({
          threadId,
          providerInstanceId: "codex",
          receiptStorageError: true,
          ...(ledgerContext ? { ledgerContext } : {}),
          request: {
            requestId,
            prompt: "",
            candidates: [],
            context: { existingSession: false, hasAttachments: false, interactionMode: "subagent" },
          },
          result: null,
        });
      }
      return events;
    } catch {
      return [];
    }
  }
  function markGap(threadId: string, ledgerContext?: JevSubagentDecision["ledgerContext"]): void {
    const events = gapEvents();
    const prior = events.find((event) => event.threadId === threadId);
    const next = events.filter((event) => event.threadId !== threadId);
    next.push({
      threadId,
      providerInstanceId: "codex",
      receiptStorageError: true,
      ...((ledgerContext ?? prior?.ledgerContext)
        ? { ledgerContext: ledgerContext ?? prior?.ledgerContext }
        : {}),
      request: {
        requestId: `jev-storage-gap:${NodeCrypto.randomUUID()}`,
        prompt: "",
        candidates: [],
        context: { existingSession: false, hasAttachments: false, interactionMode: "subagent" },
      },
      result: null,
    });
    writeGaps(next);
  }
  function read(): JevSubagentDecision[] {
    try {
      const parsed: unknown = JSON.parse(NodeFS.readFileSync(filePath, "utf8"));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (entry): entry is JevSubagentDecision =>
          typeof entry === "object" &&
          entry !== null &&
          typeof entry.request?.requestId === "string" &&
          typeof entry.threadId === "string" &&
          entry.result !== null,
      );
    } catch (error) {
      if (NodeFS.existsSync(filePath)) throw error;
      return [];
    }
  }

  function write(events: JevSubagentDecision[]) {
    NodeFS.mkdirSync(NodePath.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    NodeFS.writeFileSync(temporary, JSON.stringify(events), { mode: 0o600 });
    NodeFS.renameSync(temporary, filePath);
  }

  return {
    list: () => [...read(), ...gapEvents()],
    markGap,
    record(event: JevSubagentDecision): boolean {
      if (event.result === null) return true;
      const events = read();
      const retained = accountingEvent(event);
      const index = events.findIndex((entry) => receiptKey(entry) === receiptKey(retained));
      if (index >= 0) events[index] = retained;
      else {
        if (events.length >= MAX_RECEIPTS) {
          markGap(event.threadId, event.ledgerContext);
          return false;
        }
        events.push(retained);
      }
      write(events);
      return true;
    },
    acknowledge(identity: { requestId: string; attemptId: string }): void {
      const gaps = gapEvents();
      const remainingGaps = gaps.filter(
        (event) =>
          event.request.requestId !== identity.requestId ||
          (event.attemptId ?? event.request.requestId) !== identity.attemptId,
      );
      if (remainingGaps.length !== gaps.length) writeGaps(remainingGaps);
      const events = read();
      const remaining = events.filter(
        (event) =>
          event.request.requestId !== identity.requestId ||
          (event.attemptId ?? event.request.requestId) !== identity.attemptId,
      );
      if (remaining.length !== events.length) write(remaining);
    },
  };
}
