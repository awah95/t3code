import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";
import * as DesktopJev from "./DesktopJev.ts";
import * as DesktopJevCredential from "./DesktopJevCredential.ts";

vi.mock("electron", () => ({ safeStorage: {} }));

function testLayer(baseDir: string, available: boolean, backend?: string) {
  const secrets = new Map<number, string>();
  let sequence = 0;
  const storage = Layer.succeed(ElectronSafeStorage.ElectronSafeStorage, {
    isEncryptionAvailable: Effect.succeed(available),
    selectedStorageBackend: Effect.succeed(Option.fromNullishOr(backend)),
    encryptString: (value) =>
      Effect.sync(() => {
        secrets.set(++sequence, value);
        return new Uint8Array([sequence]);
      }),
    decryptString: (value) =>
      Effect.suspend(() => {
        const secret = secrets.get(value[0] ?? -1);
        return secret === undefined
          ? Effect.fail(
              new ElectronSafeStorage.ElectronSafeStorageDecryptError({
                cause: "test corrupt ciphertext",
              }),
            )
          : Effect.succeed(secret);
      }),
  });
  const environment = DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: baseDir,
    platform: "darwin",
    processArch: "arm64",
    appVersion: "0.0.42",
    appPath: "/repo",
    isPackaged: false,
    resourcesPath: "/missing/resources",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ T3CODE_HOME: baseDir })),
    ),
  );
  return DesktopJev.layer.pipe(
    Layer.provideMerge(DesktopJevCredential.layer),
    Layer.provideMerge(environment),
    Layer.provide(storage),
    Layer.provideMerge(NodeServices.layer),
  );
}

function withJev<A, E>(
  effect: Effect.Effect<
    A,
    E,
    | DesktopJev.DesktopJev
    | DesktopJevCredential.DesktopJevCredential
    | DesktopEnvironment.DesktopEnvironment
    | FileSystem.FileSystem
  >,
  available = true,
  backend?: string,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-jev-test-" });
    return yield* effect.pipe(Effect.provide(testLayer(directory, available, backend)));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);
}

