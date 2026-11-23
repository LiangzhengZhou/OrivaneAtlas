import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, release } from "node:os";
import { dirname, extname, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { chromium, expect } from "@playwright/test";

// Usage: node scripts/measure-resource-browser.mjs <built web directory> <new result.json>
const [, , distArgument, output] = process.argv;
if (!distArgument || !output)
  throw new Error("Expected built web directory and a new result path");
const dist = resolve(distArgument);
await readFile(resolve(dist, "index.html"));
const browser = await chromium.launch();
const origin = "http://127.0.0.1:1439";
const measurements = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    serviceWorkers: "block",
  });
  // A fresh profile and an intercepted origin keep all requests and fixture bytes local.
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith("/api/"))
      return route.abort();
    const path = resolve(
      dist,
      "." +
        (url.pathname === "/"
          ? "/index.html"
          : decodeURIComponent(url.pathname)),
    );
    if (!path.startsWith(dist + sep)) return route.abort();
    const type = {
      ".js": "text/javascript",
      ".css": "text/css",
      ".html": "text/html",
      ".png": "image/png",
      ".woff2": "font/woff2",
    }[extname(path)];
    try {
      await route.fulfill({
        body: await readFile(path),
        contentType: type ?? "application/octet-stream",
      });
    } catch {
      await route.abort();
    }
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error(error.message));
  await page.goto(origin + "/#files");
  await page.locator(".files-resource-browser input[type=file]").setInputFiles({
    name: "Survey original.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Fixture original"),
  });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const request = indexedDB.open("orivane-atlas.local-workspace");
        const db = await new Promise((ok, fail) => {
          request.onsuccess = () => ok(request.result);
          request.onerror = () => fail(request.error);
        });
        try {
          const read = db
            .transaction("entities")
            .objectStore("entities")
            .getAll();
          return await new Promise((ok, fail) => {
            read.onsuccess = () =>
              ok(read.result.some((row) => row.collection === "files"));
            read.onerror = () => fail(read.error);
          });
        } finally {
          db.close();
        }
      }),
    )
    .toBe(true);
  for (const total of [1000, 10000]) {
    await page.evaluate(async (total) => {
      const request = indexedDB.open("orivane-atlas.local-workspace");
      const db = await new Promise((ok, fail) => {
        request.onsuccess = () => ok(request.result);
        request.onerror = () => fail(request.error);
      });
      try {
        await new Promise((ok, fail) => {
          const tx = db.transaction("entities", "readwrite");
          tx.oncomplete = ok;
          tx.onabort = () => fail(tx.error);
          tx.onerror = () => fail(tx.error);
          const store = tx.objectStore("entities");
          const read = store.getAll();
          read.onsuccess = () => {
            const files = read.result.filter(
              (row) => row.collection === "files",
            );
            const first = files[0];
            if (!first) {
              fail(new Error("Missing uploaded fixture in isolated profile"));
              tx.abort();
              return;
            }
            for (let i = files.length; i < total; i++) {
              const id = crypto.randomUUID();
              store.add({
                ...first,
                id,
                value: {
                  ...first.value,
                  id,
                  name: "Survey " + String(i).padStart(5, "0") + ".txt",
                },
              });
            }
          };
        });
      } finally {
        db.close();
      }
    }, total);
    const start = performance.now();
    await page.goto(origin + "/?fixture=" + total + "#files");
    await page.waitForFunction(
      (expected) =>
        document.querySelector(".files-resource-heading small")?.textContent ===
        String(expected),
      total,
      { timeout: 120000 },
    );
    const readyMs = performance.now() - start;
    const rows = page.locator(".files-resource-row");
    const count = await rows.count();
    const first = rows.first();
    await first.scrollIntoViewIfNeeded();
    const selection = performance.now();
    await first.click();
    await page.locator(".files-detail-panel").waitFor();
    measurements.push({
      resources: total,
      renderedRows: count,
      readyMs: Math.round(readyMs),
      selectMs: Math.round(performance.now() - selection),
    });
  }
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        os: process.platform,
        osRelease: release(),
        cpu: cpus()[0]?.model,
        browser: browser.version(),
        viewport: "1440x900",
        measurements,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
} finally {
  await browser.close();
}
