import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import { makeJevBrowserRunCancellation } from "./JevBrowserRunCancellation.ts";

describe("JevBrowserRunCancellation", () => {
  it.effect("interrupts every active desktop operation for a run", () =>
    Effect.gen(function* () {
      const cancellation = makeJevBrowserRunCancellation();
      const bothStarted = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let started = 0;
      const operation = cancellation.run("run-1", () =>
        Effect.sync(() => ++started).pipe(
          Effect.tap((count) =>
            count === 2 ? Deferred.succeed(bothStarted, undefined) : Effect.void,
          ),
          Effect.andThen(Deferred.await(release)),
        ),
      );
      const first = yield* Effect.forkChild(operation, { startImmediately: true });
      const second = yield* Effect.forkChild(operation, { startImmediately: true });

      yield* Deferred.await(bothStarted);
      assert.isTrue(yield* cancellation.cancel("run-1"));

      assert.isTrue(Exit.isFailure(yield* Fiber.await(first)));
      assert.isTrue(Exit.isFailure(yield* Fiber.await(second)));
      assert.isFalse(yield* cancellation.cancel("run-1"));
    }),
  );

  it.effect("does not dispatch work registered after cancellation", () =>
    Effect.gen(function* () {
      const cancellation = makeJevBrowserRunCancellation();
      const registered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let dispatched = false;
      const fiber = yield* Effect.forkChild(
        cancellation.run("run-2", (signal) =>
          Deferred.succeed(registered, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(
              Effect.sync(() => {
                if (!signal.aborted) dispatched = true;
              }),
            ),
          ),
        ),
        { startImmediately: true },
      );

      yield* Deferred.await(registered);
      yield* cancellation.cancel("run-2");
      yield* Fiber.await(fiber);
      assert.isFalse(dispatched);
    }),
  );
});
