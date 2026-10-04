import { type ActorContext, DomainError } from "@arclattice/domain";
import type { ModelPort } from "./connected";
import type { PersonalModelVault } from "./personal-ai";

export interface ModelRoutingContext {
  projectId?: string;
  spaceId?: string;
  explicitProfileId?: string;
}

/** Model selection only. Retrieval permissions and content remain a separate boundary. */
export class ModelRouteResolver {
  constructor(
    private readonly vault: Pick<
      PersonalModelVault,
      "list" | "resolve" | "configuration"
    >,
  ) {}
  resolve(actor: ActorContext, context: ModelRoutingContext): ModelPort | null {
    if (!actor.workspaceId || !actor.principalId)
      throw new DomainError("FORBIDDEN");
    const configuration = this.vault.configuration?.(actor);
    if (configuration && configuration.version > 0) {
      const selected = context.explicitProfileId
        ? configuration.profiles.find(
            (profile) => profile.id === context.explicitProfileId,
          )
        : [
            ...(context.spaceId
              ? [
                  configuration.bindings.find(
                    (binding) =>
                      binding.scope === "SPACE" &&
                      binding.entityId === context.spaceId,
                  ),
                ]
              : []),
            ...(context.projectId
              ? [
                  configuration.bindings.find(
                    (binding) =>
                      binding.scope === "PROJECT" &&
                      binding.entityId === context.projectId,
                  ),
                ]
              : []),
            configuration.bindings.find(
              (binding) => binding.scope === "PERSONAL",
            ),
          ]
            .flatMap((binding) =>
              binding
                ? [
                    configuration.profiles.find(
                      (profile) => profile.id === binding.profileId,
                    ),
                  ]
                : [],
            )
            .find((profile) => !!profile);
      if (!selected) {
        if (context.explicitProfileId) throw new DomainError("NOT_FOUND");
        return null;
      }
      return this.vault.resolve(actor, "personal", selected.id);
    }
    const available = this.vault.list(actor);
    if (context.explicitProfileId && configuration) {
      const migrated = configuration.profiles.find(
        (profile) => profile.id === context.explicitProfileId,
      );
      if (migrated)
        return this.vault.resolve(
          actor,
          migrated.legacyScope ?? "personal",
          migrated.name === "Default profile" ? "default" : migrated.name,
        );
    }
    const scopes = [
      ...(context.spaceId ? [`SPACE:${context.spaceId}`] : []),
      ...(context.projectId ? [`WORK:${context.projectId}`] : []),
      "personal",
    ];
    if (context.explicitProfileId) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(context.explicitProfileId))
        throw new DomainError("VALIDATION_ERROR");
      // An explicit profile is resolved independently of bindings, preferring its
      // personal definition. An unavailable override must never silently inherit.
      const explicitScopes = [
        "personal",
        ...scopes.filter((scope) => scope !== "personal"),
      ];
      for (const scope of explicitScopes) {
        if (
          available.some(
            (entry) =>
              entry.scope === scope &&
              (entry.profileId ?? "default") === context.explicitProfileId,
          )
        )
          return this.vault.resolve(actor, scope, context.explicitProfileId);
      }
      throw new DomainError("NOT_FOUND");
    }
    for (const scope of scopes) {
      if (
        available.some(
          (entry) =>
            entry.scope === scope &&
            (entry.profileId ?? "default") === "default",
        )
      )
        return this.vault.resolve(actor, scope, "default");
    }
    return null;
  }
}
