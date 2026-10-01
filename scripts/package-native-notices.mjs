import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Release packaging only: generated Android assets are excluded from Git.
const destination = "src-tauri/gen/android/app/src/main/assets/third-party";
mkdirSync(destination, { recursive: true });
for (const file of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"]) {
  copyFileSync(file, join(destination, file));
}
for (const file of readdirSync("docs/licenses")) {
  if (!/\.(json|txt)$/.test(file)) continue;
  copyFileSync(join("docs/licenses", file), join(destination, file));
}
