import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRouteResolver } from "@arclattice/application";
import { afterEach, describe, expect, it } from "vitest";
import { openPersonalVault } from "./personal-model";
import {
  configurationEntries,
  migrateLegacyConfiguration,
} from "./provider-catalog";

const actor = { workspaceId: "w", principalId: "p" },
  owner = JSON.stringify(["w", "p"]);
const fixtures: string[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0))
    rmSync(fixture, { recursive: true, force: true });
});
const old = (scope: string, profileId = "default") => ({
  owner,
  version: 3,
  scope,
  profileId,
  endpoint: "https://provider.example/v1/",
  protocol: "chat" as const,
  model: profileId,
  key: "test-only-shared-key",
  maxRunsPerDay: 7,
});
describe("provider catalog compatibility and encrypted ownership", () => {
  it("keeps a same-model legacy fallback slot distinct while sharing one credential", () => {
    const base = old("personal");
    const fallback = { ...old("personal", "backup"), model: base.model };
    const config = migrateLegacyConfiguration(owner, [
      {
        ...base,
        gateway: {
          providerId: "legacy",
          enabled: true,
          capabilities: ["TEXT"],
          capability: "TEXT",
          dailyRequests: "UNLIMITED",
          dailyBudgetMicros: "UNLIMITED",
          currency: "USD",
          inputMicrosPerMillion: 0,
          outputMicrosPerMillion: 0,
          fallbackProfileIds: ["backup"],
        },
      },
      fallback,
    ]);
    expect(config.credentials).toHaveLength(1);
    expect(config.profiles[0]!.fallbackModelIds).toEqual([
      config.profiles[1]!.primaryModelId,
    ]);
    expect(config.profiles[0]!.primaryModelId).not.toBe(
      config.profiles[1]!.primaryModelId,
    );
  });
  it("migrates all old scopes, shared credentials, fallback, Unlimited and disabled profiles", () => {
    const entries = [
      old("personal"),
      old("personal", "fallback"),
      old("WORK:project"),
      old("SPACE:space"),
    ];
    const gateway = {
      providerId: "old",
      enabled: false,
      capabilities: ["TEXT"] as const,
      capability: "TEXT" as const,
      dailyRequests: "UNLIMITED" as const,
      dailyBudgetMicros: 5_000_000,
      currency: "USD" as const,
      inputMicrosPerMillion: 1,
      outputMicrosPerMillion: 2,
      fallbackProfileIds: ["fallback"],
    };
    const migrated = migrateLegacyConfiguration(owner, [
      { ...entries[0]!, gateway: { ...gateway, capabilities: ["TEXT"] } },
      ...entries.slice(1),
    ]);
    expect(migrated.connections).toHaveLength(1);
    expect(migrated.credentials).toEqual([
      {
        connectionId: migrated.connections[0]!.id,
        key: "test-only-shared-key",
      },
    ]);
    expect(migrated.bindings.map((binding) => binding.scope)).toEqual([
      "PERSONAL",
      "PROJECT",
      "SPACE",
    ]);
    expect(migrated.profiles[0]).toMatchObject({
      requestLimit: { kind: "UNLIMITED" },
      enabled: false,
      budget: { dailyMicros: 5_000_000 },
    });
    expect(migrated.profiles[0]!.fallbackModelIds).toHaveLength(1);
  });
  it("reads a real 2.0.2 encrypted array and atomically writes new credential references without losing keys", () => {
    const directory = mkdtempSync(join(tmpdir(), "atlas-provider-migrate-"));
    fixtures.push(directory);
    const master = randomBytes(32),
      iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", master, iv);
    const entries = [old("personal"), old("WORK:project"), old("SPACE:space")];
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(entries)),
      cipher.final(),
    ]);
    writeFileSync(join(directory, "master.key"), master, { mode: 0o600 });
    writeFileSync(
      join(directory, "providers.enc"),
      Buffer.concat([iv, cipher.getAuthTag(), ciphertext]),
      { mode: 0o600 },
    );
    const vault = openPersonalVault(directory),
      configuration = vault.configuration!(actor);
    expect(configuration.version).toBe(0);
    expect(vault.list(actor)).toHaveLength(3);
    const input = { ...configuration, credentials: [] };
    const saved = vault.saveConfiguration!(actor, 0, input);
    expect(saved.version).toBe(1);
    expect(saved.connections[0]!.credentialConfigured).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("test-only-shared-key");
    const sealed = readFileSync(join(directory, "providers.enc")),
      decipher = createDecipheriv(
        "aes-256-gcm",
        master,
        sealed.subarray(0, 12),
      );
    decipher.setAuthTag(sealed.subarray(12, 28));
    const decoded = JSON.parse(
      Buffer.concat([
        decipher.update(sealed.subarray(28)),
        decipher.final(),
      ]).toString("utf8"),
    );
    expect(decoded.format).toBe(2);
    expect(
      decoded.entries.every(
        (entry: Record<string, unknown>) =>
          !("key" in entry) && typeof entry.credentialRef === "string",
      ),
    ).toBe(true);
    expect(JSON.stringify(decoded).match(/test-only-shared-key/g)).toHaveLength(
      1,
    );
    const reopened = openPersonalVault(directory);
    expect(reopened.configuration!(actor)).toEqual(saved);
    expect(
      reopened.configuration!({ ...actor, principalId: "other" }).connections,
    ).toEqual([]);
    expect(() =>
      reopened.connectionAdapter!(
        { ...actor, workspaceId: "other" },
        saved.connections[0]!.id,
      ),
    ).toThrow("NOT_FOUND");
    expect(() => reopened.saveConfiguration!(actor, 0, input)).toThrow(
      "VERSION_CONFLICT",
    );
    const resolver = new ModelRouteResolver(reopened);
    expect(
      resolver.resolve(actor, { projectId: "project", spaceId: "space" })?.route
        .profileId,
    ).toBe(
      saved.bindings.find((binding) => binding.scope === "SPACE")!.profileId,
    );
    expect(
      resolver.resolve(actor, { projectId: "project", spaceId: "space" })?.route
        .scope,
    ).toBe("personal");
    const updated = reopened.save(actor, 1, {
      ...old("personal"),
      key: "test-only-rotated-key",
      model: "changed",
    });
    expect(updated.version).toBe(2);
    const afterLegacyWrite = reopened.configuration!(actor);
    expect(afterLegacyWrite.connections).toHaveLength(2);
    expect(afterLegacyWrite.profiles).toHaveLength(3);
    expect(afterLegacyWrite.bindings).toHaveLength(3);
    expect(
      new ModelRouteResolver(reopened).resolve(actor, {})?.route.model,
    ).toBe("changed");
    expect(
      new ModelRouteResolver(reopened).resolve(actor, { spaceId: "space" })
        ?.route.model,
    ).toBe("default");
    expect(JSON.stringify(afterLegacyWrite)).not.toContain(
      "test-only-rotated-key",
    );
    expect(openPersonalVault(directory).configuration!(actor)).toEqual(
      afterLegacyWrite,
    );
  });
  it("creates distinct fallback slots when different profiles share models", () => {
    const config = migrateLegacyConfiguration(owner, [
      old("personal"),
      old("personal", "fallback"),
      old("WORK:project"),
    ]);
    config.version = 1;
    config.profiles[0]!.fallbackModelIds = [config.profiles[1]!.primaryModelId];
    config.profiles[2]!.fallbackModelIds = [config.profiles[1]!.primaryModelId];
    const entries = configurationEntries(config).filter(
      (entry) => entry.scope === "personal" && entry.profileId !== "default",
    );
    expect(new Set(entries.map((entry) => entry.profileId)).size).toBe(
      entries.length,
    );
  });
});
