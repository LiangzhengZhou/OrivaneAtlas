import { it } from "vitest";
import { wikiTargetVersionScenario } from "../../../tests/contracts/wiki-target-version";
import { context, postgresHarness } from "./testing";

const harness = postgresHarness();
it("PostgreSQL versions Wiki target changes through create/delete/restore/purge", async () => {
  const name = await harness.database();
  const db = await harness.provision(await harness.open(name));
  await wikiTargetVersionScenario(
    (operation) => db.knowledge(context, (_uow, library) => operation(library)),
    async () => {
      const result = await harness.query(
        name,
        "SELECT version,target_document_id target,updated_at updated FROM arclattice.document_wiki_link WHERE workspace_id='workspace-a'",
      );
      return result.rows[0] as {
        version: number;
        target: string | null;
        updated: string;
      };
    },
  );
}, 30000);
