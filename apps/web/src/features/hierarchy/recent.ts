export interface PickerIdentity {
  server: string;
  workspaceId: string;
  principalId: string;
}
export function recentKey(identity: PickerIdentity, kind: string): string {
  return (
    "orivane.atlas.picker-recent.v1:" +
    JSON.stringify([
      identity.server,
      identity.workspaceId,
      identity.principalId,
      kind,
    ])
  );
}
export function cleanRecent(
  value: unknown,
  accessible: ReadonlySet<string>,
): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (id): id is string =>
          typeof id === "string" && id.length <= 240 && accessible.has(id),
      ),
    ),
  ].slice(0, 5);
}
