import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { expect, type Page, test } from "@playwright/test";

let assetServer: Server;
let origin: string;

test.beforeAll(async ({}, info) => {
  assetServer = createServer((request, response) => {
    void serve(request.url ?? "/", response);
  });
  await new Promise<void>((done) => assetServer.listen(0, "127.0.0.1", done));
  const address = assetServer.address();
  if (!address || typeof address === "string") throw new Error("NO_PORT");
  origin = `http://127.0.0.1:${address.port}`;
  void promisify(execFile);
  void info;
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
  const dist = resolve(process.env.ATLAS_UI_FIXTURE_DIST ?? "apps/web/dist");
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
      ".ico": "image/x-icon",
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

async function offline(page: Page) {
  await page.context().route("**/api/**", (route) => route.abort());
}

test("systematic low-chrome audit captures offline route surfaces and accessible glass fallback", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await offline(page);
  const directory = info.outputPath("route-audit");
  await mkdir(directory, { recursive: true });
  const zh = info.project.name !== "desktop-en";
  await page.goto(`${origin}/#projects`);
  await page
    .getByRole("button", { name: zh ? "新建项目" : "New project", exact: true })
    .first()
    .click();
  const projectEditor = page.getByRole("dialog");
  await projectEditor
    .getByLabel(zh ? "标题" : "Title", { exact: true })
    .fill("Audit project");
  await projectEditor
    .getByRole("button", {
      name: zh ? "新建项目" : "Create project",
      exact: true,
    })
    .click();
  await expect(projectEditor).toHaveCount(0);
  await page.getByText("Audit project", { exact: true }).first().click();
  await expect(page).toHaveURL(/#projects\/[^/?]+/);
  const projectId = new URL(page.url()).hash
    .split("projects/")[1]!
    .split(/[/?]/)[0]!;
  const widths =
    info.project.name === "mobile-zh" ? [390, 430] : [1024, 1280, 1440, 1920];
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    for (const theme of ["light", "dark"]) {
      for (const route of [
        "overview",
        "focus",
        "tasks",
        "projects",
        "notes",
        "journal",
        "calendar",
        "library",
        "graph",
        "ai",
        "settings",
        "trash",
      ]) {
        await page.goto(
          `${origin}/#${route === "graph" ? `graph/project/${projectId}?mode=structure` : route}`,
        );
        if (route === "graph") {
          await expect(page.locator(".graph-workspace")).toBeVisible();
        } else {
          await expect(
            page
              .getByRole("button", {
                name:
                  info.project.name === "desktop-en"
                    ? /^Notifications/
                    : /^通知/,
              })
              .first(),
          ).toBeVisible();
        }
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, theme);
        await expect(page.locator(".topbar")).toHaveCount(0);
        await page.screenshot({
          path: `${directory}/${width}-${theme}-${route}.png`,
          animations: "disabled",
        });
        if (route === "projects" && width < 800) {
          const row = page.locator(".project-compact-row").first();
          await expect(row).toBeVisible();
          expect(
            await row.evaluate(
              (element) =>
                getComputedStyle(element).gridTemplateColumns.split(/\s+/)
                  .length,
            ),
          ).toBe(3);
          expect(
            await row.locator(".project-lifecycle").evaluate((element) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              return range.getClientRects().length;
            }),
          ).toBe(1);
        }
      }
    }
  }
  await page.goto(`${origin}/#tasks`);
  await page
    .getByRole("button", {
      name: info.project.name === "desktop-en" ? "New task" : "新建任务",
      exact: true,
    })
    .first()
    .click();
  await page.emulateMedia({ contrast: "more" });
  await expect(page.getByRole("dialog")).toBeVisible();
  const blur = await page
    .getByRole("dialog")
    .evaluate(
      (dialog) => getComputedStyle(dialog, "::backdrop").backdropFilter,
    );
  expect(blur).toBe("none");
  await page.emulateMedia({
    contrast: "no-preference",
    reducedMotion: "reduce",
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-reduced-motion", value: "reduce" },
      { name: "prefers-reduced-transparency", value: "reduce" },
      { name: "prefers-contrast", value: "no-preference" },
    ],
  });
  expect(
    await page.evaluate(() => ({
      motion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      transparency: matchMedia("(prefers-reduced-transparency: reduce)")
        .matches,
    })),
  ).toEqual({ motion: true, transparency: true });
  const durations = await page.getByRole("dialog").evaluate((dialog) =>
    [dialog, ...dialog.querySelectorAll("*")].flatMap((element) => {
      const style = getComputedStyle(element);
      return [style.transitionDuration, style.animationDuration].flatMap(
        (value) =>
          value
            .split(",")
            .map((duration) => Number.parseFloat(duration) * 1000),
      );
    }),
  );
  expect(Math.max(...durations)).toBeLessThanOrEqual(0.011);
  expect(
    await page
      .getByRole("dialog")
      .evaluate(
        (dialog) => getComputedStyle(dialog, "::backdrop").backdropFilter,
      ),
  ).toBe("none");
  await page.screenshot({
    path: info.outputPath("reduced-preferences-dialog.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: zh ? /^通知/ : /^Notifications/ })
    .first()
    .click();
  const notifications = page.locator(".notification-center");
  await expect(notifications).toBeVisible();
  await expect(notifications).toHaveCSS("backdrop-filter", "none");
  await expect(notifications).toHaveCSS("animation-name", "none");
  await page.screenshot({
    path: info.outputPath("reduced-preferences-notifications.png"),
    animations: "disabled",
  });
});

test("forced colors removes transient glass and dialog backdrop blur", async ({
  page,
}, info) => {
  const zh = info.project.name !== "desktop-en";
  await offline(page);
  await page.goto(`${origin}/#tasks`);
  await page.emulateMedia({
    forcedColors: "active",
    contrast: "no-preference",
  });
  await page
    .getByRole("button", { name: zh ? /^通知/ : /^Notifications/ })
    .first()
    .click();
  const glass = page.locator(".glass-surface:visible");
  await expect(glass.first()).toBeVisible();
  await expect
    .poll(() =>
      glass
        .first()
        .evaluate((element) => getComputedStyle(element).backdropFilter),
    )
    .toBe("none");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: zh ? "新建任务" : "New task", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      dialog.evaluate(
        (element) => getComputedStyle(element, "::backdrop").backdropFilter,
      ),
    )
    .toBe("none");
  await page.screenshot({ path: info.outputPath("forced-colors-dialog.png") });
});

