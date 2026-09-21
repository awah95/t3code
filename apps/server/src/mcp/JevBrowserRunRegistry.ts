import type { EnvironmentId, PreviewTabId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SynchronizedRef from "effect/SynchronizedRef";

const keyOf = (environmentId: EnvironmentId, tabId: PreviewTabId) =>
  `${environmentId}\u0000${tabId}`;

export class JevBrowserRunRegistry extends Context.Service<
  JevBrowserRunRegistry,
  {
    readonly acquire: (
      environmentId: EnvironmentId,
      tabId: PreviewTabId,
      runId: string,
    ) => Effect.Effect<string | undefined>;
    readonly release: (
      environmentId: EnvironmentId,
      tabId: PreviewTabId,
      runId: string,
    ) => Effect.Effect<void>;
  }
>()("t3/mcp/JevBrowserRunRegistry") {}

export const make = Effect.gen(function* () {
  const active = yield* SynchronizedRef.make(new Map<string, string>());
  return JevBrowserRunRegistry.of({
    acquire: (environmentId, tabId, runId) =>
      SynchronizedRef.modify(active, (current) => {
        const key = keyOf(environmentId, tabId);
        const existing = current.get(key);
        if (existing !== undefined) return [existing, current] as const;
        const next = new Map(current);
        next.set(key, runId);
        return [undefined, next] as const;
      }),
    release: (environmentId, tabId, runId) =>
      SynchronizedRef.update(active, (current) => {
        const key = keyOf(environmentId, tabId);
        if (current.get(key) !== runId) return current;
        const next = new Map(current);
        next.delete(key);
        return next;
      }),
  });
});

export const layer = Layer.effect(JevBrowserRunRegistry, make);
