import { it } from "vitest";
import { fileReplayScenario } from "../../../tests/contracts/file-replay";
import { context, sqliteHarness } from "./testing";

const harness = sqliteHarness();
it("SQLite original File identities and complete guarded mutations preserve original bytes", async () => {
  const db = await harness.create();
  await fileReplayScenario((operation) =>
    db.request(
      context,
      null,
      (
        _uow,
        _notes,
        _connected,
        library,
        _organization,
        _projects,
        _sessions,
        files,
        blobs,
      ) => operation(files, library, blobs),
    ),
  );
});
