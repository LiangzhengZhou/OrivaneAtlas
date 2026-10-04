import { expect, it } from "vitest";
import {
  readV22Backup,
  seedV22Backup,
} from "../../../tests/contracts/v22-backup";
import { PostgresUnitOfWork } from "./index";
import { context, postgresHarness } from "./testing";

const harness = postgresHarness();
it("PostgreSQL physical backup restores v2.2 reminder, skipped occurrence, conversation pages and durable cursor", async () => {
  const name = await harness.database();
  const db = await harness.provision(await harness.open(name));
  const before = await db.knowledge(
    context,
    (uow, _library, _projects, sessions) =>
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
  await db.close();
  const backup = await harness.cluster().snapshot();
  await harness.cluster().withRestoredSnapshot(backup, async (restored) => {
    const copy = await PostgresUnitOfWork.open({
      connection: { ...restored.connection, database: name },
    });
    try {
      const after = await copy.knowledge(
        context,
        (uow, _library, _projects, sessions) =>
          readV22Backup(context, uow, sessions),
      );
      expect(after).toEqual(before);
    } finally {
      await copy.close();
    }
  });
}, 180000);
