import { validateSchedule } from "@arclattice/domain";
import { expect, test } from "vitest";
import { v22PerformanceFixture } from "../../../tests/performance/v2.2-fixture";
import {
  conversationHash,
  parseConversationRoute,
} from "./features/ai/conversation-route";

test("release benchmark fixtures obey the same Domain schedule constraints as synchronized work", () => {
  const fixture = v22PerformanceFixture(
    { workspaceId: "fixture-workspace", principalId: "fixture-principal" },
    "2026-10-16",
  );
  expect(fixture.projects).toHaveLength(150);
  expect(fixture.tasks).toHaveLength(1500);
  expect(new Set(fixture.sessions.map((session) => session.id)).size).toBe(100);
  for (const session of fixture.sessions)
    expect(parseConversationRoute(conversationHash(session.id))).toBe(
      session.id,
    );
  for (const item of [...fixture.projects, ...fixture.tasks])
    expect(
      () => validateSchedule(item.startDate, item.dueDate),
      item.id,
    ).not.toThrow();
  expect(
    fixture.tasks.some((item) => item.activationState === "SCHEDULED"),
  ).toBe(true);
});
