import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const rules = [
  ["packages/domain/src", []],
  ["packages/application/src", ["@arclattice/domain"]],
  ["apps/web/src", null],
];
function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? walk(file)
      : /\.tsx?$/.test(file)
        ? [file]
        : [];
  });
}
const errors = [];
for (const [directory, allowed] of rules) {
  for (const file of walk(directory)) {
    if (file.endsWith(".test.ts")) continue;
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node) {
      let specifier;
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        specifier = node.moduleSpecifier.text;
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          node.expression.getText(source) === "require") &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        specifier = node.arguments[0].text;
      if (specifier) {
        const local = specifier.startsWith(".");
        const escapes =
          local &&
          !path
            .resolve(path.dirname(file), specifier)
            .startsWith(`${path.resolve(directory)}${path.sep}`);
        if (allowed && (escapes || (!local && !allowed.includes(specifier))))
          errors.push(`${file}: forbidden dependency ${specifier}`);
        if (
          !allowed &&
          path.basename(file) !== "bootstrap.ts" &&
          (/storage-|sqlite|postgres|tauri-apps/.test(specifier) ||
            (local && !specifier.endsWith("bootstrap") && escapes))
        )
          errors.push(`${file}: UI cannot access infrastructure ${specifier}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else console.log("Architecture boundaries passed.");
