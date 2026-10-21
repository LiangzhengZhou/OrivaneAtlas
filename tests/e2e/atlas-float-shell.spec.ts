import { mkdir, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, resolve, sep } from "node:path";
import { expect, test } from "@playwright/test";

let assetServer: Server;
let origin: string;
test.beforeAll(async () => {
  assetServer = createServer((request, response) => {
    void (async () => {
      const dist = resolve("apps/web/dist");
      try {
        const pathname = new URL(request.url ?? "/", "http://127.0.0.1")
          .pathname;
        const path = resolve(
          dist,
          pathname === "/" ? "index.html" : "." + decodeURIComponent(pathname),
        );
        if (!path.startsWith(dist + sep)) throw new Error("UNSAFE");
        const types: Record<string, string> = {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".png": "image/png",
          ".svg": "image/svg+xml",
          ".woff2": "font/woff2",
        };
        response.setHeader(
          "Content-Type",
          types[extname(path)] ?? "application/octet-stream",
        );
        response.end(await readFile(path));
      } catch {
        response.writeHead(404);
        response.end();
      }
    })();
  });
  await new Promise<void>((done) => assetServer.listen(0, "127.0.0.1", done));
  const address = assetServer.address();
  if (!address || typeof address === "string") throw new Error("NO_PORT");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((done, fail) =>
    assetServer.close((error) => (error ? fail(error) : done())),
  );
});

test("offline conversation reload is a history error and never sends a model request", async ({
  page,
}, info) => {
  let modelRequests = 0;
  await page.context().route("**/api/**", (route) => {
    if (/\/ai\/(propose|decide|run)(?:[/?]|$)/.test(route.request().url()))
      modelRequests++;
    return route.abort();
  });
  const zh = info.project.name !== "desktop-en";
  await page.goto(`${origin}/#ai`);
  const title = page.getByText(
    zh ? "对话暂时无法加载" : "Conversations could not be loaded",
    { exact: true },
  );
  await expect(title).toBeVisible();
  await expect(
    page.getByText(zh ? "模型请求失败" : "Model request failed", {
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: zh ? "重新加载对话" : "Reload conversations",
      exact: true,
    })
    .click();
  await expect(title).toBeVisible();
  expect(modelRequests).toBe(0);
  await mkdir(info.outputDir, { recursive: true });
  await page.screenshot({
    path: info.outputPath("atlas-offline-errors.png"),
    animations: "disabled",
  });
});

test("Atlas opens as a floating surface beside a task Inspector, never as an Inspector tab", async ({
  page,
}, info) => {
  await page.context().route("**/api/**", (route) => route.abort());
  const zh = info.project.name !== "desktop-en";
  await page.goto(`${origin}/#tasks`);
  await expect(page.locator(".tasks-workspace")).toBeVisible();
  // The same event the command palette and graph use; avoids keyboard-focus races.
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("atlas:open")),
  );
  const float = page.getByRole("dialog", {
    name: zh ? "Atlas 助手" : "Atlas assistant",
    exact: true,
  });
  await expect(float).toBeVisible();
  await expect(page.locator(".context-pane")).toHaveCount(0);
  const box = await float.boundingBox();
  const viewport = page.viewportSize()!;
  // A float, not a full-height side panel.
  expect(box!.height).toBeLessThan(viewport.height - 16);
  expect(box!.width).toBeLessThanOrEqual(viewport.width - 8);
  await mkdir(info.outputDir, { recursive: true });
  await page.screenshot({
    path: info.outputPath("atlas-float.png"),
  });
  await float
    .getByRole("button", { name: zh ? "关闭 Atlas" : "Close Atlas" })
    .click();
  await expect(float).toHaveCount(0);
});
