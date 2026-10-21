import { randomUUID } from "node:crypto";
import { DomainError } from "@arclattice/domain";
import { expect, it, vi } from "vitest";
import type { UnitOfWork } from "./index";
import { RecurrenceReplayUnitOfWork } from "./recurrence-replay-effects";
import { WorkflowService } from "./workflows";

it("recurrence stable creation authorizes before validating identity or reading private records", async () => {
  const run = vi.fn();
  const uow: UnitOfWork = {
    run: async () => {
      run();
      throw new Error("Unexpected private read");
    },
  };
  const flow = new WorkflowService(
    uow,
    {
      require: async () => {
        throw new DomainError("FORBIDDEN");
      },
    },
    { now: () => "2026-10-14T00:00:00Z" },
    { next: randomUUID },
  );
  await expect(
    flow.createRecurrenceWithStableId(
      { workspaceId: "local", principalId: "owner" },
      "invalid",
      {
        version: 0,
        deleted: false,
        rule: {
          title: "Private",
          descriptionMd: "Private",
          startDate: "2026-10-14",
          timezone: "UTC",
          frequency: "DAILY",
          interval: 1,
        },
      },
    ),
  ).rejects.toThrow("FORBIDDEN");
  expect(run).not.toHaveBeenCalled();
});

it("recurrence effect declarations retain contiguous task version chains and reject gaps or other families", () => {
  const uow: UnitOfWork = {
    run: async () => {
      throw new Error("Unexpected transaction");
    },
  };
  const effects = [
    {
      collection: "items" as const,
      id: randomUUID(),
      op: "UPSERT" as const,
      baseVersion: 0,
    },
    {
      collection: "workflows" as const,
      id: "occurrence:definition:2026-10-14",
      op: "UPSERT" as const,
      baseVersion: 1,
    },
  ];
  expect(
    () =>
      new RecurrenceReplayUnitOfWork(uow, "local", "owner", [
        effects[0]!,
        { ...effects[0]!, baseVersion: 1 },
        effects[1]!,
      ]),
  ).not.toThrow();
  expect(
    () =>
      new RecurrenceReplayUnitOfWork(uow, "local", "owner", [
        effects[0]!,
        { ...effects[0]!, baseVersion: 2 },
        effects[1]!,
      ]),
  ).toThrow("VALIDATION_ERROR");
  expect(
    () => new RecurrenceReplayUnitOfWork(uow, "local", "owner", [effects[0]!]),
  ).toThrow("VALIDATION_ERROR");
});
