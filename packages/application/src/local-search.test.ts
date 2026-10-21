import { expect, test } from "vitest";
import { localSearchGrams, localSearchKey } from "./local-search";

test("Unicode substring candidates preserve short Chinese and astral characters", () => {
  const grams = localSearchGrams("唯一🧭needle");
  expect(grams).toEqual(
    expect.arrayContaining(["唯", "唯一", "唯一🧭", "🧭ne", "nee"]),
  );
  expect(
    grams.some((gram) => gram.includes("\ud83e") && !gram.includes("🧭")),
  ).toBe(false);
  expect(new Set(grams).size).toBe(grams.length);
  expect(localSearchGrams("")).toEqual([]);
});
test("search key does not collide across workspace, collection or delimiter characters", () => {
  expect(
    new Set([
      localSearchKey("w", "notes", "a"),
      localSearchKey("w", "library", "a"),
      localSearchKey("other", "notes", "a"),
      localSearchKey("w:notes", "a", ""),
    ]).size,
  ).toBe(4);
});
