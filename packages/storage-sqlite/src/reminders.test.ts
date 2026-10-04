import { it } from "vitest";
import { reminderScenario } from "../../../tests/contracts/reminders";
import { sqliteHarness } from "./testing";

const harness = sqliteHarness();
it("reminder lifecycle, CAS and rollback on SQLite", async () => {
  const db = await harness.create();
  await reminderScenario((actor, operation) =>
    db.request(actor, null, (uow) => operation(uow)),
  );
});
