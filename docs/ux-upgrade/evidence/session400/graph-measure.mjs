// Run from the candidate root with Node 24. Arguments point to baseline and candidate checkouts.
import { cpus, release } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [baseline, candidate] = process.argv.slice(2);
if (!baseline || !candidate)
  throw Error("Pass baseline and candidate checkout paths");
const modulePath =
  "apps/web/src/features/graph/layouts/KnowledgeForceLayout.ts";
const before = (await import(pathToFileURL(resolve(baseline, modulePath))))
  .knowledgeForceLayout;
const after = (await import(pathToFileURL(resolve(candidate, modulePath))))
  .knowledgeForceLayout;
const cases = [];
for (const size of [500, 1000]) {
  const nodes = Array.from({ length: size }, (_, index) => String(index));
  const edges = nodes
    .slice(1)
    .map((target, index) => ({ source: nodes[index], target }));
  const times = { baseline: [], candidate: [] };
  for (let round = 0; round < 4; round++) {
    for (const side of round % 2
      ? ["candidate", "baseline"]
      : ["baseline", "candidate"]) {
      const start = performance.now();
      const positions =
        side === "baseline" ? before(nodes, edges) : after([], []);
      if (positions.length !== (side === "baseline" ? size : 0))
        throw Error("Unexpected layout result");
      if (round)
        times[side].push(Number((performance.now() - start).toFixed(4)));
    }
  }
  cases.push({ documents: size, edges: edges.length, ...times });
}
console.log(
  JSON.stringify(
    {
      measure:
        "Force pass only for non-local grid scopes, milliseconds. One warm-up per size. Excludes grid, React and paint.",
      node: process.version,
      cpu: cpus()[0].model,
      windows: release(),
      cases,
    },
    null,
    2,
  ),
);
