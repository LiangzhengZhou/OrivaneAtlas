import { it } from "vitest";
import { fileReplayScenario } from "../../../tests/contracts/file-replay";
import { context, postgresHarness } from "./testing";

const harness = postgresHarness();
it("PostgreSQL original File identities and complete guarded mutations preserve original bytes", async () => {
  const name = await harness.database(),
    db = await harness.provision(await harness.open(name));
  await fileReplayScenario((operation) =>
    db.knowledge(
      context,
      (_uow, library, _projects, _sessions, _notes, files, blobs) =>
        operation(files, library, blobs),
    ),
  );
}, 30000);
