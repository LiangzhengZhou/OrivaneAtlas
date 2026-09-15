import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { edge, work } from "../../../tests/fixtures";
import {
  blockers,
  dependency,
  isReady,
  requireTitle,
  validateEdge,
  type WorkEdge,
} from "./index";

describe("Work domain", () => {
  it("normalizes titles without losing user content", () => {
    expect(requireTitle("  中文 title  ")).toBe("中文 title");
  });
  it.each(["", "   ", "x".repeat(241), "two\nlines", "bad\u0000title"])(
    "rejects invalid title %j",
    (value) => {
      expect(() => requireTitle(value)).toThrow("VALIDATION_ERROR");
    },
  );
  it("normalizes REQUIRES in the opposite direction", () => {
    expect(dependency(edge("b", "a", "REQUIRES"))).toEqual(["a", "b"]);
  });
  it("rejects duplicate dependencies across edge spellings", () => {
    expect(() =>
      validateEdge(
        edge("b", "a", "REQUIRES"),
        [work("a"), work("b")],
        [edge("a", "b")],
      ),
    ).toThrow("DUPLICATE_EDGE");
  });
  it("allows reciprocal non-scheduling relations", () => {
    expect(() =>
      validateEdge(
        edge("b", "a", "RELATED"),
        [work("a"), work("b")],
        [edge("a", "b", "RELATED")],
      ),
    ).not.toThrow();
  });
  it("rejects self loops", () => {
    expect(() => validateEdge(edge("a", "a"), [work("a")], [])).toThrow(
      "WORK_GRAPH_CYCLE_DETECTED",
    );
  });
  it("rejects a foreign workspace endpoint", () => {
    expect(() =>
      validateEdge(edge("a", "b"), [work("a"), work("b", "workspace-b")], []),
    ).toThrow("NOT_FOUND");
  });
  it("rejects a deleted endpoint", () => {
    expect(() =>
      validateEdge(
        edge("a", "b"),
        [work("a"), { ...work("b"), deletedAt: "now" }],
        [],
      ),
    ).toThrow("NOT_FOUND");
  });
  it("ignores foreign edges when computing readiness", () => {
    expect(
      isReady(
        work("b"),
        [work("b")],
        [edge("a", "b", "BLOCKS", "workspace-b")],
      ),
    ).toBe(true);
  });
  it("requires all predecessors to be DONE; canceled and missing do not count", () => {
    const target = work("c");
    const graph = [edge("a", "c"), edge("c", "b", "REQUIRES")];
    expect(
      blockers(
        target,
        [
          { ...work("a"), status: "DONE" },
          { ...work("b"), status: "CANCELED" },
          target,
        ],
        graph,
      ),
    ).toEqual(["b"]);
    expect(
      isReady(
        target,
        [
          { ...work("a"), status: "DONE" },
          { ...work("b"), status: "DONE" },
          target,
        ],
        graph,
      ),
    ).toBe(true);
    expect(isReady(target, [target], graph)).toBe(false);
    expect(isReady({ ...target, deletedAt: "now" }, [target], [])).toBe(false);
    expect(isReady({ ...target, status: "DONE" }, [target], [])).toBe(false);
  });
  it("property: forward edges preserve DAGs and closing edges are rejected", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 60 }),
        fc.boolean(),
        (size, reverseSpelling) => {
          const items = Array.from({ length: size }, (_, index) =>
            work(String(index)),
          );
          const graph: WorkEdge[] = [];
          for (let i = 0; i < size - 1; i++) {
            const candidate = reverseSpelling
              ? edge(String(i + 1), String(i), "REQUIRES")
              : edge(String(i), String(i + 1));
            expect(() => validateEdge(candidate, items, graph)).not.toThrow();
            graph.push(candidate);
          }
          expect(() =>
            validateEdge(edge(String(size - 1), "0"), items, graph),
          ).toThrow("WORK_GRAPH_CYCLE_DETECTED");
        },
      ),
      { numRuns: 150, seed: 20260913 },
    );
  });
});
