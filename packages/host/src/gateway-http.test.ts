import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type {
  AgentRun,
  GatewayPolicy,
  ModelPort,
} from "@arclattice/application";
import { ModelNotSentError } from "@arclattice/application";
import { expect, test, vi } from "vitest";
import { passwordHash } from "./password";
import { openPersonalVault } from "./personal-model";
import { createHost } from "./server";

test("HTTP approvals bind fallback registry and settle actual backup usage; sent failures never retry", async () => {
  const directory = mkdtempSync(join(tmpdir(), "arclattice-gateway-http-"));
  const origin = "http://127.0.0.1:4317",
    vault = openPersonalVault(join(directory, "vault"));
  const primary = vi.fn<ModelPort["complete"]>(async () => {
    throw new ModelNotSentError();
  });
  const backup = vi.fn<ModelPort["complete"]>(
    async (_prompt, _signal, usage) => {
      usage?.({
        inputTokens: 12,
        outputTokens: 3,
        source: "PROVIDER_REPORTED",
      });
      return "Backup output";
    },
  );
  const host = await createHost({
    database: join(directory, "data.sqlite"),
    secret: randomBytes(32).toString("hex"),
    origin,
    webRoot: directory,
    vault: {
      ...vault,
      resolve(actor, scope, profileId) {
        const actual = vault.resolve(actor, scope, profileId);
        return actual
          ? {
              ...actual,
              complete: primary,
              fallbacks:
                actual.fallbacks?.map((model) => ({
                  ...model,
                  complete: backup,
                })) ?? [],
            }
          : null;
      },
    },
  });
  let cookie = "",
    csrf = "";
  await new Promise<void>((done) => host.server.listen(0, "127.0.0.1", done));
  const address = host.server.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  const call = (path: string, value?: unknown) =>
    new Promise<{ status: number; value: any }>((accept, reject) => {
      const req = request(
        `http://127.0.0.1:${address.port}${path}`,
        {
          method: value === undefined ? "GET" : "POST",
          headers: {
            Host: "127.0.0.1:4317",
            Origin: origin,
            Cookie: cookie,
            "X-CSRF-Token": csrf,
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
        },
        (response) => {
          const parts: Buffer[] = [];
          response.on("data", (part) => parts.push(part));
          response.on("end", () => {
            if (response.headers["set-cookie"])
              cookie = response.headers["set-cookie"][0]!.split(";")[0]!;
            accept({
              status: response.statusCode!,
              value: JSON.parse(Buffer.concat(parts).toString("utf8")),
            });
          });
        },
      );
      req.on("error", reject);
      req.end(value === undefined ? undefined : JSON.stringify(value));
    });
  try {
    const verifier = await passwordHash("Gateway-test-password-123");
    await host.db.accounts((store) =>
      store.register("gateway", verifier, true),
    );
    const login = await call("/api/session", {
      username: "gateway",
      password: "Gateway-test-password-123",
    });
    expect(login.status).toBe(200);
    csrf = login.value.csrf;
    const gateway: GatewayPolicy = {
      providerId: "provider",
      enabled: true,
      capabilities: ["TEXT"],
      capability: "TEXT",
      dailyRequests: "UNLIMITED",
      dailyBudgetMicros: 1000000,
      currency: "USD",
      inputMicrosPerMillion: 1000000,
      outputMicrosPerMillion: 2000000,
      fallbackProfileIds: [],
    };
    const input = {
      scope: "personal",
      endpoint: "https://provider.example/v1",
      protocol: "chat",
      model: "test",
      key: "TEST-ONLY-GATEWAY-KEY",
      maxRunsPerDay: 1,
      gateway,
    };
    expect(
      (
        await call("/api/ai/providers/save", {
          version: 0,
          input: { ...input, profileId: "backup" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("/api/ai/providers/save", {
          version: 0,
          input: {
            ...input,
            gateway: { ...gateway, fallbackProfileIds: ["backup"] },
          },
        })
      ).status,
    ).toBe(200);
    const proposed: AgentRun = (
      await call("/api/ai/propose", { prompt: "review" })
    ).value;
    expect(proposed.route.fallbackRoutes?.[0]?.profileId).toBe("backup");
    expect(primary).not.toHaveBeenCalled();
    expect(backup).not.toHaveBeenCalled();
    expect(
      (
        await call("/api/ai/decide", {
          id: proposed.id,
          version: proposed.version,
          approve: true,
        })
      ).status,
    ).toBe(200);
    await vi.waitFor(async () => {
      const current = (await call("/api/ai")).value.runs.find(
        (run: AgentRun) => run.id === proposed.id,
      );
      expect(current.status).toBe("SUCCEEDED");
      expect(current.attempt.money).toMatchObject({
        chargedMicros: 18,
        state: "RECONCILED",
        routeFingerprint: proposed.route.fallbackRoutes![0]!.fingerprint,
      });
    });
    expect(primary).toHaveBeenCalledTimes(1);
    expect(backup).toHaveBeenCalledTimes(1);
    primary.mockImplementation(async () => {
      throw new Error("unknown sent outcome");
    });
    const next = (await call("/api/ai/propose", { prompt: "unknown" })).value;
    expect(
      (
        await call("/api/ai/decide", {
          id: next.id,
          version: next.version,
          approve: true,
        })
      ).status,
    ).toBe(200);
    await vi.waitFor(async () => {
      const current = (await call("/api/ai")).value.runs.find(
        (run: AgentRun) => run.id === next.id,
      );
      expect(current.status).toBe("FAILED");
      expect(current.attempt.money.state).toBe("UNKNOWN");
      expect(current.attempt.money.chargedMicros).toBe(
        current.attempt.money.reservedMicros,
      );
    });
    expect(backup).toHaveBeenCalledTimes(1);
    const stale = (await call("/api/ai/propose", { prompt: "stale" })).value;
    expect(
      (
        await call("/api/ai/providers/save", {
          version: 1,
          input: { ...input, profileId: "backup", model: "changed" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("/api/ai/decide", {
          id: stale.id,
          version: stale.version,
          approve: true,
        })
      ).status,
    ).toBe(409);
    expect(primary).toHaveBeenCalledTimes(2);
    expect(
      JSON.stringify((await call("/api/ai/providers")).value),
    ).not.toContain(input.key);
  } finally {
    const closing = host.close();
    host.server.closeAllConnections();
    await closing;
    if (
      !resolve(directory).startsWith(
        resolve(tmpdir()) + sep + "arclattice-gateway-http-",
      )
    )
      throw new Error("Unsafe cleanup");
    rmSync(directory, { recursive: true });
  }
}, 20000);
