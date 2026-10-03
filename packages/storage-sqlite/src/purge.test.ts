import { it } from "vitest";
import { permanentPurgeScenario } from "../../../tests/contracts/permanent-purge";
import { sqliteHarness } from "./testing";

const harness = sqliteHarness();
it("permanent purge application contract on SQLite", async () => {
  const db = await harness.create();
  await permanentPurgeScenario((actor, operation) =>
    db.request(actor, null, (uow, notes, _connected, library) =>
      operation(uow, library, notes),
    ),
  );
});
