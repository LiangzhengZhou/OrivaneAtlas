import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "api-spec",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "openapi.json",
          source: readFileSync(
            new URL("../../docs/api/openapi.json", import.meta.url),
          ),
        });
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
