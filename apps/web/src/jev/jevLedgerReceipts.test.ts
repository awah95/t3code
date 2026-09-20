import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { CodexLedgerJevReceiptInput } from "@t3tools/contracts";
import {
  flushJevLedgerReceipts,
  jevUsdDecimal,
  queueJevLedgerReceipt,
  setJevLedgerReceiptWriter,
} from "./jevLedgerReceipts";

const input: CodexLedgerJevReceiptInput = {
  requestId: "route",
  attemptId: "attempt",
  rootTurnId: null,
  toolUseId: null,
  environmentId: "env",
  projectId: null,
  threadId: null,
  messageId: null,
  turnId: null,
  providerThreadId: null,
  providerTurnId: null,
  childProviderThreadId: null,
  parentProviderTurnId: null,
  dispatchId: null,
  observedModel: null,
  sourceScope: "turn",
  decisionJson: "{}",
  dispatchJson: null,
  reportedCostUsd: null,
  estimatedCostUsd: null,
  status: "completed",
};

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("Jev ledger receipt queue", () => {
  it("encodes tiny charges as plain decimal strings", () => {
    expect(jevUsdDecimal(1e-7)).toBe("0.0000001");
    expect(jevUsdDecimal(3.2e-6)).toBe("0.0000032");
    expect(jevUsdDecimal(0)).toBe("0");
    expect(jevUsdDecimal(Number.NaN)).toBeNull();
  });
  it("preserves prepared message identity when a desktop replay arrives after reload", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      get length() {
        return storage.size;
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    expect(
      queueJevLedgerReceipt({
        environmentId: "env",
        input: {
          ...input,
          messageId: "pre-send-message",
          dispatchJson: '{"model":"gpt-5.6-sol","accepted":null}',
          status: "proposed",
        },
      }),
    ).toBe(true);
    expect(
      queueJevLedgerReceipt({
        environmentId: "env",
        input: { ...input, reportedCostUsd: "0.000001", status: "completed" },
      }),
    ).toBe(true);
    const merged = JSON.parse([...storage.values()][0]!) as { input: CodexLedgerJevReceiptInput };
    expect(merged.input).toMatchObject({
      messageId: "pre-send-message",
      dispatchJson: '{"model":"gpt-5.6-sol","accepted":null}',
      reportedCostUsd: "0.000001",
      status: "completed",
    });
  });
  it("keeps independent receipts in separate keys and stops after failed deletion", async () => {
    vi.useFakeTimers();
    const storage = new Map<string, string>();
    let failRemoval = true;
    vi.stubGlobal("localStorage", {
      get length() {
        return storage.size;
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => {
        if (failRemoval) throw new Error("storage failed");
        storage.delete(key);
      },
    });
    vi.stubGlobal("window", { addEventListener: vi.fn() });
    expect(queueJevLedgerReceipt({ environmentId: "env", input })).toBe(true);
    expect(
      queueJevLedgerReceipt({ environmentId: "env", input: { ...input, requestId: "other" } }),
    ).toBe(true);
    expect(storage.size).toBe(2);
    const writer = vi.fn().mockResolvedValue(true);
    const failure = vi.fn();
    setJevLedgerReceiptWriter(writer, failure);
    await flushJevLedgerReceipts();
    expect(writer).toHaveBeenCalledTimes(2);
    expect(failure).toHaveBeenCalledWith(
      "Delivered Jev accounting receipt could not be cleared locally.",
    );
    expect(storage.size).toBe(2);
    failRemoval = false;
    await vi.runOnlyPendingTimersAsync();
    expect(storage.size).toBe(0);
  });
  it("retries a storage gap after RPC failure and acknowledges only after server success", async () => {
    vi.useFakeTimers();
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      get length() {
        return storage.size;
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal("window", { addEventListener: vi.fn() });
    const gap = {
      environmentId: "env",
      input: {
        ...input,
        requestId: "jev-storage-gap:unique",
        attemptId: "jev-storage-gap:unique",
        sourceScope: "subagent" as const,
        threadId: "closed-thread",
        receiptStorageError: true,
      },
    };
    const server = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const acknowledge = vi.fn();
    setJevLedgerReceiptWriter(async (receipt) => {
      const persisted = await server(receipt);
      if (persisted)
        acknowledge({ requestId: receipt.input.requestId, attemptId: receipt.input.attemptId });
      return persisted;
    });
    expect(queueJevLedgerReceipt(gap)).toBe(true);
    await flushJevLedgerReceipts();
    expect(server).toHaveBeenCalledTimes(1);
    expect(storage.size).toBe(1);
    expect(acknowledge).not.toHaveBeenCalled();
    await vi.runOnlyPendingTimersAsync();
    expect(server).toHaveBeenCalledTimes(2);
    expect(acknowledge).toHaveBeenCalledWith({
      requestId: "jev-storage-gap:unique",
      attemptId: "jev-storage-gap:unique",
    });
    expect(storage.size).toBe(0);
  });
});
