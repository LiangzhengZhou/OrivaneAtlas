import { it } from "vitest";
import { fileLinkScenario } from "../../../tests/contracts/file-links";
import { postgresHarness } from "./testing";

const harness = postgresHarness();
it("PostgreSQL File relations preserve source identity and reject foreign/deleted endpoints", async () => {
  const db = await harness.provision(
    await harness.open(await harness.database()),
  );
  await fileLinkScenario((actor, operation) =>
    db.knowledge(
      actor,
      (work, library, _projects, _sessions, _notes, files, blobs, connected) =>
        operation(work, connected, library, files, blobs),
    ),
  );
}, 30000);
