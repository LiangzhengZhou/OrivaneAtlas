import { expect, it } from "vitest";
import { requireApiGrants, requireApiScopes } from "./api-scopes";

it("rejects wildcard, unknown, duplicate and empty grants without coercion", () => {
  for (const value of [
    null,
    {},
    "tasks:read",
    [],
    ["*"],
    ["memo:read"],
    [1],
    ["tasks:read", "tasks:read"],
  ])
    expect(() => requireApiScopes(value)).toThrow("VALIDATION_ERROR");
  const input = ["tasks:write", "tasks:read"];
  expect(requireApiScopes(input)).toEqual(["tasks:read", "tasks:write"]);
  expect(input).toEqual(["tasks:write", "tasks:read"]);
});

it("keeps File metadata, content, writes, execution and publication independent", () => {
  expect(() => requireApiGrants(["files:read"], ["files:content"])).toThrow(
    "FORBIDDEN",
  );
  expect(() => requireApiGrants(["tasks:write"], ["tasks:read"])).toThrow(
    "FORBIDDEN",
  );
  expect(() =>
    requireApiGrants(["plans:propose", "proposals:write"], ["plans:publish"]),
  ).toThrow("FORBIDDEN");
  expect(() =>
    requireApiGrants(["tasks:write"], ["tasks:write", "capabilities:execute"]),
  ).toThrow("FORBIDDEN");
  expect(() =>
    requireApiGrants(
      ["tasks:write", "capabilities:execute"],
      ["tasks:write", "capabilities:execute"],
    ),
  ).not.toThrow();
  expect(() => requireApiGrants(["workspace:read"], [])).toThrow("FORBIDDEN");
});
