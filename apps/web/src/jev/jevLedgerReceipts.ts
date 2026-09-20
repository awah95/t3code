import type { CodexLedgerJevReceiptInput } from "@t3tools/contracts";

type QueuedReceipt = { environmentId: string; input: CodexLedgerJevReceiptInput };
type ReceiptWriter = (receipt: QueuedReceipt) => Promise<boolean>;

const STORAGE_PREFIX = "t3:jev-ledger-receipt:v2:";
const MAX_PENDING = 256;

export function jevUsdDecimal(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  const text = String(value);
  if (!/[eE]/.test(text)) return text;
  const [mantissa = "", exponent = "0"] = text.split(/[eE]/);
  const digits = mantissa.replace(".", "");
  const point =
    (mantissa.includes(".") ? mantissa.indexOf(".") : mantissa.length) + Number(exponent);
  if (point <= 0) return `0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${digits}${"0".repeat(point - digits.length)}`;
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}
let writer: ReceiptWriter | null = null;
let onFailure: ((message: string) => void) | null = null;
let running = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 1_000;
let listeningForOnline = false;

function key(receipt: QueuedReceipt): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(receipt.environmentId)}:${encodeURIComponent(receipt.input.requestId)}:${encodeURIComponent(receipt.input.attemptId)}`;
}

const RECEIPT_IDENTITY_FIELDS = [
  "rootTurnId",
  "toolUseId",
  "environmentId",
  "projectId",
  "threadId",
  "messageId",
  "turnId",
  "providerThreadId",
  "providerTurnId",
  "childProviderThreadId",
  "parentProviderTurnId",
  "dispatchId",
  "observedModel",
  "sourceScope",
] as const;

function stageRank(status: CodexLedgerJevReceiptInput["status"]): number {
  switch (status) {
    case "proposed":
      return 0;
    case "completed":
      return 1;
    case "cancelled":
      return 2;
    case "failed":
    case "dispatched":
      return 3;
  }
}

function mergeReceipt(previous: QueuedReceipt, incoming: QueuedReceipt): QueuedReceipt {
  const input = { ...previous.input, ...incoming.input };
  for (const field of RECEIPT_IDENTITY_FIELDS) {
    if (incoming.input[field] === null || incoming.input[field] === undefined)
      (input as Record<string, unknown>)[field] = previous.input[field];
  }
  input.decisionJson = incoming.input.decisionJson ?? previous.input.decisionJson;
  input.dispatchJson = incoming.input.dispatchJson ?? previous.input.dispatchJson;
  input.reportedCostUsd = incoming.input.reportedCostUsd ?? previous.input.reportedCostUsd;
  input.estimatedCostUsd = incoming.input.estimatedCostUsd ?? previous.input.estimatedCostUsd;
  input.receiptStorageError =
    incoming.input.receiptStorageError || previous.input.receiptStorageError;
  input.status =
    stageRank(incoming.input.status) >= stageRank(previous.input.status)
      ? incoming.input.status
      : previous.input.status;
  return { environmentId: incoming.environmentId, input };
}

function listKeys(): string[] {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const candidate = localStorage.key(index);
    if (candidate?.startsWith(STORAGE_PREFIX)) keys.push(candidate);
  }
  return keys.sort();
}

function read(keyName: string): QueuedReceipt | null {
  const raw = localStorage.getItem(keyName);
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as QueuedReceipt).environmentId !== "string" ||
    typeof (parsed as QueuedReceipt).input?.requestId !== "string" ||
    typeof (parsed as QueuedReceipt).input?.attemptId !== "string"
  )
    throw new Error("Invalid Jev accounting receipt in browser storage.");
  return parsed as QueuedReceipt;
}

function reportFailure(message: string) {
  onFailure?.(message);
}

function scheduleRetry() {
  if (retryTimer !== null || writer === null) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushJevLedgerReceipts();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 60_000);
}

/** Each receipt has its own key, so separate renderer windows never overwrite unrelated calls. */
export function queueJevLedgerReceipt(receipt: QueuedReceipt): boolean {
  try {
    const receiptKey = key(receipt);
    const existing = read(receiptKey);
    if (existing === null && listKeys().length >= MAX_PENDING) {
      reportFailure("Jev accounting receipt storage is full.");
      return false;
    }
    localStorage.setItem(
      receiptKey,
      JSON.stringify(existing ? mergeReceipt(existing, receipt) : receipt),
    );
  } catch {
    reportFailure("Jev accounting receipt could not be saved locally.");
    return false;
  }
  void flushJevLedgerReceipts();
  return true;
}

export function setJevLedgerReceiptWriter(
  next: ReceiptWriter,
  failureListener?: (message: string) => void,
): void {
  writer = next;
  onFailure = failureListener ?? null;
  if (typeof window !== "undefined" && !listeningForOnline) {
    window.addEventListener("online", onOnline);
    listeningForOnline = true;
  }
  void flushJevLedgerReceipts();
}

function onOnline() {
  void flushJevLedgerReceipts();
}

export async function flushJevLedgerReceipts(): Promise<void> {
  if (running || writer === null) return;
  running = true;
  const blocked = new Set<string>();
  try {
    while (true) {
      let receiptKey: string | undefined;
      let receipt: QueuedReceipt | null;
      try {
        receiptKey = listKeys().find((candidate) => !blocked.has(candidate));
        if (!receiptKey) {
          if (blocked.size > 0) scheduleRetry();
          else retryDelay = 1_000;
          return;
        }
        receipt = read(receiptKey);
        if (receipt === null) continue;
      } catch {
        reportFailure("Stored Jev accounting receipt cannot be read.");
        if (receiptKey) blocked.add(receiptKey);
        else {
          scheduleRetry();
          return;
        }
        continue;
      }
      let delivered = false;
      try {
        delivered = await writer(receipt);
      } catch {
        // A disconnected environment is retried from browser storage.
      }
      if (!delivered) {
        blocked.add(receiptKey);
        continue;
      }
      try {
        // A newer stage may have replaced this receipt while the RPC was pending.
        if (localStorage.getItem(receiptKey) === JSON.stringify(receipt))
          localStorage.removeItem(receiptKey);
      } catch {
        reportFailure("Delivered Jev accounting receipt could not be cleared locally.");
        blocked.add(receiptKey);
      }
    }
  } finally {
    running = false;
  }
}
