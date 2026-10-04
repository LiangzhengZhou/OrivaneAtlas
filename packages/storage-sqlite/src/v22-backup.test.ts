import { expect, it } from "vitest";
import {
  readV22Backup,
  seedV22Backup,
} from "../../../tests/contracts/v22-backup";
import { restoreDatabase } from "./index";
import { context, sqliteHarness } from "./testing";

const harness = sqliteHarness();
it("SQLite backup restores v2.2 reminder, skipped occurrence, conversation pages and durable cursor", async () => {
  const db = await harness.create();
  const before = await db.request(
    context,
    null,
    (uow, _notes, _connected, _library, _organization, _projects, sessions) =>
      seedV22Backup(context, uow, sessions),
  );
  expect(
    before.workflows.some(
      (entry) =>
        entry.payload.kind === "OCCURRENCE" &&
        entry.payload.status === "SKIPPED",
    ),
  ).toBe(true);
  expect(before.summaries[0]?.messageCount).toBe(120);
  const backup = harness.file();
  await db.backup(backup);
  const file = harness.file();
  await restoreDatabase(backup, file);
  const restored = await harness.open(file);
  const after = await restored.request(
    context,
    null,
    (uow, _notes, _connected, _library, _organization, _projects, sessions) =>
      readV22Backup(context, uow, sessions),
  );
  expect(after).toEqual(before);
});
