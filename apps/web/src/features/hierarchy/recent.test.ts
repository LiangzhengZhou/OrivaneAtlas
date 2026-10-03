import { expect, test } from "vitest";
import { cleanRecent, recentKey } from "./recent";

test("recent keys isolate server workspace principal and picker kind", () => {
  const base = {
    server: "https://example.test",
    workspaceId: "w",
    principalId: "p",
  };
  const keys = [
    recentKey(base, "PROJECT"),
    recentKey({ ...base, server: "https://other.test" }, "PROJECT"),
    recentKey({ ...base, workspaceId: "other" }, "PROJECT"),
    recentKey({ ...base, principalId: "other" }, "PROJECT"),
    recentKey(base, "DOCUMENT"),
  ];
  expect(new Set(keys).size).toBe(5);
});
test("only accessible unique IDs survive reload; content and missing entities are removed", () => {
  expect(
    cleanRecent(
      ["a", "a", "missing", { id: "b", body: "secret" }, "b"],
      new Set(["a", "b"]),
    ),
  ).toEqual(["a", "b"]);
  expect(cleanRecent("malformed", new Set(["a"]))).toEqual([]);
});
