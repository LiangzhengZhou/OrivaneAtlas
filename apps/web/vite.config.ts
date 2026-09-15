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
});
