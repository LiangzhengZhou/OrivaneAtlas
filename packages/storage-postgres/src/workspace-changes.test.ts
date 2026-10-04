import { it } from "vitest";
import { workspaceChangeScenario } from "../../../tests/contracts/workspace-change-log";
import { postgresHarness } from "./testing";

const harness = postgresHarness();
it("durable workspace changes survive PostgreSQL restart and rollback with workspace isolation and cursor recovery", async () => {
  const name = await harness.database();
  let db = await harness.provision(await harness.open(name));
  await workspaceChangeScenario(
    (actor, operation) => db.knowledge(actor, (uow) => operation(uow)),
    async () => {
      await db.close();
      db = await harness.open(name);
    },
  );
}, 30000);
