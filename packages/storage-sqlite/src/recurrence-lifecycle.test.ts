import { it } from "vitest";
import { recurrenceLifecycleScenario } from "../../../tests/contracts/recurrence-lifecycle";
import { sqliteHarness } from "./testing";

const harness = sqliteHarness();
it("recurrence lifecycle survives restart and duplicate ticks on sqlite", async () => {
  const db = await harness.create();
  await recurrenceLifecycleScenario(
    (actor, operation) => db.request(actor, null, (uow) => operation(uow)),
    () => db.inspectEvents("workspace-a"),
  );
}, 30000);
