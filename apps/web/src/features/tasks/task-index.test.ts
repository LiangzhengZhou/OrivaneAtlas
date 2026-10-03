import { availability, blockers } from "@arclattice/domain";
import { expect, test } from "vitest";
import { edge, work } from "../../../../../tests/fixtures";
import { taskDerivedIndex } from "./task-index";

test("derived readiness matches domain policies with hidden deleted missing and cross-workspace blockers", () => {
  const items = [
    work("before"),
    work("after"),
    { ...work("completed"), status: "DONE" as const },
    { ...work("deleted"), deletedAt: "2026-10-03" },
    { ...work("foreign"), workspaceId: "other" },
    { ...work("paused"), activationState: "INACTIVE" as const },
    {
      ...work("scheduled"),
      activationPolicy: "AT_SCHEDULED_TIME" as const,
      startDate: "2026-10-04",
    },
  ];
  const edges = [
    edge("before", "after"),
    edge("completed", "after"),
    edge("deleted", "after"),
    edge("missing", "after"),
    edge("foreign", "after"),
  ];
  const derived = taskDerivedIndex(items, edges, "2026-10-03");
  for (const item of items) {
    expect(derived.blockersByTaskId.get(item.id) ?? []).toEqual(
      blockers(item, items, edges),
    );
    expect(derived.availabilityByTaskId.get(item.id)).toBe(
      availability(item, items, edges, "2026-10-03"),
    );
  }
});
