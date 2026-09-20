import type { JevRouteRequest, JevRouteResult, JevStatus } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";
import { failedJevDecision, JEV_TIMEOUT_MS, requestJevDecision } from "./decision.ts";

export class JevCredentialError extends Schema.TaggedError<JevCredentialError>()(
  "JevCredentialError",
  { message: Schema.String },
) {}

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
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const storage = yield* ElectronSafeStorage.ElectronSafeStorage;
    const keyPath = path.join(environment.stateDir, "jev-openrouter-key.encrypted");
    const pending = new Map<string, AbortController>();
    const available = Effect.gen(function* () {
      if (!(yield* storage.isEncryptionAvailable)) return false;
      return Option.getOrNull(yield* storage.selectedStorageBackend) !== "basic_text";
    }).pipe(Effect.catch(() => Effect.succeed(false)));
    const readKey = Effect.gen(function* () {
      if (!(yield* available)) return null;
      if (!(yield* fs.exists(keyPath))) return null;
      return yield* storage.decryptString(yield* fs.readFile(keyPath));
    }).pipe(Effect.catch(() => Effect.succeed(null)));

    return DesktopJev.of({
      status: Effect.gen(function* () {
        return { hasKey: (yield* readKey) !== null, secureStorageAvailable: yield* available };
      }),
      setKey: (key) =>
        Effect.gen(function* () {
          if (key === null) {
            for (const controller of pending.values()) controller.abort();
            yield* fs.remove(keyPath, { force: true });
            return;
          }
          const clean = key.trim();
          if (!clean || clean.length > 4096 || /\s/.test(clean))
            return yield* new JevCredentialError({ message: "Enter a valid OpenRouter API key." });
          if (!(yield* available))
            return yield* new JevCredentialError({
              message: "Secure OS credential storage is unavailable.",
            });
          const encrypted = yield* storage.encryptString(clean);
          yield* fs.makeDirectory(environment.stateDir, { recursive: true });
          const temporary = `${keyPath}.tmp`;
          yield* fs.writeFile(temporary, encrypted, { mode: 0o600 });
          yield* fs.rename(temporary, keyPath);
        }).pipe(
          Effect.mapError(
            () =>
              new JevCredentialError({
                message:
                  "Could not update the encrypted Jev API key. Check secure OS storage availability.",
              }),
          ),
        ),
      cancel: (id) =>
        Effect.sync(() => {
          pending.get(id)?.abort();
        }),
      decide: (request) =>
        Effect.gen(function* () {
          if (
            !request.requestId ||
            request.requestId.length > 128 ||
            request.prompt.length > 12_000 ||
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
          const key = yield* readKey;
          if (!key || controller.signal.aborted) {
            pending.delete(request.requestId);
            return failedJevDecision(
              controller.signal.aborted
                ? "Jev routing cancelled."
                : "Add an OpenRouter key in Settings to use Jev Auto. Using the selected model.",
            );
          }
          return yield* Effect.tryPromise(async () => {
            try {
              return await requestJevDecision(
                request,
                key,
                AbortSignal.any([controller.signal, AbortSignal.timeout(JEV_TIMEOUT_MS)]),
              );
            } finally {
              pending.delete(request.requestId);
            }
          }).pipe(
            Effect.catch(() =>
              Effect.succeed(failedJevDecision("Jev failed; using the selected model.")),
            ),
          );
        }),
    });
  }),
);
