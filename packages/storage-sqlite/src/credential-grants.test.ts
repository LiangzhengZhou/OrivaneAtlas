import { join } from "node:path";
import { expect, it } from "vitest";
import { restoreDatabase } from "./index";
import { sqliteHarness } from "./testing";

const harness = sqliteHarness();

it("persists explicit grants and legacy identities through restart, rollback, backup and restore", async () => {
  const path = harness.file();
  const db = await harness.open(path);
  await db.provisionWorkspace({ id: "arclattice-personal", name: "Owner" }, [
    { id: "arclattice-owner", kind: "USER", displayName: "Owner" },
  ]);
  const owner = await db.accounts((store) =>
    store.register("owner", "verifier", true),
  );
  const legacy = await db.accounts((store) =>
    store.issue(owner.id, "legacy", "read-write", "legacy-hash", null),
  );
  const granular = await db.accounts((store) =>
    store.issue(owner.id, "granular", "write", "granular-hash", null, [
      "knowledge:read",
    ]),
  );
  await expect(
    db.accounts((store) => {
      store.issue(owner.id, "rollback", "write", "rollback-hash", null, [
        "files:read",
      ]);
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  await expect(
    db.accounts((store) =>
      store.issue(owner.id, "invalid", "write", "invalid-hash", null, []),
    ),
  ).rejects.toThrow("VALIDATION_ERROR");
  const backup = path + ".backup";
  await db.backup(backup);
  await db.close();
  const reopened = await harness.open(path);
  expect(
    await reopened.accounts((store) => store.resolve("legacy-hash")),
  ).toMatchObject({
    credential: { id: legacy.id, scope: "read-write", grants: undefined },
  });
  expect(
    await reopened.accounts((store) => store.resolve("granular-hash")),
  ).toMatchObject({
    credential: { id: granular.id, grants: ["knowledge:read"] },
  });
  expect(
    await reopened.accounts((store) => store.resolve("rollback-hash")),
  ).toBeNull();
  await reopened.accounts((store) => store.revoke(owner.id, granular.id));
  expect(
    await reopened.accounts((store) => store.resolve("granular-hash")),
  ).toBeNull();
  const restoredPath = join(path + ".restored");
  await restoreDatabase(backup, restoredPath);
  const restored = await harness.open(restoredPath);
  expect(
    await restored.accounts((store) => store.resolve("granular-hash")),
  ).toMatchObject({
    credential: { id: granular.id, grants: ["knowledge:read"] },
  });
  expect(
    await restored.accounts((store) => store.resolve("legacy-hash")),
  ).toMatchObject({ credential: { id: legacy.id, grants: undefined } });
});