/** Creates a task due today through the real editor, so the cause is genuine. */
async function createDueTask(page: Page, zh: boolean, title: string) {
  await page.goto(`${origin}/#tasks`);
  await page
    .getByRole("button", { name: zh ? "新建任务" : "New task", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(zh ? "标题" : "Title", { exact: true }).fill(title);
  await dialog
    .getByRole("button", { name: zh ? "截止日期" : "Due date", exact: true })
    .click();
  await page
    .getByRole("button", { name: zh ? "今天" : "Today", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: zh ? "新建任务" : "Create task", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}

test("calendar keeps selected-day actions accessible on a compact populated month", async ({
  page,
}, info) => {
  await offline(page);
  const zh = info.project.name !== "desktop-en";
  await createDueTask(page, zh, "Agenda context task");
  await page.goto(`${origin}/#calendar`);
  const agenda = page.locator(".agenda-panel");
  await expect(
    agenda.getByText("Agenda context task", { exact: true }),
  ).toBeVisible();
  const actions = agenda.locator(".calendar-agenda-actions");
  await expect(actions).toBeVisible();
  if (info.project.name === "mobile-zh") {
    const bounds = (await actions.boundingBox())!;
    expect(bounds.y + bounds.height).toBeLessThan(
      page.viewportSize()!.height - 68,
    );
    const day = (await page
      .locator(".calendar-grid .ui-calendar-day")
      .first()
      .boundingBox())!;
    expect(day.height).toBeGreaterThanOrEqual(44);
    expect(day.height).toBeLessThanOrEqual(72);
  }
  await mkdir(info.outputDir, { recursive: true });
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    if (info.project.name === "mobile-zh") {
      const contrast = () =>
        page.locator(".mobile-navigation-toggle").evaluate((button) => {
          const luminance = (value: string) => {
            const [r = 0, g = 0, b = 0] = (value.match(/[\d.]+/g) ?? [])
              .slice(0, 3)
              .map(Number)
              .map((channel) => {
                const s = channel / 255;
                return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
              });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const foreground = luminance(getComputedStyle(button).color);
          const background = luminance(
            getComputedStyle(button.closest(".sidebar")!).backgroundColor,
          );
          return {
            ratio:
              (Math.max(foreground, background) + 0.05) /
              (Math.min(foreground, background) + 0.05),
            foreground: getComputedStyle(button).color,
            background: getComputedStyle(button.closest(".sidebar")!)
              .backgroundColor,
            theme: document.documentElement.dataset.theme,
          };
        });
      // Theme colors transition; measure the rendered final contrast, rather
      // than mixing the new canvas with an old foreground animation frame.
      await expect
        .poll(async () => (await contrast()).ratio)
        .toBeGreaterThanOrEqual(3);
    }
    await page.screenshot({
      path: info.outputPath(`calendar-${theme}.png`),
      animations: "disabled",
    });
  }
});

test("due work becomes one durable notification with read, snooze, dismiss and restart safety", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await offline(page);
  await page.clock.setFixedTime(new Date("2026-10-16T18:00:00+08:00"));
  const zh = info.project.name !== "desktop-en";
  await createDueTask(page, zh, "Pay invoice");

  const bell = page.getByRole("button", {
    name: zh ? /^通知/ : /^Notifications/,
  });
  await expect(bell).toContainText("");
  await expect(bell).toHaveAccessibleName(
    zh ? "通知，1 条未读" : "Notifications, 1 unread",
  );
  await bell.click();
  const center = page.getByRole("dialog", {
    name: zh ? "通知中心" : "Notification Center",
  });
  await expect(center).toBeVisible();
  await expect(center.getByText("Pay invoice")).toHaveCount(1);
  await mkdir(info.outputDir, { recursive: true });
  await page.screenshot({
    path: info.outputPath("notification-open.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");

  // Restart: still exactly one record, still unread, nothing re-created.
  await page.reload();
  await expect(
    page.getByRole("button", { name: zh ? /^通知/ : /^Notifications/ }),
  ).toHaveAccessibleName(zh ? "通知，1 条未读" : "Notifications, 1 unread");

  await page
    .getByRole("button", { name: zh ? /^通知/ : /^Notifications/ })
    .click();
  await center
    .getByRole("button", { name: zh ? "标为已读" : "Mark read" })
    .click();
  const filters = center.getByRole("group", {
    name: zh ? "通知筛选" : "Filter notifications",
  });
  await filters
    .getByRole("button", { name: zh ? "未读" : "Unread", exact: true })
    .click();
  await expect(center.getByText("Pay invoice")).toHaveCount(0);
  await filters
    .getByRole("button", { name: zh ? "全部" : "All", exact: true })
    .click();
  await expect(center.getByText("Pay invoice")).toBeVisible();
  await expect(
    page.getByRole("button", { name: zh ? /^通知/ : /^Notifications/ }),
  ).toHaveAccessibleName(zh ? "通知" : "Notifications");
  await center.getByRole("button", { name: zh ? "忽略" : "Dismiss" }).click();
  await expect(center.getByText("Pay invoice")).toHaveCount(0);

  // A dismissed cause must not come back after restart.
  await page.reload();
  await page
    .getByRole("button", { name: zh ? /^通知/ : /^Notifications/ })
    .click();
  await expect(center.getByText("Pay invoice")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a native notification tap opens its target and rejects off-app routes", async ({
  page,
}) => {
  await offline(page);
  await page.addInitScript(() => {
    let pending: string | null = null;
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (command: string) => {
          if (command === "notification_take_route") {
            const route = pending;
            pending = null;
            return route;
          }
          throw new Error(`Unsupported native test command: ${command}`);
        },
      },
    });
    window.addEventListener("test-native-route", (event) => {
      pending = (event as CustomEvent<string>).detail;
      window.dispatchEvent(new Event("orivane-notification-open"));
    });
  });
  await page.goto(`${origin}/#overview`);
  await expect(page.locator("body")).toBeVisible();
  await page.waitForTimeout(500);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("test-native-route", { detail: "/calendar" }),
    ),
  );
  await expect(page).toHaveURL(/#calendar/);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("test-native-route", {
        detail: "https://evil.example/x",
      }),
    ),
  );
  await expect(page).toHaveURL(/#calendar/);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("orivane-notification-open", {
        detail: "/tasks",
      }),
    ),
  );
  await expect(page).toHaveURL(/#calendar/);
});

