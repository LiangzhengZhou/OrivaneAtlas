// Reproducible inventory of Git-visible source, never business data or secrets.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

const [outputArg] = process.argv.slice(2);
if (!outputArg || process.argv.length !== 3)
  throw new Error(
    "Usage: node scripts/package-source.mjs ABSOLUTE_OUTPUT_PREFIX",
  );
const root = process.cwd();
const output = resolve(outputArg);
if (!isAbsolute(outputArg) || output.startsWith(root + sep))
  throw new Error("Output must be outside the workspace");
const archive = `${output}.tar.gz`;
const manifest = `${output}.sha256`;
if (existsSync(archive) || existsSync(manifest))
  throw new Error("Refusing to replace an existing checkpoint");
const files = [
  ...new Set(
    execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { encoding: "utf8" },
    )
      .split("\0")
      .filter(Boolean),
  ),
].sort();
for (const file of files) {
  if (
    !/^[a-zA-Z0-9_@./-]+$/.test(file) ||
    file.split("/").includes("..") ||
    isAbsolute(file) ||
    /(?:^|\/)(?:node_modules|dist|test-results|\.git|\.env)(?:\/|$|\.)|\.(?:sqlite|db|key|pem)(?:$|[.-])/i.test(
      file,
    ) ||
    !lstatSync(file).isFile()
  )
    throw new Error(`Unsafe source path: ${file}`);
}
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
writeFileSync(
  manifest,
  files.map((file) => `${digest(readFileSync(file))}  ${file}\n`).join(""),
  { flag: "wx" },
);
execFileSync("tar", ["-czf", archive, "--", ...files], { stdio: "inherit" });
console.log(
  JSON.stringify({
    files: files.length,
    archive,
    manifest,
    sha256: digest(readFileSync(archive)),
  }),
);
