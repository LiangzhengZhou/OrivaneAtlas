import { expect, it } from "vitest";
import { remoteBodyUnavailable } from "./local-body-availability";
import { localObject } from "./local-dto";
import type { LocalEntity } from "./local-persistence";

function fixture() {
  const manifest: LocalEntity = {
    workspaceId: "local-workspace",
    collection: "library",
    id: "document",
    version: 4,
    value: {
      workspaceId: "local-workspace",
      id: "document",
      version: 4,
      title: "正文\r\n😀",
      bodyState: "UNLOADED",
      aliases: ["甲", "乙"],
      aiPolicy: { classification: "PRIVATE", aiAccess: "DENY" },
    },
  };
  const scope = {
    serverOrigin: "https://example.test",
    remoteWorkspaceId: "remote-workspace",
    remotePrincipalId: "owner",
    epoch: "epoch",
  };
  const availability: LocalEntity = {
    workspaceId: manifest.workspaceId,
    collection: "$local.libraryBodyAvailability",
    id: manifest.id,
    version: 1,
    value: {
      ...scope,
      collection: "library",
      id: manifest.id,
      state: "MISSING",
      entityVersion: 4,
    },
  };
  const base: LocalEntity = {
    workspaceId: manifest.workspaceId,
    collection: "$local.remoteBase",
    id: JSON.stringify(["library", manifest.id]),
    version: 1,
    value: {
      ...scope,
      collection: "library",
      id: manifest.id,
      version: 4,
      value: {
        ...localObject(manifest.value),
        workspaceId: "remote-workspace",
      },
    },
  };
  return { manifest, availability, base };
}

it("validates exact canonical content across local and remote workspace identities without mutating either record", () => {
  const { manifest, availability, base } = fixture();
  const original = structuredClone({ manifest, availability, base });
  Object.freeze(localObject(base.value).value);
  Object.freeze(manifest.value);
  expect(remoteBodyUnavailable("library", manifest, availability, base)).toBe(
    true,
  );
  expect({ manifest, availability, base }).toEqual(original);
});

it.each([
  "title",
  "aliases",
  "policy",
  "field-swap",
  "workspace",
  "owner",
  "epoch",
  "body",
])(
  "rejects same-version canonical corruption or foreign scope: %s",
  (scenario) => {
    const { manifest, availability, base } = fixture();
    const canonical = localObject(base.value);
    const value = localObject(canonical.value!);
    if (scenario === "title") value.title = "Changed";
    if (scenario === "aliases") value.aliases = ["乙", "甲"];
    if (scenario === "policy")
      value.aiPolicy = { classification: "PRIVATE", aiAccess: "ALLOW" };
    if (scenario === "field-swap") {
      delete value.title;
      value.replacement = "正文\r\n😀";
    }
    if (scenario === "workspace") value.workspaceId = "foreign";
    if (scenario === "owner") canonical.remotePrincipalId = "foreign";
    if (scenario === "epoch") canonical.epoch = "foreign";
    if (scenario === "body") value.bodyMd = "Unexpected body";
    expect(() =>
      remoteBodyUnavailable("library", manifest, availability, base),
    ).toThrow();
  },
);
