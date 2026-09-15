import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 2,
  use: {
    baseURL: "http://127.0.0.1:1420",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-en",
      use: { ...devices["Desktop Chrome"], locale: "en-US" },
    },
    {
      name: "desktop-zh",
      use: { ...devices["Desktop Chrome"], locale: "zh-CN" },
    },
    { name: "mobile-zh", use: { ...devices["Pixel 7"], locale: "zh-CN" } },
  ],
});
