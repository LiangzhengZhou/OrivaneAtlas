import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, resolve, sep } from "node:path";
import { expect, type Page, test } from "@playwright/test";

let assetServer: Server;
let origin: string;

test.beforeAll(async () => {
  assetServer = createServer((request, response) => {
    void serve(request.url ?? "/", response);
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

async function serve(
  url: string,
  response: import("node:http").ServerResponse,
) {
  const dist = resolve("apps/web/dist");
  try {
    const pathname = new URL(url, "http://127.0.0.1").pathname;
    const path = resolve(
      dist,
      pathname === "/" ? "index.html" : "." + decodeURIComponent(pathname),
    );
    if (!path.startsWith(dist + sep)) throw new Error("UNSAFE");
    const types: Record<string, string> = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".mjs": "text/javascript",
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
}

async function createProject(page: Page, zh: boolean, title: string) {
  await page.goto(`${origin}/#projects`);
  await page
    .getByRole("button", { name: zh ? "新建项目" : "New project", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(zh ? "标题" : "Title", { exact: true }).fill(title);
  await dialog
    .getByRole("button", {
      name: zh ? "新建项目" : "Create project",
      exact: true,
    })
    .click();
  await expect(dialog).toHaveCount(0);
}

const direction = (page: Page) =>
  new URL(page.url()).hash.match(/[?&]direction=(LR|TB)/)?.[1] ?? null;

test("project destination survives navigation before route listeners mount", async ({
  page,
}, info) => {
  const zh = info.project.name !== "desktop-en";
  await createProject(page, zh, "Route handover project");
  await page
    .getByText("Route handover project", { exact: true })
    .first()
    .click();
  await expect(page.locator(".project-workspace h1")).toHaveText(
    "Route handover project",
  );
  const destination = new URL(page.url()).hash;
  await page.addInitScript((hash) => {
    const original = window.addEventListener;
    let changed = false;
    window.addEventListener = function (
      ...args: Parameters<typeof window.addEventListener>
    ) {
      if (args[0] === "hashchange" && !changed) {
        changed = true;
        history.replaceState(null, "", hash);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }
      return original.apply(this, args);
    };
  }, destination);
  await page.goto(`${origin}/?route-handover#projects`);
  await expect(page.locator(".project-workspace h1")).toHaveText(
    "Route handover project",
  );
});

test("graph direction persists across reload, back and forward", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.context().route("**/api/**", (route) => route.abort());
  const zh = info.project.name !== "desktop-en";
  await createProject(page, zh, "Direction project");
  await page.getByText("Direction project", { exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp("#projects/[^/?]+"));
  const projectId = decodeURIComponent(
    new URL(page.url()).hash.split("projects/")[1]?.split(/[/?]/)[0] ?? "",
  );
  expect(projectId).not.toBe("");

  // Open the dependency graph through its real route.
  await page.goto(
    `${origin}/#graph/project/${projectId}?mode=dependencies&scope=focus`,
  );
  const vertical = page.getByRole("button", {
    name: zh ? "纵向布局" : "Vertical layout",
    exact: true,
  });
  const horizontal = page.getByRole("button", {
    name: zh ? "横向布局" : "Horizontal layout",
    exact: true,
  });
  await expect(horizontal).toHaveAttribute("aria-pressed", "true");
  expect(direction(page)).toBeNull();

  await vertical.click();
  await expect(vertical).toHaveAttribute("aria-pressed", "true");
  expect(direction(page)).toBe("TB");

  await page.reload();
  await expect(vertical).toHaveAttribute("aria-pressed", "true");
  expect(direction(page)).toBe("TB");

  // Navigate away and use real history entries.
  await page.goto(`${origin}/#tasks`);
  await page.goBack();
  await expect(vertical).toHaveAttribute("aria-pressed", "true");
  expect(direction(page)).toBe("TB");
  await page.goForward();
  await expect(page).toHaveURL(/#tasks/);
  await page.goBack();
  await expect(vertical).toHaveAttribute("aria-pressed", "true");

  await horizontal.click();
  await page.reload();
  await expect(horizontal).toHaveAttribute("aria-pressed", "true");
  expect(direction(page)).toBe("LR");
  expect(errors).toEqual([]);
});
