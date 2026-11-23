import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { serveWebFixture } from "./serve-ux-web-fixture.mjs";

const [baseline, candidate, output] = process.argv.slice(2);
if (!baseline || !candidate || !output)
  throw new Error(
    "Expected baseline build, candidate build and a new result directory.",
  );
await mkdir(output);
const signature = async (path) =>
  createHash("sha256")
    .update(await readFile(resolve(path, "index.html")))
    .digest("hex");
const baseIndex = await signature(baseline),
  nextIndex = await signature(candidate);
if (baseIndex === nextIndex) throw new Error("Release builds must be distinct");
const host = await serveWebFixture(baseline);
const browser = await chromium.launch();
const steps = [];
try {
  const profile = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1280, height: 800 },
  });
  await profile.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: host.origin,
  });
  const page = await profile.newPage();
  await page.goto(host.origin + "/#library");
  const bytes = Buffer.from("Transect 7\r\n原始字节\r\n", "utf8");
  const bytesSha = createHash("sha256").update(bytes).digest("hex");
  await page.getByLabel("Upload file", { exact: true }).setInputFiles({
    name: "Survey rollback.txt",
    mimeType: "text/plain",
    buffer: bytes,
  });
  const detail = page.getByRole("region", {
    name: "Survey rollback.txt",
    exact: true,
  });
  await expect(detail).toBeVisible();
  await detail
    .getByRole("button", { name: "Copy reference", exact: true })
    .click();
  const reference = await page.evaluate(() => navigator.clipboard.readText());
  const hash = reference.match(/\((#library\?file=[a-z0-9-]+)\)$/)?.[1];
  if (!hash) throw new Error("Missing typed file reference");
  await page.goto(host.origin + "/" + hash);
  await page.evaluate(() =>
    localStorage.setItem("orivane-atlas.theme", "dark"),
  );
  let baseScript, nextScript;
  for (const [stage, build] of [
    ["baseline", baseline],
    ["upgrade", candidate],
    ["rollback", baseline],
    ["reupgrade", candidate],
    ["offline", candidate],
  ]) {
    host.setDist(build);
    if (stage === "offline") {
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      await profile.setOffline(true);
    }
    await page.reload();
    await expect(detail).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const js = await page.evaluate(() =>
      [...document.querySelectorAll("script[type=module][src]")]
        .map((s) => new URL(s.src).pathname)
        .join("|"),
    );
    if (
      !js ||
      (stage === "upgrade" && js === baseScript) ||
      (stage === "rollback" && js !== baseScript) ||
      ((stage === "reupgrade" || stage === "offline") && js !== nextScript)
    )
      throw new Error("Unexpected served asset in " + stage);
    if (stage === "baseline") baseScript = js;
    if (stage === "upgrade") nextScript = js;
    const downloaded = page.waitForEvent("download");
    await detail
      .getByRole("button", { name: "Download original", exact: true })
      .click();
    const original = await downloaded;
    const digest = createHash("sha256");
    for await (const chunk of await original.createReadStream())
      digest.update(chunk);
    if (
      digest.digest("hex") !== bytesSha ||
      original.suggestedFilename() !== "Survey rollback.txt" ||
      new URL(page.url()).hash !== hash
    )
      throw new Error("Original or reference changed in " + stage);
    steps.push({ stage, js, deepLink: hash, sha256: bytesSha, theme: "dark" });
    if (stage === "rollback" || stage === "upgrade")
      await page.screenshot({ path: resolve(output, stage + ".png") });
  }
  await writeFile(
    resolve(output, "result.json"),
    JSON.stringify(
      {
        baselineIndex: baseIndex,
        candidateIndex: nextIndex,
        engine: browser.version(),
        steps,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Five stages preserved the same link, theme and downloaded SHA-256",
  );
} finally {
  await browser.close();
  host.close();
}
