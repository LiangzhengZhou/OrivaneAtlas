import { randomUUID } from "node:crypto";
import type { UnitOfWork } from "@arclattice/application";
import { CategoryService } from "@arclattice/application";
import { expect, test } from "vitest";
import { MemoryUnitOfWork } from "./index";

const actor = { workspaceId: "workspace-a", principalId: "human" };
const input = { name: "Research", version: 0, deleted: false };
const service = (uow: UnitOfWork) =>
  new CategoryService(
    uow,
    { require: async () => {} },
    { now: () => "2026-09-18T00:00:00Z" },
    { next: randomUUID },
  );

test("category presentation defaults, legacy updates, ordering, isolation and CAS", async () => {
  const categories = service(new MemoryUnitOfWork());
  const first = await categories.save(actor, {
    ...input,
    position: 9,
    icon: "🔬",
    color: "#ABCDEF",
  });
  const second = await categories.save(actor, { ...input, name: "Reading" });
  expect(second).toMatchObject({ icon: "", color: "#7863c5", position: 0 });
  const updated = await categories.save(actor, {
    ...input,
    id: first.id,
    version: first.version,
    name: "Renamed",
  });
  expect(updated).toMatchObject({ icon: "🔬", color: "#abcdef", position: 9 });
  expect((await categories.list(actor)).map((category) => category.id)).toEqual(
    [second.id, first.id],
  );
  expect(await categories.list({ ...actor, workspaceId: "other" })).toEqual([]);
  await expect(
    categories.save(actor, { ...input, id: first.id, version: first.version }),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  const reordered = await categories.save(actor, {
    ...input,
    id: first.id,
    version: updated.version,
    position: 0,
  });
  const repeated = await categories.list(actor);
  expect(await categories.list(actor)).toEqual(repeated);
  expect(reordered).not.toHaveProperty("projectIds");
});

test.each([
  { icon: "<script>" },
  { icon: "\n" },
  { icon: "a".repeat(17) },
  { color: "red" },
  { color: "#fff" },
  { color: "#ffffff;" },
  { position: -1 },
  { position: 1.5 },
  { position: 2147483648 },
  { icon: null },
  { color: null },
  { position: null },
])(
  "reject invalid category presentation without writing %j",
  async (invalid) => {
    const categories = service(new MemoryUnitOfWork());
    await expect(
      categories.save(actor, { ...input, ...invalid } as Parameters<
        CategoryService["save"]
      >[1]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await categories.list(actor)).toEqual([]);
  },
);

test("event failure rolls presentation back", async () => {
  const memory = new MemoryUnitOfWork();
  const categories = service(memory);
  const category = await categories.save(actor, input);
  const failing = service({
    run: (workspaceId, operation) =>
      memory.run(workspaceId, (tx) =>
        operation({
          ...tx,
          appendCategoryChange: async () => {
            throw new Error("event failure");
          },
        }),
      ),
  });
  await expect(
    failing.save(actor, {
      ...input,
      id: category.id,
      version: category.version,
      color: "#123456",
    }),
  ).rejects.toThrow("event failure");
  expect(await categories.list(actor)).toEqual([category]);
});
