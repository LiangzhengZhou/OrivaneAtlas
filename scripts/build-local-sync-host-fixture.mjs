import { cp } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const worker = process.argv[2] ?? "0";
if (!/^\d{1,4}$/.test(worker)) throw new Error("Invalid fixture worker ID");
const require = createRequire(resolve("packages/host/package.json"));
const { build } = await import(pathToFileURL(require.resolve("vite")).href);
const outDir = resolve(`.artifacts/local-sync-host-fixture-${worker}`);
await build({
  configFile: false,
  root: resolve("packages/host"),
  build: {
    ssr: resolve("tests/fixtures/local-sync-host.ts"),
    outDir,
    emptyOutDir: true,
    minify: false,
  },
  ssr: {
    noExternal: [
      "@arclattice/application",
      "@arclattice/domain",
      "@arclattice/storage-sqlite",
      "@arclattice/wiki-core",
      "uuid",
    ],
  },
});
await cp(
  resolve("packages/storage-sqlite/src/migrations"),
  resolve(outDir, "migrations"),
  { recursive: true },
);
