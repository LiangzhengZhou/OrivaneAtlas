import { expect, it } from "vitest";
import type { Snapshot } from "../bootstrap";
import { notificationProjection } from "./notification-projection";

it("reuses pure notification inputs across unrelated hydration but invalidates entity, scope, timezone and derived File status", () => {
  const snapshot = {
    items: [{ id: "task", version: 1, status: "TODO" }],
    files: [
      {
        id: "file",
        version: 1,
        extractionStatus: "PENDING",
        indexStatus: "PENDING",
      },
    ],
    reminders: [{ id: "reminder", version: 1 }],
    workflows: [{ id: "workflow", version: 1 }],
    calendarTimezone: "UTC",
    notes: [],
    library: [],
    edges: [],
    links: [],
    organization: [],
    projectMaterials: [],
  } as unknown as Snapshot;
  const original = notificationProjection(snapshot, "account-a");
  expect(
    notificationProjection(structuredClone(snapshot), "account-a", original),
  ).toBe(original);
  expect(notificationProjection(snapshot, "account-b", original)).not.toBe(
    original,
  );
  for (const collection of [
    "items",
    "files",
    "reminders",
    "workflows",
  ] as const) {
    const changed = {
      ...snapshot,
      [collection]: snapshot[collection]!.map((row) => ({
        ...row,
        version: row.version + 1,
      })),
    };
    expect(notificationProjection(changed, "account-a", original)).not.toBe(
      original,
    );
  }
  const changed = {
    ...snapshot,
    files: snapshot.files!.map((file) => ({
      ...file,
      extractionStatus: "FAILED" as const,
    })),
  };
  expect(notificationProjection(changed, "account-a", original)).not.toBe(
    original,
  );
  expect(
    notificationProjection(
      { ...snapshot, calendarTimezone: "Asia/Shanghai" },
      "account-a",
      original,
    ),
  ).not.toBe(original);
});
