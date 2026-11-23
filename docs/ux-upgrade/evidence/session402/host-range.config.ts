import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "host-range.bench.ts",
  workers: 1,
  retries: 0,
});
