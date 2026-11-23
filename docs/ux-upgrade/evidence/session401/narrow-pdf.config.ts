import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "../../../../tests/e2e",
  testMatch: "work.spec.ts",
  grep: /large PDF originals/,
  workers: 1,
  retries: 0,
  projects: [
    { name: "narrow-zh", use: { colorScheme: "light" } },
    { name: "narrow-contrast-zh", use: { forcedColors: "active" } },
  ],
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 768, height: 900 },
    locale: "zh-CN",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
});
