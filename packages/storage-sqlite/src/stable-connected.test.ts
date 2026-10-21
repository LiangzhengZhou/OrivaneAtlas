import { it } from "vitest";
import { stableConnectedScenario } from "../../../tests/contracts/stable-connected";
import { sqliteHarness } from "./testing";

const harness = sqliteHarness();
it("SQLite connected transactions preserve stable/deleted identities, rollback and actor scope", async () => {
  const db = await harness.create();
  await stableConnectedScenario((actor, operation) =>
    db.request(actor, null, (uow, _notes, connected) =>
      operation(uow, connected),
    ),
  );
});