test("notification privacy, quiet hours and explicit system sources persist offline", async ({
  page,
}, info) => {
  await offline(page);
  const zh = info.project.name !== "desktop-en";
  await page.goto(`${origin}/#settings`);
  const sources = page.getByRole("group", {
    name: zh ? "系统通知来源" : "System notification sources",
  });
  await expect(
    sources.getByLabel(zh ? "提醒" : "Reminders", { exact: true }),
  ).toBeChecked();
  const task = sources.getByLabel(zh ? "任务" : "Tasks", { exact: true });
  await expect(task).not.toBeChecked();
  await task.check();
  const inApp = page
    .getByRole("group", {
      name: zh ? "应用内通知来源" : "In-app notification sources",
    })
    .getByLabel(zh ? "任务" : "Tasks", { exact: true });
  await expect(inApp).toBeChecked();
  await inApp.uncheck();
  const previews = page.getByLabel(
    zh
      ? "在系统通知中显示内容预览"
      : "Show content previews in system notifications",
    { exact: true },
  );
  await previews.uncheck();
  const quiet = page.getByLabel(zh ? "勿扰时段" : "Quiet hours", {
    exact: true,
  });
  await quiet.check();
  await expect(
    page.getByLabel(zh ? "开始时间" : "Starts at", { exact: true }),
  ).toHaveValue("22:00");
  await page.reload();
  await expect(task).toBeChecked();
  await expect(inApp).not.toBeChecked();
  await expect(previews).not.toBeChecked();
  await expect(quiet).toBeChecked();
  await sources.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("notification-settings.png"),
    animations: "disabled",
  });
});

