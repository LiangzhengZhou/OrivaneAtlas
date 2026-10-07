import { expect, test } from "vitest";
import { edge, work } from "../../../../../tests/fixtures";
import { graphHash, parseGraphRoute } from "./graph-route";
import {
  buildDependencyGraphIndex,
  dependencyNeighborhood,
  indexedDependencyNeighborhood,
  projectDependencyMembership,
  projectDepth,
} from "./graph-scope";

test("dependency focus is bounded to one or two hops in 300 tasks", () => {
  const tasks = Array.from({ length: 300 }, (_, i) => work(String(i))),
    edges = tasks
      .slice(1)
      .map((task, i) => edge(String(i), task.id, "BLOCKS", String(i)));
  expect(
    dependencyNeighborhood(tasks, edges, "150", 1).map((t) => t.id),
  ).toEqual(["149", "150", "151"]);
  expect(
    dependencyNeighborhood(tasks, edges, "150", 2).map((t) => t.id),
  ).toEqual(["148", "149", "150", "151", "152"]);
  expect(dependencyNeighborhood(tasks, edges, "", 1)).toEqual([]);
  expect(dependencyNeighborhood(tasks, edges, "missing", 2)).toEqual([]);
});
test("shared dependency adjacency handles 1500 tasks without leaking deleted or isolated nodes", () => {
  const tasks = Array.from({ length: 1500 }, (_, i) => work(String(i)));
  tasks[752] = { ...tasks[752]!, deletedAt: "2026-10-04T08:00:00Z" };
  const edges = tasks
    .slice(1)
    .map((task, i) => edge(String(i), task.id, "BLOCKS", String(i)));
  const index = buildDependencyGraphIndex(tasks, edges);
  expect(
    indexedDependencyNeighborhood(index, "750", 2).map((task) => task.id),
  ).toEqual(["748", "749", "750", "751"]);
  expect(indexedDependencyNeighborhood(index, "752", 2)).toEqual([]);
  expect(index.counts.get("750")).toEqual({ blockers: 1, dependents: 1 });
  expect(
    indexedDependencyNeighborhood(index, "750", 1).map((task) => task.id),
  ).toEqual(["749", "750", "751"]);
  expect(index.tasks.size).toBe(1499);
  expect(index.neighbors.get("751")?.has("752")).toBe(false);
});
test("project depth is directed and cannot leak the rest of a large universe", () => {
  const projects = Array.from({ length: 110 }, (_, i) => ({
    ...work(String(i)),
    type: "PROJECT" as const,
    parentProjectId: i ? String(i - 1) : null,
  }));
  expect(projectDepth(projects, "0", 1).map((p) => p.id)).toEqual(["0", "1"]);
  expect(projectDepth(projects, "0", 2).map((p) => p.id)).toEqual([
    "0",
    "1",
    "2",
  ]);
  expect(projectDepth(projects, "1", 1).map((p) => p.id)).toEqual(["1", "2"]);
});
test("graph URL preserves scope focus selection depth and safe Back", () => {
  const route = {
    kind: "project" as const,
    id: "项目 / a",
    mode: "dependencies" as const,
    scope: "focus",
    depth: 2,
    hops: 2,
    focus: "task?1",
    selection: "task?2",
    back: "#projects/p?tab=tasks",
    view: "graph" as const,
    taskScope: "DIRECT_PROJECT" as const,
    includeExternal: false,
  };
  expect(parseGraphRoute(graphHash(route))).toEqual(route);
  expect(
    parseGraphRoute(graphHash({ ...route, expandedIds: ["a / 中文", "b?c"] })),
  ).toEqual({ ...route, expandedIds: ["a / 中文", "b?c"] });
  expect(
    parseGraphRoute(graphHash({ ...route, expandedIds: [] }))?.expandedIds,
  ).toEqual([]);
  expect(parseGraphRoute("#graph/project/%ZZ")).toBeNull();
  expect(
    parseGraphRoute(
      graphHash({ ...route, viewport: { x: -120.5, y: 80, zoom: 0.75 } }),
    )?.viewport,
  ).toEqual({ x: -120.5, y: 80, zoom: 0.75 });
  for (const value of ["NaN,0,1", "0,0,100", "0,0,-1", "0,0", "0,,1"]) {
    const parsed = parseGraphRoute(
      "#graph/project/p?viewport=" + encodeURIComponent(value),
    );
    expect(parsed?.viewport).toBeUndefined();
  }
  expect(
    parseGraphRoute(
      "#graph/document/d?mode=structure&back=https://evil.invalid",
    ),
  ).toMatchObject({ mode: "knowledge", back: "#library", depth: 1, hops: 1 });
});

test("dependency membership defaults to direct ownership and tree never includes boundary blockers", () => {
  const projects = [
    { ...work("p"), type: "PROJECT" as const, parentProjectId: null },
    { ...work("child"), type: "PROJECT" as const, parentProjectId: "p" },
    {
      ...work("grandchild"),
      type: "PROJECT" as const,
      parentProjectId: "child",
    },
    { ...work("other"), type: "PROJECT" as const, parentProjectId: null },
  ];
  const tasks = [
    { ...work("direct"), projectIds: ["p"] },
    { ...work("child-task"), projectIds: ["child"] },
    { ...work("grandchild-task"), projectIds: ["grandchild"] },
    { ...work("shared"), projectIds: ["p", "other"] },
    { ...work("external"), projectIds: ["other"] },
    { ...work("unassigned"), projectIds: [] },
    {
      ...work("deleted"),
      projectIds: ["p"],
      deletedAt: "2026-10-07T00:00:00Z",
    },
  ];
  const index = buildDependencyGraphIndex(
    [...projects, ...tasks],
    [edge("external", "direct", "BLOCKS", "boundary")],
  );
  const direct = projectDependencyMembership(index, "p", "DIRECT_PROJECT");
  expect([...direct.projectIds]).toEqual(["p"]);
  expect([...direct.taskIds]).toEqual(["direct", "shared"]);
  const tree = projectDependencyMembership(index, "p", "PROJECT_TREE");
  expect([...tree.projectIds]).toEqual(["p", "child", "grandchild"]);
  expect([...tree.taskIds]).toEqual([
    "direct",
    "shared",
    "child-task",
    "grandchild-task",
  ]);
  expect(tree.taskIds.has("external")).toBe(false);
  expect(index.neighbors.get("direct")?.has("external")).toBe(true);
  expect(parseGraphRoute("#graph/project/p?mode=dependencies")?.taskScope).toBe(
    "DIRECT_PROJECT",
  );
});
