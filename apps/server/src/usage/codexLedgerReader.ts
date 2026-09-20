// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";

import {
  createCodexLedgerScanState,
  ingestCodexLedgerRecord,
  type CodexLedgerEvent,
  type CodexLedgerScanState,
} from "./codexLedgerAccounting.ts";
import {
  extractCodexLedgerLineageHints,
  type CodexLedgerLineageHint,
} from "./codexLedgerLineage.ts";

export interface CodexLedgerFileCursor {
  readonly offset: number;
  readonly guardHash: string;
  readonly state: CodexLedgerScanState;
  readonly generation: string;
  readonly skippingOversizedLine: boolean;
}

export interface CodexLedgerFileBatch {
  readonly events: readonly CodexLedgerEvent[];
  readonly lineageHints: readonly CodexLedgerLineageHint[];
  readonly cursor: CodexLedgerFileCursor;
  readonly malformed: number;
  readonly size: number;
  readonly reset: boolean;
}

const MAX_BYTES = 4 * 1024 * 1024;
const GUARD_BYTES = 64;
export const hashLedgerId = (value: string): string =>
  NodeCrypto.createHash("sha256").update(value).digest("hex");

export async function listCodexLedgerFiles(
  root: string,
  onDirectoryError?: (directory: string, cause: unknown) => void,
): Promise<readonly string[]> {
  const found: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    let entries: NodeFS.Dirent[];
    try {
      entries = await NodeFSP.readdir(directory, { withFileTypes: true });
    } catch (cause) {
      onDirectoryError?.(directory, cause);
      return;
    }
    for (const entry of entries) {
      const path = NodePath.join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push(path);
    }
  };
  await walk(root);
  return found;
}

async function guardAt(file: NodeFSP.FileHandle, offset: number): Promise<string> {
  const length = Math.min(GUARD_BYTES, offset);
  if (length === 0) return "";
  const bytes = Buffer.alloc(length);
  const read = await file.read(bytes, 0, length, offset - length);
  return read.bytesRead === length ? hashLedgerId(bytes.toString("hex")) : "";
}

/** Reads only complete appended JSONL records; cursor and events commit in one DB transaction. */
export async function readCodexLedgerFile(
  path: string,
  sourceId: string,
  previous?: CodexLedgerFileCursor,
): Promise<CodexLedgerFileBatch> {
  const file = await NodeFSP.open(path, "r");
  try {
    const stat = await file.stat();
    const safeResume =
      previous !== undefined &&
      previous.offset <= stat.size &&
      previous.offset >= 0 &&
      previous.guardHash === (await guardAt(file, previous.offset));
    const reset = previous !== undefined && !safeResume;
    const offset = safeResume ? previous.offset : 0;
    const state = safeResume ? structuredClone(previous.state) : createCodexLedgerScanState();
    const first = Buffer.alloc(Math.min(64, stat.size));
    await file.read(first, 0, first.length, 0);
    const generation = safeResume
      ? previous.generation
      : hashLedgerId(
          `${previous?.generation ?? ""}:${stat.dev}:${stat.ino}:${stat.birthtimeMs}:${stat.mtimeMs}:${stat.size}:${first.toString("hex")}`,
        );
    const bytes = Buffer.alloc(Math.min(MAX_BYTES, stat.size - offset));
    const { bytesRead } = await file.read(bytes, 0, bytes.length, offset);
    const slice = bytes.subarray(0, bytesRead);
    let start = 0;
    let skippedOversized = false;
    if (safeResume && previous.skippingOversizedLine) {
      const newline = slice.indexOf(0x0a);
      if (newline < 0) {
        const nextOffset = offset + bytesRead;
        return {
          events: [],
          lineageHints: [],
          cursor: {
            offset: nextOffset,
            guardHash: await guardAt(file, nextOffset),
            state,
            generation,
            skippingOversizedLine: true,
          },
          malformed: 0,
          size: stat.size,
          reset,
        };
      }
      start = newline + 1;
    }
    const lastNewline = slice.lastIndexOf(0x0a);
    const hasComplete = lastNewline >= start;
    const consumed = hasComplete ? lastNewline + 1 : start;
    const complete = slice.subarray(start, consumed);
    const events: CodexLedgerEvent[] = [];
    const lineageHints: CodexLedgerLineageHint[] = [];
    let malformed = 0;
    let position = offset + start;
    for (const line of complete.toString("utf8").split("\n")) {
      if (line.length === 0) {
        position += 1;
        continue;
      }
      const observationId = `${generation}:${position}`;
      position += Buffer.byteLength(line, "utf8") + 1;
      try {
        const record: unknown = JSON.parse(line);
        events.push(...ingestCodexLedgerRecord(state, record, { sourceId, observationId }));
        for (const hint of extractCodexLedgerLineageHints(record)) {
          lineageHints.push(
            hint.kind === "spawn"
              ? {
                  ...hint,
                  parentThreadId: hint.parentThreadId ?? state.threadId,
                  parentTurnId: hint.parentTurnId ?? state.activeTurnId,
                }
              : hint,
          );
        }
      } catch {
        malformed += 1;
      }
    }
    let nextOffset = offset + consumed;
    if (consumed === start && bytesRead === MAX_BYTES) {
      nextOffset = offset + bytesRead;
      skippedOversized = true;
      malformed += 1;
    }
    return {
      events,
      lineageHints,
      cursor: {
        offset: nextOffset,
        guardHash: await guardAt(file, nextOffset),
        state,
        generation,
        skippingOversizedLine: skippedOversized,
      },
      malformed,
      size: stat.size,
      reset,
    };
  } finally {
    await file.close();
  }
}
