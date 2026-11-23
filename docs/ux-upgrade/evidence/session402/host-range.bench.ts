import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { StatementSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { passwordHash } from "../../../../packages/host/src/password";
import { openPersonalVault } from "../../../../packages/host/src/personal-model";
import { createHost } from "../../../../packages/host/src/server";
import { largeSurveyPdf } from "../../../../tests/e2e/large-pdf-fixture";

test("measure SQL payloads for the personal PDF reader's three HTTP ranges", async ({
  request,
}, info) => {
  test.setTimeout(180000);
  await mkdir(info.outputDir, { recursive: true });
  const probe = createServer();
  await new Promise<void>((ok) => probe.listen(0, "127.0.0.1", ok));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((ok) => probe.close(() => ok()));
  const origin = "http://127.0.0.1:" + port,
    secret = randomBytes(24).toString("hex");
  const host = await createHost({
    origin,
    secret,
    database: info.outputPath("fixture.sqlite"),
    vault: openPersonalVault(info.outputPath("vault")),
  });
  const all = StatementSync.prototype.all;
  try {
    const verifier = await passwordHash(secret);
    await host.db.accounts((s) =>
      s.register("personal-reader", verifier, true),
    );
    await new Promise<void>((ok) => host.server.listen(port, "127.0.0.1", ok));
    const login = await request.post(origin + "/api/session", {
      headers: { Origin: origin },
      data: { username: "personal-reader", password: secret },
    });
    expect(login.status()).toBe(200);
    const { csrf } = await login.json();
    const post = async (
      path: string,
      data: object | Buffer,
      extra: Record<string, string> = {},
    ) => {
      const r = await request.post(origin + "/api/v1/" + path, {
        headers: {
          Origin: origin,
          "X-CSRF-Token": csrf,
          "Idempotency-Key": randomUUID(),
          ...extra,
        },
        data,
      });
      expect(r.status()).toBe(200);
      const value = await r.json();
      await r.dispose();
      return value;
    };
    const original = largeSurveyPdf(),
      chunk = 262144;
    const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");
    const contentHash = digest(original);
    await post("files/binary/begin", {
      contentHash,
      size: original.length,
      mime: "application/pdf",
      chunkSize: chunk,
    });
    for (let i = 0; i < original.length; i += chunk) {
      const bytes = original.subarray(i, i + chunk);
      await post(
        "files/binary/chunk?hash=" + contentHash + "&index=" + i / chunk,
        bytes,
        {
          "Content-Type": "application/octet-stream",
          "X-File-Chunk-Hash": digest(bytes),
        },
      );
    }
    await post("files/binary/complete", { contentHash });
    const { id } = await post("files/register", {
      name: "Survey.pdf",
      spaceId: null,
      mime: "application/pdf",
      size: original.length,
      contentHash,
    });
    let sqlBytes = 0,
      peakRss = 0,
      maxSqlBatchBytes = 0;
    const sample = () => {
      peakRss = Math.max(peakRss, process.memoryUsage.rss());
    };
    StatementSync.prototype.all = function (...args) {
      const rows = all.apply(this, args);
      let bytes = 0;
      for (const r of rows)
        if (typeof r.chunk_hash === "string" && r.bytes instanceof Uint8Array)
          bytes += r.bytes.byteLength;
      sqlBytes += bytes;
      maxSqlBatchBytes = Math.max(maxSqlBatchBytes, bytes);
      sample();
      return rows;
    };
    const groups = [];
    for (let pass = 0; pass < 3; pass++) {
      const start = performance.now(),
        cpu = process.cpuUsage(),
        baseRss = process.memoryUsage.rss();
      sqlBytes = 0;
      maxSqlBatchBytes = 0;
      peakRss = baseRss;
      const timer = setInterval(sample, 5);
      let transferred = 0;
      try {
        for (const [begin, end] of [
          [0, chunk],
          [71 * chunk, 72 * chunk],
          [72 * chunk, original.length],
        ] as const) {
          const r = await request.get(origin + "/api/v1/files/bytes?id=" + id, {
            headers: {
              Range: "bytes=" + begin + "-" + (end - 1),
              "If-Range": '"' + contentHash + '"',
            },
          });
          expect(r.status()).toBe(206);
          const bytes = await r.body();
          expect(digest(bytes)).toBe(digest(original.subarray(begin, end)));
          transferred += bytes.byteLength;
          await r.dispose();
        }
      } finally {
        clearInterval(timer);
      }
      sample();
      const usage = process.cpuUsage(cpu);
      groups.push({
        sqlBytes,
        maxSqlBatchBytes,
        transferred,
        elapsedMs: Math.round(performance.now() - start),
        cpuMs: (usage.user + usage.system) / 1000,
        baseRss,
        peakRss,
      });
    }
    if (process.env.ATLAS_EXPECT_VERIFIED_RANGES === "1") {
      expect(groups.map((g) => g.sqlBytes)).toEqual([
        original.length + original.length - 71 * chunk,
        2 * chunk + (original.length % chunk),
        2 * chunk + (original.length % chunk),
      ]);
      for (const g of groups)
        expect(g.maxSqlBatchBytes).toBeLessThanOrEqual(1024 * 1024);
    }
    await writeFile(
      info.outputPath("result.json"),
      JSON.stringify(
        {
          node: process.version,
          platform: process.platform,
          originalBytes: original.length,
          contentHash,
          groups,
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
  } finally {
    StatementSync.prototype.all = all;
    const closing = host.close();
    host.server.closeAllConnections();
    await closing;
  }
});
