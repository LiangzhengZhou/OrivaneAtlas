import { expect, it } from "vitest";
import {
  projectLocalRecurrence,
  validateLocalCanonicalRecurrenceValue,
} from "./local-canonical-recurrence";
import type { LocalCommandPlan } from "./local-command-plan";
import { buildLocalRecurrenceReplayRequest } from "./local-recurrence-replay-request";

const commandId = "11111111-1111-4111-8111-111111111111",
  deviceId = "22222222-2222-4222-8222-222222222222",
  definitionId = "33333333-3333-4333-8333-333333333333";
const rule = {
  title: "Original",
  descriptionMd: "原文\r\n[[Target]]",
  startDate: "2026-10-14",
  timezone: "UTC",
  frequency: "DAILY",
  interval: 1,
  state: "PAUSED",
};
function plan(): LocalCommandPlan {
  return {
    id: commandId,
    state: "READY",
    command: {
      name: "recurrence.save",
      input: { definitionId, input: { version: 0, deleted: false, rule } },
    },
    mutationIds: [commandId],
    mutations: [
      {
        id: commandId,
        commandId,
        workspaceId: "local",
        principalId: "owner",
        deviceId,
        entityType: "workflows",
        entityId: definitionId,
        operation: "CREATE",
        baseVersion: null,
        payload: { descriptionMd: "Newer text" },
        state: "PENDING",
        attemptCount: 0,
        lastAttemptAt: null,
        createdAt: "2026-10-14T00:00:00Z",
      },
    ],
  };
}
it("recurrence serializer preserves original definition identity and Markdown rather than a newer projection", () => {
  expect(buildLocalRecurrenceReplayRequest(plan())).toMatchObject({
    path: "/api/v1/recurrences/save",
    idempotencyKey: commandId,
    deviceId,
    body: {
      stableId: definitionId,
      rule,
      syncCommand: {
        effects: [
          { collection: "workflows", id: definitionId, baseVersion: 0 },
        ],
      },
    },
  });
  const wrong = plan();
  expect(() =>
    buildLocalRecurrenceReplayRequest({
      ...wrong,
      mutations: [{ ...wrong.mutations[0]!, entityId: "foreign" }],
    }),
  ).toThrow("VALIDATION_ERROR");
  expect(
    buildLocalRecurrenceReplayRequest({ ...plan(), mutationIds: [] }),
  ).toBeNull();
  expect(() =>
    buildLocalRecurrenceReplayRequest({
      ...plan(),
      command: { name: "recurrence.skip", input: {} },
    }),
  ).toThrow("VALIDATION_ERROR");
});
it("canonical recurrence validation checks actor/scope/version and deterministic occurrence identity", () => {
  const record = {
    id: definitionId,
    workspaceId: "remote",
    version: 1,
    createdBy: "owner",
    updatedBy: "owner",
    createdAt: "2026-10-14T00:00:00Z",
    updatedAt: "2026-10-14T00:00:00Z",
    deletedAt: null,
    payload: { ...rule, kind: "RECURRENCE" },
  };
  expect(() =>
    validateLocalCanonicalRecurrenceValue(definitionId, "remote", 1, record),
  ).not.toThrow();
  expect(() =>
    validateLocalCanonicalRecurrenceValue(definitionId, "foreign", 1, record),
  ).toThrow("VALIDATION_ERROR");
  expect(() =>
    validateLocalCanonicalRecurrenceValue(definitionId, "remote", 2, record),
  ).toThrow("VALIDATION_ERROR");
  expect(() =>
    validateLocalCanonicalRecurrenceValue(definitionId, "remote", 1, {
      ...record,
      payload: { kind: "PLAN" },
    }),
  ).toThrow("VALIDATION_ERROR");
  expect(() =>
    validateLocalCanonicalRecurrenceValue(definitionId, "remote", 1, {
      ...record,
      payload: { ...record.payload, timezone: "Invalid/Zone" },
    }),
  ).toThrow();
});
it("recurrence projection maps only the confirmed remote owner and leaves canonical remote audit facts untouched", () => {
  const remote = {
    id: definitionId,
    workspaceId: "remote",
    createdBy: "bound-remote-owner",
    updatedBy: "foreign-member",
    version: 2,
  };
  const before = structuredClone(remote);
  expect(
    projectLocalRecurrence(
      remote,
      "local",
      "installation-owner",
      "bound-remote-owner",
    ),
  ).toEqual({
    ...remote,
    workspaceId: "local",
    createdBy: "installation-owner",
  });
  expect(remote).toEqual(before);
  expect(
    projectLocalRecurrence(
      { ...remote, createdBy: "foreign-member" },
      "local",
      "installation-owner",
      "bound-remote-owner",
    ),
  ).toEqual({ ...remote, workspaceId: "local", createdBy: "foreign-member" });
});
