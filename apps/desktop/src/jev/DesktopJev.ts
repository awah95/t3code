import type {
  JevRouteRequest,
  JevRouteResult,
  JevStatus,
  JevApiProvider,
} from "@t3tools/contracts";
import { isValidJevRouteRequest } from "@t3tools/jev/requestValidation";
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
    readonly setProvider: (provider: JevApiProvider) => Effect.Effect<void, JevCredentialError>;
    readonly setProviderKey: (
      provider: JevApiProvider,
      key: string | null,
    ) => Effect.Effect<void, JevCredentialError>;
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
      setProvider: (provider) => credential.setProvider(provider),
      setProviderKey: (provider, key) => credential.setProviderKey(provider, key),
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
          if (!isValidJevRouteRequest(request)) {
            return failedJevDecision("Invalid routing request; using the selected model.");
          }
          if (pending.size >= 8 || pending.has(request.requestId))
            return failedJevDecision("Jev is busy; using the selected model.");
          const controller = new AbortController();
          pending.set(request.requestId, controller);
          const result = yield* credential.useKey((key, credentialSignal, provider) =>
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
                  fetch,
                  provider,
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
                : "Add a key for the selected Jev provider in Settings to use Jev Auto. Using the selected model.",
            );
          }
          return result.value;
        }),
    });
  }),
);
