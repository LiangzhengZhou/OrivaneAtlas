import { it } from "vitest";
import { workspaceChangeScenario } from "../../../tests/contracts/workspace-change-log";
import { context, principal, sqliteHarness } from "./testing";

const harness = sqliteHarness();
it("durable workspace changes survive SQLite restart and rollback with workspace isolation and cursor recovery", async () => {
  const path = harness.file();
  let db = await harness.open(path);
  for (const id of [context.workspaceId, "workspace-b"])
    await db.provisionWorkspace({ id, name: id }, [principal]);
  await workspaceChangeScenario(
    (actor, operation) => db.request(actor, null, (uow) => operation(uow)),
    async () => {
      await db.close();
      db = await harness.open(path);
    },
  );
});
