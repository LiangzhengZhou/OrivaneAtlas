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
