// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { UsageRecord } from "./usageTranscripts.ts";

export const cursorUsageReceiptPath = (stateDir: string) =>
  NodePath.join(stateDir, "cursor-usage.jsonl");

type CursorUsageReceipt = Pick<
  UsageRecord,
  "timestampMs" | "model" | "sessionId" | "totals" | "dedupeKey"
>;

const validCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** The ACP prompt result is optional; missing usage must never become a zero-cost turn. */
export function cursorPromptUsageReceipt(input: {
  readonly usage:
    | {
        readonly inputTokens: number;
        readonly outputTokens: number;
        readonly cachedReadTokens?: number | null;
        readonly cachedWriteTokens?: number | null;
        readonly thoughtTokens?: number | null;
      }
    | null
    | undefined;
  readonly timestampMs: number;
  readonly model: string;
  readonly sessionId: string;
  readonly receiptId: string;
}): CursorUsageReceipt | null {
  const usage = input.usage;
  if (!usage || !validCount(usage.inputTokens) || !validCount(usage.outputTokens)) return null;
  const cachedRead = usage.cachedReadTokens ?? 0;
  const cachedWrite = usage.cachedWriteTokens ?? 0;
  const reasoning = usage.thoughtTokens ?? 0;
  if (
    !validCount(cachedRead) ||
    !validCount(cachedWrite) ||
    !validCount(reasoning) ||
    cachedRead + cachedWrite > usage.inputTokens ||
    reasoning > usage.outputTokens
  )
    return null;
  return {
    timestampMs: input.timestampMs,
    model: input.model.trim() || "cursor-unknown-model",
    sessionId: input.sessionId,
    totals: {
      uncachedInputTokens: usage.inputTokens - cachedRead - cachedWrite,
      cachedInputTokens: cachedRead,
      cacheCreationTokens: cachedWrite,
      outputTokens: usage.outputTokens,
      reasoningTokens: reasoning,
    },
    dedupeKey: `cursor-prompt:${input.receiptId}`,
  };
}

export async function appendCursorUsageReceipt(
  filePath: string,
  receipt: CursorUsageReceipt,
): Promise<void> {
  await NodeFSP.mkdir(NodePath.dirname(filePath), { recursive: true });
  await NodeFSP.appendFile(filePath, `${JSON.stringify(receipt)}\n`, "utf8");
}

export async function readCursorUsageReceipts(
  filePath: string,
  sinceMs: number,
): Promise<{ records: UsageRecord[]; malformed: number } | null> {
  let contents: string;
  try {
    contents = await NodeFSP.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const records: UsageRecord[] = [];
  let malformed = 0;
  for (const line of contents.split("\n")) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      malformed += 1;
      continue;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      malformed += 1;
      continue;
    }
    const receipt = value as Record<string, unknown>;
    const totals = receipt.totals;
    if (
      !validCount(receipt.timestampMs) ||
      typeof receipt.model !== "string" ||
      typeof receipt.sessionId !== "string" ||
      typeof receipt.dedupeKey !== "string" ||
      !receipt.dedupeKey.startsWith("cursor-prompt:") ||
      typeof totals !== "object" ||
      totals === null ||
      Array.isArray(totals) ||
      !validCount((totals as Record<string, unknown>).uncachedInputTokens) ||
      !validCount((totals as Record<string, unknown>).cachedInputTokens) ||
      !validCount((totals as Record<string, unknown>).cacheCreationTokens) ||
      !validCount((totals as Record<string, unknown>).outputTokens) ||
      !validCount((totals as Record<string, unknown>).reasoningTokens)
    ) {
      malformed += 1;
      continue;
    }
    if (receipt.timestampMs < sinceMs) continue;
    records.push({
      provider: "cursor",
      timestampMs: receipt.timestampMs,
      model: receipt.model,
      sessionId: receipt.sessionId,
      totals: totals as UsageRecord["totals"],
      reportedCostUsd: null,
      dedupeKey: receipt.dedupeKey,
    });
  }
  return { records, malformed };
}
