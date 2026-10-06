import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { brotliDecompressSync } from "node:zlib";
import { expect, test } from "vitest";
import { v22PerformanceFixture } from "../../../tests/performance/v2.2-fixture";
import { createHost } from "./server";

test("real bootstrap transfer stays independent of a 500-document corpus", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-cold-bootstrap-"));
  const database = join(directory, "fixture.sqlite");
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, "127.0.0.1", done));
  const port = (reservation.address() as AddressInfo).port;
  await new Promise<void>((done) => reservation.close(() => done()));
  const origin = "http://127.0.0.1:" + port;
  const host = await createHost({
    database,
    secret: randomBytes(32).toString("hex"),
    origin,
    webRoot: resolve("apps/web/dist"),
  });
  try {
    const account = await host.db.accounts((store) =>
      store.register("cold-fixture", "unused-test-verifier", true),
    );
    const actor = {
      workspaceId: account.workspaceId,
      principalId: account.principalId,
    };
    const fixture = v22PerformanceFixture(actor, "2026-10-05");
    await host.db.request(
      actor,
      null,
      async (uow, _notes, _connected, library) => {
        await uow.run(actor.workspaceId, async (tx) => {
          for (const item of [...fixture.projects, ...fixture.tasks])
            await tx.insert(item);
        });
        await library.save(fixture.space, 0);
        for (const document of fixture.documents.slice(0, 500))
          await library.save({ ...document, bodyMd: "A".repeat(1024) }, 0);
      },
    );
    // Register a read credential through the real account contract.
    const credentialSecret = "arc_" + randomBytes(32).toString("hex");
    await host.db.accounts((store) =>
      store.issue(
        account.id,
        "benchmark",
        "read-write",
        createHash("sha256").update(credentialSecret).digest("hex"),
        30,
      ),
    );
    await new Promise<void>((done) =>
      host.server.listen(port, "127.0.0.1", done),
    );
    const measure = async (path: string, encoding: string) => {
      const started = performance.now();
      const result = await new Promise<{
        bytes: Buffer;
        encoding: string | undefined;
        status: number | undefined;
      }>((resolve, reject) => {
        get(
          origin + path,
          {
            headers: {
              Authorization: "Bearer " + credentialSecret,
              "Accept-Encoding": encoding,
            },
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("error", reject);
            response.on("end", () =>
              resolve({
                bytes: Buffer.concat(chunks),
                encoding: response.headers["content-encoding"],
                status: response.statusCode,
              }),
            );
          },
        ).on("error", reject);
      });
      expect(result.status).toBe(200);
      const decoded =
        result.encoding === "br"
          ? brotliDecompressSync(result.bytes)
          : result.bytes;
      return {
        bytes: result.bytes.length,
        decodedBytes: decoded.length,
        elapsedMs: performance.now() - started,
        value: JSON.parse(decoded.toString()),
      };
    };
    const small = await measure("/api/bootstrap", "identity");
    const raw = new DatabaseSync(database);
    try {
      const update = raw.prepare(
        "UPDATE library_entry SET payload=? WHERE workspace_id=? AND id=?",
      );
      raw.exec("BEGIN");
      for (const document of fixture.documents.slice(0, 500))
        update.run(
          JSON.stringify({ ...document, bodyMd: "A".repeat(50 * 1024) }),
          actor.workspaceId,
          document.id,
        );
      raw.exec("COMMIT");
    } finally {
      raw.close();
    }
    const large = await measure("/api/bootstrap", "identity");
    const compressed = await measure("/api/bootstrap", "br");
    const hydrated = await measure(
      "/api/document/body?kind=LIBRARY&id=" + fixture.documents[0]!.id,
      "identity",
    );
    expect(hydrated.value.bodyMd).toBe("A".repeat(50 * 1024));
    const legacy = await measure("/api/snapshot", "identity");
    expect(large.bytes / small.bytes).toBeLessThan(1.05);
    expect(large.value.library).toHaveLength(501);
    expect(large.value.workspace.items).toHaveLength(1650);
    for (const entry of large.value.library)
      expect(entry).not.toHaveProperty("bodyMd");
    expect(compressed.value).toEqual(large.value);
    expect(compressed.bytes).toBeLessThan(large.bytes / 4);
    expect(legacy.bytes).toBeGreaterThan(25 * 1024 * 1024);
    mkdirSync(resolve(".artifacts"), { recursive: true });
    const metrics = (entry: typeof small) => ({
      bytes: entry.bytes,
      decodedBytes: entry.decodedBytes,
      elapsedMs: entry.elapsedMs,
    });
    writeFileSync(
      resolve(".artifacts/v23-cold-transfer.json"),
      JSON.stringify(
        {
          tasks: 1500,
          projects: 150,
          documents: 500,
          small1KB: metrics(small),
          large50KB: metrics(large),
          brotli50KB: metrics(compressed),
          bodyHydration50KB: metrics(hydrated),
          legacySnapshot50KB: metrics(legacy),
        },
        null,
        2,
      ),
    );
  } finally {
    await host.close();
    if (
      !resolve(directory).startsWith(
        resolve(tmpdir()) + sep + "atlas-cold-bootstrap-",
      )
    )
      throw new Error("Unsafe cleanup");
    rmSync(directory, { recursive: true });
  }
}, 60000);
