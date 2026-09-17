import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteUnitOfWork } from "@arclattice/storage-sqlite";
import { expect, test, vi } from "vitest";
import { passwordHash } from "./password";
import { createHost } from "./server";

test("policy receipts survive reopening and revoked access cannot replay or mutate", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-policy-receipts-"));
  const file = join(directory, "test.sqlite");
  let db = await SqliteUnitOfWork.open(file);
  try {
    const account = await db.accounts((store) =>
      store.register("policy-test", "test-verifier", false),
    );
    const receipt = {
      context: {
        workspaceId: account.workspaceId,
        principalId: account.principalId,
      },
      key: "policy-test-receipt",
      digest: "policy-one-day",
    };
    await db.setInstanceSetting("session_lifetime_policy", "ONE_DAY", receipt);
    await db.setInstanceSetting("session_lifetime_policy", "THIRTY_DAYS");
    await db.close();
    db = await SqliteUnitOfWork.open(file);
    await db.setInstanceSetting("session_lifetime_policy", "ONE_DAY", receipt);
    expect(await db.getInstanceSetting("session_lifetime_policy")).toBe(
      "THIRTY_DAYS",
    );
    const revoked = () => {
      throw new Error("revoked");
    };
    await expect(
      db.setInstanceSetting("session_lifetime_policy", "ONE_DAY", {
        ...receipt,
        authorize: revoked,
      }),
    ).rejects.toThrow("revoked");
    await expect(
      db.setInstanceSetting("session_lifetime_policy", "ONE_DAY", {
        ...receipt,
        key: "policy-revoked-request",
        authorize: revoked,
      }),
    ).rejects.toThrow("revoked");
    expect(await db.getInstanceSetting("session_lifetime_policy")).toBe(
      "THIRTY_DAYS",
    );
    // Failed authorization must not consume the receipt.
    await db.setInstanceSetting("session_lifetime_policy", "ONE_DAY", {
      ...receipt,
      key: "policy-revoked-request",
    });
    expect(await db.getInstanceSetting("session_lifetime_policy")).toBe(
      "ONE_DAY",
    );
  } finally {
    await db.close();
    rmSync(directory, { recursive: true });
  }
});

test("login lasts seven days with fixed expiry and early logout revocation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-session-lifetime-"));
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, "127.0.0.1", done));
  const port = (reservation.address() as AddressInfo).port;
  await new Promise<void>((done) => reservation.close(() => done()));
  const origin = `http://127.0.0.1:${port}`;
  const host = await createHost({
    database: join(directory, "test.sqlite"),
    webRoot: directory,
    secret: randomBytes(32).toString("hex"),
    origin,
  });
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    await host.db.setInstanceSetting("session_lifetime_policy", "SEVEN_DAYS");
    const password = randomBytes(32).toString("hex");
    const hash = await passwordHash(password);
    await host.db.accounts((store) =>
      store.register("session-test", hash, true),
    );
    await new Promise<void>((done) =>
      host.server.listen(port, "127.0.0.1", done),
    );
    const base = `http://127.0.0.1:${(host.server.address() as AddressInfo).port}`;
    const request = (url: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set("Host", new URL(origin).host);
      return fetch(url, { ...init, headers });
    };
    const login = () =>
      request(base + "/api/session", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ username: "session-test", password }),
      });
    const response = await login();
    expect(response.status).toBe(200);
    const header = response.headers.get("set-cookie")!;
    expect(header).toContain("Max-Age=604800");
    expect(header).toContain("HttpOnly; SameSite=Strict; Path=/");
    const cookie = header.split(";")[0]!;
    const { csrf: adminCsrf } = await response.json();
    const policyRequest = (
      policy: string,
      key = randomBytes(16).toString("hex"),
      csrf = adminCsrf,
    ) =>
      request(base + "/api/admin/session-policy", {
        method: "POST",
        headers: {
          Origin: origin,
          Cookie: cookie,
          "X-CSRF-Token": csrf,
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({ policy }),
      });
    const currentPolicy = async () =>
      (
        await (
          await request(base + "/api/admin", { headers: { Cookie: cookie } })
        ).json()
      ).sessionLifetimePolicy;
    for (const invalid of ["constructor", "toString", "__proto__", "FOREVER"]) {
      expect((await policyRequest(invalid)).status).toBe(400);
    }
    expect(
      (await policyRequest("ONE_DAY", undefined, "wrong-csrf")).status,
    ).toBe(403);
    expect(await currentPolicy()).toBe("SEVEN_DAYS");
    const firstKey = randomBytes(16).toString("hex");
    expect((await policyRequest("ONE_DAY", firstKey)).status).toBe(200);
    expect(await currentPolicy()).toBe("ONE_DAY");
    expect((await login()).headers.get("set-cookie")).toContain(
      "Max-Age=86400",
    );
    expect((await policyRequest("THIRTY_DAYS")).status).toBe(200);
    expect((await login()).headers.get("set-cookie")).toContain(
      "Max-Age=2592000",
    );
    expect((await policyRequest("ONE_DAY", firstKey)).status).toBe(200);
    expect(await currentPolicy()).toBe("THIRTY_DAYS");
    expect((await policyRequest("PERMANENT", firstKey)).status).toBe(409);
    expect((await policyRequest("PERMANENT")).status).toBe(200);
    expect((await login()).headers.get("set-cookie")).toContain(
      "Max-Age=31536000",
    );
    expect(await host.db.getInstanceSetting("session_lifetime_policy")).toBe(
      "PERMANENT",
    );
    // The original seven-day session must keep its deadline after policy edits.
    const status = async () =>
      (await request(base + "/api/session", { headers: { Cookie: cookie } }))
        .status;
    for (const elapsed of [8 * 3600000 + 1, 6 * 86400000, 7 * 86400000 - 1]) {
      clock.mockReturnValue(now + elapsed);
      expect(await status()).toBe(200);
    }
    clock.mockReturnValue(now + 7 * 86400000);
    expect(await status()).toBe(401);
    clock.mockReturnValue(now + 7 * 86400000 + 1);
    expect(await status()).toBe(401);
    const second = await login();
    expect(second.status).toBe(200);
    const secondCookie = second.headers.get("set-cookie")!.split(";")[0]!;
    const { csrf } = await second.json();
    const logout = await request(base + "/api/logout", {
      method: "POST",
      headers: { Origin: origin, Cookie: secondCookie, "X-CSRF-Token": csrf },
    });
    expect(logout.status).toBe(200);
    expect(
      (
        await request(base + "/api/session", {
          headers: { Cookie: secondCookie },
        })
      ).status,
    ).toBe(401);
  } finally {
    clock.mockRestore();
    await host.close();
    rmSync(directory, { recursive: true });
  }
}, 30000);
