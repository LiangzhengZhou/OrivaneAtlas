import { describe, expect, it } from "vitest";
import {
  defaultNavigationPreference,
  moveNavigationWithinGroup,
} from "./navigation";

describe("group-local navigation movement", () => {
  it("reorders visible siblings while preserving other groups and mobile settings", () => {
    const initial = defaultNavigationPreference();
    const next = moveNavigationWithinGroup(
      initial,
      "calendar",
      "tasks",
      "BEFORE",
    );
    expect(next.desktop.order.slice(0, 6)).toEqual([
      "overview",
      "calendar",
      "tasks",
      "projects",
      "focus",
      "notes",
    ]);
    expect(next.desktop.order.slice(6)).toEqual(initial.desktop.order.slice(6));
    expect(next.mobile).toBe(initial.mobile);
    expect(next.version).toBe(initial.version);
    expect(moveNavigationWithinGroup(next, "calendar", "tasks", "BEFORE")).toBe(
      next,
    );
  });
  it("rejects cross-group, hidden and pinned-boundary moves", () => {
    const initial = defaultNavigationPreference();
    expect(() =>
      moveNavigationWithinGroup(initial, "tasks", "notes", "BEFORE"),
    ).toThrow();
    expect(() =>
      moveNavigationWithinGroup(
        { ...initial, desktop: { ...initial.desktop, hidden: ["tasks"] } },
        "tasks",
        "projects",
        "AFTER",
      ),
    ).toThrow();
    expect(() =>
      moveNavigationWithinGroup(
        { ...initial, desktop: { ...initial.desktop, pinned: ["tasks"] } },
        "tasks",
        "projects",
        "AFTER",
      ),
    ).toThrow();
  });
  it("orders pinned siblings without changing the unpinned order", () => {
    const initial = defaultNavigationPreference();
    const preference = {
      ...initial,
      desktop: {
        ...initial.desktop,
        pinned: ["tasks", "calendar", "notes"] as const,
      },
    };
    const next = moveNavigationWithinGroup(
      preference,
      "calendar",
      "tasks",
      "BEFORE",
    );
    expect(next.desktop.pinned).toEqual(["calendar", "tasks", "notes"]);
    expect(next.desktop.order).toBe(preference.desktop.order);
  });
});
