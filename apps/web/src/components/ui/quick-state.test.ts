import { describe, expect, it } from "vitest";
import { armQuickState } from "./quick-state";

describe("inline completion/restore contract", () => {
  it.each(["COMPLETE", "RESTORE"] as const)(
    "%s only commits a second click inside the four-second window",
    (intent) => {
      const first = armQuickState(null, "task-a", intent, 100);
      expect(first.commit).toBe(false);
      expect(armQuickState(first.arm, "task-a", intent, 4099).commit).toBe(
        true,
      );
      expect(armQuickState(first.arm, "task-a", intent, 4100).commit).toBe(
        false,
      );
    },
  );
  it("does not reuse confirmation across entities or opposite intents", () => {
    const { arm } = armQuickState(null, "task-a", "COMPLETE", 0);
    expect(armQuickState(arm, "task-b", "COMPLETE", 1).commit).toBe(false);
    expect(armQuickState(arm, "task-a", "RESTORE", 1).commit).toBe(false);
    expect(armQuickState(null, "task-a", "COMPLETE", 1).commit).toBe(false);
  });
});
