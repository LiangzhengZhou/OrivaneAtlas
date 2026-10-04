import { it } from "vitest";
import { conversationScenario } from "../../../tests/contracts/agent-conversations";
import { postgresHarness } from "./testing";

const harness = postgresHarness();
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
