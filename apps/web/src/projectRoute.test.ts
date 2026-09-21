import { expect, it } from "vitest";
import { parseProjectRoute, projectHash } from "./projectRoute";

it("round trips project identity, tab and scope without losing Unicode", () => {
  const route = {
    projectId: "项目 / a?b",
    tab: "tasks" as const,
    scope: "DIRECT" as const,
  };
  expect(parseProjectRoute(projectHash(route))).toEqual(route);
});
it("falls back safely for unknown tabs, scope and malformed escapes", () => {
  expect(parseProjectRoute("#projects/abc?tab=no&scope=no")).toEqual({
    projectId: "abc",
    tab: "brief",
    scope: "SUBTREE",
  });
  expect(parseProjectRoute("#projects/%ZZ").projectId).toBe(null);
  expect(parseProjectRoute("#tasks").projectId).toBe(null);
});
