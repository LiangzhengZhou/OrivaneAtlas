import { test } from "vitest";
import { stableProjectKnowledgeScenario } from "../../../tests/contracts/stable-project-knowledge";
import { postgresHarness } from "./testing";

const harness = postgresHarness();
test("PostgreSQL project knowledge stable primary IDs preserve ownership and original Markdown", async () => {
  const db = await harness.create();
  await stableProjectKnowledgeScenario((actor, operation) =>
    db.knowledge(actor, (uow, library, projects, _sessions, notes) =>
      operation(uow, library, projects, notes),
    ),
  );
});
