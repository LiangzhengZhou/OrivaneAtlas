import { it } from "vitest";
import { planKnowledgeReplayScenario } from "../../../tests/contracts/plan-knowledge-replay";
import { planReplayScenario } from "../../../tests/contracts/plan-replay";
import { context, sqliteHarness } from "./testing";

const harness = sqliteHarness();
it("SQLite original PLAN owned Knowledge publication is atomic across nested Application calls", async () => {
  const db = await harness.create();
  await planKnowledgeReplayScenario((operation) =>
    db.request(
      context,
      null,
      (uow, notes, _connected, library, _organization, projects) =>
        operation(uow, notes, library, projects),
    ),
  );
});
it("SQLite PLAN publication preserves original identities and complete multi-collection version chains", async () => {
  await planReplayScenario(await harness.create());
});
