import { defineConfig } from "@playwright/test";
import configuration from "./playwright.config";

// Tracing takes DOM snapshots inside browser tasks and distorts CPU acceptance.
// Functional suites retain their normal tracing; benchmark inputs/assertions stay identical.
export default defineConfig({
  ...configuration,
  workers: 1,
  grep: /v2\.2 complete release fixture interaction and editor benchmark/,
  use: { ...configuration.use, trace: "off", screenshot: "off" },
});
