import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { passwordHash } from "./password";
import { createHost } from "./server";

test.skipIf(!process.env.ATLAS_NATIVE_TEST_EXE)(
  "native transport authenticates against strict host",
  async () => {
    const reservation = createServer();
    await new Promise<void>((done) => reservation.listen(0, "127.0.0.1", done));
    const port = (reservation.address() as AddressInfo).port;
    await new Promise<void>((done) => reservation.close(() => done()));
    const origin = "http://127.0.0.1:" + port;
    const directory = mkdtempSync(join(tmpdir(), "atlas-native-transport-"));
    const password = randomBytes(32).toString("hex");
    const host = await createHost({
      database: join(directory, "test.sqlite"),
      webRoot: resolve("apps/web/dist"),
      secret: randomBytes(32).toString("hex"),
      origin,
    });
    try {
      const hash = await passwordHash(password);
      await host.db.accounts((store) =>
        store.register("native-test", hash, true),
      );
      await new Promise<void>((done) =>
        host.server.listen(port, "127.0.0.1", done),
      );
      expect(
        (
          await fetch(origin + "/api/session", {
            method: "OPTIONS",
            headers: { Origin: "http://tauri.localhost" },
          })
        ).status,
      ).toBe(403);
      const result = await promisify(execFile)(
        process.env.ATLAS_NATIVE_TEST_EXE!,
        [
          "--ignored",
          "--exact",
          "transport::tests::strict_host_contract",
          "--nocapture",
        ],
        {
          env: {
            ...process.env,
            ATLAS_TEST_ORIGIN: origin,
            ATLAS_TEST_PASSWORD: password,
          },
          timeout: 30000,
        },
      );
      expect(result.stdout).toContain("1 passed");
    } finally {
      await host.close();
      if (
        !resolve(directory).startsWith(
          resolve(tmpdir()) + sep + "atlas-native-transport-",
        )
      )
        throw new Error("Unsafe cleanup");
      rmSync(directory, { recursive: true });
    }
  },
  45000,
);
