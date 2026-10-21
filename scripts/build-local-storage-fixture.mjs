import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const worker = process.argv[2] ?? "0";
if (!/^\d{1,4}$/.test(worker)) throw new Error("Invalid fixture worker ID");
const require = createRequire(resolve("apps/web/package.json"));
const { build } = await import(pathToFileURL(require.resolve("vite")).href);
await build({
  configFile: false,
  root: resolve("apps/web"),
  build: {
    outDir: resolve(`.artifacts/local-storage-fixture-${worker}`),
    emptyOutDir: true,
    lib: {
      entry: resolve("apps/web/test-fixtures/local-storage.ts"),
      name: "OrivaneLocalStorageFixture",
      formats: ["iife"],
      fileName: () => "storage.js",
    },
  },
});
