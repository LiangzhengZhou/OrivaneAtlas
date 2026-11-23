import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "../../../../tests/e2e",
  testMatch: "work.spec.ts",
  grep: /personal PDF reading/,
  workers: 1,
  retries: 0,
  projects: [
    {
      name: "320-zh",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 320, height: 640 },
        locale: "zh-CN",
        forcedColors: "active",
        reducedMotion: "reduce",
      },
    },
  ],
});
