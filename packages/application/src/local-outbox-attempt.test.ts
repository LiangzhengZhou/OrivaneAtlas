import { expect, it } from "vitest";
import { localOutboxTransition } from "./local-outbox-attempt";
import type { LocalMutation, LocalOutboxTransition } from "./local-persistence";

const pending: LocalMutation = {
  id: "mutation",
  workspaceId: "local",
  principalId: "owner",
  deviceId: "original-device",
  entityType: "tasks",
  entityId: "task",
  operation: "CREATE",
  baseVersion: null,
  payload: { title: "Original" },
  createdAt: "2026-10-13T00:00:00Z",
  attemptCount: 0,
  lastAttemptAt: null,
  state: "PENDING",
};
const claim: LocalOutboxTransition = {
  workspaceId: "local",
  mutationId: "mutation",
  binding: {
    version: 1,
    remoteWorkspaceId: "remote",
    serverOrigin: "https://example.test",
  },
  expectedState: "PENDING",
  expectedAttemptCount: 0,
  expectedLastAttemptAt: null,
  nextState: "SENDING",
  at: "2026-10-13T00:01:00Z",
};

it("increments sending attempt once and keeps original identity and payload through retry", () => {
  const sending = localOutboxTransition(pending, claim);
  expect(sending).toEqual({
    ...pending,
    state: "SENDING",
    attemptCount: 1,
    lastAttemptAt: claim.at,
  });
  const retry = localOutboxTransition(sending, {
    ...claim,
    expectedState: "SENDING",
    expectedAttemptCount: 1,
    expectedLastAttemptAt: claim.at,
    nextState: "PENDING",
  });
  expect(retry).toEqual({ ...sending, state: "PENDING" });
  expect(pending.attemptCount).toBe(0);
});

it("rejects stale callbacks and invalid transitions without rewriting content", () => {
  const sending = localOutboxTransition(pending, claim);
  expect(() => localOutboxTransition(sending, claim)).toThrow(
    "VERSION_CONFLICT",
  );
  expect(() =>
    localOutboxTransition(sending, {
      ...claim,
      expectedState: "SENDING",
      nextState: "CONFLICT",
    }),
  ).toThrow("VERSION_CONFLICT");
  expect(() =>
    localOutboxTransition(pending, { ...claim, nextState: "REJECTED" }),
  ).toThrow("INVALID_WRITE");
  expect(() =>
    localOutboxTransition(pending, { ...claim, at: "invalid" }),
  ).toThrow("INVALID_WRITE");
  expect(() =>
    localOutboxTransition(pending, { ...claim, expectedAttemptCount: -1 }),
  ).toThrow("INVALID_WRITE");
});
