import { expect, it, vi } from "vitest";
import {
  OwnedWorkspaceService,
  ownedWorkspaceCreateSchema,
} from "./owned-workspaces";

it("owned workspace title contract rejects whitespace without rejecting ordinary titles", () => {
  const pattern = new RegExp(
    ownedWorkspaceCreateSchema.properties.name.pattern,
  );
  expect(pattern.test("A new workspace")).toBe(true);
  expect(pattern.test("  \n ")).toBe(false);
});
it("owned workspace creation does not reach persistence before authenticated authorization", async () => {
  const create = vi.fn(async () => {
    throw new Error("UNEXPECTED_PERSIST");
  });
  const service = new OwnedWorkspaceService(
    { list: async () => [], create },
    {
      require: async () => {
        throw new Error("FORBIDDEN");
      },
    },
    { next: () => crypto.randomUUID() },
    { now: () => "2026-10-15T00:00:00.000Z" },
  );
  await expect(
    service.create(
      { workspaceId: "source", principalId: "owner" },
      crypto.randomUUID(),
      "New workspace",
    ),
  ).rejects.toThrow("FORBIDDEN");
  expect(create).not.toHaveBeenCalled();
});
