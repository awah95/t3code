import * as Effect from "effect/Effect";

const interruptOnAbort = (signal: AbortSignal) =>
  Effect.callback<never>((resume) => {
    if (signal.aborted) {
      resume(Effect.interrupt);
      return;
    }

    const onAbort = () => resume(Effect.interrupt);
    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", onAbort));
  });

export const makeJevBrowserRunCancellation = () => {
  const active = new Map<string, Set<AbortController>>();

  const run = <A, E, R>(
    runId: string,
    operation: (signal: AbortSignal) => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const controller = new AbortController();
        const controllers = active.get(runId) ?? new Set<AbortController>();
        controllers.add(controller);
        active.set(runId, controllers);
        return controller;
      }),
      (controller) =>
        Effect.raceFirst(
          Effect.suspend(() => operation(controller.signal)),
          interruptOnAbort(controller.signal),
        ),
      (controller) =>
        Effect.sync(() => {
          const controllers = active.get(runId);
          controllers?.delete(controller);
          if (controllers?.size === 0) active.delete(runId);
        }),
    );

  const cancel = (runId: string) =>
    Effect.sync(() => {
      const controllers = active.get(runId);
      if (controllers === undefined) return false;
      for (const controller of controllers) controller.abort();
      return true;
    });

  return { run, cancel } as const;
};
