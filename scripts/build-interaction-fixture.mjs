import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Test-only bundle: never an entry in the production app or a runtime flag.
const require = createRequire(resolve("apps/web/package.json"));
const worker = process.argv[2] ?? "0";
if (!/^\d{1,4}$/.test(worker)) throw new Error("Invalid fixture worker ID");
const output = resolve(`.artifacts/interaction-fixture-${worker}`);
if (
  !output.startsWith(resolve(".artifacts") + "/") &&
  !output.startsWith(resolve(".artifacts") + "\\")
)
  throw new Error("Unsafe fixture output");
const { build } = await import(pathToFileURL(require.resolve("vite")).href);
const react = (
  await import(pathToFileURL(require.resolve("@vitejs/plugin-react")).href)
).default;
await build({
  configFile: false,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  root: resolve("apps/web"),
  plugins: [react()],
  build: {
    outDir: output,
    emptyOutDir: true,
    lib: {
      entry: resolve("apps/web/test-fixtures/interaction.tsx"),
      name: "OrivaneInteractionFixture",
      formats: ["iife"],
      fileName: () => "interaction.js",
      cssFileName: "interaction",
    },
  },
});