describe("DesktopJev credential storage", () => {
  it.effect("stores only encrypted bytes, returns status without the key, and removes it", () =>
    withJev(
      Effect.gen(function* () {
        const service = yield* DesktopJev.DesktopJev;
        const fs = yield* FileSystem.FileSystem;
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        assert.deepInclude(yield* service.status, { hasKey: false, secureStorageAvailable: true });
        yield* service.setKey("test-private-openrouter-key");
        const file = environment.path.join(environment.stateDir, "jev-openrouter-key.encrypted");
        const bytes = yield* fs.readFile(file);
        assert.deepEqual([...bytes], [1]);
        assert.deepInclude(yield* service.status, { hasKey: true, secureStorageAvailable: true });
        yield* service.setKey(null);
        assert.isFalse(yield* fs.exists(file));
        assert.isFalse((yield* service.status).hasKey);
      }),
    ),
  );

  it.effect("keeps separate provider keys and restores the selected provider", () =>
    withJev(
      Effect.gen(function* () {
        const service = yield* DesktopJev.DesktopJev;
        yield* service.setKey("openrouter-key");
        yield* service.setProvider("typesafe");
        assert.deepInclude(yield* service.status, { provider: "typesafe", hasKey: false });
        yield* service.setProviderKey("typesafe", "typesafe-key");
        assert.deepInclude(yield* service.status, {
          provider: "typesafe",
          hasKey: true,
          keys: { openrouter: true, typesafe: true },
        });
        yield* service.setProviderKey("typesafe", null);
        assert.deepInclude(yield* service.status, {
          provider: "typesafe",
          hasKey: false,
          keys: { openrouter: true, typesafe: false },
        });
        yield* service.setProvider("openrouter");
        assert.isTrue((yield* service.status).hasKey);
      }),
    ),
  );

  it.effect("sends the selected TypeSafe key to the TypeSafe endpoint", () =>
    withJev(
      Effect.gen(function* () {
        const transport = vi
          .spyOn(globalThis, "fetch")
          .mockResolvedValue(new Response("", { status: 401 }));
        try {
          const service = yield* DesktopJev.DesktopJev;
          yield* service.setProvider("typesafe");
          yield* service.setProviderKey("typesafe", "test-typesafe-key");
          const result = yield* service.decide({
            requestId: "typesafe-route",
            prompt: "Review code",
            candidates: [{ key: "fast", description: "Fast" }],
            context: { existingSession: false, hasAttachments: false, interactionMode: "default" },
          });
          assert.include(result.error ?? "", "HTTP 401");
          assert.equal(transport.mock.calls.length, 1);
          const [url, init] = transport.mock.calls[0]!;
          assert.equal(url, "https://api.typesafe.ai/v1/systemone");
          assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-typesafe-key");
          assert.include(String(init?.body), '"model":"jev-latest"');
        } finally {
          transport.mockRestore();
        }
      }),
    ),
  );

  it.effect("refuses to persist when OS encryption is unavailable", () =>
    withJev(
      Effect.gen(function* () {
        const service = yield* DesktopJev.DesktopJev;
        assert.isTrue(yield* Effect.isFailure(service.setKey("test-private-key")));
        assert.deepInclude(yield* service.status, { hasKey: false, secureStorageAvailable: false });
      }),
      false,
    ),
  );

  it.effect("refuses the Linux plaintext safe-storage backend", () =>
    withJev(
      Effect.gen(function* () {
        const service = yield* DesktopJev.DesktopJev;
        assert.isTrue(yield* Effect.isFailure(service.setKey("test-private-key")));
        assert.deepInclude(yield* service.status, { hasKey: false, secureStorageAvailable: false });
      }),
      true,
      "basic_text",
    ),
  );

  it.effect("accepts full long prompts and visibly rejects oversized context", () =>
    withJev(
      Effect.gen(function* () {
        const service = yield* DesktopJev.DesktopJev;
        const request = {
          requestId: "long",
          prompt: "x".repeat(20000),
          candidates: [{ key: "fast", description: "Fast" }],
          context: { existingSession: false, hasAttachments: false, interactionMode: "default" },
        };
        assert.include((yield* service.decide(request)).error ?? "", "selected Jev provider");
        const oversized = yield* service.decide({
          ...request,
          context: { ...request.context, originalTask: "x".repeat(240000) },
        });
        assert.include(oversized.error ?? "", "Invalid routing request");
      }),
    ),
  );

  it.effect("falls back without credentials and rejects malformed input", () =>
    withJev(
      Effect.gen(function* () {
        const service = yield* DesktopJev.DesktopJev;
        const request = {
          requestId: "test",
          prompt: "Review code",
          candidates: [{ key: "fast", description: "Fast" }],
          context: { existingSession: false, hasAttachments: false, interactionMode: "default" },
        };
        const missingKey = yield* service.decide(request);
        assert.isNull(missingKey.choice);
        assert.include(missingKey.error ?? "", "selected Jev provider");
        yield* service.setKey("test-private-key");
        const invalid = yield* service.decide({ ...request, candidates: [] });
        assert.isNull(invalid.choice);
        assert.include(invalid.error ?? "", "Invalid routing request");
      }),
    ),
  );

  it.effect("aborts every active credential consumer before removing the shared key", () =>
    withJev(
      Effect.gen(function* () {
        const jev = yield* DesktopJev.DesktopJev;
        const credential = yield* DesktopJevCredential.DesktopJevCredential;
        let markStarted!: () => void;
        let markAborted!: () => void;
        const started = new Promise<void>((resolve) => {
          markStarted = resolve;
        });
        const aborted = new Promise<void>((resolve) => {
          markAborted = resolve;
        });
        yield* jev.setKey("test-private-key");
        const fiber = yield* credential
          .useKey((_key, signal) =>
            Effect.callback<void>((resume) => {
              markStarted();
              const onAbort = () => {
                markAborted();
                resume(Effect.void);
              };
              signal.addEventListener("abort", onAbort, { once: true });
              return Effect.sync(() => signal.removeEventListener("abort", onAbort));
            }),
          )
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.promise(() => started);
        yield* jev.setKey(null);
        yield* Effect.promise(() => aborted);
        yield* Fiber.join(fiber);
      }),
    ),
  );
});
