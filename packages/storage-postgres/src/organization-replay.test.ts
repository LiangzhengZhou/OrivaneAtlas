import { test } from "vitest";
import { organizationReplayScenario } from "../../../tests/contracts/organization-replay";
import { postgresHarness } from "./testing";

const harness = postgresHarness();
test("PostgreSQL organization replay complete effects and atomic rollback", async () => {
  const db = await harness.create();
  await organizationReplayScenario((actor, operation) =>
    db.knowledge(actor, (uow) => operation(uow)),
  );
});
