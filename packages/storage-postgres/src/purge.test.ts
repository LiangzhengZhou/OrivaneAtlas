import { it } from "vitest";
import { permanentPurgeScenario } from "../../../tests/contracts/permanent-purge";
import { postgresHarness } from "./testing";

const harness = postgresHarness();
it("permanent purge application contract on PostgreSQL", async () => {
  const db = await harness.create();
  await permanentPurgeScenario((actor, operation) =>
    db.knowledge(actor, (uow, library, _projects, _sessions, notes) =>
      operation(uow, library, notes),
    ),
  );
}, 30000);