test("resource queue preserves successful files through a failed read and scoped layout reload", async ({
  page,
}, info) => {
  const zh = info.project.name.endsWith("zh");
  await offline(page);
  await page.goto(origin + "/#files");
  const browser = page.locator(".files-resource-browser");
  await expect(browser).toBeVisible();
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer;
    let failed = false;
    File.prototype.arrayBuffer = function () {
      if (!failed && this.name === "Field map.png") {
        failed = true;
        return Promise.reject(
          new DOMException("Temporary read failure", "NotReadableError"),
        );
      }
      return read.call(this);
    };
  });
  const printPage = await page.context().newPage();
  await printPage.setContent("<h1>Field survey</h1>");
  const pdf = await printPage.pdf();
  await printPage.close();
  await browser.locator("input[type=file]").setInputFiles([
    { name: "Field survey.pdf", mimeType: "application/pdf", buffer: pdf },
    {
      name: "Field map.png",
      mimeType: "image/png",
      buffer: await readFile("apps/web/public/favicon.png"),
    },
    {
      name: "Readings.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("point,height\nA,12\nB,23"),
    },
  ]);
  const queue = browser.getByRole("region", {
    name: zh ? "上传队列" : "Upload queue",
  });
  await expect(queue.getByRole("status")).toContainText("2 / 3");
  const retry = queue.getByRole("button", { name: zh ? "重试" : "Retry" });
  await expect(retry).toBeVisible();
  await expect(browser.locator(".files-resource-row")).toHaveCount(2);
  await page.screenshot({ path: info.outputPath("queue-partial-failure.png") });
  await retry.click();
  await expect(queue.getByRole("status")).toContainText("3 / 3");
  await expect(browser.locator(".files-resource-row")).toHaveCount(3);
  await queue
    .getByRole("button", { name: zh ? "关闭队列" : "Dismiss queue" })
    .click();
  const grid = browser.getByRole("button", {
    name: zh ? "网格视图" : "Grid view",
  });
  await grid.click();
  await page.reload();
  await expect(grid).toHaveAttribute("aria-pressed", "true");
  const row = browser.getByRole("button", { name: /Readings\.csv ·/ });
  await row.focus();
  await row.press("Space");
  const detail = browser.locator(".files-detail-panel");
  await expect(detail).toContainText("text/csv");
  await page.screenshot({ path: info.outputPath("resource-grid-details.png") });
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  await expect(row).toBeFocused();
});

test("palette text and actions meet AA in both appearance modes", async ({
  page,
}) => {
  await offline(page);
  await page.goto(origin + "/#files");
  await expect(page.locator(".files-resource-browser")).toBeVisible();
  const pairs = await page.evaluate(() => {
    const canvas = document.createElement("canvas").getContext("2d")!;
    function luminance(css: string) {
      if (!CSS.supports("color", css.trim()))
        throw new Error("Unresolved color: " + css);
      canvas.fillStyle = css.trim();
      canvas.fillRect(0, 0, 1, 1);
      const channels = Array.from(
        canvas.getImageData(0, 0, 1, 1).data.slice(0, 3),
      )
        .map((v) => v / 255)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return (
        channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
      );
    }
    const rows = [];
    const root = document.documentElement;
    for (const palette of [
      "warm-green",
      "warm-violet",
      "warm-orange",
      "orange-white",
      "cool-neutral",
    ])
      for (const theme of ["dark", "light"]) {
        root.dataset.palette = palette;
        root.dataset.theme = theme;
        const style = getComputedStyle(root);
        for (const [fg, bg] of [
          ["--text-muted", "--surface"],
          ["--text-muted", "--canvas"],
          ["--text-secondary", "--sidebar-surface"],
          ["--on-accent", "--accent"],
          ["--on-accent", "--accent-hover"],
        ] as const) {
          const a = luminance(style.getPropertyValue(fg)),
            b = luminance(style.getPropertyValue(bg));
          rows.push({
            palette,
            theme,
            fg,
            bg,
            ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          });
        }
      }
    return rows;
  });
  for (const row of pairs)
    expect(row.ratio, JSON.stringify(row)).toBeGreaterThanOrEqual(4.5);
});

