import { vi } from "vite-plus/test";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { JevBrowserDecideResult } from "@t3tools/contracts";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { DesktopJevCredential } from "../jev/DesktopJevCredential.ts";
import { DesktopJevBrowser, layer } from "./DesktopJevBrowser.ts";

vi.mock("@t3tools/shared/jevAutomationDecision", () => ({
  createOpenRouterJevAutomationDecision: () => ({
    decide: async () => ({
      decision: { outcome: "done" },
      accounting: { inputTokens: 3, outputTokens: 1, costUsd: 0.001 },
    }),
  }),
}));

const decodeBillingEntries = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Array(Schema.Struct({ pending: Schema.Boolean, result: JevBrowserDecideResult })),
  ),
);

const request = {
  runId: "cancelled-run",
  iteration: 1,
  task: "Tab",
  observation: { revision: "1", surface: "browser" as const, controls: [], candidates: [] },
  inputs: [],
  unmetConditions: [],
  priorReceipts: [],
};

describe("DesktopJevBrowser billing lifecycle", () => {
  for (const outcome of ["cancel", "interrupt", "reported"] as const) {
    it.effect(`settles billing on ${outcome} before releasing the run`, () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "jev-browser-test-" });
        const started = yield* Deferred.make<void>();
        const environment = DesktopEnvironment.layer({
          dirname: "/repo/apps/desktop/src",
          homeDirectory: directory,
          platform: "darwin",
          processArch: "arm64",
          appVersion: "0.0.42",
          appPath: "/repo",
          isPackaged: false,
          resourcesPath: "/missing/resources",
          runningUnderArm64Translation: false,
        }).pipe(
          Layer.provide(
            Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ T3CODE_HOME: directory })),
          ),
        );
        const credential = Layer.succeed(DesktopJevCredential, {
          status: Effect.succeed({ hasKey: true, secureStorageAvailable: true }),
          setKey: () => Effect.void,
          useKey: (use) =>
            outcome === "reported"
              ? Effect.asSome(use("test-key", new AbortController().signal))
              : Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
        });
        yield* Effect.gen(function* () {
          const service = yield* DesktopJevBrowser;
          const env = yield* DesktopEnvironment.DesktopEnvironment;
          const fiber = yield* Effect.forkChild(service.decide(request), {
            startImmediately: true,
          });
          if (outcome !== "reported") {
            yield* Deferred.await(started);
            if (outcome === "cancel") yield* service.cancel(request.runId);
            else yield* Fiber.interrupt(fiber);
          }
          const exit = yield* Fiber.await(fiber);
          assert.equal(Exit.isSuccess(exit), outcome === "reported");
          const entries = yield* decodeBillingEntries(
            yield* fs.readFileString(
              env.path.join(env.stateDir, "jev-browser-billing-receipts.json"),
            ),
          );
          assert.lengthOf(entries, 1);
          assert.isFalse(entries[0]!.pending);
          assert.equal(
            entries[0]!.result.accounting.costUsd,
            outcome === "reported" ? 0.001 : null,
          );
          assert.equal(
            entries[0]!.result.decision.outcome,
            outcome === "reported" ? "done" : "unavailable",
          );
        }).pipe(
          Effect.provide(layer.pipe(Layer.provide(credential), Layer.provideMerge(environment))),
        );
      }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
    );
  }
});
