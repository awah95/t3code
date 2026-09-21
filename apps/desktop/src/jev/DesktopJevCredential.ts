import type { JevStatus } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";

export class JevCredentialError extends Schema.TaggedError<JevCredentialError>()(
  "JevCredentialError",
  { message: Schema.String },
) {}

export class DesktopJevCredential extends Context.Service<
  DesktopJevCredential,
  {
    readonly status: Effect.Effect<JevStatus>;
    readonly setKey: (key: string | null) => Effect.Effect<void, JevCredentialError>;
    /** Runs only in the desktop main process; the credential is never returned over IPC. */
    readonly useKey: <A, E, R>(
      use: (key: string, credentialSignal: AbortSignal) => Effect.Effect<A, E, R>,
    ) => Effect.Effect<Option.Option<A>, E, R>;
  }
>()("@t3tools/desktop/jev/DesktopJevCredential") {}

export const layer = Layer.effect(
  DesktopJevCredential,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const storage = yield* ElectronSafeStorage.ElectronSafeStorage;
    const keyPath = path.join(environment.stateDir, "jev-openrouter-key.encrypted");
    const active = new Set<AbortController>();
    let generation = 0;
    let changing = false;
    const available = Effect.gen(function* () {
      if (!(yield* storage.isEncryptionAvailable)) return false;
      return Option.getOrNull(yield* storage.selectedStorageBackend) !== "basic_text";
    }).pipe(Effect.catch(() => Effect.succeed(false)));
    const readKey = Effect.gen(function* () {
      if (!(yield* available)) return null;
      if (!(yield* fs.exists(keyPath))) return null;
      return yield* storage.decryptString(yield* fs.readFile(keyPath));
    }).pipe(Effect.catch(() => Effect.succeed(null)));

    return DesktopJevCredential.of({
      status: Effect.gen(function* () {
        return { hasKey: (yield* readKey) !== null, secureStorageAvailable: yield* available };
      }),
      setKey: (key) =>
        Effect.gen(function* () {
          if (key === null) {
            yield* Effect.sync(() => {
              changing = true;
              generation += 1;
              for (const controller of active) controller.abort();
            });
            yield* fs
              .remove(keyPath, { force: true })
              .pipe(Effect.ensuring(Effect.sync(() => (changing = false))));
            return;
          }
          const clean = key.trim();
          if (!clean || clean.length > 4096 || /\s/.test(clean)) {
            return yield* new JevCredentialError({ message: "Enter a valid OpenRouter API key." });
          }
          if (!(yield* available)) {
            return yield* new JevCredentialError({
              message: "Secure OS credential storage is unavailable.",
            });
          }
          const encrypted = yield* storage.encryptString(clean);
          yield* Effect.sync(() => {
            changing = true;
            generation += 1;
            for (const controller of active) controller.abort();
          });
          yield* Effect.gen(function* () {
            yield* fs.makeDirectory(environment.stateDir, { recursive: true });
            const temporary = `${keyPath}.tmp`;
            yield* fs.writeFile(temporary, encrypted, { mode: 0o600 });
            yield* fs.rename(temporary, keyPath);
          }).pipe(Effect.ensuring(Effect.sync(() => (changing = false))));
        }).pipe(
          Effect.mapError(
            () =>
              new JevCredentialError({
                message:
                  "Could not update the encrypted Jev API key. Check secure OS storage availability.",
              }),
          ),
        ),
      useKey: (use) =>
        Effect.suspend(() => {
          if (changing) return Effect.succeed(Option.none());
          const observedGeneration = generation;
          return Effect.flatMap(readKey, (key) => {
            if (key === null) return Effect.succeed(Option.none());
            return Effect.flatMap(
              Effect.sync(() => {
                if (changing || generation !== observedGeneration) return null;
                const controller = new AbortController();
                active.add(controller);
                return controller;
              }),
              (controller) =>
                controller === null
                  ? Effect.succeed(Option.none())
                  : Effect.acquireUseRelease(
                      Effect.succeed(controller),
                      (registered) => Effect.map(use(key, registered.signal), Option.some),
                      (registered) =>
                        Effect.sync(() => {
                          active.delete(registered);
                        }),
                    ),
            );
          });
        }),
    });
  }),
);
