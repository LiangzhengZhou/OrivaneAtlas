import { expect, test } from "vitest";
import { edge, work } from "../../../../../tests/fixtures";
import { graphHash, parseGraphRoute } from "./graph-route";
import { dependencyNeighborhood, projectDepth } from "./graph-scope";

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
