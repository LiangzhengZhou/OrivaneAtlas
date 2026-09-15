import { describe, expect, it } from "vitest";
import { repositoryContract } from "../../../tests/contracts/work-repository";
import { work } from "../../../tests/fixtures";
import { MemoryUnitOfWork } from "./index";

repositoryContract("Memory", () => new MemoryUnitOfWork());
describe("Memory transaction events", () => {
  it("rolls back mutations, activity, and outbox together", async () => {
    const uow = new MemoryUnitOfWork();
    await expect(
      uow.run("workspace-a", async (tx) => {
        await tx.insert(work("a"));
        await tx.appendActivity({
          id: "event",
          workspaceId: "workspace-a",
          principalId: "human",
          entityId: "a",
          type: "WORK_ITEM_CREATED",
          occurredAt: "now",
        });
        await tx.appendOutbox({
          id: "outbox",
          workspaceId: "workspace-a",
          activityId: "event",
          type: "WORK_CHANGED",
          occurredAt: "now",
        });
        throw new Error("simulated failure");
      }),
    ).rejects.toThrow("simulated failure");
    expect(await uow.inspectEvents("workspace-a")).toEqual({
      activity: [],
      outbox: [],
    });
    expect(await uow.run("workspace-a", async (tx) => tx.list())).toEqual([]);
  });
});
