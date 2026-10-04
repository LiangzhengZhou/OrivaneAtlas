import { describe, expect, it } from "vitest";
import {
  dailyRequestLimit,
  type ModelConfigurationInput,
  requestLimitThreshold,
  validateModelConfiguration,
} from "./model-configuration";

describe("one formal daily request limit", () => {
  it("rejects null and malformed catalog rows with a domain validation error", () => {
    for (const kind of [
      "connections",
      "models",
      "profiles",
      "bindings",
      "credentials",
    ]) {
      for (const bad of [null, 1, "row", []]) {
        const value = {
          connections: [],
          models: [],
          profiles: [],
          bindings: [],
          credentials: [],
          [kind]: [bad],
        };
        expect(() =>
          validateModelConfiguration(
            value as unknown as ModelConfigurationInput,
          ),
        ).toThrow("VALIDATION_ERROR");
      }
    }
  });
  it("treats Unlimited as first class and accepts bounded positive limits", () => {
    expect(dailyRequestLimit({ kind: "UNLIMITED" })).toEqual({
      kind: "UNLIMITED",
    });
    expect(dailyRequestLimit({ kind: "LIMITED", count: 100 })).toEqual({
      kind: "LIMITED",
      count: 100,
    });
    for (const value of [
      null,
      [],
      {},
      { kind: "UNLIMITED", count: 100 },
      { kind: "LIMITED", count: 0 },
      { kind: "LIMITED", count: 1.5 },
      { kind: "LIMITED", count: 1_000_001 },
    ])
      expect(() => dailyRequestLimit(value)).toThrow("VALIDATION_ERROR");
  });
  it("formal limits win, while old Gateway Unlimited never becomes maxRunsPerDay", () => {
    expect(
      requestLimitThreshold({
        maxRunsPerDay: 3,
        gateway: { dailyRequests: "UNLIMITED" },
      }),
    ).toBe(Number.POSITIVE_INFINITY);
    expect(
      requestLimitThreshold({
        maxRunsPerDay: 3,
        gateway: { dailyRequests: "UNLIMITED" },
        requestLimit: { kind: "LIMITED", count: 10 },
      }),
    ).toBe(10);
    expect(
      requestLimitThreshold({
        maxRunsPerDay: 3,
        gateway: { dailyRequests: 100 },
        requestLimit: { kind: "UNLIMITED" },
      }),
    ).toBe(Number.POSITIVE_INFINITY);
    expect(requestLimitThreshold({ maxRunsPerDay: 3 })).toBe(3);
  });
});
