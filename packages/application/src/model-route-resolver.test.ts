import type { ActorContext } from "@arclattice/domain";
import { describe, expect, it } from "vitest";
import type { ModelPort } from "./connected";
import { ModelRouteResolver } from "./model-route-resolver";
import type { PersonalModelSummary, PersonalModelVault } from "./personal-ai";

const actor: ActorContext = { workspaceId: "w", principalId: "p" };
function fixture() {
  const rows: PersonalModelSummary[] = [
    "personal",
    "WORK:project",
    "SPACE:space",
  ].map((scope) => ({
    scope,
    profileId: "default",
    endpoint: "https://models.example/v1/",
    protocol: "chat",
    model: scope,
    maxRunsPerDay: 100,
    version: 1,
    route: {
      scope,
      profileId: "default",
      provider: "provider",
      model: scope,
      fingerprint: scope,
      timeoutMs: 60000,
      maxInputChars: 32000,
      maxOutputTokens: 4096,
      maxRunsPerDay: 100,
    },
  }));
  rows.push({
    ...rows[0]!,
    profileId: "explicit",
    route: { ...rows[0]!.route, model: "explicit", profileId: "explicit" },
  });
  const vault: Pick<PersonalModelVault, "list" | "resolve"> = {
    list: (context) =>
      context.workspaceId === "w" && context.principalId === "p" ? rows : [],
    resolve: (context, scope, profileId = "default") => {
      const row = vault
        .list(context)
        .find(
          (entry) => entry.scope === scope && entry.profileId === profileId,
        );
      return row
        ? ({ route: row.route, complete: async () => "" } satisfies ModelPort)
        : null;
    },
  };
  return { rows, resolver: new ModelRouteResolver(vault) };
}
describe("model routing is independent of retrieval", () => {
  it("resolves Explicit > Space > Project > Personal, inheriting unset bindings", () => {
    const { rows, resolver } = fixture();
    expect(resolver.resolve(actor, {})?.route.model).toBe("personal");
    expect(resolver.resolve(actor, { projectId: "project" })?.route.model).toBe(
      "WORK:project",
    );
    expect(
      resolver.resolve(actor, { projectId: "project", spaceId: "space" })?.route
        .model,
    ).toBe("SPACE:space");
    expect(
      resolver.resolve(actor, {
        projectId: "project",
        spaceId: "space",
        explicitProfileId: "explicit",
      })?.route.model,
    ).toBe("explicit");
    rows.splice(2, 1);
    expect(
      resolver.resolve(actor, { projectId: "project", spaceId: "space" })?.route
        .model,
    ).toBe("WORK:project");
    expect(
      resolver.resolve(actor, { projectId: "missing", spaceId: "missing" })
        ?.route.model,
    ).toBe("personal");
  });
  it("isolates principals/workspaces and never silently replaces a missing explicit override", () => {
    const { resolver } = fixture();
    expect(
      resolver.resolve(
        { ...actor, principalId: "other" },
        { projectId: "project" },
      ),
    ).toBeNull();
    expect(
      resolver.resolve(
        { ...actor, workspaceId: "other" },
        { spaceId: "space" },
      ),
    ).toBeNull();
    expect(() =>
      resolver.resolve(actor, { explicitProfileId: "missing" }),
    ).toThrow();
  });
});
