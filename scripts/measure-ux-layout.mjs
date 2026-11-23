import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { chromium } from "@playwright/test";

const [distPath, outputPath] = process.argv.slice(2);
if (!distPath || !outputPath)
  throw new Error("Expected a built Web directory and a new output directory.");
const dist = resolve(distPath);
await readFile(resolve(dist, "index.html"));
const output = resolve(outputPath);
await mkdir(output);
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".wasm": "application/wasm",
};
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    const file = resolve(dist, "." + (path === "/" ? "/index.html" : path));
    if (!file.startsWith(dist + sep) || path.startsWith("/api/"))
      throw new Error();
    const bytes = await readFile(file);
    res.writeHead(200, {
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
    });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
const origin = "http://127.0.0.1:" + server.address().port;
const routes = [
  "overview",
  "files",
  "notes",
  "journal",
  "library",
  "graph",
  "projects",
  "tasks",
  "focus",
  "calendar",
  "ai",
  "account",
  "settings",
  "trash",
];
const viewports = [
  [1920, 1080],
  [1440, 900],
  [1280, 800],
  [1024, 768],
  [768, 1024],
  [390, 844],
  [360, 800],
];
const records = [];
const browser = await chromium.launch();
try {
  for (const [width, height] of viewports) {
    const context = await browser.newContext({
      viewport: { width, height },
      locale: width < 769 ? "zh-CN" : "en-US",
      hasTouch: width < 769,
      serviceWorkers: "block",
      reducedMotion: "reduce",
    });
    await context.route(/^https?:/, (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    for (const route of routes) {
      await page.goto(origin + "/?layout=" + route + "#" + route);
      await page.locator("main.workspace-main").waitFor();
      const content = page.locator("main.workspace-main > .content:visible");
      await content.waitFor();
      const heading = content
        .locator("h1:visible, h2:visible, [role=heading]:visible")
        .first();
      const headingText = await heading
        .textContent({ timeout: 6000 })
        .catch(() => "");
      if (!headingText)
        console.log(
          `No visible heading: ${width} ${route} (${new URL(page.url()).hash})`,
        );
      await page.evaluate(() => document.fonts.ready);
      for (const theme of ["light", "dark"])
        for (const density of ["comfortable", "compact"]) {
          // Exercise the same root attributes used by ThemeSettings and DensitySettings.
          const measurement = await page.evaluate(
            async ({ theme, density, headingText }) => {
              const root = document.documentElement;
              root.dataset.theme = theme;
              root.dataset.density = density;
              await new Promise((ok) =>
                requestAnimationFrame(() => requestAnimationFrame(ok)),
              );
              const main = document.querySelector("main.workspace-main");
              return {
                heading: headingText,
                hash: location.hash,
                rootOverflow: root.scrollWidth - innerWidth,
                mainOverflow: main.scrollWidth - main.clientWidth,
                appliedTheme: root.dataset.theme,
                appliedDensity: root.dataset.density,
              };
            },
            { theme, density, headingText },
          );
          records.push({
            route,
            width,
            height,
            theme,
            density,
            ...measurement,
          });
          if (
            (width === 390 || width === 1280) &&
            theme === (width === 390 ? "dark" : "light") &&
            density === (width === 390 ? "compact" : "comfortable")
          ) {
            await page.screenshot({
              path: resolve(
                output,
                `${route}-${width}-${theme}-${density}.png`,
              ),
              animations: "disabled",
            });
          }
        }
    }
    await context.close();
    console.log(`Measured ${width} px · ${records.length} cases`);
  }
  const failures = records.filter(
    (r) =>
      !r.heading ||
      r.hash.split("?")[0] !== "#" + r.route ||
      r.rootOverflow > 1 ||
      r.mainOverflow > 1 ||
      r.appliedTheme !== r.theme ||
      r.appliedDensity !== r.density,
  );
  await writeFile(
    resolve(output, "layout.json"),
    JSON.stringify(
      {
        engine: browser.version(),
        fixture: "offline empty workspace",
        records,
        failures,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `${records.length} measured, ${failures.length} outside layout bounds`,
  );
  if (failures.length) process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
