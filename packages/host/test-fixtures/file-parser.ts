import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { NodeFileParser } from "../src/node-file-parser";
import hostConfig from "../vite.config";

export async function actualFileParserFixture(label: string) {
  if (!/^[a-z-]+$/.test(label)) throw new Error("INVALID_WORKER_FIXTURE");
  const output = resolve("packages/host/.artifacts", label);
  await build({
    ...hostConfig,
    configFile: false,
    plugins: [],
    root: resolve("packages/host"),
    logLevel: "silent",
    build: {
      ssr: true,
      outDir: output,
      minify: false,
      rolldownOptions: {
        input: {
          "file-parser-worker": "src/file-parser-worker.ts",
          "node-file-parser": "src/node-file-parser.ts",
        },
      },
    },
  });
  return new NodeFileParser(
    pathToFileURL(resolve(output, "file-parser-worker.js")),
  );
}
