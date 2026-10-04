import { stat } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  knowledgeRuntimeRoundTrip,
  knowledgeRuntimeScenario,
} from "../../../tests/contracts/knowledge-runtime";
import { PostgresUnitOfWork } from "./index";
import { inspectSchema, migrate, migrations } from "./migrations";
import { context, postgresHarness } from "./testing";

const h = postgresHarness();
it("restores a real pre-v15 PostgreSQL backup into an independent data directory after upgrade", async () => {
  const name = await h.database();
  await h.client(name, (client) =>
    migrate(client, 2000, undefined, migrations.slice(0, 14)),
  );
  await h.query(
    name,
    "INSERT INTO arclattice.workspace VALUES ('w','Original'); INSERT INTO arclattice.library_entry VALUES ('w','doc',1,'{\"kind\":\"DOCUMENT\",\"title\":\"Original\",\"bodyMd\":\"[[Future]]\"}'); INSERT INTO arclattice.document_wiki_link VALUES ('w','link','doc',NULL,'Future',NULL,NULL,1,'2026-10-01')",
  );
  const before = (await h.query(name, "SELECT * FROM arclattice.library_entry"))
    .rows;
  const backup = await h.cluster().snapshot();
  await h.client(name, (client) =>
    migrate(client, 2000, async () => {
      expect((await stat(backup)).isDirectory()).toBe(true);
    }),
  );
  expect(await h.client(name, (client) => inspectSchema(client))).toBe(
    migrations.length,
  );
  await h.cluster().withRestoredSnapshot(backup, async (restored) => {
    expect(
      (
        await restored.query(
          name,
          "SELECT max(version) version FROM arclattice.schema_migrations",
        )
      ).rows[0]?.version,
    ).toBe(14);
    expect(
      (await restored.query(name, "SELECT * FROM arclattice.library_entry"))
        .rows,
    ).toEqual(before);
    expect(
      (
        await restored.query(
          name,
          "SELECT target_document_id,target_text FROM arclattice.document_wiki_link",
        )
      ).rows,
    ).toEqual([{ target_document_id: null, target_text: "Future" }]);
    await restored.query(
      name,
      "UPDATE arclattice.workspace SET name='Restored copy'",
    );
  });
  expect(
    (await h.query(name, "SELECT name FROM arclattice.workspace")).rows[0]
      ?.name,
  ).toBe("Original");
  expect(await h.client(name, (client) => inspectSchema(client))).toBe(
    migrations.length,
  );
}, 180000);

it("restores PostgreSQL aliases, hierarchy, Wiki index and sessions through real application adapters", async () => {
  const name = await h.database();
  const db = await h.provision(await h.open(name));
  const state = await db.knowledge(context, knowledgeRuntimeScenario);
  await db.close();
  const backup = await h.cluster().snapshot();
  await h.cluster().withRestoredSnapshot(backup, async (restored) => {
    const copy = await PostgresUnitOfWork.open({
      connection: { ...restored.connection, database: name },
    });
    try {
      await copy.knowledge(context, (_uow, library, _projects, sessions) =>
        knowledgeRuntimeRoundTrip(library, sessions, state),
      );
    } finally {
      await copy.close();
    }
  });
}, 180000);
