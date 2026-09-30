import * as NodeAssert from "node:assert/strict";

import { it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Logger from "effect/Logger";
import * as TestClock from "effect/testing/TestClock";
import { describe } from "vite-plus/test";

import { measureCodexStartupPhase } from "./CodexStartupTiming.ts";

describe("Codex startup timing", () => {
  it.effect("records elapsed phase time while returning the provider response intact", () => {
    const messages: unknown[] = [];
    const logger = Logger.make<unknown, void>(({ message }) => {
      messages.push(message);
    });
    const response = { thread: { id: "child" }, privateValue: "not-for-diagnostics" };
    return Effect.gen(function* () {
      const result = yield* measureCodexStartupPhase(
        "fork",
        true,
        TestClock.adjust("37 millis").pipe(Effect.as(response)),
      );
      NodeAssert.strictEqual(result, response);
      NodeAssert.deepEqual(messages, [
        [
          "codex session startup phase",
          {
            phase: "fork",
            sideChat: true,
            durationMs: 37,
            outcome: "success",
            historyPages: 0,
            excludeTurns: true,
          },
        ],
      ]);
    }).pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false })));
  });

  it.effect("records failed startup without leaking the provider error or changing it", () => {
    const messages: unknown[] = [];
    const logger = Logger.make<unknown, void>(({ message }) => {
      messages.push(message);
    });
    const error = new Error("secret-token prompt-content /private/path");
    return Effect.gen(function* () {
      const result = yield* Effect.flip(
        measureCodexStartupPhase("initialize", false, Effect.fail(error)),
      );
      NodeAssert.strictEqual(result, error);
      NodeAssert.deepEqual(messages, [
        [
          "codex session startup phase",
          {
            phase: "initialize",
            sideChat: false,
            durationMs: 0,
            outcome: "failure",
          },
        ],
      ]);
    }).pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false })));
  });

  it.effect("records interrupted startup and retains total time from before spawning", () => {
    const messages: unknown[] = [];
    const logger = Logger.make<unknown, void>(({ message }) => {
      messages.push(message);
    });
    return Effect.gen(function* () {
      const reached = yield* Deferred.make<void>();
      yield* TestClock.adjust("12 millis");
      const fiber = yield* measureCodexStartupPhase(
        "startup",
        true,
        Deferred.succeed(reached, undefined).pipe(Effect.andThen(Effect.never)),
        0,
      ).pipe(Effect.forkChild);
      yield* Deferred.await(reached);
      yield* Fiber.interrupt(fiber);
      NodeAssert.deepEqual(messages, [
        [
          "codex session startup phase",
          {
            phase: "startup",
            sideChat: true,
            durationMs: 12,
            outcome: "interrupted",
          },
        ],
      ]);
    }).pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false })));
  });
});
