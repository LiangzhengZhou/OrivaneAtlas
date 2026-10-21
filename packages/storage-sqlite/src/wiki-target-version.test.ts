import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { wikiTargetVersionScenario } from "../../../tests/contracts/wiki-target-version";
import { context, sqliteHarness } from "./testing";

const harness = sqliteHarness();
it("SQLite versions Wiki target changes through create/delete/restore/purge", async () => {
  const db = await harness.create();
  await wikiTargetVersionScenario(
    (operation) =>
      db.request(context, null, (_uow, _notes, _connected, library) =>
        operation(library),
      ),
    async () => {
      const reader = new DatabaseSync(db.filename, { readOnly: true });
      try {
        return reader
          .prepare(
            "SELECT version,target_document_id target,updated_at updated FROM document_wiki_link WHERE workspace_id=?",
          )
          .get(context.workspaceId) as unknown as {
          version: number;
          target: string | null;
          updated: string;
        };
      } finally {
        reader.close();
      }
    },
  );
});
