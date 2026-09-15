import { closeSync, openSync } from "node:fs";
import { resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { setTimeout } from "node:timers/promises";

export class StorageError extends Error {
  constructor(
    public readonly code: string,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "StorageError";
  }
}

export function sqliteCode(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "errcode" in error)
    return typeof error.errcode === "number" ? error.errcode : undefined;
  return undefined;
}

/** Never retry a callback: retry only lock acquisition, yielding to other writers. */
export async function beginImmediate(db: DatabaseSync, timeoutMs: number) {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    try {
      db.exec("BEGIN IMMEDIATE");
      return;
    } catch (error) {
      if ((sqliteCode(error) ?? 0) % 256 !== 5) throw error;
      if (performance.now() >= deadline)
        throw new StorageError("STORAGE_BUSY", { cause: error });
      await setTimeout(Math.min(10, Math.max(1, deadline - performance.now())));
    }
  }
}

export function validateIntegrity(db: DatabaseSync): void {
  const rows = db.prepare("PRAGMA integrity_check").all();
  if (rows.length !== 1 || rows[0]?.integrity_check !== "ok")
    throw new StorageError("INTEGRITY_CHECK_FAILED");
  if (db.prepare("PRAGMA foreign_key_check").all().length)
    throw new StorageError("FOREIGN_KEY_CHECK_FAILED");
}

/** Reserve a NEW path. Never replace or truncate existing user files. */
export async function snapshotToNewFile(
  source: DatabaseSync,
  destination: string,
): Promise<string> {
  const target = resolve(destination);
  const fd = openSync(target, "wx", 0o600);
  closeSync(fd);
  try {
    await backup(source, target);
    const check = new DatabaseSync(target);
    try {
      // Convert ONLY our new snapshot to a standalone file (no WAL sidecars).
      check.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL");
      validateIntegrity(check);
    } finally {
      check.close();
    }
    return target;
  } catch (error) {
    // Preserve the failed artifact for diagnosis, never mark it as valid.
    throw new StorageError("BACKUP_FAILED", { cause: error });
  }
}
