import type { JevRouteRequest, JevRouteResult, JevStatus } from "@t3tools/contracts";
import { JEV_MAX_REQUEST_CHARS } from "@t3tools/shared/jevRouting";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { failedJevDecision, JEV_TIMEOUT_MS, requestJevDecision } from "./decision.ts";
import { DesktopJevCredential, JevCredentialError } from "./DesktopJevCredential.ts";

export { JevCredentialError } from "./DesktopJevCredential.ts";

export class DesktopJev extends Context.Service<
  DesktopJev,
  {
    readonly status: Effect.Effect<JevStatus>;
    readonly setKey: (key: string | null) => Effect.Effect<void, JevCredentialError>;
    readonly decide: (request: JevRouteRequest) => Effect.Effect<JevRouteResult>;
    readonly cancel: (id: string) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/jev/DesktopJev") {}

export const layer = Layer.effect(
  DesktopJev,
  Effect.gen(function* () {
    const credential = yield* DesktopJevCredential;
    const pending = new Map<string, AbortController>();

    return DesktopJev.of({
      status: credential.status,
      setKey: (key) =>
        Effect.gen(function* () {
          if (key === null) {
            for (const controller of pending.values()) controller.abort();
          }
          yield* credential.setKey(key);
        }),
      cancel: (id) =>
        Effect.sync(() => {
          pending.get(id)?.abort();
        }),
      decide: (request) =>
        Effect.gen(function* () {
          if (
            !request.requestId ||
            request.requestId.length > 128 ||
            // Serialized size is the wire boundary limit, including optional context.
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify(request).length > JEV_MAX_REQUEST_CHARS ||
            request.candidates.length < 1 ||
            request.candidates.length > 128 ||
            new Set(request.candidates.map((candidate) => candidate.key)).size !==
              request.candidates.length ||
            request.candidates.some(
              (candidate) =>
                !/^[a-zA-Z0-9_-]{1,128}$/.test(candidate.key) ||
                candidate.description.length > 1000,
            )
          ) {
            return failedJevDecision("Invalid routing request; using the selected model.");
          }
          if (pending.size >= 8 || pending.has(request.requestId))
            return failedJevDecision("Jev is busy; using the selected model.");
          const controller = new AbortController();
          pending.set(request.requestId, controller);
          const result = yield* credential.useKey((key, credentialSignal) =>
            Effect.tryPromise(async () => {
              try {
                return await requestJevDecision(
                  request,
                  key,
                  AbortSignal.any([
                    controller.signal,
                    credentialSignal,
                    AbortSignal.timeout(JEV_TIMEOUT_MS),
                  ]),
                );
              } finally {
                pending.delete(request.requestId);
              }
            }).pipe(
              Effect.catch(() =>
                Effect.succeed(failedJevDecision("Jev failed; using the selected model.")),
              ),
            ),
          );
          if (Option.isNone(result) || controller.signal.aborted) {
            pending.delete(request.requestId);
            return failedJevDecision(
              controller.signal.aborted
                ? "Jev routing cancelled."
                : "Add an OpenRouter key in Settings to use Jev Auto. Using the selected model.",
            );
          }
          return result.value;
        }),
    });
  }),
);
