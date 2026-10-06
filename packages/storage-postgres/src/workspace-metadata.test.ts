import { expect, it } from "vitest";
import { workspaceMetadataScenario } from "../../../tests/contracts/workspace-metadata";
import { context, postgresHarness } from "./testing";

const harness = postgresHarness();
it("PostgreSQL runs the shared body-free metadata and durable Wiki gate contract", async () => {
  const name = await harness.database();
  const db = await harness.provision(await harness.open(name));
  const state = await db.knowledge(
    context,
    (_uow, library, _projects, _sessions, notes) =>
      workspaceMetadataScenario(context, notes, library),
  );
  await db.knowledge(context, async (_uow, library) => {
    expect(await library.ensureWikiIndex!()).toBe(false);
  });
  await harness.query(
    name,
    "INSERT INTO arclattice.document_alias VALUES ($1,$2,$3,$4,$5,$6)",
    [
      context.workspaceId,
      state.target.id,
      "Imported alias",
      "imported alias",
      "2026-10-05",
      context.principalId,
    ],
  );
  await expect(
    db.knowledge(context, async (_uow, library) => {
      expect(await library.ensureWikiIndex!()).toBe(true);
      throw new Error("Interrupted alias rebuild");
    }),
  ).rejects.toThrow("Interrupted alias rebuild");
  await db.knowledge(context, async (_uow, library) => {
    expect(await library.ensureWikiIndex!()).toBe(true);
    expect(await library.ensureWikiIndex!()).toBe(false);
  });
  await harness.query(
    name,
    "DELETE FROM arclattice.document_alias WHERE workspace_id=$1 AND normalized_alias=$2",
    [context.workspaceId, "imported alias"],
  );
  await db.knowledge(context, async (_uow, library) => {
    expect(await library.ensureWikiIndex!()).toBe(true);
    expect(await library.ensureWikiIndex!()).toBe(false);
  });
}, 30000);
