import { afterEach, expect, test, vi } from "vitest";
import { densityStorageKey, readDensity } from "./DensitySettings";

afterEach(() => vi.unstubAllGlobals());
test("density storage keeps workspace and principal tuples separate", () => {
  const first = densityStorageKey({ workspaceId: "a:b", principalId: "c" });
  const second = densityStorageKey({ workspaceId: "a", principalId: "b:c" });
  expect(first).not.toBe(second);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key === first ? "compact" : null),
  });
  expect(readDensity(first)).toBe("compact");
  expect(readDensity(second)).toBe("comfortable");
});
test("inaccessible or corrupt density preference is comfortable", () => {
  vi.stubGlobal("localStorage", { getItem: () => "invalid" });
  expect(readDensity("key")).toBe("comfortable");
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("storage blocked");
    },
  });
  expect(readDensity("key")).toBe("comfortable");
});
