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
import * as Schema from "effect/Schema";
import { failedJevDecision } from "./decision.ts";

const Identity = Schema.Struct({ threadId: Schema.String, providerInstanceId: Schema.String });
const SpawnRequest = Schema.Struct({ ...Identity.fields, taskPrompt: Schema.String });
const StatusRequest = Schema.Struct({ ...Identity.fields, error: Schema.String });
const decodeIdentity = Schema.decodeUnknownSync(Identity);
const decodeSpawn = Schema.decodeUnknownSync(SpawnRequest);
const decodeStatus = Schema.decodeUnknownSync(StatusRequest);

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
        if (size > 65_536) {
          respond(413, {});
          return;
        }
        chunks.push(bytes);
      }
      const raw: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
      if (!body.taskPrompt.trim() || body.taskPrompt.length > 48_000) {
        respond(400, {});
        return;
      }
      // The desktop UI registers the allowlist; hook callers cannot expand it.
      const candidates = policy.candidates.map((candidate, index) => ({
        key: `c${index}`,
        description: `${candidate.key}: ${candidate.description}`.slice(0, 1000),
      }));
      const request: JevRouteRequest = {
        requestId: NodeCrypto.randomUUID(),
        prompt: body.taskPrompt
          .replace(
            /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
            "[private key redacted]",
          )
          .replace(/Bearer\s+[a-zA-Z0-9._~-]+/gi, "Bearer [redacted]")
          .replace(
            /\b(?:sk-[a-zA-Z0-9_-]{8,}|gh[pousr]_[a-zA-Z0-9_]{8,}|AKIA[A-Z0-9]{16})\b/g,
            "[credential redacted]",
          )
          .replace(
            /\b(api[_-]?key|authorization|password|secret|token)\s*[:=]\s*[^\s,;]+/gi,
            "$1=[redacted]",
          )
          .slice(0, 12_000),
        candidates,
        context: { existingSession: false, hasAttachments: false, interactionMode: "subagent" },
      };
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
        const effectiveResult =
          cancelled || current !== policy
            ? {
                ...result,
                choice: null,
                error: "Subagent routing cancelled or disabled; Codex retained its original model.",
              }
            : result;
        options.onDecision({ ...identity, request, result: effectiveResult });
        const index = candidates.findIndex((candidate) => candidate.key === result.choice);
        respond(200, {
          model:
            !cancelled && current === policy && index >= 0
              ? (policy.candidates[index]?.key ?? null)
              : null,
        });
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
            /^[a-zA-Z0-9._/-]{1,200}$/.test(candidate.key) && candidate.description.length <= 1000,
        );
      if (policy.enabled && valid && (policies.has(policy.threadId) || policies.size < 128))
        policies.set(policy.threadId, policy);
      else policies.delete(policy.threadId);
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
