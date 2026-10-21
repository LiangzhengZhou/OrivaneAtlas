import { it } from "vitest";
import { calendarReplayScenario } from "../../../tests/contracts/calendar-replay";
import { navigationReplayScenario } from "../../../tests/contracts/navigation-replay";
import { reminderScenario } from "../../../tests/contracts/reminders";
import { sqliteHarness } from "./testing";

const harness = sqliteHarness();
it("principal-owned navigation original replay and rollback on SQLite", async () => {
  const db = await harness.create();
  await navigationReplayScenario((actor, operation) =>
    db.request(actor, null, (uow) => operation(uow)),
  );
});
it("calendar original replay, CAS and rollback on SQLite", async () => {
  const db = await harness.create();
  await calendarReplayScenario((actor, operation) =>
    db.request(actor, null, (uow) => operation(uow)),
  );
});
it("reminder lifecycle, CAS and rollback on SQLite", async () => {
  const db = await harness.create();
  await reminderScenario((actor, operation) =>
    db.request(actor, null, (uow) => operation(uow)),
  );
});
