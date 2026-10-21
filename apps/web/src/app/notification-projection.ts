import type { Snapshot } from "../bootstrap";

type Projection = Pick<
  Snapshot,
  "items" | "files" | "reminders" | "workflows" | "calendarTimezone"
>;
export function notificationProjection(
  snapshot: Snapshot,
  scope: string,
  previous?: { key: string; value: Projection },
) {
  // Business fields use entity CAS versions. File processing status is derived
  // independently, so include it explicitly even when the File version is equal.
  const versions = (rows: readonly { id: string; version: number }[] = []) =>
    rows.map((row) => [row.id, row.version]);
  const key = JSON.stringify([
    scope,
    snapshot.calendarTimezone,
    versions(snapshot.items),
    versions(snapshot.reminders),
    versions(snapshot.workflows),
    (snapshot.files ?? []).map((file) => [
      file.id,
      file.version,
      file.extractionStatus,
      file.indexStatus,
    ]),
  ]);
  if (previous?.key === key) return previous;
  return {
    key,
    value: {
      items: snapshot.items,
      ...(snapshot.files === undefined ? {} : { files: snapshot.files }),
      ...(snapshot.reminders === undefined
        ? {}
        : { reminders: snapshot.reminders }),
      ...(snapshot.workflows === undefined
        ? {}
        : { workflows: snapshot.workflows }),
      ...(snapshot.calendarTimezone === undefined
        ? {}
        : { calendarTimezone: snapshot.calendarTimezone }),
    },
  };
}
