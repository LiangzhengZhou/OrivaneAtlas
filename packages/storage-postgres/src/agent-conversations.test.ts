import { it } from "vitest";
import {
  contextualPromotionScenario,
  conversationScenario,
} from "../../../tests/contracts/agent-conversations";
import { postgresHarness } from "./testing";

const harness = postgresHarness();
it("PostgreSQL contextual promotion uses canonical runs and rolls back session/message/run changes together", async () => {
  const db = await harness.provision(
    await harness.open(await harness.database()),
  );
  await contextualPromotionScenario((actor, operation) =>
    db.knowledge(
      actor,
      (
        _uow,
        _library,
        _projects,
        sessions,
        _notes,
        _files,
        _blobs,
        connected,
      ) => operation(sessions, connected),
    ),
  );
}, 30000);
it("PostgreSQL conversation summaries, message pagination, lifecycle and workspace isolation", async () => {
  const db = await harness.provision(
    await harness.open(await harness.database()),
  );
  await conversationScenario((actor, operation) =>
    db.knowledge(actor, (_uow, _library, _projects, sessions) =>
      operation(sessions),
    ),
  );
}, 30000);
