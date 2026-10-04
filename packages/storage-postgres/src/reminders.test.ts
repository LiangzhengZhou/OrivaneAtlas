import { it } from "vitest";
import { reminderScenario } from "../../../tests/contracts/reminders";
import { postgresHarness } from "./testing";

const harness = postgresHarness();
it("reminder lifecycle, CAS and rollback on PostgreSQL", async () => {
  const db = await harness.create();
  await reminderScenario((actor, operation) =>
    db.knowledge(actor, (uow) => operation(uow)),
  );
}, 30000);
