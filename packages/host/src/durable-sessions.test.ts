import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test, vi } from "vitest";
import { passwordHash } from "./password";
import { createHost } from "./server";

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "atlas-durable-session-"));
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, "127.0.0.1", done));
  const port = (reservation.address() as AddressInfo).port;
  await new Promise<void>((done) => reservation.close(() => done()));
  const origin = `http://127.0.0.1:${port}`;
  const database = join(directory, "test.sqlite");
  const options = {
    database,
    webRoot: directory,
    origin,
    secret: randomBytes(32).toString("hex"),
  };
  let host = await createHost(options);
  const listen = () =>
    new Promise<void>((done) => host.server.listen(port, "127.0.0.1", done));
  await listen();
  const password = randomBytes(32).toString("hex");
  const verifier = await passwordHash(password);
  const admin = await host.db.accounts((s) =>
    s.register("owner", verifier, true),
  );
  const user = await host.db.accounts((s) => {
    const a = s.register("member", verifier, false);
    return s.status(a.id, a.version, "ACTIVE");
  });
  const request = (
    path: string,
    cookie = "",
    data?: unknown,
    csrf = "",
    key = randomBytes(16).toString("hex"),
  ) =>
    fetch(origin + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        Connection: "close",
        Cookie: cookie,
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf,
        "Idempotency-Key": key,
      },
      body: data === undefined ? null : JSON.stringify(data),
    });
  const login = async (username = "owner", pass = password) => {
    const res = await request("/api/session", "", { username, password: pass });
    expect(res.status).toBe(200);
    return {
      cookie: res.headers.get("set-cookie")!.split(";")[0]!,
      csrf: (await res.json()).csrf as string,
    };
  };
  return {
    database,
    admin,
    user,
    password,
    request,
    login,
    get host() {
      return host;
    },
    async restart() {
      await host.close();
      host = await createHost(options);
      await listen();
    },
    async close() {
      await host.close();
      rmSync(directory, { recursive: true });
    },
  };
}

test("permanent sessions survive restart; selected/all revocation is durable and account-isolated", async () => {
  const f = await fixture();
  try {
    const first = await f.login(),
      second = await f.login(),
      other = await f.login("member");
    const rawToken = first.cookie.slice(12);
    const raw = new DatabaseSync(f.database, { readOnly: true });
    try {
      const rows = raw.prepare("SELECT * FROM login_session").all();
      expect(rows).toHaveLength(3);
      expect(JSON.stringify(rows)).not.toContain(rawToken);
      expect(JSON.stringify(rows)).not.toContain(first.csrf);
      expect(
        rows.some(
          (r) =>
            r.token_hash ===
            createHash("sha256").update(rawToken).digest("hex"),
        ),
      ).toBe(true);
    } finally {
      raw.close();
    }
    await f.restart();
    const restored = await f.request("/api/session", first.cookie);
    expect(restored.status).toBe(200);
    expect((await restored.json()).csrf).toBe(first.csrf);
    const listing = await (
      await f.request("/api/account/sessions", first.cookie)
    ).json();
    expect(listing).toHaveLength(2);
    expect(listing.filter((s: { current: boolean }) => s.current)).toHaveLength(
      1,
    );
    expect(JSON.stringify(listing)).not.toContain("token_hash");
    const selected = listing.find((s: { current: boolean }) => !s.current).id;
    expect(
      (
        await f.request(
          "/api/account/sessions/revoke",
          first.cookie,
          { id: selected },
          "bad",
        )
      ).status,
    ).toBe(403);
    // Another account cannot revoke even a known session ID.
    expect(
      (
        await f.request(
          "/api/account/sessions/revoke",
          other.cookie,
          { id: selected },
          other.csrf,
        )
      ).status,
    ).toBe(200);
    expect((await f.request("/api/session", second.cookie)).status).toBe(200);
    const key = randomBytes(16).toString("hex");
    expect(
      (
        await f.request(
          "/api/account/sessions/revoke",
          first.cookie,
          { id: selected },
          first.csrf,
          key,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await f.request(
          "/api/account/sessions/revoke",
          first.cookie,
          { id: selected },
          first.csrf,
          key,
        )
      ).status,
    ).toBe(200);
    await f.restart();
    expect((await f.request("/api/session", second.cookie)).status).toBe(401);
    expect((await f.request("/api/session", first.cookie)).status).toBe(200);
    expect(
      (
        await f.request(
          "/api/account/sessions/revoke",
          first.cookie,
          { all: true },
          first.csrf,
        )
      ).status,
    ).toBe(200);
    await f.restart();
    expect((await f.request("/api/session", first.cookie)).status).toBe(401);
    expect((await f.request("/api/session", other.cookie)).status).toBe(200);
    expect(
      (await f.request("/api/logout", other.cookie, {}, other.csrf)).status,
    ).toBe(200);
    await f.restart();
    expect((await f.request("/api/session", other.cookie)).status).toBe(401);
  } finally {
    await f.close();
  }
}, 30000);

test("password change and disable invalidate all persisted sessions after restart", async () => {
  const f = await fixture();
  try {
    const first = await f.login(),
      second = await f.login(),
      other = await f.login("member");
    const changed = randomBytes(32).toString("hex");
    expect(
      (
        await f.request(
          "/api/account/password",
          first.cookie,
          { current: f.password, password: changed },
          first.csrf,
        )
      ).status,
    ).toBe(200);
    await f.restart();
    for (const s of [first, second])
      expect((await f.request("/api/session", s.cookie)).status).toBe(401);
    const owner = await f.login("owner", changed);
    expect(
      (
        await f.request(
          "/api/admin/status",
          owner.cookie,
          { id: f.user.id, version: f.user.version, status: "DISABLED" },
          owner.csrf,
        )
      ).status,
    ).toBe(200);
    await f.restart();
    expect((await f.request("/api/session", other.cookie)).status).toBe(401);
    expect((await f.request("/api/session", owner.cookie)).status).toBe(200);
  } finally {
    await f.close();
  }
}, 30000);

test("finite sessions retain exact expiry through restart; permanent has no server deadline", async () => {
  const f = await fixture();
  const now = Date.now(),
    clock = vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    const permanent = await f.login();
    await f.host.db.setInstanceSetting("session_lifetime_policy", "ONE_DAY");
    const finite = await f.login();
    await f.restart();
    clock.mockReturnValue(now + 86400000 - 1);
    expect((await f.request("/api/session", finite.cookie)).status).toBe(200);
    clock.mockReturnValue(now + 86400000);
    expect((await f.request("/api/session", finite.cookie)).status).toBe(401);
    clock.mockReturnValue(now + 400 * 86400000);
    const res = await f.request("/api/session", permanent.cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=31536000");
  } finally {
    clock.mockRestore();
    await f.close();
  }
}, 30000);
