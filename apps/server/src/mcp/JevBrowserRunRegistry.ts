import type {
  CancelBrowserRunInput,
  CancelBrowserRunResult,
  EnvironmentId,
  PreviewTabId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SynchronizedRef from "effect/SynchronizedRef";

interface ActiveBrowserRun {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly tabId: PreviewTabId;
  readonly runId: string;
  readonly abortController: AbortController;
}

export interface AcquireBrowserRunInput extends ActiveBrowserRun {}

export interface ReleaseBrowserRunInput {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly tabId: PreviewTabId;
  readonly runId: string;
}

const keyOf = (environmentId: EnvironmentId, tabId: PreviewTabId) =>
  `${environmentId}\u0000${tabId}`;

export class JevBrowserRunRegistry extends Context.Service<
  JevBrowserRunRegistry,
  {
    /** Returns the conflicting run id, or undefined after acquiring the tab. */
    readonly acquire: (input: AcquireBrowserRunInput) => Effect.Effect<string | undefined>;
    readonly release: (input: ReleaseBrowserRunInput) => Effect.Effect<void>;
    /** Aborts only an exact environment/thread/run match. Repeated active cancellation is safe. */
    readonly cancel: (input: CancelBrowserRunInput) => Effect.Effect<CancelBrowserRunResult>;
  }
>()("t3/mcp/JevBrowserRunRegistry") {}

export const make = Effect.gen(function* () {
  const active = yield* SynchronizedRef.make(new Map<string, ActiveBrowserRun>());
  return JevBrowserRunRegistry.of({
    acquire: (input) =>
      SynchronizedRef.modify(active, (current) => {
        const key = keyOf(input.environmentId, input.tabId);
        const existing = current.get(key);
        if (existing !== undefined) return [existing.runId, current] as const;
        const next = new Map(current);
        next.set(key, input);
        return [undefined, next] as const;
      }),
    release: (input) =>
      SynchronizedRef.update(active, (current) => {
        const key = keyOf(input.environmentId, input.tabId);
        const existing = current.get(key);
        if (
          existing?.runId !== input.runId ||
          existing.threadId !== input.threadId ||
          existing.environmentId !== input.environmentId
        ) {
          return current;
        }
        const next = new Map(current);
        next.delete(key);
        return next;
      }),
    cancel: (input) =>
      SynchronizedRef.get(active).pipe(
        Effect.map((current) =>
          [...current.values()].find(
            (run) =>
              run.environmentId === input.environmentId &&
              run.threadId === input.threadId &&
              run.runId === input.runId,
          ),
        ),
        Effect.flatMap((run) =>
          Effect.sync(() => {
            if (!run) return { runId: input.runId, cancelled: false };
            run.abortController.abort(new Error("Browser run cancelled by the user."));
            return { runId: input.runId, cancelled: true };
          }),
        ),
      ),
  });
});

/** Effect handler used by WebSocket/RPC wiring without exposing registry internals. */
export const cancelJevBrowserRun = Effect.fn("JevBrowserRunRegistry.cancel")(function* (
  input: CancelBrowserRunInput,
) {
  const registry = yield* JevBrowserRunRegistry;
  return yield* registry.cancel(input);
});

export const layer = Layer.effect(JevBrowserRunRegistry, make);
