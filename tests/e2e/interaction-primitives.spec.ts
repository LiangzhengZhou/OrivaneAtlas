import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

test("priority signals retain text and accessible semantic contrast in light and dark", async ({
  page,
}) => {
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme,
    );
    const signals = page
      .getByRole("region", { name: "Priority signals" })
      .locator(".ui-priority-signal");
    await expect(signals).toHaveText(["●URGENT", "●HIGH", "MEDIUM", "LOW"]);
    const measurements = await signals.evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        const background = getComputedStyle(
          element.parentElement!,
        ).backgroundColor;
        const luminance = (color: string) => {
          const channels = color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
            .map((value) => {
              const channel = value / 255;
              return channel <= 0.04045
                ? channel / 12.92
                : ((channel + 0.055) / 1.055) ** 2.4;
            });
          return (
            (channels[0] ?? 0) * 0.2126 +
            (channels[1] ?? 0) * 0.7152 +
            (channels[2] ?? 0) * 0.0722
          );
        };
        const foreground = luminance(style.color),
          back = luminance(background);
        return {
          contrast:
            (Math.max(foreground, back) + 0.05) /
            (Math.min(foreground, back) + 0.05),
          background: style.backgroundColor,
          color: style.color,
        };
      }),
    );
    expect(new Set(measurements.map((value) => value.color)).size).toBe(4);
    for (const value of measurements) {
      expect(value.contrast).toBeGreaterThanOrEqual(4.5);
      expect(value.background).toBe("rgba(0, 0, 0, 0)");
    }
  }
});

test.beforeAll(async ({}, info) => {
  await promisify(execFile)(
    process.execPath,
    ["scripts/build-interaction-fixture.mjs", String(info.workerIndex)],
    { timeout: 30000 },
  );
});
test.beforeEach(async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({
    content: await readFile(
      `.artifacts/interaction-fixture-${info.workerIndex}/interaction.css`,
      "utf8",
    ),
  });
  await page.addScriptTag({
    content: await readFile(
      `.artifacts/interaction-fixture-${info.workerIndex}/interaction.js`,
      "utf8",
    ),
  });
  expect(errors).toEqual([]);
  await expect(page.locator("main")).toBeVisible();
});

test("destination opens directly; nested action and operational selection remain independent", async ({
  page,
}) => {
  const events = page.getByLabel("Events");
  await page
    .getByText("Destination", { exact: false })
    .click({ position: { x: 5, y: 5 } });
  await expect(events).toHaveText("navigate");
  await page
    .getByRole("button", { name: "Nested action", exact: true })
    .click();
  await expect(events).toHaveText("navigate,nested");
  await page.getByText("Operational row", { exact: true }).click();
  await expect(events).toHaveText("navigate,nested,select");
  await page.getByText("Operational row", { exact: true }).press("Enter");
  await expect(events).toHaveText("navigate,nested,select,open");
});

test("arming never commits and escape/outside/expiry cancel; second click commits", async ({
  page,
}) => {
  const instant = new Date("2026-10-11T00:00:00Z");
  await page.clock.install({ time: instant });
  await page.clock.pauseAt(instant);
  const events = page.getByLabel("Events");
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(events).toHaveText("");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Complete", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await page.getByRole("button", { name: "Outside", exact: true }).click();
  await expect(events).toHaveText("");
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await page.clock.fastForward(4001);
  await expect(
    page.getByRole("button", { name: "Complete", exact: true }),
  ).toBeVisible({ timeout: 5000 });
  await expect(events).toHaveText("");
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm completion", exact: true })
    .click();
  await expect(events).toHaveText("commit");
});

test("touch long press arms after 400ms and scrolling cancels it", async ({
  page,
}) => {
  const instant = new Date("2026-10-11T00:00:00Z");
  await page.clock.install({ time: instant });
  await page.clock.pauseAt(instant);
  const row = page.getByTestId("touch-row");
  const events = page.getByLabel("Events");
  await row.dispatchEvent("pointerdown", {
    pointerType: "touch",
    button: 0,
    clientX: 10,
    clientY: 10,
  });
  await page.clock.fastForward(399);
  await expect(events).toHaveText("");
  await row.dispatchEvent("pointermove", {
    pointerType: "touch",
    clientX: 10,
    clientY: 30,
  });
  await page.clock.fastForward(100);
  await expect(events).toHaveText("");
  await row.dispatchEvent("pointerdown", {
    pointerType: "touch",
    button: 0,
    clientX: 10,
    clientY: 10,
  });
  await page.clock.fastForward(400);
  await expect(events).toHaveText("long-press");
  await row.dispatchEvent("pointerup", { pointerType: "touch" });
});

