import { DomainError } from "@arclattice/domain";

/** Explicit grants: no wildcard, implicit hierarchy or read-from-write inference. */
export const apiScopes = [
  "workspace:read",
  "tasks:read",
  "tasks:write",
  "projects:read",
  "projects:write",
  "knowledge:read",
  "knowledge:write",
  "files:read",
  "files:write",
  "files:content",
  "proposals:read",
  "proposals:write",
  "proposals:apply",
  "plans:propose",
  "plans:publish",
  "atlas:context",
  "atlas:request",
  "atlas:approval",
  "atlas:invoke",
  "capabilities:execute",
] as const;
export type ApiScope = (typeof apiScopes)[number];

export function requireApiScopes(input: unknown): ApiScope[] {
  if (
    !Array.isArray(input) ||
    !input.length ||
    input.length > apiScopes.length ||
    input.some(
      (scope) =>
        typeof scope !== "string" || !apiScopes.includes(scope as ApiScope),
    ) ||
    new Set(input).size !== input.length
  )
    throw new DomainError("VALIDATION_ERROR");
  return [...input].sort() as ApiScope[];
}

export function requireApiGrants(
  grants: readonly ApiScope[],
  required: readonly ApiScope[],
): void {
  // Revalidate durable data rather than trusting a TypeScript annotation.
  const canonical = requireApiScopes(grants);
  if (
    !required.length ||
    required.some(
      (scope) => !apiScopes.includes(scope) || !canonical.includes(scope),
    )
  )
    throw new DomainError("FORBIDDEN");
}
