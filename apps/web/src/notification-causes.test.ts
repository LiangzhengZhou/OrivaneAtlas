import type { LocalMutation, WorkflowRecord } from "@arclattice/application";
import type { LibraryFile, Reminder } from "@arclattice/domain";
import { expect, test } from "vitest";
import { work } from "../../../tests/fixtures";
import { notificationCauses } from "./app/hooks/useNotificationCenter";

const reminder: Reminder = {
  id: "r",
  workspaceId: "w",
  version: 1,
  title: "Call",
  bodyMd: "",
  day: "2026-03-08",
  time: "09:45",
  timezone: "America/New_York",
  notifyMode: "MINUTES_BEFORE",
  notifyOffsetMinutes: 15,
  linkedProjectId: null,
  linkedTaskId: null,
  state: "ACTIVE",
  deletedAt: null,
  createdAt: "2026-03-08T00:00:00Z",
  updatedAt: "2026-03-08T00:00:00Z",
  createdBy: "p",
  updatedBy: "p",
};
function causes(value = reminder) {
  return notificationCauses(
    {
      items: [],
      reminders: [value],
      calendarTimezone: "UTC",
    },
    "w",
    "2026-03-08",
    "2026-03-08T08:00:00.000Z",
    "en-US",
  );
}
test("Reminder records retain their actual DST-aware time and offset rather than notifying at startup", () => {
  expect(causes()[0]?.fireAt).toBe("2026-03-08T13:30:00.000Z");
  expect(causes({ ...reminder, notifyMode: "AT_TIME" })[0]?.fireAt).toBe(
    "2026-03-08T13:45:00.000Z",
  );
});

test("only recent failed local files require attention; successful processing is quiet", () => {
  const file: LibraryFile = {
    id: "file",
    workspaceId: "w",
    spaceId: null,
    parentDocumentId: null,
    name: "Report.pdf",
    originalName: "Report.pdf",
    extension: "pdf",
    mime: "application/pdf",
    size: 12,
    contentHash: "a".repeat(64),
    blobId: "blob",
    version: 2,
    provenance: "HUMAN",
    aiPolicy: {
      classification: "PRIVATE",
      processingBoundary: "LOCAL_ONLY",
      aiAccess: "DENY",
    },
    extractionStatus: "FAILED",
    indexStatus: "PENDING",
    createdBy: "p",
    updatedBy: "p",
    createdAt: "2026-03-08T07:00:00Z",
    updatedAt: "2026-03-08T07:00:00Z",
    deletedAt: null,
  };
  const derive = (value: LibraryFile) =>
    notificationCauses(
      { items: [], files: [value] },
      "w",
      "2026-03-08",
      "2026-03-08T08:00:00Z",
      "en-US",
    );
  expect(derive(file)).toMatchObject([
    {
      reason: "FILE_PROCESSING_FAILED",
      target: { kind: "FILE", id: "file" },
      targetVersion: 2,
    },
  ]);
  for (const changes of [
    { extractionStatus: "READY" as const, indexStatus: "READY" as const },
    { workspaceId: "other" },
    { deletedAt: file.updatedAt },
    { updatedAt: "2026-02-01T00:00:00Z" },
  ])
    expect(derive({ ...file, ...changes })).toEqual([]);
});
test("future Reminder records are durable schedule candidates; terminal and foreign reminders never are", () => {
  expect(causes({ ...reminder, day: "2026-03-09" })[0]?.fireAt).toBe(
    "2026-03-09T13:30:00.000Z",
  );
  for (const changed of [
    { state: "DONE" as const },
    { deletedAt: reminder.createdAt },
    { workspaceId: "foreign" },
    { notifyMode: "NONE" as const },
  ])
    expect(causes({ ...reminder, ...changed })).toEqual([]);
});

test("future Task start and due records preserve local wall clock and suppress terminal tasks", () => {
  const task = {
    ...work("t", "w"),
    startDate: "2026-03-09",
    dueDate: "2026-03-10",
  };
  const snapshot = {
    items: [task],
    reminders: [],
    calendarTimezone: "America/New_York",
  };
  expect(
    notificationCauses(
      snapshot,
      "w",
      "2026-03-08",
      "2026-03-08T08:00:00.000Z",
      "en-US",
    ).map((c) => [c.reason, c.fireAt]),
  ).toEqual([
    ["TASK_START", "2026-03-09T13:00:00.000Z"],
    ["TASK_DUE", "2026-03-10T13:00:00.000Z"],
  ]);
  expect(
    notificationCauses(
      { ...snapshot, items: [{ ...task, status: "DONE" }] },
      "w",
      "2026-03-08",
      "2026-03-08T08:00:00.000Z",
      "en-US",
    ),
  ).toEqual([]);
});