test("touch reorder commits only on release over an eligible row and scroll/Escape cancel arming", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-11T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-11T00:00:00Z"));
  const row = page.locator('[data-order-entity="A"]');
  const point = await row.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + 20, y: rect.top + 20 };
  });
  const down = () =>
    row.dispatchEvent("pointerdown", {
      pointerType: "touch",
      pointerId: 7,
      isPrimary: true,
      button: 0,
      clientX: point.x,
      clientY: point.y,
    });
  const events = page.getByLabel("Events");
  await down();
  await page.clock.runFor(399);
  await expect(row).not.toHaveAttribute("data-reordering", "true");
  await expect(events).not.toContainText("touch-move");
  await page.clock.runFor(1);
  await expect(row).toHaveAttribute("data-reordering", "true");
  const destination = await page
    .locator('[data-order-entity="B"]')
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + 20, y: rect.top + 20 };
    });
  await page.evaluate(
    ({ x, y }) =>
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerType: "touch",
          pointerId: 7,
          clientX: x,
          clientY: y,
          bubbles: true,
        }),
      ),
    destination,
  );
  await expect(events).not.toContainText("touch-move");
  await page.evaluate(() =>
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerType: "touch",
        pointerId: 7,
        bubbles: true,
      }),
    ),
  );
  await expect(events).toContainText("touch-move:A:B");
  await expect(row).not.toHaveAttribute("data-reordering", "true");
  await down();
  await row.dispatchEvent("pointermove", {
    pointerType: "touch",
    pointerId: 7,
    isPrimary: true,
    clientX: point.x,
    clientY: point.y + 12,
  });
  await page.clock.runFor(450);
  await expect(row).not.toHaveAttribute("data-reordering", "true");
  await down();
  await page.keyboard.press("Escape");
  await page.clock.runFor(450);
  await expect(row).not.toHaveAttribute("data-reordering", "true");
  await down();
  await page.clock.runFor(400);
  const disabled = await page
    .locator('[data-order-entity="C"]')
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + 20, y: rect.top + 20 };
    });
  await page.evaluate(({ x, y }) => {
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerType: "touch",
        pointerId: 7,
        clientX: x,
        clientY: y,
        bubbles: true,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerType: "touch",
        pointerId: 7,
        bubbles: true,
      }),
    );
  }, disabled);
  await expect(events).toHaveText("touch-move:A:B");
  await down();
  await page.clock.runFor(400);
  const after = await page
    .locator('[data-order-entity="B"]')
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + 20, y: rect.bottom - 10 };
    });
  await page.evaluate(
    ({ x, y }) =>
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerType: "touch",
          pointerId: 8,
          clientX: x,
          clientY: y,
          bubbles: true,
        }),
      ),
    after,
  );
  await page.evaluate(() =>
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerType: "touch",
        pointerId: 8,
        bubbles: true,
      }),
    ),
  );
  await expect(row).toHaveAttribute("data-reordering", "true");
  await expect(events).toHaveText("touch-move:A:B");
  await page.evaluate(() =>
    document.dispatchEvent(
      new PointerEvent("pointercancel", {
        pointerType: "touch",
        pointerId: 8,
        bubbles: true,
      }),
    ),
  );
  await expect(row).toHaveAttribute("data-reordering", "true");
  await page.evaluate(({ x, y }) => {
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerType: "touch",
        pointerId: 7,
        clientX: x,
        clientY: y,
        bubbles: true,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerType: "touch",
        pointerId: 7,
        bubbles: true,
      }),
    );
  }, after);
  await expect(events).toHaveText("touch-move:A:B,touch-after:A:B");
});

test("touch gesture survives a virtual source row unmount until the valid drop", async ({
  page,
}) => {
  const instant = new Date("2026-10-11T00:00:00Z");
  await page.clock.install({ time: instant });
  await page.clock.pauseAt(instant);
  const row = page.locator('[data-order-entity="A"]');
  const point = await row.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + 20, y: rect.top + 20 };
  });
  await row.dispatchEvent("pointerdown", {
    pointerType: "touch",
    pointerId: 7,
    isPrimary: true,
    button: 0,
    clientX: point.x,
    clientY: point.y,
  });
  await page.clock.runFor(400);
  await expect(row).toHaveAttribute("data-reordering", "true");
  await page
    .getByRole("button", { name: "Unmount virtual source", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  const pointB = await page
    .locator('[data-order-entity="B"]')
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + 20, y: rect.top + 20 };
    });
  await page.evaluate(({ x, y }) => {
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerType: "touch",
        pointerId: 7,
        clientX: x,
        clientY: y,
        bubbles: true,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerType: "touch",
        pointerId: 7,
        bubbles: true,
      }),
    );
  }, pointB);
  await expect(page.getByLabel("Events")).toHaveText("touch-move:A:B");
});

