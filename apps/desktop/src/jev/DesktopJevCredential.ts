import type { JevApiProvider, JevStatus } from "@t3tools/contracts";
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
    readonly setProvider: (provider: JevApiProvider) => Effect.Effect<void, JevCredentialError>;
    readonly setProviderKey: (
      provider: JevApiProvider,
      key: string | null,
    ) => Effect.Effect<void, JevCredentialError>;
    readonly setKey: (key: string | null) => Effect.Effect<void, JevCredentialError>;
    /** Runs only in the desktop main process; the credential is never returned over IPC. */
    readonly useKey: <A, E, R>(
      use: (
        key: string,
        credentialSignal: AbortSignal,
        provider: JevApiProvider,
      ) => Effect.Effect<A, E, R>,
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
    const keyPath = (provider: JevApiProvider) =>
      path.join(environment.stateDir, `jev-${provider}-key.encrypted`);
    const providerPath = path.join(environment.stateDir, "jev-provider.json");
    let selectedProvider: JevApiProvider = "openrouter";
    if (yield* fs.exists(providerPath)) {
      const saved = yield* fs.readFileString(providerPath);
      if (saved === "typesafe") selectedProvider = "typesafe";
    }
    const active = new Set<AbortController>();
    let generation = 0;
    let changing = false;
    const available = Effect.gen(function* () {
      if (!(yield* storage.isEncryptionAvailable)) return false;
      return Option.getOrNull(yield* storage.selectedStorageBackend) !== "basic_text";
    }).pipe(Effect.catch(() => Effect.succeed(false)));
    const readKey = (provider: JevApiProvider) =>
      Effect.gen(function* () {
        if (!(yield* available)) return null;
        if (!(yield* fs.exists(keyPath(provider)))) return null;
        return yield* storage.decryptString(yield* fs.readFile(keyPath(provider)));
      }).pipe(Effect.catch(() => Effect.succeed(null)));

    const setProviderKey = (provider: JevApiProvider, key: string | null) =>
      Effect.gen(function* () {
        if (key === null) {
          changing = true;
          generation += 1;
          for (const controller of active) controller.abort();
          yield* fs
            .remove(keyPath(provider), { force: true })
            .pipe(Effect.ensuring(Effect.sync(() => (changing = false))));
          return;
        }
        const clean = key.trim();
        if (!clean || clean.length > 4096 || /\s/.test(clean))
          return yield* new JevCredentialError({ message: "Enter a valid Jev API key." });
        if (!(yield* available))
          return yield* new JevCredentialError({
            message: "Secure OS credential storage is unavailable.",
          });
        const encrypted = yield* storage.encryptString(clean);
        changing = true;
        generation += 1;
        for (const controller of active) controller.abort();
        yield* Effect.gen(function* () {
          yield* fs.makeDirectory(environment.stateDir, { recursive: true });
          const temporary = `${keyPath(provider)}.tmp`;
          yield* fs.writeFile(temporary, encrypted, { mode: 0o600 });
          yield* fs.rename(temporary, keyPath(provider));
        }).pipe(Effect.ensuring(Effect.sync(() => (changing = false))));
      }).pipe(
        Effect.mapError(
          () => new JevCredentialError({ message: "Could not update the encrypted Jev API key." }),
        ),
      );
    return DesktopJevCredential.of({
      status: Effect.gen(function* () {
        const openrouter = (yield* readKey("openrouter")) !== null;
        const typesafe = (yield* readKey("typesafe")) !== null;
        return {
          provider: selectedProvider,
          keys: { openrouter, typesafe },
          hasKey: selectedProvider === "typesafe" ? typesafe : openrouter,
          secureStorageAvailable: yield* available,
        };
      }),
      setProvider: (provider) =>
        Effect.gen(function* () {
          changing = true;
          generation += 1;
          for (const controller of active) controller.abort();
          try {
            yield* fs.makeDirectory(environment.stateDir, { recursive: true });
            yield* fs.writeFileString(providerPath, provider);
            selectedProvider = provider;
          } finally {
            changing = false;
          }
        }).pipe(
          Effect.mapError(
            () => new JevCredentialError({ message: "Could not save Jev provider." }),
          ),
        ),
      setKey: (key) => setProviderKey("openrouter", key),
      setProviderKey,
      useKey: (use) =>
        Effect.suspend(() => {
          if (changing) return Effect.succeed(Option.none());
          const observedGeneration = generation;
          const observedProvider = selectedProvider;
          return Effect.flatMap(readKey(observedProvider), (key) => {
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
                      (registered) =>
                        Effect.map(use(key, registered.signal, observedProvider), Option.some),
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
