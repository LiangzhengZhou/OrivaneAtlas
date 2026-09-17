import { randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  currentSchemaVersion,
  SqliteUnitOfWork,
} from "@arclattice/storage-sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  decryptSnapshot,
  encryptSnapshot,
  pullBackup,
  restoreEncrypted,
  validateSnapshot,
} from "./offsite";

let directory: string;
const key = randomBytes(32).toString("hex");
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "arclattice-offsite-"));
  chmodSync(directory, 0o700);
});
afterEach(() => rmSync(directory, { recursive: true }));
async function fixture() {
  const database = join(directory, "source.sqlite");
  const db = await SqliteUnitOfWork.open(database);
  await db.provisionWorkspace({ id: "test", name: "Kept" }, [
    { id: "user", kind: "USER", displayName: "User" },
  ]);
  await db.close();
  const encryptionKeyFile = join(directory, "encryption.key"),
    accessKeyFile = join(directory, "access.key");
  writeFileSync(encryptionKeyFile, key, { mode: 0o600 });
  writeFileSync(accessKeyFile, "a".repeat(64), { mode: 0o600 });
  return {
    database,
    encryptionKeyFile,
    accessKeyFile,
    directory,
    origin: "https://backup.example",
  };
}
it("authenticates encrypted archives and rejects wrong keys, edits and truncation", () => {
  const source = Buffer.from("private snapshot"),
    encrypted = encryptSnapshot(source, key);
  expect(encrypted.includes(source)).toBe(false);
  expect(decryptSnapshot(encrypted, key)).toEqual(source);
  expect(encryptSnapshot(source, key)).not.toEqual(encrypted);
  expect(() => decryptSnapshot(encrypted, "b".repeat(64))).toThrow();
  expect(() => decryptSnapshot(encrypted.subarray(0, 20), key)).toThrow();
  encrypted[encrypted.length - 1] = encrypted[encrypted.length - 1]! ^ 1;
  expect(() => decryptSnapshot(encrypted, key)).toThrow();
});
it("pulls, validates, encrypts, logs out and restores only to a new database", async () => {
  const config = await fixture();
  const source = readFileSync(config.database);
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    expect(init?.redirect).toBe("error");
    if (String(url).endsWith("/session"))
      return Response.json(
        { csrf: "c".repeat(64) },
        {
          headers: {
            "Set-Cookie":
              "arc_session=" + "b".repeat(64) + "; HttpOnly; Secure",
          },
        },
      );
    if (String(url).endsWith("/backup")) {
      expect(init?.headers).toMatchObject({
        Cookie: "arc_session=" + "b".repeat(64),
        "X-CSRF-Token": "c".repeat(64),
      });
      return new Response(source, {
        headers: { "Content-Type": "application/vnd.sqlite3" },
      });
    }
    return Response.json({ ok: true });
  });
  const result = await pullBackup(config, fetcher);
  expect(result.version).toBe(currentSchemaVersion);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(readFileSync(result.target).subarray(0, 8).toString()).toBe(
    "ARCBK001",
  );
  const restored = join(directory, "restored.sqlite");
  await restoreEncrypted(result.target, restored, config.encryptionKeyFile);
  expect(validateSnapshot(restored)).toBe(currentSchemaVersion);
  expect(readFileSync(restored)).toEqual(source);
  await expect(
    restoreEncrypted(result.target, config.database, config.encryptionKeyFile),
  ).rejects.toThrow(/EEXIST/);
  expect(readFileSync(config.database)).toEqual(source);
  expect(readdirSync(directory).some((f) => f.startsWith("."))).toBe(false);
});
it("failed pulls keep old archives, clean locks and reject insecure origins before sending", async () => {
  const config = await fixture();
  const kept = join(directory, "older.arcbk");
  writeFileSync(kept, "keep");
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    String(url).endsWith("/session")
      ? Response.json(
          { csrf: "c".repeat(64) },
          { headers: { "Set-Cookie": "arc_session=" + "b".repeat(64) } },
        )
      : new Response("corrupt", {
          headers: { "Content-Type": "application/vnd.sqlite3" },
        }),
  );
  await expect(
    pullBackup({ ...config, origin: "http://backup.example" }, fetcher),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  await expect(pullBackup(config, fetcher)).rejects.toThrow();
  expect(readFileSync(kept, "utf8")).toBe("keep");
  expect(readdirSync(directory).some((f) => f.startsWith("."))).toBe(false);
  writeFileSync(join(directory, ".arclattice-backup.lock"), "", {
    mode: 0o600,
  });
  fetcher.mockClear();
  await expect(pullBackup(config, fetcher)).rejects.toThrow(/EEXIST/);
  expect(fetcher).not.toHaveBeenCalled();
});
