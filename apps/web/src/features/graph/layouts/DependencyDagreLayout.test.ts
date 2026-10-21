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

test("TB direction ranks top to bottom and LR stays the default", () => {
  const edges = [
    { source: "a", target: "b" },
    { source: "a", target: "c" },
    { source: "b", target: "d" },
  ];
  const ids = ["a", "b", "c", "d"];
  const pos = (nodes: ReturnType<typeof dependencyDagreLayout>) =>
    new Map(nodes.map((node) => [node.id, node.position]));
  const lr = pos(dependencyDagreLayout(ids, edges));
  const explicit = pos(dependencyDagreLayout(ids, edges, "LR"));
  expect(explicit).toEqual(lr);
  const tb = pos(dependencyDagreLayout(ids, edges, "TB"));
  for (const edge of edges) {
    expect(tb.get(edge.target)!.y).toBeGreaterThan(tb.get(edge.source)!.y);
    expect(lr.get(edge.target)!.x).toBeGreaterThan(lr.get(edge.source)!.x);
  }
  expect(tb.get("b")!.x).not.toBe(tb.get("c")!.x);
});

test("TB direction also applies to the Dagre fallback for cycles and large graphs", () => {
  const ids = Array.from({ length: 45 }, (_, index) => String(index));
  const edges = ids.slice(1).map((target, index) => ({
    source: ids[index]!,
    target,
  }));
  const tb = new Map(
    dependencyDagreLayout(ids, edges, "TB").map((n) => [n.id, n.position]),
  );
  for (const edge of edges)
    expect(tb.get(edge.target)!.y).toBeGreaterThan(tb.get(edge.source)!.y);
});
