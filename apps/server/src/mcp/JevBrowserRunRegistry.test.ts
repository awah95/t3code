import { expect, it } from "@effect/vitest";
import { EnvironmentId, PreviewTabId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { make } from "./JevBrowserRunRegistry.ts";

const environmentId = EnvironmentId.make("environment-1");
const threadId = ThreadId.make("thread-1");
const tabId = PreviewTabId.make("tab-1");
const makeAbortController = () => new AbortController();

it.effect("cancels only the exact active environment/thread/run and remains idempotent", () =>
  Effect.gen(function* () {
    const registry = yield* make;
    const abortController = makeAbortController();
    expect(
      yield* registry.acquire({
        environmentId,
        threadId,
        tabId,
        runId: "run-1",
        abortController,
      }),
    ).toBeUndefined();

    expect(
      yield* registry.cancel({ environmentId, threadId: ThreadId.make("other"), runId: "run-1" }),
    ).toEqual({ runId: "run-1", cancelled: false });
    expect(abortController.signal.aborted).toBe(false);

    expect(yield* registry.cancel({ environmentId, threadId, runId: "run-1" })).toEqual({
      runId: "run-1",
      cancelled: true,
    });
    expect(abortController.signal.aborted).toBe(true);
    expect(yield* registry.cancel({ environmentId, threadId, runId: "run-1" })).toEqual({
      runId: "run-1",
      cancelled: true,
    });

    yield* registry.release({ environmentId, threadId, tabId, runId: "run-1" });
    expect(yield* registry.cancel({ environmentId, threadId, runId: "run-1" })).toEqual({
      runId: "run-1",
      cancelled: false,
    });
  }),
);

it.effect("keeps the tab lock until its exact owner releases it", () =>
  Effect.gen(function* () {
    const registry = yield* make;
    const first = {
      environmentId,
      threadId,
      tabId,
      runId: "run-1",
      abortController: makeAbortController(),
    };
    expect(yield* registry.acquire(first)).toBeUndefined();
    expect(
      yield* registry.acquire({
        ...first,
        threadId: ThreadId.make("thread-2"),
        runId: "run-2",
        abortController: makeAbortController(),
      }),
    ).toBe("run-1");

    yield* registry.release({ ...first, runId: "wrong-run" });
    expect(
      yield* registry.acquire({
        ...first,
        threadId: ThreadId.make("thread-2"),
        runId: "run-2",
        abortController: makeAbortController(),
      }),
    ).toBe("run-1");

    yield* registry.release(first);
    expect(
      yield* registry.acquire({
        ...first,
        threadId: ThreadId.make("thread-2"),
        runId: "run-2",
        abortController: makeAbortController(),
      }),
    ).toBeUndefined();
  }),
);
