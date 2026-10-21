import { cpSync } from "node:fs";
import { defineConfig } from "vite";
export default defineConfig({
  build: {
    ssr: true,
    outDir: "dist",
    minify: false,
    rolldownOptions: {
      input: {
        main: "src/main.ts",
        "file-parser-worker": "src/file-parser-worker.ts",
      },
    },
  },
  ssr: {
    noExternal: /^(?!pdfjs-dist(?:\/|$))/,
  },
  plugins: [
    {
      name: "copy-migrations",
      closeBundle() {
        cpSync("../storage-sqlite/src/migrations", "dist/migrations", {
          recursive: true,
        });
      },
    },
  ],
});