test("touch edge scrolling keeps 1500 virtual rows bounded and cancels its animation on release", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Show virtual reorder fixture", exact: true })
    .click();
  const scroller = page.locator(".touch-virtual-fixture .virtual-task-scroll");
  await scroller.scrollIntoViewIfNeeded();
  const instant = new Date("2026-10-11T00:00:00Z");
  await page.clock.install({ time: instant });
  await page.clock.pauseAt(instant);
  const row = scroller.locator('[data-order-entity="virtual-0"]');
  const point = await row.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.left + 20, y: bounds.top + 20 };
  });
  await row.dispatchEvent("pointerdown", {
    pointerType: "touch",
    pointerId: 7,
    isPrimary: true,
    button: 0,
    clientX: point.x,
    clientY: point.y,
  });
  await page.clock.runFor(400);
  const edge = await scroller.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.left + 20, y: bounds.bottom - 10 };
  });
  await page.evaluate(
    ({ x, y }) =>
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerType: "touch",
          pointerId: 7,
          clientX: x,
          clientY: y,
          bubbles: true,
        }),
      ),
    edge,
  );
  await page.clock.runFor(500);
  expect(
    await scroller.evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(100);
  expect(await scroller.locator("[data-order-entity]").count()).toBeLessThan(
    25,
  );
  await expect(page.getByLabel("Events")).not.toContainText("virtual-");
  await page.evaluate(() =>
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerType: "touch",
        pointerId: 7,
        bubbles: true,
      }),
    ),
  );
  await expect(page.getByLabel("Events")).toContainText("virtual-");
  const stopped = await scroller.evaluate((element) => element.scrollTop);
  await page.clock.runFor(500);
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(stopped);
});

test("browser-generated touch events reorder after a real long press without becoming a scroll", async ({
  page,
}) => {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  const row = page.locator('[data-order-entity="A"]');
  const point = await row.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + 20, y: rect.top + 20 };
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...point, id: 1 }],
  });
  await expect(row).toHaveAttribute("data-reordering", "true");
  const destination = page.locator('[data-order-entity="B"]');
  const pointB = await destination.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + 20, y: rect.top + 20 };
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...pointB, id: 1 }],
  });
  await expect(destination).toHaveAttribute("data-touch-drop", "BEFORE");
  await expect(page.getByLabel("Events")).not.toContainText("touch-move");
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.getByLabel("Events")).toHaveText("touch-move:A:B");
  await session.detach();
});

test("picker selection, child exploration and keyboard movement use separate actions", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Parent project", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Parent project", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Explore child projects", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Move row (Alt+Up/Down)", exact: true })
    .press("Alt+ArrowDown");
  await expect(page.getByLabel("Events")).toHaveText(
    "picker-select,explore,DOWN",
  );
});

test("searchable property picker handles keyboard, disabled choices and focus restoration", async ({
  page,
}) => {
  const trigger = page.getByRole("button", {
    name: "Choose property",
    exact: true,
  });
  await trigger.click();
  await expect(
    page.getByRole("option", { name: "Disabled choice" }),
  ).toBeDisabled();
  const input = page.getByRole("combobox");
  await input.fill("Beta");
  await input.press("Enter");
  await expect(trigger).toHaveText("Beta");
  await expect(trigger).toBeFocused();
  await expect(page.getByLabel("Events")).toHaveText("beta");
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("editor keeps actions visible while body scrolls and restores focus on close", async ({
  page,
}) => {
  const trigger = page.getByRole("button", {
    name: "Open editor",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: "Shared editor",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await page.locator(".ui-editor-body").evaluate((body) => {
    body.scrollTop = body.scrollHeight;
  });
  await expect(
    dialog.getByRole("button", { name: "Save", exact: true }),
  ).toBeInViewport();
  await expect(dialog.locator(".ui-button-primary")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByLabel("Events")).toHaveText("save");
});
