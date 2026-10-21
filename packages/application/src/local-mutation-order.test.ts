import { expect, it } from "vitest";
import {
  compareLocalMutations,
  validLocalMutationOrder,
} from "./local-mutation-order";
import type { LocalMutation } from "./local-persistence";

function mutation(id: string, order?: LocalMutation["order"]): LocalMutation {
  return {
    id,
    ...(order ? { order } : {}),
    deviceId: "device",
    workspaceId: "workspace",
    principalId: "owner",
    operation: "CREATE",
    entityType: "tasks",
    entityId: id,
    baseVersion: null,
    payload: {},
    createdAt: "2026-10-13T00:00:00Z",
    attemptCount: 0,
    lastAttemptAt: null,
    state: "PENDING",
  };
}

it("preserves causal revision and operation order independently of UUID and clock", () => {
  const values = [
    mutation("a", { transactionVersion: 2, operationIndex: 0 }),
    mutation("b", { transactionVersion: 1, operationIndex: 1 }),
    mutation("z", { transactionVersion: 1, operationIndex: 0 }),
  ];
  expect(values.sort(compareLocalMutations).map((value) => value.id)).toEqual([
    "z",
    "b",
    "a",
  ]);
});

it("retains legacy mutations before stamped entries without claiming causal proof", () => {
  const values = [
    mutation("new", { transactionVersion: 1, operationIndex: 0 }),
    mutation("z"),
    mutation("a"),
  ];
  expect(values.sort(compareLocalMutations).map((value) => value.id)).toEqual([
    "a",
    "z",
    "new",
  ]);
});

it("rejects malformed, inherited and out-of-range order stamps", () => {
  expect(validLocalMutationOrder(undefined)).toBe(true);
  expect(
    validLocalMutationOrder({ transactionVersion: 1, operationIndex: 0 }),
  ).toBe(true);
  const inherited = Object.assign(
    Object.create({ transactionVersion: 1, operationIndex: 0 }),
    { unrelated: 1, another: 2 },
  );
  for (const value of [
    null,
    [],
    inherited,
    { transactionVersion: 0, operationIndex: 0 },
    { transactionVersion: 1, operationIndex: -1 },
    { transactionVersion: 1.5, operationIndex: 0 },
    { transactionVersion: Number.MAX_SAFE_INTEGER + 1, operationIndex: 0 },
    { transactionVersion: 1, operationIndex: Number.NaN },
    { transactionVersion: 1, operationIndex: 0, extra: true },
  ]) {
    expect(validLocalMutationOrder(value)).toBe(false);
  }
  expect(() =>
    compareLocalMutations(
      mutation("bad", { transactionVersion: 0, operationIndex: 0 }),
      mutation("legacy"),
    ),
  ).toThrow("LOCAL_MUTATION_ORDER_CORRUPT");
});
