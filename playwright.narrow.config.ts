import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

export default defineConfig({
  ...config,
  outputDir: "test-results-narrow",
  workers: 1,
  projects: [
    {
      name: "narrow-en",
      use: {
        ...config.projects![0]!.use,
        viewport: { width: 900, height: 800 },
      },
    },
  ],
});
