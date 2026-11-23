import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "revoked-draft.bench.ts",
  workers: 1,
  retries: 0,
  use: {
    locale: "en-US",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
});
