import { expect, test } from "vitest";
import { dependencyDagreLayout } from "./DependencyDagreLayout";

test("local dependency ranks preserve every direction and separate same-rank nodes", () => {
  const edges = [
    { source: "a", target: "b" },
    { source: "a", target: "c" },
    { source: "c", target: "d" },
    { source: "b", target: "d" },
    { source: "b", target: "d" },
  ];
  const nodes = dependencyDagreLayout(["a", "b", "c", "d", "isolated"], edges);
  const positions = new Map(nodes.map((node) => [node.id, node.position]));
  for (const edge of edges)
    expect(positions.get(edge.target)!.x).toBeGreaterThan(
      positions.get(edge.source)!.x,
    );
  expect(positions.get("b")!.y).not.toBe(positions.get("c")!.y);
  expect(
    new Set(nodes.map((node) => `${node.position.x}:${node.position.y}`)).size,
  ).toBe(5);
  expect(dependencyDagreLayout([], [])).toEqual([]);
});

test("cyclic and larger dependency graphs retain finite Dagre positions", () => {
  for (const count of [3, 45]) {
    const ids = Array.from({ length: count }, (_, index) => String(index));
    const edges = ids.map((source, index) => ({
      source,
      target: ids[(index + 1) % count]!,
    }));
    const nodes = dependencyDagreLayout(ids, edges);
    expect(nodes).toHaveLength(count);
    expect(
      nodes.every(
        (node) =>
          Number.isFinite(node.position.x) && Number.isFinite(node.position.y),
      ),
    ).toBe(true);
  }
});
