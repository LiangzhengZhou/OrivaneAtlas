import { it } from "vitest";
import { noteKnowledgeReplayScenario } from "../../../tests/contracts/note-knowledge-replay";
import { context, postgresHarness } from "./testing";

const harness = postgresHarness();
it("PostgreSQL original Note promotion preserves identities and rolls back incomplete effects", async () => {
  const name = await harness.database(),
    db = await harness.provision(await harness.open(name));
  await noteKnowledgeReplayScenario((operation) =>
    db.knowledge(
      context,
      (_uow, library, _projects, _sessions, notes, _files, _blobs, connected) =>
        operation(notes, library, connected),
    ),
  );
}, 30000);
