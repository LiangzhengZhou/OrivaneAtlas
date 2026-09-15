import { cpSync } from "node:fs";
import { defineConfig } from "vite";
export default defineConfig({
  build: { ssr: "src/main.ts", outDir: "dist", minify: false },
  ssr: {
    noExternal: [
      "@arclattice/application",
      "@arclattice/domain",
      "@arclattice/storage-sqlite",
      "uuid",
    ],
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
