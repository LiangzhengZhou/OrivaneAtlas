import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";

// Independent release gate: verify the real installer, then reject a mutated copy.
const file = process.argv[2];
assert(file, "Pass the installer path");
const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const publicLines = Buffer.from(config.plugins.updater.pubkey, "base64")
  .toString()
  .trim()
  .split(/\r?\n/);
const key = Buffer.from(publicLines[1], "base64");
const lines = Buffer.from(readFileSync(file + ".sig", "utf8").trim(), "base64")
  .toString()
  .trim()
  .split(/\r?\n/);
const signature = Buffer.from(lines[1], "base64");
assert.equal(
  signature.subarray(0, 2).toString(),
  "ED",
  "Expected prehashed minisign",
);
assert.deepEqual(key.subarray(2, 10), signature.subarray(2, 10));
const publicKey = createPublicKey({
  key: Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    key.subarray(10),
  ]),
  format: "der",
  type: "spki",
});
const rawSignature = signature.subarray(10);
const bytes = readFileSync(file);
const check = (content) =>
  verify(
    null,
    createHash("blake2b512").update(content).digest(),
    publicKey,
    rawSignature,
  );
assert(check(bytes), "Installer signature invalid");
assert(lines[2].startsWith("trusted comment: "));
assert(
  verify(
    null,
    Buffer.concat([rawSignature, Buffer.from(lines[2].slice(17))]),
    publicKey,
    Buffer.from(lines[3], "base64"),
  ),
  "Trusted comment invalid",
);
const tampered = Buffer.from(bytes);
tampered[Math.floor(tampered.length / 2)] ^= 1;
assert(!check(tampered), "Tampered installer accepted");
assert(
  !check(bytes.subarray(0, bytes.length - 1)),
  "Truncated installer accepted",
);
console.log(
  "PASS: real updater signature and trusted comment; modified/truncated installers rejected",
);
