// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import type { JevBrowserDecideResult } from "@t3tools/contracts";

const MAX_ENTRIES = 2_048;

type BillingEntry =
  | {
      readonly id: string;
      readonly runId: string;
      readonly iteration: number;
      readonly pending: true;
    }
  | {
      readonly id: string;
      readonly runId: string;
      readonly iteration: number;
      readonly pending: false;
      readonly result: JevBrowserDecideResult;
    };

export function createJevBrowserBillingOutbox(filePath: string) {
  const read = (): BillingEntry[] => {
    try {
      const value: unknown = JSON.parse(NodeFS.readFileSync(filePath, "utf8"));
      if (!Array.isArray(value)) return [];
      return value.filter(
        (entry): entry is BillingEntry =>
          typeof entry === "object" &&
          entry !== null &&
          typeof entry.id === "string" &&
          typeof entry.runId === "string" &&
          Number.isSafeInteger(entry.iteration) &&
          typeof entry.pending === "boolean",
      );
    } catch (error) {
      if (NodeFS.existsSync(filePath)) throw error;
      return [];
    }
  };
  const write = (entries: readonly BillingEntry[]) => {
    NodeFS.mkdirSync(NodePath.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${NodeCrypto.randomUUID()}.tmp`;
    NodeFS.writeFileSync(temporary, JSON.stringify(entries), { mode: 0o600 });
    const temporaryFd = NodeFS.openSync(temporary, "r");
    try {
      NodeFS.fsyncSync(temporaryFd);
    } finally {
      NodeFS.closeSync(temporaryFd);
    }
    NodeFS.renameSync(temporary, filePath);
    const directoryFd = NodeFS.openSync(NodePath.dirname(filePath), "r");
    try {
      NodeFS.fsyncSync(directoryFd);
    } finally {
      NodeFS.closeSync(directoryFd);
    }
  };
  return {
    reserve(runId: string, iteration: number): string {
      const entries = read();
      if (entries.some((entry) => entry.runId === runId && entry.iteration === iteration)) {
        throw new Error("This Jev browser billing iteration was already reserved.");
      }
      while (entries.length >= MAX_ENTRIES) {
        const completed = entries.findIndex(({ pending }) => !pending);
        if (completed < 0) throw new Error("The Jev browser billing outbox is full.");
        entries.splice(completed, 1);
      }
      const id = NodeCrypto.randomUUID();
      entries.push({ id, runId, iteration, pending: true });
      write(entries);
      return id;
    },
    complete(id: string, result: JevBrowserDecideResult): void {
      const entries = read();
      const index = entries.findIndex((entry) => entry.id === id && entry.pending);
      if (index < 0) throw new Error("The reserved Jev browser billing receipt is unavailable.");
      const entry = entries[index]!;
      entries[index] = {
        id,
        runId: entry.runId,
        iteration: entry.iteration,
        pending: false,
        result,
      };
      write(entries);
    },
  };
}
