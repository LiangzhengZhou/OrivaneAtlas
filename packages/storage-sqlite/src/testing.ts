import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { WorkService } from "@arclattice/application";
import { afterEach } from "vitest";
import { SqliteUnitOfWork } from "./index";

export const context = { workspaceId: "workspace-a", principalId: "human" };
export const principal = {
  id: "human",
  kind: "USER" as const,
  displayName: "Human",
};

/** Each suite owns only its newly-created, validated temporary directories. */
export function sqliteHarness() {
  const directories: string[] = [];
  const connections: SqliteUnitOfWork[] = [];
  afterEach(async () => {
    for (const db of connections.splice(0)) await db.close();
    for (const directory of directories.splice(0)) {
      const prefix = resolve(tmpdir()) + sep + "arclattice-sqlite-";
      if (!resolve(directory).startsWith(prefix))
        throw new Error("Unsafe cleanup path");
      rmSync(directory, { recursive: true });
    }
  });
  const file = () => {
    const directory = mkdtempSync(join(tmpdir(), "arclattice-sqlite-"));
    directories.push(directory);
    return join(directory, "work.sqlite");
  };
  const open = async (path = file(), timeoutMs = 2000) => {
    const db = await SqliteUnitOfWork.open(path, { lockTimeoutMs: timeoutMs });
    connections.push(db);
    return db;
  };
  const create = async () => {
    const db = await open();
    for (const id of ["workspace-a", "workspace-b"])
      await db.provisionWorkspace({ id, name: id }, [principal]);
    return db;
  };
  return { file, open, create };
}

export function service(db: SqliteUnitOfWork) {
  return new WorkService(
    db,
    {
      require: async (actor) => {
        if (
          actor.workspaceId !== context.workspaceId ||
          actor.principalId !== context.principalId
        )
          throw new Error("FORBIDDEN");
      },
    },
    { now: () => "2026-09-13T00:00:00.000Z" },
    { next: randomUUID },
  );
}
