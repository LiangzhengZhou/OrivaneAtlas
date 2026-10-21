import { localDto, localObject } from "./local-dto";
import type { LocalJson, LocalMutation } from "./local-persistence";
import { mergeMarkdown } from "./markdown-merge";

export type LocalRecordRebase =
  | {
      readonly state: "CLEAN";
      readonly value: LocalJson;
      readonly changedFields: readonly string[];
    }
  | {
      readonly state: "CONFLICT";
      readonly fields: readonly string[];
      readonly reason: "BASE_UNAVAILABLE" | "DELETE_VS_EDIT" | "SAME_FIELD";
    };

const metadata = new Set([
  "version",
  "workspaceId",
  "createdBy",
  "createdAt",
  "updatedBy",
  "updatedAt",
  "bodyState",
  "bodyCharacterCount",
]);

function equal(
  left: LocalJson | undefined,
  right: LocalJson | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return false;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => equal(item, right[index]))
    );
  const a = left as Record<string, LocalJson>,
    b = right as Record<string, LocalJson>;
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every(
      (key) => Object.hasOwn(b, key) && equal(a[key], b[key]),
    )
  );
}

/** Computes a reviewable candidate only; committing still requires version and binding CAS. */
export function rebaseLocalRecord(
  mutation: LocalMutation,
  remoteValue: LocalJson | null,
): LocalRecordRebase {
  if (mutation.basePayload === undefined)
    return { state: "CONFLICT", fields: [], reason: "BASE_UNAVAILABLE" };
  const intended = localObject(localDto(mutation.payload));
  const base =
    mutation.basePayload === null
      ? null
      : localObject(localDto(mutation.basePayload));
  const remote =
    remoteValue === null ? null : localObject(localDto(remoteValue));
  if (base === null)
    return remote === null || equal(intended, remote)
      ? {
          state: "CLEAN",
          value: intended,
          changedFields: Object.keys(intended).filter(
            (key) => !metadata.has(key),
          ),
        }
      : { state: "CONFLICT", fields: ["id"], reason: "SAME_FIELD" };
  if (
    (Object.hasOwn(base, "id") && !equal(base.id, intended.id)) ||
    (remote && Object.hasOwn(base, "id") && !equal(base.id, remote.id))
  )
    return { state: "CONFLICT", fields: ["id"], reason: "SAME_FIELD" };
  const fields = [
    ...new Set([
      ...Object.keys(base),
      ...Object.keys(intended),
      ...Object.keys(remote ?? {}),
    ]),
  ].filter((key) => !metadata.has(key));
  const localChanged = fields.filter((key) => !equal(base[key], intended[key]));
  const remoteChanged = fields.filter(
    (key) => !equal(base[key], remote?.[key]),
  );
  const deleted = (value: Record<string, LocalJson> | null) =>
    value === null ||
    value.localTombstone === true ||
    typeof value.deletedAt === "string";
  if (
    deleted(intended) !== deleted(remote) &&
    (deleted(intended) ? remoteChanged.length > 0 : localChanged.length > 0)
  )
    return {
      state: "CONFLICT",
      fields: ["deletedAt"],
      reason: "DELETE_VS_EDIT",
    };
  if (remote === null)
    return localChanged.length === 0
      ? { state: "CLEAN", value: null, changedFields: [] }
      : { state: "CONFLICT", fields: ["deletedAt"], reason: "DELETE_VS_EDIT" };
  const markdown = new Map<string, string>();
  const conflicts = localChanged.filter((key) => {
    if (!remoteChanged.includes(key) || equal(intended[key], remote[key]))
      return false;
    if (
      (key === "bodyMd" || key === "descriptionMd") &&
      typeof base[key] === "string" &&
      typeof intended[key] === "string" &&
      typeof remote[key] === "string"
    ) {
      const result = mergeMarkdown(base[key], intended[key], remote[key]);
      if (result.conflicts === 0) {
        markdown.set(key, result.text);
        return false;
      }
    }
    return true;
  });
  if (conflicts.length)
    return { state: "CONFLICT", fields: conflicts, reason: "SAME_FIELD" };
  const merged = Object.assign(Object.create(null), remote) as Record<
    string,
    LocalJson
  >;
  for (const key of localChanged) {
    if (Object.hasOwn(intended, key))
      merged[key] = markdown.get(key) ?? intended[key]!;
    else delete merged[key];
  }
  return {
    state: "CLEAN",
    value: localDto(merged),
    changedFields: localChanged,
  };
}
