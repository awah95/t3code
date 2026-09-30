import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

type CodexStartupPhase =
  | "spawn"
  | "client"
  | "initialize"
  | "jev-hook"
  | "thread-open"
  | "fork"
  | "startup";

/** Measure startup without logging prompts, credentials, paths, or provider errors. */
export const measureCodexStartupPhase = Effect.fnUntraced(function* <A, E, R>(
  phase: CodexStartupPhase,
  sideChat: boolean,
  operation: Effect.Effect<A, E, R>,
  startedAtOverride?: number,
) {
  const startedAt = startedAtOverride ?? (yield* Clock.currentTimeMillis);
  return yield* operation.pipe(
    Effect.onExit((exit) =>
      Effect.gen(function* () {
        const completedAt = yield* Clock.currentTimeMillis;
        yield* Effect.logInfo("codex session startup phase", {
          phase,
          sideChat,
          durationMs: Math.max(0, completedAt - startedAt),
          outcome: Exit.isSuccess(exit)
            ? "success"
            : Exit.hasInterrupts(exit)
              ? "interrupted"
              : "failure",
          ...(phase === "fork" ? { historyPages: 0, excludeTurns: true } : {}),
        });
      }),
    ),
  );
});
