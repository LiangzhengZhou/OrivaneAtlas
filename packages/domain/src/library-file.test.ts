import { expect, it } from "vitest";
import { fileExtension, fileReadTier, requireFileName } from "./library-file";

it("preserves original Unicode names and separates extension from parser capability", () => {
  expect(requireFileName("实验 结果.XLSX")).toBe("实验 结果.XLSX");
  expect(fileExtension("实验 结果.XLSX")).toBe("xlsx");
  expect(fileExtension(".env")).toBeNull();
  expect(fileExtension("archive.tar.gz")).toBe("gz");
  expect(fileReadTier("xlsx")).toBe("STRUCTURED");
  expect(fileReadTier("md")).toBe("TEXT");
  expect(fileReadTier("xlsm")).toBe("STORAGE");
  expect(fileReadTier("exe")).toBe("STORAGE");
  expect(fileReadTier(null)).toBe("STORAGE");
});

it("rejects paths, controls and excessive names without silently rewriting input", () => {
  for (const name of [
    "",
    " ",
    ".",
    "..",
    "../secret",
    "a/b",
    "a\\b",
    "a\0b",
    "a\nb",
    "a\x7fb",
    "字".repeat(256),
  ])
    expect(() => requireFileName(name)).toThrow("VALIDATION_ERROR");
});
