import { test } from "vitest";
import { organizationReplayScenario } from "../../../tests/contracts/organization-replay";
import { sqliteHarness } from "./testing";

const harness = sqliteHarness();
test("SQLite organization replay complete effects and atomic rollback", async () => {
  const db = await harness.create();
  await organizationReplayScenario((actor, operation) =>
    db.request(actor, null, (uow) => operation(uow)),
  );
});
