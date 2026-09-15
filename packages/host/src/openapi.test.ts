import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("OpenAPI references resolve and versioned aliases preserve unique operations", () => {
  const spec = JSON.parse(
    readFileSync(resolve("docs/api/openapi.json"), "utf8"),
  );
  const operations = new Set<string>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref") {
        expect(typeof child).toBe("string");
        expect((child as string).startsWith("#/")).toBe(true);
        const target = (child as string)
          .slice(2)
          .split("/")
          .reduce(
            (current, part) =>
              current?.[part.replace(/~1/g, "/").replace(/~0/g, "~")],
            spec,
          );
        expect(target, String(child)).toBeDefined();
      } else if (key === "operationId") {
        expect(operations.has(child as string), String(child)).toBe(false);
        operations.add(child as string);
      }
      walk(child);
    }
  };
  walk(spec);
  expect(spec.info.version).toBe("0.6.0");
  for (const [path, item] of Object.entries(spec.paths)) {
    if (path.startsWith("/api/v1/")) continue;
    const alias = spec.paths[path.replace("/api/", "/api/v1/")];
    expect(alias, path).toBeDefined();
    const withoutId = (value: unknown) =>
      JSON.parse(
        JSON.stringify(value, (key, field) =>
          key === "operationId" ? undefined : field,
        ),
      );
    expect(withoutId(alias), path).toEqual(withoutId(item));
  }
});
