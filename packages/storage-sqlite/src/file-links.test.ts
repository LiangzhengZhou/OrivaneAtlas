import { it } from "vitest";
import { fileLinkScenario } from "../../../tests/contracts/file-links";
import { sqliteHarness } from "./testing";

const harness = sqliteHarness();
it("SQLite File relations preserve source identity and reject foreign/deleted endpoints", async () => {
  const db = await harness.create();
  await fileLinkScenario((actor, operation) =>
    db.request(
      actor,
      null,
      (
        work,
        _notes,
        connected,
        library,
        _org,
        _projects,
        _sessions,
        files,
        blobs,
      ) => operation(work, connected, library, files, blobs),
    ),
  );
});
