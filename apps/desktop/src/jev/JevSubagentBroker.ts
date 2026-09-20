// @effect-diagnostics nodeBuiltinImport:off
// Node HTTP is the boundary used by Codex command hooks outside Electron IPC.
import * as NodeHttp from "node:http";
import * as NodeCrypto from "node:crypto";
import type {
  JevRouteRequest,
  JevRouteResult,
  JevSubagentDecision,
  JevSubagentPolicy,
} from "@t3tools/contracts";
import {
  JEV_MAX_REQUEST_CHARS,
  sanitizeJevText,
  sanitizeJevContext,
  isJevCandidateAllowed,
} from "@t3tools/shared/jevRouting";
import * as Schema from "effect/Schema";
import { failedJevDecision } from "./decision.ts";

const Identity = Schema.Struct({ threadId: Schema.String, providerInstanceId: Schema.String });
const SpawnRequest = Schema.Struct({
  ...Identity.fields,
  taskPrompt: Schema.String,
  proposedModel: Schema.optional(Schema.Unknown),
  proposedEffort: Schema.optional(Schema.Unknown),
  forkTurns: Schema.optional(Schema.String),
});
const StatusRequest = Schema.Struct({ ...Identity.fields, error: Schema.String });
const decodeIdentity = Schema.decodeUnknownSync(Identity);
const decodeSpawn = Schema.decodeUnknownSync(SpawnRequest);
const decodeStatus = Schema.decodeUnknownSync(StatusRequest);

function samePool(a: JevSubagentPolicy | undefined, b: JevSubagentPolicy | undefined) {
  return (
    !!a &&
    !!b &&
    a.enabled === b.enabled &&
    a.providerInstanceId === b.providerInstanceId &&
    JSON.stringify(a.candidates.map(({ key, model, effort }) => ({ key, model, effort }))) ===
      JSON.stringify(b.candidates.map(({ key, model, effort }) => ({ key, model, effort })))
  );
}