test("reached milestones produce one occasion while reopened and old milestones are quiet", () => {
  const milestone = {
    ...work("m", "w"),
    type: "MILESTONE" as const,
    status: "DONE" as const,
    updatedAt: "2026-03-08T07:00:00Z",
  };
  const derive = (item: typeof milestone) =>
    notificationCauses(
      { items: [item] },
      "w",
      "2026-03-08",
      "2026-03-08T08:00:00Z",
      "en-US",
    );
  expect(derive(milestone)).toMatchObject([
    { reason: "MILESTONE_REACHED", occasion: milestone.updatedAt },
  ]);
  expect(derive({ ...milestone, deletedAt: milestone.updatedAt })).toEqual([]);
  expect(derive({ ...milestone, updatedAt: "2026-02-01T00:00:00Z" })).toEqual(
    [],
  );
});

test("an open recurrence nearing expiry is actionable; skipped, completed and expired occurrences stay quiet", () => {
  const task = work("t", "w");
  const occurrence: WorkflowRecord = {
    id: "o",
    workspaceId: "w",
    version: 1,
    createdBy: "p",
    updatedBy: "p",
    createdAt: "2026-03-08T06:00:00Z",
    updatedAt: "2026-03-08T06:00:00Z",
    deletedAt: null,
    payload: {
      kind: "OCCURRENCE",
      definitionId: "series",
      definitionVersion: 1,
      day: "2026-03-08",
      status: "OPEN",
      expiresAt: "2026-03-08T09:00:00Z",
      taskId: task.id,
      completedAt: null,
      recordedAt: "2026-03-08T06:00:00Z",
      backfilledAt: null,
    },
  };
  const derive = (workflow: WorkflowRecord, now = "2026-03-08T08:00:00Z") =>
    notificationCauses(
      { items: [task], workflows: [workflow] },
      "w",
      "2026-03-08",
      now,
      "en-US",
    );
  expect(derive(occurrence)).toMatchObject([
    { reason: "RECURRENCE_EXPIRING", fireAt: "2026-03-08T08:00:00.000Z" },
  ]);
  expect(derive(occurrence, "2026-03-08T09:00:00Z")).toEqual([]);
  expect(derive({ ...occurrence, deletedAt: occurrence.updatedAt })).toEqual(
    [],
  );
  if (occurrence.payload.kind !== "OCCURRENCE") throw new Error("Fixture kind");
  for (const status of ["SKIPPED", "COMPLETED", "MISSED"] as const)
    expect(
      derive({ ...occurrence, payload: { ...occurrence.payload, status } }),
    ).toEqual([]);
});

test("only actionable sync failures produce attention, with no payload or credentials exposed", () => {
  const mutation: LocalMutation = {
    id: "mutation",
    workspaceId: "w",
    principalId: "p",
    deviceId: "d",
    operation: "PATCH",
    entityType: "WORK",
    entityId: "t",
    baseVersion: 1,
    payload: { title: "Private text" },
    createdAt: "2026-03-08T07:00:00Z",
    attemptCount: 1,
    lastAttemptAt: "2026-03-08T08:00:00Z",
    state: "CONFLICT",
  };
  const derive = (value: LocalMutation) =>
    notificationCauses(
      { items: [], syncMutations: [value] },
      "w",
      "2026-03-08",
      "2026-03-08T08:00:00Z",
      "en-US",
    );
  expect(derive(mutation)).toMatchObject([
    { reason: "CONFLICT_ACTIONABLE", needsUserAction: true, body: "" },
  ]);
  expect(JSON.stringify(derive(mutation))).not.toContain("Private text");
  expect(derive({ ...mutation, state: "REJECTED" })).toMatchObject([
    { reason: "SYNC_NEEDS_INTERVENTION" },
  ]);
  expect(derive({ ...mutation, state: "PENDING" })).toEqual([]);
  expect(derive({ ...mutation, state: "SENDING" })).toEqual([]);
  expect(derive({ ...mutation, workspaceId: "other" })).toEqual([]);
});
