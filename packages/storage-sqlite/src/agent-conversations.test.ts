import { it } from "vitest";
import { conversationScenario } from "../../../tests/contracts/agent-conversations";
import { sqliteHarness } from "./testing";

const harness = sqliteHarness();
it("SQLite conversation summaries, message pagination, lifecycle and workspace isolation", async () => {
  const db = await harness.create();
  await conversationScenario((actor, operation) =>
    db.request(
      actor,
      null,
      (
        _uow,
        _notes,
        _connected,
        _library,
        _organization,
        _projects,
        sessions,
      ) => operation(sessions),
    ),
  );
});