export async function createJevSubagentBroker(options: {
  decide: (request: JevRouteRequest) => Promise<JevRouteResult>;
  cancel: (requestId: string) => void;
  onDecision: (event: JevSubagentDecision) => void;
}) {
  const token = NodeCrypto.randomBytes(32).toString("hex");
  const authorization = Buffer.from(`Bearer ${token}`);
  const policies = new Map<string, JevSubagentPolicy>();
  const pending = new Map<string, { threadId: string; abort: () => void }>();
  const server = NodeHttp.createServer(async (req, res) => {
    const respond = (status: number, body: unknown) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    };
    const supplied = Buffer.from(req.headers.authorization ?? "");
    if (
      supplied.length !== authorization.length ||
      !NodeCrypto.timingSafeEqual(supplied, authorization)
    ) {
      respond(401, {});
      return;
    }
    if (
      req.method !== "POST" ||
      !["/subagent-route", "/subagent-policy", "/subagent-status"].includes(req.url ?? "")
    ) {
      respond(404, {});
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > JEV_MAX_REQUEST_CHARS * 4) {
          respond(413, {});
          return;
        }
        chunks.push(bytes);
      }
      const serialized = Buffer.concat(chunks).toString("utf8");
      if (serialized.length > JEV_MAX_REQUEST_CHARS) {
        respond(413, {});
        return;
      }
      const raw: unknown = JSON.parse(serialized);
      const identity = decodeIdentity(raw);
      const policy = policies.get(identity.threadId);
      const enabled =
        policy?.enabled === true && policy.providerInstanceId === identity.providerInstanceId;
      if (req.url === "/subagent-policy") {
        respond(200, { enabled, candidates: enabled ? policy.candidates : [] });
        return;
      }
      if (!enabled) {
        respond(200, { model: null });
        return;
      }
      if (req.url === "/subagent-status") {
        const status = decodeStatus(raw);
        options.onDecision({
          ...identity,
          request: {
            requestId: NodeCrypto.randomUUID(),
            prompt: "Codex subagent routing setup (local status; no Jev API call)",
            candidates: [],
            context: {
              existingSession: true,
              hasAttachments: false,
              interactionMode: "subagent-status",
            },
          },
          result: {
            ...failedJevDecision(status.error.slice(0, 1000)),
            costKind: "estimated",
            costUsd: 0,
            inputTokens: 0,
            outputTokens: 0,
          },
        });
        respond(200, {});
        return;
      }
      if (pending.size >= 8) {
        respond(429, { model: null });
        return;
      }
      const body = decodeSpawn(raw);
      if (!body.taskPrompt.trim() || body.taskPrompt.length > 120_000) {
        respond(400, {});
        return;
      }
      // Explicit arguments have no trusted provenance; never rewrite a possible user choice.
      if (
        "proposedModel" in body ||
        "proposedEffort" in body ||
        (body.forkTurns !== undefined &&
          body.forkTurns !== "none" &&
          !/^[1-9][0-9]*$/.test(body.forkTurns))
      ) {
        respond(200, { model: null });
        return;
      }
      // The registered parent snapshot is not the child's inherited transcript. In particular,
      // parent failures and the parent's selected model cannot establish a child capability floor.
      const inheritedContext = body.forkTurns === "none" ? "none" : "bounded";
      const childContext = sanitizeJevContext({
        existingSession: false,
        hasAttachments: false,
        interactionMode: "subagent",
        originalTask: body.taskPrompt,
        target: { kind: "independent_child", inheritedContext },
        selectionSource: "agent_default",
        historyCompleteness: inheritedContext === "none" ? "complete" : "missing",
        ...(inheritedContext === "bounded"
          ? { missingContext: ["The child's inherited transcript is unavailable to the router."] }
          : {}),
      });
      const candidates = policy.candidates.map((candidate, index) => ({
        ...candidate,
        key: `c${index}`,
        description: sanitizeJevText(
          `${candidate.model ?? candidate.key}: ${candidate.description}`,
        ),
      }));
      const request: JevRouteRequest = {
        requestId: NodeCrypto.randomUUID(),
        prompt: sanitizeJevText(body.taskPrompt),
        candidates,
        context: childContext,
      };
      if (JSON.stringify(request).length > JEV_MAX_REQUEST_CHARS) {
        options.onDecision({
          ...identity,
          request,
          result: failedJevDecision(
            "Subagent routing request exceeds the context limit; Codex retained its original model.",
          ),
        });
        respond(200, { model: null });
        return;
      }
      let cancelled = false;
      const abort = () => {
        cancelled = true;
        options.cancel(request.requestId);
        respond(200, { model: null });
      };
      pending.set(request.requestId, { threadId: body.threadId, abort });
      res.on("close", abort);
      const signal = AbortSignal.timeout(10_000);
      signal.addEventListener("abort", abort, { once: true });
      options.onDecision({ ...identity, request, result: null });
      try {
        let result: JevRouteResult;
        try {
          result = await options.decide(request);
        } catch {
          result = failedJevDecision(
            "Subagent routing unavailable; Codex keeps its selected model.",
          );
        }
        // Preserve accounting even when routing was disabled while awaiting Jev.
        const current = policies.get(body.threadId);
        const index = candidates.findIndex((candidate) => candidate.key === result.choice);
        const selected =
          !cancelled && samePool(current, policy) && index >= 0
            ? policy.candidates[index]
            : undefined;
        const mayRoute =
          (result.policyOutcome === undefined || result.policyOutcome === "route") &&
          typeof result.confidence === "number" &&
          Number.isFinite(result.confidence) &&
          result.confidence >= 0.5 &&
          result.error === null &&
          (result.admissibleCandidateKeys === undefined ||
            (result.choice !== null && result.admissibleCandidateKeys.includes(result.choice)));
        const allowed = selected && mayRoute && isJevCandidateAllowed(selected, childContext);
        const effectiveResult =
          cancelled || !samePool(current, policy)
            ? {
                ...result,
                choice: null,
                error: "Subagent routing cancelled or disabled; Codex retained its original model.",
              }
            : !mayRoute
              ? { ...result, choice: null }
              : result.choice !== null && !allowed
                ? {
                    ...result,
                    choice: null,
                    error:
                      "Unsupported subagent model and effort pair; Codex retained its original model.",
                  }
                : result;
        options.onDecision({ ...identity, request, result: effectiveResult });
        respond(
          200,
          selected && allowed
            ? {
                model: selected.model ?? selected.key,
                ...(result.policyOutcome !== undefined
                  ? { policyOutcome: result.policyOutcome }
                  : {}),
                ...(selected.effort !== undefined ? { effort: selected.effort } : {}),
              }
            : { model: null },
        );
      } finally {
        signal.removeEventListener("abort", abort);
        res.off("close", abort);
        pending.delete(request.requestId);
      }
    } catch {
      respond(400, { model: null });
    }
  });
  server.requestTimeout = 12_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not start Jev desktop broker.");
  return {
    url: `http://127.0.0.1:${address.port}/subagent-route`,
    token,
    clearPolicies() {
      policies.clear();
      for (const entry of pending.values()) entry.abort();
    },
    setPolicy(policy: JevSubagentPolicy) {
      const previous = policies.get(policy.threadId);
      if (previous && JSON.stringify(previous) === JSON.stringify(policy)) return;
      const valid =
        policy.threadId.length > 0 &&
        policy.threadId.length <= 256 &&
        policy.providerInstanceId.length > 0 &&
        policy.candidates.length > 0 &&
        policy.candidates.length <= 128 &&
        new Set(policy.candidates.map((candidate) => candidate.key)).size ===
          policy.candidates.length &&
        policy.candidates.every(
          (candidate) =>
            /^[a-zA-Z0-9._/-]{1,200}$/.test(candidate.key) &&
            candidate.description.length <= 1000 &&
            ((candidate.model === undefined && candidate.effort === undefined) ||
              (typeof candidate.model === "string" &&
                /^[a-zA-Z0-9._/-]{1,200}$/.test(candidate.model) &&
                ["low", "medium", "high", "xhigh"].includes(candidate.effort ?? ""))),
        );
      if (policy.enabled && valid && (policies.has(policy.threadId) || policies.size < 128))
        policies.set(policy.threadId, policy);
      else policies.delete(policy.threadId);
      if (!samePool(previous, policies.get(policy.threadId)))
        for (const entry of pending.values()) if (entry.threadId === policy.threadId) entry.abort();
    },
    async close() {
      policies.clear();
      for (const entry of pending.values()) entry.abort();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
