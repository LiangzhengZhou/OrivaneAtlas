import { it } from "vitest";
import { recurrenceLifecycleScenario } from "../../../tests/contracts/recurrence-lifecycle";
import { postgresHarness } from "./testing";

const harness = postgresHarness();
it("recurrence lifecycle survives restart and duplicate ticks on postgres", async () => {
  const db = await harness.create();
  await recurrenceLifecycleScenario(
    (actor, operation) => db.knowledge(actor, (uow) => operation(uow)),
    () => db.inspectEvents("workspace-a"),
  );
}, 30000);
