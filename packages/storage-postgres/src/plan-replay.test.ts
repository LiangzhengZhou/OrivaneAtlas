import { it } from "vitest";
import { planKnowledgeReplayScenario } from "../../../tests/contracts/plan-knowledge-replay";
import { planReplayScenario } from "../../../tests/contracts/plan-replay";
import { context, postgresHarness } from "./testing";

const harness = postgresHarness();
it("PostgreSQL original PLAN owned Knowledge publication is atomic across nested Application calls", async () => {
  const name = await harness.database(),
    db = await harness.provision(await harness.open(name));
  await planKnowledgeReplayScenario((operation) =>
    db.knowledge(context, (uow, library, projects, _sessions, notes) =>
      operation(uow, notes, library, projects),
    ),
  );
}, 30000);
it("PostgreSQL PLAN publication preserves original identities and complete multi-collection version chains", async () => {
  const name = await harness.database();
  await planReplayScenario(await harness.provision(await harness.open(name)));
}, 30000);
