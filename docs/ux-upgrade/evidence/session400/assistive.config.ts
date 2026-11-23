import { defineConfig } from "@playwright/test";
import base from "../../../../playwright.config";

// Exercise populated production screens with both operating-system preferences.
export default defineConfig({
  ...base,
  testDir: "../../../../tests/e2e",
  testMatch: "work.spec.ts",
  grep: /first keyboard stop skips|moves a mixed collection|long Markdown contents|graph search bounds|calendar week day and agenda|first activation of an indexed Wiki/,
  projects: base.projects?.map((project) => ({
    ...project,
    use: { ...project.use, forcedColors: "active", reducedMotion: "reduce" },
  })),
});
