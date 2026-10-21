import { DomainError } from "@arclattice/domain";
import { localObject } from "./local-dto";
import { equalLocalJson } from "./local-json-equal";
import type { LocalEntity } from "./local-persistence";

export class LocalBodyUnavailableError extends Error {
  readonly code = "LOCAL_BODY_UNAVAILABLE";
  constructor(
    readonly collection: "notes" | "library",
    readonly entityId: string,
    readonly version: number,
  ) {
    super("LOCAL_BODY_UNAVAILABLE");
    this.name = "LocalBodyUnavailableError";
  }
}

/** An explicit remote MISSING state is not a license to mask lost local bodies. */
export function remoteBodyUnavailable(
  collection: "notes" | "library",
  manifest: LocalEntity,
  availability: LocalEntity | null,
  base: LocalEntity | null,
): boolean {
  if (!availability) return false;
  const state = localObject(availability.value);
  if (state.state !== "MISSING" || state.entityVersion !== manifest.version)
    return false;
  if (!base) throw new Error("LOCAL_DATA_CORRUPT");
  const canonical = localObject(base.value);
  if (
    availability.workspaceId !== manifest.workspaceId ||
    availability.id !== manifest.id ||
    base.workspaceId !== manifest.workspaceId ||
    base.id !== JSON.stringify([collection, manifest.id]) ||
    canonical.collection !== collection ||
    canonical.id !== manifest.id ||
    canonical.version !== manifest.version ||
    state.collection !== collection ||
    state.id !== manifest.id ||
    typeof state.serverOrigin !== "string" ||
    !state.serverOrigin ||
    typeof state.remoteWorkspaceId !== "string" ||
    !state.remoteWorkspaceId ||
    typeof state.remotePrincipalId !== "string" ||
    !state.remotePrincipalId ||
    typeof state.epoch !== "string" ||
    !state.epoch ||
    canonical.serverOrigin !== state.serverOrigin ||
    canonical.remoteWorkspaceId !== state.remoteWorkspaceId ||
    canonical.remotePrincipalId !== state.remotePrincipalId ||
    canonical.epoch !== state.epoch
  )
    throw new Error("LOCAL_DATA_CORRUPT");
  if (canonical.value === undefined) throw new Error("LOCAL_DATA_CORRUPT");
  const value = localObject(canonical.value);
  if (
    value.id !== manifest.id ||
    value.workspaceId !== state.remoteWorkspaceId ||
    value.version !== manifest.version ||
    value.bodyState !== "UNLOADED" ||
    Object.hasOwn(value, "bodyMd")
  )
    throw new DomainError("VALIDATION_ERROR", { field: "bodyAvailability" });
  const manifestValue = localObject(manifest.value);
  const fields = Object.keys(manifestValue);
  if (
    fields.length !== Object.keys(value).length ||
    fields.some(
      (field) =>
        !equalLocalJson(
          manifestValue[field]!,
          field === "workspaceId" ? manifest.workspaceId : value[field]!,
        ),
    )
  )
    throw new Error("LOCAL_DATA_CORRUPT");
  return true;
}