test("calendar keyboard selection follows the date across a month boundary", async ({
  page,
}) => {
  await offline(page);
  await page.clock.setFixedTime(new Date("2026-01-31T12:00:00Z"));
  await page.goto(origin + "/#calendar");
  const today = page.getByRole("button", { name: "2026-01-31", exact: true });
  await expect(today).toHaveAttribute("aria-current", "date");
  await today.focus();
  await today.press("ArrowRight");
  const first = page.getByRole("button", { name: "2026-02-01", exact: true });
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await first.press("ArrowUp");
  await expect(
    page.getByRole("button", { name: "2026-01-25", exact: true }),
  ).toBeFocused();
  await expect(page.locator('.calendar-day[tabindex="0"]')).toHaveCount(1);
});

test("table preview preserves quoted cells and the original delimited text", async ({
  page,
}, info) => {
  const zh = info.project.name.endsWith("zh");
  await offline(page);
  await page.goto(origin + "/#files");
  const text =
    'station,reading\r\n"East, coast",=1+1\r\n"line one\nline two",42';
  await page.locator(".files-resource-browser input[type=file]").setInputFiles({
    name: "Tide.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(text),
  });
  const grid = page.getByRole("table", {
    name: zh ? "表格内容" : "Table contents",
  });
  await expect(grid.getByRole("row")).toHaveCount(3);
  await expect(
    grid.getByRole("cell", { name: "East, coast", exact: true }),
  ).toBeVisible();
  await expect(
    grid.getByRole("cell", { name: "=1+1", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("csv-preview.png") });
  await page
    .getByRole("button", { name: zh ? "源文本" : "Source text", exact: true })
    .click();
  expect(await page.locator(".file-text-preview pre").textContent()).toBe(text);
});

test("the file viewer opens a private raster and pages extracted PDF text", async ({
  page,
}, info) => {
  const zh = info.project.name.endsWith("zh");
  await offline(page);
  await page.goto(origin + "/#files");
  const input = page.locator(".files-resource-browser input[type=file]");
  await input.setInputFiles({
    name: "Survey mark.png",
    mimeType: "image/png",
    buffer: await readFile("apps/web/public/favicon.png"),
  });
  const detail = page.locator(".file-detail");
  await detail
    .getByRole("button", { name: zh ? "查看图片" : "View image", exact: true })
    .click();
  const viewer = page.getByRole("dialog", { name: "Survey mark.png" });
  await expect(
    viewer.getByRole("img", { name: "Survey mark.png" }),
  ).toBeVisible();
  await viewer
    .getByRole("button", { name: zh ? "放大" : "Zoom in", exact: true })
    .click();
  await page.screenshot({ path: info.outputPath("private-image-viewer.png") });
  await viewer
    .getByRole("button", { name: zh ? "关闭" : "Close", exact: true })
    .click();
  await expect(viewer).toHaveCount(0);
  await page.goto(origin + "/#files");
  const print = await page.context().newPage();
  await print.setContent(
    '<main style="break-after:page">North station</main><main>South station</main>',
  );
  const bytes = await print.pdf();
  await print.close();
  await input.setInputFiles({
    name: "Stations.pdf",
    mimeType: "application/pdf",
    buffer: bytes,
  });
  const preview = page.locator(".file-text-preview");
  await expect(preview.locator("pre")).toContainText("North station");
  await preview
    .getByRole("button", { name: zh ? "下一页" : "Next page", exact: true })
    .click();
  await expect(preview.locator("pre")).toContainText("South station");
  await expect(preview).not.toContainText("North station");
  await page.screenshot({ path: info.outputPath("pdf-text-page.png") });
});
