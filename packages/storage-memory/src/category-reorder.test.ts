import { randomUUID } from "node:crypto";
import { CategoryService, type UnitOfWork } from "@arclattice/application";
import { expect, test } from "vitest";
import { MemoryUnitOfWork } from "./index";

const actor = { workspaceId: "workspace-a", principalId: "human" };
const service = (uow: UnitOfWork) =>
  new CategoryService(
    uow,
    { require: async () => {} },
    { now: () => "2026-10-11T00:00:00Z" },
    { next: randomUUID },
  );

test("category reorder preserves presentation, rejects stale membership and is idempotent at current versions", async () => {
  const categories = service(new MemoryUnitOfWork());
  const a = await categories.save(actor, {
    name: "A",
    icon: "🔬",
    color: "#123456",
    version: 0,
    deleted: false,
  });
  const b = await categories.save(actor, {
    name: "B",
    version: 0,
    deleted: false,
  });
  const result = await categories.reorder(actor, [b, a]);
  expect(result.map((c) => [c.id, c.position, c.version])).toEqual([
    [b.id, 1024, 2],
    [a.id, 2048, 2],
  ]);
  expect(result[1]).toMatchObject({ icon: "🔬", color: "#123456" });
  expect(await categories.reorder(actor, result)).toEqual(result);
  await expect(categories.reorder(actor, [a, b])).rejects.toMatchObject({
    code: "VERSION_CONFLICT",
  });
  await expect(
    categories.reorder(actor, [result[0]!, result[0]!]),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  await expect(
    categories.reorder({ ...actor, workspaceId: "other" }, result),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  await categories.save(actor, { name: "C", version: 0, deleted: false });
  await expect(categories.reorder(actor, result)).rejects.toMatchObject({
    code: "VERSION_CONFLICT",
  });
});

test("failure during the second category write rolls back the whole scope", async () => {
  const memory = new MemoryUnitOfWork();
  const categories = service(memory);
  const a = await categories.save(actor, {
    name: "A",
    version: 0,
    deleted: false,
  });
  const b = await categories.save(actor, {
    name: "B",
    version: 0,
    deleted: false,
  });
  const before = await categories.list(actor);
  let writes = 0;
  const failing = service({
    run: (workspaceId, operation) =>
      memory.run(workspaceId, (tx) =>
        operation({
          ...tx,
          saveCategory: async (category, version) => {
            if (++writes === 2) throw new Error("second write failure");
            await tx.saveCategory(category, version);
          },
        }),
      ),
  });
  await expect(failing.reorder(actor, [b, a])).rejects.toThrow(
    "second write failure",
  );
  expect(await categories.list(actor)).toEqual(before);
});
