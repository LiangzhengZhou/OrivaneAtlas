import { expect, it } from "vitest";
import { sampleDelimited } from "./delimited-preview";

it("preserves quoted delimiters, quoted newlines, empty fields and formula-like text", () => {
  expect(
    sampleDelimited(
      "a,b,\r\n\u0022one,two\u0022,\u0022first\nsecond\u0022,=1+1\r\n\u0022a\u0022\u0022b\u0022,,",
      ",",
    )?.rows,
  ).toEqual([
    ["a", "b", ""],
    ["one,two", "first\nsecond", "=1+1"],
    ['a"b', "", ""],
  ]);
  expect(sampleDelimited("a\tb\r\n1\t2", "\t")?.rows).toHaveLength(2);
  expect(sampleDelimited('a,"unterminated', ",")).toBeNull();
});
it("bounds mounted rows and columns and reports when the source contains more", () => {
  const result = sampleDelimited(
    Array.from({ length: 51 }, () => Array(25).fill("literal").join(",")).join(
      "\n",
    ),
    ",",
  );
  expect(result?.rows).toHaveLength(50);
  expect(result?.rows[0]).toHaveLength(24);
  expect(result?.clipped).toBe(true);
});
