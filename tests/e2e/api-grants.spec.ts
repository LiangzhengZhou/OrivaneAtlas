import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { passwordHash } from "../../packages/host/src/password";
import { createHost } from "../../packages/host/src/server";

test("real browser cookie and bearer grants keep knowledge read, write, MCP, File and private Atlas boundaries separate", async ({
  page,
}, info) => {
  const directory = await mkdtemp(join(tmpdir(), "arclattice-grants-browser-"));
  const port = 1420 + info.parallelIndex;
  const origin = `http://127.0.0.1:${port}`;
  const host = await createHost({
    database: join(directory, "data.sqlite"),
    secret: randomBytes(32).toString("hex"),
    origin,
    webRoot: resolve("apps/web/dist"),
  });
  try {
    const verifier = await passwordHash("Grants-browser-password-123");
    await host.db.accounts((store) => store.register("owner", verifier, true));
    await new Promise<void>((done) =>
      host.server.listen(port, "127.0.0.1", done),
    );
    await page.goto(origin);
    await expect(page.locator(".app-shell")).toBeVisible();
    const evidence = await page.evaluate(async () => {
      const login = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "owner",
          password: "Grants-browser-password-123",
        }),
      });
      const session = await login.json();
      const human = async (path: string, body: unknown, csrf = session.csrf) =>
        fetch(path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        });
      const token = await (
        await human("/api/v1/tokens/create", {
          name: "Read only",
          scope: "read-write",
          grants: ["knowledge:read"],
        })
      ).json();
      const bearer = async (path: string, body?: unknown) =>
        fetch(path, {
          method: body === undefined ? "GET" : "POST",
          credentials: "omit",
          headers: {
            Authorization: "Bearer " + token.secret,
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      const result: Record<string, number> = {};
      for (const prefix of ["/api", "/api/v1"]) {
        result[prefix + "/read"] = (await bearer(prefix + "/library")).status;
        result[prefix + "/write"] = (
          await bearer(prefix + "/library/save", {
            id: null,
            version: 0,
            input: {
              kind: "SPACE",
              spaceId: null,
              title: "Forbidden",
              bodyMd: "original",
            },
          })
        ).status;
        for (const path of [
          "/files/bytes?id=missing",
          "/memo?targetKind=TASK&targetId=missing",
          "/ai/run?id=missing",
          "/projects/activity?projectId=missing",
        ])
          result[prefix + path] = (await bearer(prefix + path)).status;
        result[prefix + "/mint"] = (
          await bearer(prefix + "/tokens/create", {
            name: "Escalation",
            scope: "read-write",
            grants: ["knowledge:write"],
          })
        ).status;
        result[prefix + "/mcp"] = (
          await bearer(prefix + "/mcp", {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "create_task", arguments: { title: "Forbidden" } },
          })
        ).status;
      }
      result.csrf = (
        await human(
          "/api/tokens/create",
          { name: "CSRF", scope: "write", grants: ["knowledge:write"] },
          "wrong",
        )
      ).status;
      await human("/api/tokens/revoke", { id: token.id });
      result.revoked = (await bearer("/api/v1/library")).status;
      return result;
    });
    for (const [name, status] of Object.entries(evidence))
      expect(status, name).toBe(
        name.endsWith("/read") ? 200 : name === "revoked" ? 401 : 403,
      );
    await info.attach("api-grants-browser-evidence.json", {
      body: JSON.stringify(evidence, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({ path: info.outputPath("local-shell-grants.png") });
  } finally {
    // Assertions and evidence are complete; close disposable browser preconnects.
    const closing = host.close();
    host.server.closeAllConnections();
    await closing;
    await rm(directory, {
      recursive: true,
      force: false,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
