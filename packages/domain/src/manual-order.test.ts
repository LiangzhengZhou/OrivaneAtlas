import { describe, expect, it } from "vitest";
import {
  manualOrderScopeKey,
  planOrderMove,
  planOrderSequence,
  requireManualOrderScope,
  requireManualOrderState,
} from "./manual-order";

describe("scoped sparse order", () => {
  it("canonical order validates scope, entry ownership and unique sparse positions", () => {
    const state = {
      id: "WORKSPACE_TASKS",
      workspaceId: "workspace",
      scope: { kind: "WORKSPACE_TASKS" },
      version: 1,
      updatedBy: "human",
      updatedAt: "2026-10-13T00:00:00Z",
      entries: [
        {
          workspaceId: "workspace",
          scopeKey: "WORKSPACE_TASKS",
          entityId: "a",
          position: 1024,
          version: 1,
          updatedBy: "human",
          updatedAt: "2026-10-13T00:00:00Z",
        },
      ],
    };
    expect(requireManualOrderState(state)).toEqual(state);
    expect(() => requireManualOrderScope({ kind: "UNKNOWN" })).toThrow();
    expect(() =>
      requireManualOrderScope({ kind: "PROJECT_TASKS", projectId: null }),
    ).toThrow();
    expect(() =>
      requireManualOrderState({ ...state, id: "wrong-scope" }),
    ).toThrow();
    expect(() =>
      requireManualOrderState({
        ...state,
        entries: state.entries.map((entry) => ({
          ...entry,
          workspaceId: "foreign",
        })),
      }),
    ).toThrow();
    expect(() =>
      requireManualOrderState({
        ...state,
        entries: [...state.entries, { ...state.entries[0], entityId: "b" }],
      }),
    ).toThrow();
  });
  it("keeps a 1500-member sparse move to one changed position", () => {
    const fixture = Array.from({ length: 1500 }, (_, index) => ({
      entityId: `task-${index}`,
      position: (index + 1) * 1024,
    }));
    expect(planOrderMove(fixture, "task-1499", "task-1", "BEFORE")).toEqual([
      { entityId: "task-1499", position: 1536 },
    ]);
    expect(fixture[1499]?.position).toBe(1500 * 1024);
  });
  it("keeps workspace, project and root identities distinct", () => {
    expect(
      manualOrderScopeKey({ kind: "PROJECT_CHILDREN", parentProjectId: null }),
    ).not.toBe(
      manualOrderScopeKey({
        kind: "PROJECT_CHILDREN",
        parentProjectId: "ROOT",
      }),
    );
    expect(
      manualOrderScopeKey({ kind: "PROJECT_TASKS", projectId: "a:b" }),
    ).toBe("PROJECT_TASKS:a%3Ab");
    expect(() =>
      manualOrderScopeKey({ kind: "PROJECT_TASKS", projectId: " " }),
    ).toThrow();
  });
  const entries = [
    { entityId: "a", position: 1024 },
    { entityId: "b", position: 2048 },
    { entityId: "c", position: 3072 },
  ];
  it("moves only one entity when a sparse gap is available", () => {
    expect(planOrderMove(entries, "c", "b", "BEFORE")).toEqual([
      { entityId: "c", position: 1536 },
    ]);
    expect(planOrderMove(entries, "a", null, "AFTER")).toEqual([
      { entityId: "a", position: 4096 },
    ]);
  });
  it("does not mutate or create writes for a no-op", () => {
    expect(planOrderMove(entries, "a", "b", "BEFORE")).toEqual([]);
    expect(planOrderMove(entries, "a", "a", "AFTER")).toEqual([]);
    expect(entries[0]?.position).toBe(1024);
  });
  it("rebalances an exhausted gap and integer overflow safely", () => {
    expect(
      planOrderMove(
        [
          { entityId: "a", position: 1 },
          { entityId: "b", position: 2 },
          { entityId: "c", position: 3 },
        ],
        "c",
        "b",
        "BEFORE",
      ),
    ).toEqual([
      { entityId: "a", position: 1024 },
      { entityId: "c", position: 2048 },
      { entityId: "b", position: 3072 },
    ]);
    const result = planOrderMove(
      [
        { entityId: "a", position: Number.MAX_SAFE_INTEGER - 1 },
        { entityId: "b", position: Number.MAX_SAFE_INTEGER },
      ],
      "a",
      null,
      "AFTER",
    );
    expect(result).toEqual([
      { entityId: "b", position: 1024 },
      { entityId: "a", position: 2048 },
    ]);
  });
  it("rejects unknown anchors, duplicate positions and unsafe integers", () => {
    expect(() => planOrderMove(entries, "a", "missing", "AFTER")).toThrow();
    for (const position of [
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      Number.NaN,
    ]) {
      expect(() =>
        planOrderMove([{ entityId: "a", position }], "a", null, "AFTER"),
      ).toThrow();
    }
    expect(() =>
      planOrderMove(
        [
          { entityId: "a", position: 1 },
          { entityId: "b", position: 1 },
        ],
        "a",
        "b",
        "AFTER",
      ),
    ).toThrow();
  });
});

it("sequence import retains unselected order and plans once for a large scope", () => {
  const entries = Array.from({ length: 1500 }, (_, i) => ({
    entityId: "t" + i,
    position: (i + 1) * 1024,
  }));
  const plan = planOrderSequence(entries, ["t4", "t2"]);
  expect(plan.map((entry) => entry.entityId)).toEqual([
    ...entries
      .filter((entry) => !["t4", "t2"].includes(entry.entityId))
      .map((entry) => entry.entityId),
    "t4",
    "t2",
  ]);
  expect(planOrderSequence(plan, ["t4", "t2"])).toEqual([]);
  expect(() => planOrderSequence(entries, ["missing"])).toThrow(
    "VALIDATION_ERROR",
  );
  expect(() => planOrderSequence(entries, ["t4", "t4"])).toThrow(
    "VALIDATION_ERROR",
  );
  expect(() =>
    planOrderSequence(
      [
        { entityId: "a", position: 1 },
        { entityId: "b", position: 1 },
      ],
      ["a"],
    ),
  ).toThrow("VALIDATION_ERROR");
});
