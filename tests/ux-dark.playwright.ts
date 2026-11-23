import { defineConfig, devices } from "@playwright/test";
import base from "../playwright.config";

/** Populated end-to-end workflows under the user's dark system preference. */
export default defineConfig({
  ...base,
  testDir: "./e2e",
  testMatch: "work.spec.ts",
  grep: /mixed resource selection|resource batch trash and filtered restore|resource collections show scoped|journal date navigation|notes, safe reading|knowledge references and AI approval|quick completion and restore|v2.2 recurrence skip|account experience: file search|project settings preserve brief|first keyboard stop|overview resumes the authorized|graph entry distinguishes|moves a mixed collection|long Markdown contents|graph search bounds|calendar week day and agenda|two independent sessions sync|files page opens real documents/,
  projects: [
    {
      name: "desktop-en",
      use: {
        ...devices["Desktop Chrome"],
        locale: "en-US",
        colorScheme: "dark",
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "mobile-zh",
      use: {
        ...devices["Pixel 7"],
        locale: "zh-CN",
        colorScheme: "dark",
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});
