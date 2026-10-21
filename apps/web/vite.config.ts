import { copyFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "api-spec",
      closeBundle() {
        copyFileSync("../../docs/api/openapi.json", "dist/openapi.json");
      },
    },
  ],
  clearScreen: false,
  build: {
    // Keep font delivery compatible with the Host's self-only CSP. Small
    // third-party font subsets must not silently become data: URLs.
    assetsInlineLimit: (file) =>
      /\.(woff2?|ttf|otf)$/i.test(file) ? false : undefined,
  },
});
