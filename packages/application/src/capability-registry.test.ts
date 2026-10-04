import { describe, expect, it } from "vitest";
import {
  capabilityDefinition,
  capabilityRegistry,
  validateCapabilityInput,
} from "./capability-registry";

describe("shared capability boundary", () => {
  it("rejects unknown tools and untrusted approval fields", () => {
    expect(() => capabilityDefinition("execute_shell")).toThrow();
    expect(() =>
      validateCapabilityInput(
        capabilityDefinition("complete_task").inputSchema,
        { id: "task", version: 1, approved: true },
      ),
    ).toThrow();
    expect(new Set(capabilityRegistry.map((entry) => entry.name)).size).toBe(
      capabilityRegistry.length,
    );
  });
  it("requires optimistic versions and validates nested arrays and priorities", () => {
    const validate = (name: string, value: unknown) =>
      validateCapabilityInput(capabilityDefinition(name).inputSchema, value);
    expect(() => validate("complete_task", { id: "task" })).toThrow();
    expect(() =>
      validate("complete_task", { id: "task", version: 1.5 }),
    ).toThrow();
    expect(() =>
      validate("move_task_to_project", {
        id: "task",
        version: 1,
        projectIds: [42],
      }),
    ).toThrow();
    expect(() =>
      validate("set_task_priority", {
        id: "task",
        version: 1,
        priority: "CRITICAL",
      }),
    ).toThrow();
    expect(() =>
      validate("complete_task", { id: "task", version: 1 }),
    ).not.toThrow();
  });
});
