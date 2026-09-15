import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  link,
  lstat,
  mkdtemp,
  open,
  readFile,
  rm,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const magic = Buffer.from("ARCBK001");
const maxBytes = 64 * 1024 * 1024;
export async function readPrivate(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error("Absolute private file path required");
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.size > 16_384 ||
    (process.platform !== "win32" && info.mode & 0o077)
  )
    throw new Error("Private file permissions required");
  return (await readFile(path, "utf8")).trim();
}
function decodeKey(value: string) {
  if (!/^[0-9a-f]{64}$/i.test(value))
    throw new Error("Expected 32-byte hex encryption key");
  return Buffer.from(value, "hex");
}
export function encryptSnapshot(content: Buffer, hexKey: string): Buffer {
  if (content.length > maxBytes) throw new Error("Backup too large");
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", decodeKey(hexKey), nonce);
  cipher.setAAD(magic);
  const ciphertext = Buffer.concat([cipher.update(content), cipher.final()]);
  return Buffer.concat([magic, nonce, cipher.getAuthTag(), ciphertext]);
}
export function decryptSnapshot(content: Buffer, hexKey: string): Buffer {
  if (
    content.length < 36 ||
    content.length > maxBytes + 36 ||
    !content.subarray(0, 8).equals(magic)
  )
    throw new Error("Invalid backup envelope");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    decodeKey(hexKey),
    content.subarray(8, 20),
  );
  decipher.setAAD(magic);
  decipher.setAuthTag(content.subarray(20, 36));
  return Buffer.concat([
    decipher.update(content.subarray(36)),
    decipher.final(),
  ]);
}
export function validateSnapshot(path: string): number {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const version = Number(
      db.prepare("PRAGMA user_version").get()?.user_version,
    );
    if (
      db.prepare("PRAGMA application_id").get()?.application_id !==
        0x4152434c ||
      version < 1 ||
      version > 7
    )
      throw new Error("Unsupported snapshot");
    const integrity = db.prepare("PRAGMA integrity_check").all();
    if (
      integrity.length !== 1 ||
      integrity[0]?.integrity_check !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").all().length
    )
      throw new Error("Snapshot integrity failed");
    const history = db
      .prepare(
        "SELECT version,checksum FROM schema_migrations ORDER BY version",
      )
      .all();
    if (
      history.length !== version ||
      history.some(
        (r, i) =>
          r.version !== i + 1 || !/^[a-f0-9]{64}$/.test(String(r.checksum)),
      )
    )
      throw new Error("Snapshot history invalid");
    return version;
  } finally {
    db.close();
  }
}
async function writeNew(path: string, bytes: Buffer) {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}
async function privateDirectory(path: string) {
  if (!isAbsolute(path))
    throw new Error("Absolute destination directory required");
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    (process.platform !== "win32" && info.mode & 0o077)
  )
    throw new Error("Destination must be a private directory");
}
export interface BackupConfig {
  origin: string;
  accessKeyFile: string;
  encryptionKeyFile: string;
  directory: string;
}
/** Pull on the explicitly selected backup machine. Never writes to the project host. */
export async function pullBackup(
  config: BackupConfig,
  fetcher: typeof fetch = fetch,
) {
  const origin = new URL(config.origin);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error("Exact trusted HTTPS origin required");
  await privateDirectory(config.directory);
  const secret = await readPrivate(config.accessKeyFile),
    encryptionKey = await readPrivate(config.encryptionKeyFile);
  decodeKey(encryptionKey);
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error("Invalid access key");
  const lockPath = join(config.directory, ".arclattice-backup.lock");
  const lock = await open(lockPath, "wx", 0o600);
  let temporary: string | undefined,
    cookie = "",
    csrf = "";
  async function post(path: string, body: object) {
    return fetcher(origin.origin + path, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
      headers: {
        Origin: origin.origin,
        "Content-Type": "application/json",
        Cookie: cookie,
        "X-CSRF-Token": csrf,
      },
      body: JSON.stringify(body),
    });
  }
  try {
    const session = await post("/api/session", { secret });
    if (!session.ok) throw new Error("Backup authentication failed");
    cookie = session.headers.get("set-cookie")?.split(";")[0] ?? "";
    csrf = (await session.json()).csrf;
    if (
      !/^arc_session=[a-f0-9]{64}$/.test(cookie) ||
      typeof csrf !== "string" ||
      !/^[a-f0-9]{64}$/.test(csrf)
    )
      throw new Error("Invalid backup session");
    const response = await post("/api/backup", {});
    if (
      !response.ok ||
      response.headers.get("content-type") !== "application/vnd.sqlite3" ||
      !response.body
    )
      throw new Error("Backup download failed");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > maxBytes) throw new Error("Backup too large");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = Buffer.concat(chunks);
    temporary = await mkdtemp(join(config.directory, ".verify-"));
    const snapshot = join(temporary, "snapshot.sqlite");
    await writeNew(snapshot, bytes);
    const version = validateSnapshot(snapshot);
    const encrypted = encryptSnapshot(bytes, encryptionKey);
    if (!decryptSnapshot(encrypted, encryptionKey).equals(bytes))
      throw new Error("Encryption verification failed");
    const partial = join(temporary, "encrypted.partial");
    await writeNew(partial, encrypted);
    const target = join(
      config.directory,
      "arclattice-" +
        new Date().toISOString().replaceAll(":", "-") +
        "-" +
        randomUUID() +
        ".arcbk",
    );
    await link(partial, target); // Atomic no-overwrite publication, same filesystem.
    return { target, version, bytes: encrypted.length };
  } finally {
    if (cookie) {
      try {
        await post("/api/logout", {});
      } catch {
        /* Session expires; no secret logging. */
      }
    }
    try {
      if (temporary) await rm(temporary, { recursive: true, force: true });
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }
}
export async function restoreEncrypted(
  source: string,
  destination: string,
  keyFile: string,
) {
  if (!isAbsolute(source) || !isAbsolute(destination))
    throw new Error("Absolute paths required");
  await privateDirectory(dirname(destination));
  const info = await lstat(source);
  if (!info.isFile() || info.size > maxBytes + 36)
    throw new Error("Invalid encrypted backup");
  const bytes = decryptSnapshot(
    await readFile(source),
    await readPrivate(keyFile),
  );
  const temporary = await mkdtemp(join(dirname(destination), ".restore-"));
  try {
    const candidate = join(temporary, "snapshot.sqlite");
    await writeNew(candidate, bytes);
    const version = validateSnapshot(candidate);
    await link(candidate, destination);
    return { target: destination, version };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
