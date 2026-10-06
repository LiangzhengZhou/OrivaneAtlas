import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { workspaceMetadataScenario } from "../../../tests/contracts/workspace-metadata";
import { context, principal, sqliteHarness } from "./testing";

const harness = sqliteHarness();
it("SQLite projects body-free metadata and durably gates clean, dirty and interrupted Wiki indexes", async () => {
  const file = harness.file(),
    db = await harness.open(file);
  await db.provisionWorkspace(
    { id: context.workspaceId, name: "Metadata fixture" },
    [principal],
  );
  const state = await db.request(
    context,
    null,
    (_uow, notes, _connected, library) =>
      workspaceMetadataScenario(context, notes, library),
  );
  await db.request(context, null, async (_uow, _notes, _connected, library) => {
    expect(await library.ensureWikiIndex!()).toBe(false);
  });
  const raw = new DatabaseSync(file);
  try {
    raw
      .prepare("INSERT INTO document_alias VALUES (?,?,?,?,?,?)")
      .run(
        context.workspaceId,
        state.target.id,
        "Imported alias",
        "imported alias",
        "2026-10-05",
        context.principalId,
      );
    await db.request(
      context,
      null,
      async (_uow, _notes, _connected, library) => {
        expect(await library.ensureWikiIndex!()).toBe(true);
        expect(await library.ensureWikiIndex!()).toBe(false);
      },
    );
    raw
      .prepare(
        "DELETE FROM document_alias WHERE workspace_id=? AND normalized_alias=?",
      )
      .run(context.workspaceId, "imported alias");
    await db.request(
      context,
      null,
      async (_uow, _notes, _connected, library) => {
        expect(await library.ensureWikiIndex!()).toBe(true);
        expect(await library.ensureWikiIndex!()).toBe(false);
      },
    );
    raw
      .prepare(
        "UPDATE library_entry SET payload=json_set(payload,'$.bodyMd',?) WHERE workspace_id=? AND id=?",
      )
      .run("[[Missing]]", context.workspaceId, state.source.id);
  } finally {
    raw.close();
  }
  await expect(
    db.request(context, null, async (_uow, _notes, _connected, library) => {
      expect(await library.ensureWikiIndex!()).toBe(true);
      throw new Error("Interrupted rebuild");
    }),
  ).rejects.toThrow("Interrupted rebuild");
  await db.request(context, null, async (_uow, _notes, _connected, library) => {
    expect(await library.ensureWikiIndex!()).toBe(true);
    expect(await library.ensureWikiIndex!()).toBe(false);
    expect(await library.wikiLinks!()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceDocumentId: state.source.id,
          targetText: "Missing",
          targetDocumentId: null,
        }),
      ]),
    );
  });
});
