import { test } from "vitest";
import { stableProjectKnowledgeScenario } from "../../../tests/contracts/stable-project-knowledge";
import { sqliteHarness } from "./testing";

const harness = sqliteHarness();
test("SQLite project knowledge stable primary IDs preserve ownership and original Markdown", async () => {
  const db = await harness.create();
  await stableProjectKnowledgeScenario((actor, operation) =>
    db.request(
      actor,
      null,
      (uow, notes, _connected, library, _organization, projects) =>
        operation(uow, library, projects, notes),
    ),
  );
});
