import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { serveWebFixture } from "../../../../scripts/serve-ux-web-fixture.mjs";

// One valid, uncompressed blank page with a large whitespace content stream.
function blankPdf(streamBytes) {
  const head = "%PDF-1.7\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 120] /Resources <<>> /Contents 4 0 R >>",
    "<< /Length " +
      streamBytes +
      " >>\nstream\n" +
      " ".repeat(streamBytes) +
      "\nendstream",
  ];
  const offsets = [];
  let body = head;
  for (const [i, object] of objects.entries()) {
    offsets.push(body.length);
    body += i + 1 + " 0 obj\n" + object + "\nendobj\n";
  }
  const xref = body.length;
  body += "xref\n0 5\n0000000000 65535 f \n";
  for (const offset of offsets)
    body += String(offset).padStart(10, "0") + " 00000 n \n";
  return Buffer.from(
    body +
      "trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n" +
      xref +
      "\n%%EOF\n",
    "ascii",
  );
}

const [dist, directory] = process.argv.slice(2);
if (!dist || !directory)
  throw new Error(
    "Provide a built Web directory and a new evidence directory.",
  );
await mkdir(directory, { recursive: true });
const fixture = await serveWebFixture(dist);
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1280, height: 800 },
  });
  await context.route("**/api/**", (route) => route.abort());
  const page = await context.newPage();
  await page.goto(fixture.origin + "/#files");
  const input = page.locator(".files-resource-browser input[type=file]");
  await input.waitFor({ state: "attached" });
  const original = blankPdf(18 * 1024 * 1024);
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const diskPath = resolve(directory, "Large blank survey.pdf");
  await writeFile(diskPath, original, { flag: "wx" });
  const cdp = await context.newCDPSession(page);
  const baseline = await cdp.send("Runtime.getHeapUsage");
  const samples = [baseline];
  let sampling = true;
  const sample = (async () => {
    while (sampling) {
      await new Promise((ok) => setTimeout(ok, 125));
      samples.push(await cdp.send("Runtime.getHeapUsage"));
    }
  })();
  const start = performance.now();
  try {
    await input.setInputFiles(diskPath);
    const detail = page.locator(".file-detail");
    const download = detail.getByRole("button", {
      name: "Download original",
      exact: true,
    });
    await download.waitFor({ timeout: 60000 });
    const detailReadyMs = Math.round(performance.now() - start);
    const canOpen =
      (await detail
        .getByRole("button", { name: "View original PDF pages", exact: true })
        .count()) > 0;
    let firstPageMs = null;
    if (canOpen) {
      const opened = performance.now();
      await detail
        .getByRole("button", { name: "View original PDF pages", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "Large blank survey.pdf",
      });
      await dialog.locator("canvas:visible").waitFor({ timeout: 60000 });
      firstPageMs = Math.round(performance.now() - opened);
      await page.screenshot({ path: resolve(directory, "page-one.png") });
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
    }
    const pending = page.waitForEvent("download");
    await download.click();
    const file = await pending;
    const bytes = await readFile(await file.path());
    assert.equal(hash(bytes), hash(original));
    const downloadedMs = Math.round(performance.now() - start);
    await page.screenshot({ path: resolve(directory, "detail.png") });
    sampling = false;
    await sample;
    const result = {
      browser: browser.version(),
      source: "Isolated offline workspace, actual file input and download",
      fixtureBytes: original.length,
      sourceSha256: hash(original),
      downloadedSha256: hash(bytes),
      previewButtonPresent: canOpen,
      firstPageMs,
      detailReadyMs,
      downloadedMs,
      samples: samples.length,
      samplingIntervalMs: 125,
      rendererMainThreadJsHeapBefore: baseline.usedSize,
      rendererMainThreadJsHeapMaxObserved: Math.max(
        ...samples.map((x) => x.usedSize),
      ),
      backingStorageBefore: baseline.backingStorageSize,
      backingStorageMaxObserved: Math.max(
        ...samples.map((x) => x.backingStorageSize),
      ),
    };
    await writeFile(
      resolve(directory, "result.json"),
      JSON.stringify(result, null, 2) + "\n",
      { flag: "wx" },
    );
    console.log(JSON.stringify(result));
  } finally {
    sampling = false;
    await sample;
  }
} finally {
  await browser.close();
  fixture.close();
}
