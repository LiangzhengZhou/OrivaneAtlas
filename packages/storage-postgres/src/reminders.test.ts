import { it } from "vitest";
import { calendarReplayScenario } from "../../../tests/contracts/calendar-replay";
import { navigationReplayScenario } from "../../../tests/contracts/navigation-replay";
import { reminderScenario } from "../../../tests/contracts/reminders";
import { postgresHarness } from "./testing";

const harness = postgresHarness();
it("principal-owned navigation original replay and rollback on PostgreSQL", async () => {
  const db = await harness.create();
  await navigationReplayScenario((actor, operation) =>
    db.knowledge(actor, (uow) => operation(uow)),
  );
}, 30000);
it("calendar original replay, CAS and rollback on PostgreSQL", async () => {
  const db = await harness.create();
  await calendarReplayScenario((actor, operation) =>
    db.knowledge(actor, (uow) => operation(uow)),
  );
}, 30000);
it("reminder lifecycle, CAS and rollback on PostgreSQL", async () => {
  const db = await harness.create();
  await reminderScenario((actor, operation) =>
    db.knowledge(actor, (uow) => operation(uow)),
  );
}, 30000);
