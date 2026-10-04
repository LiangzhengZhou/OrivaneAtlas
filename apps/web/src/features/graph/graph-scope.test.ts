import { expect, test } from "vitest";
import { edge, work } from "../../../../../tests/fixtures";
import { graphHash, parseGraphRoute } from "./graph-route";
import {
  buildDependencyGraphIndex,
  dependencyNeighborhood,
  indexedDependencyNeighborhood,
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
  };
  expect(parseGraphRoute(graphHash(route))).toEqual(route);
  expect(parseGraphRoute("#graph/project/%ZZ")).toBeNull();
  expect(
    parseGraphRoute(
      "#graph/document/d?mode=structure&back=https://evil.invalid",
    ),
  ).toMatchObject({ mode: "knowledge", back: "#library", depth: 1, hops: 1 });
});
