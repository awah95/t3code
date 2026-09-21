import { EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const atomState = vi.hoisted(() => ({
  turns: { _tag: "Initial" as string, value: null as unknown },
  detail: { _tag: "Initial" as string, value: null as unknown },
}));

vi.mock("@effect/atom-react", () => ({
  useAtomRefresh: () => () => {},
  useAtomValue: (atom: { kind: "turns" | "detail" }) => atomState[atom.kind],
}));

vi.mock("effect/unstable/reactivity", () => ({
  AsyncResult: {
    value: (result: { _tag: string; value: unknown }) =>
      result._tag === "Success" ? { _tag: "Some", value: result.value } : { _tag: "None" },
  },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/usage">{children}</a>,
}));

vi.mock("../../state/server", () => ({
  serverEnvironment: {
    codexLedgerTurns: () => ({ kind: "turns" as const }),
    codexLedgerTurn: () => ({ kind: "detail" as const }),
  },
}));

import { CodexTurnUsage } from "./CodexTurnUsage";

const valuation = (amount: string) => ({
  snapshotId: "snapshot",
  calculationVersion: "1",
  estimateKind: "standardApiEquivalent" as const,
  pricedSubtotalUsd: amount,
  completeEstimateUsd: amount,
  unpricedResponseCount: 0,
  missingPriceReasons: [],
});

const tokens = (processedTokens: number) => ({
  inputTokens: processedTokens,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  processedTokens,
});

const coverage = {
  usage: "exact" as const,
  model: "observed" as const,
  pricing: "priced" as const,
  lineage: "resolved" as const,
  subscription: "unknown" as const,
};

const rootTurn = {
  identity: {
    sourceDomain: "source",
    codexThreadId: "root-thread",
    codexTurnId: "root-turn",
    rootTurnId: "root-turn",
    t3EnvironmentId: "environment",
    t3ProjectId: "project",
    t3ThreadId: "thread",
    t3TurnId: "turn",
    t3MessageId: "message",
  },
  startedAt: "2026-09-21T10:00:00.000Z",
  finishedAt: "2026-09-21T10:00:01.000Z",
  model: "gpt-5.6-sol",
  effort: "medium",
  scope: "main" as const,
  lifecycle: "completed" as const,
  responseCount: 1,
  childTurnCount: 2,
  tokens: tokens(26_701),
  valuation: valuation("0.0637128"),
  coverage,
};

const childTurn = (index: number, model: string, tokenCount: number, amount: string) => ({
  ...rootTurn,
  identity: {
    ...rootTurn.identity,
    codexThreadId: `child-thread-${index}`,
    codexTurnId: `child-turn-${index}`,
    t3ThreadId: null,
    t3TurnId: null,
    t3MessageId: null,
  },
  model,
  scope: "child" as const,
  childTurnCount: 0,
  tokens: tokens(tokenCount),
  valuation: valuation(amount),
});

beforeEach(() => {
  atomState.turns = { _tag: "Success", value: { items: [rootTurn], nextCursor: null } };
  atomState.detail = {
    _tag: "Success",
    value: {
      turn: rootTurn,
      responses: [],
      family: {
        rootTurnId: "root-turn",
        includedTurnCount: 3,
        childTurnCount: 2,
        unresolvedChildCount: 0,
        activeChildTurnCount: 0,
        childPreviewTruncated: false,
        tokens: tokens(30_935),
        valuation: valuation("0.100057"),
        coverage,
      },
      childTurns: [
        childTurn(1, "gpt-5.6-luna", 1_234, "0.012345"),
        childTurn(2, "gpt-5.6-terra", 3_000, "0.023999"),
      ],
      tools: [],
    },
  };
});

describe("CodexTurnUsage", () => {
  it("shows compact usage and expands into per-child model, token, and cost rows", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let renderer: ReactTestRenderer | undefined;
    await act(() => {
      renderer = create(
        <CodexTurnUsage
          environmentId={EnvironmentId.make("environment")}
          threadId={ThreadId.make("thread")}
          turnId={TurnId.make("turn")}
          isLatestTurn={false}
          isUnsettled={false}
        />,
      );
    });

    const button = renderer!.root.findByProps({ "aria-label": "Codex turn usage" });
    expect(button.children.join("")).toContain("$0.0637 · 26,701 tokens");

    await act(() => button.props.onClick());
    const paragraphs = renderer!.root
      .findAllByType("p")
      .map((paragraph) => paragraph.children.join(""));
    expect(paragraphs).toContain("gpt-5.6-sol · 1 response · 2 children");
    expect(paragraphs).toContain("Child 1 · gpt-5.6-luna · 1,234 tokens · $0.0123");
    expect(paragraphs).toContain("Child 2 · gpt-5.6-terra · 3,000 tokens · $0.024");
    expect(paragraphs).toContain("Family total · $0.1 · 30,935 tokens");
    expect(renderer!.root.findByType("a").children.join("")).toBe("Open ledger");

    await act(() => renderer?.unmount());
  });
});
