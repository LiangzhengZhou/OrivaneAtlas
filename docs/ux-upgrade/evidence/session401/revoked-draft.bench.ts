import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { passwordHash } from "../../../../packages/host/src/password";
import { openPersonalVault } from "../../../../packages/host/src/personal-model";
import { createHost } from "../../../../packages/host/src/server";

test("restore the untouched task draft after the workspace owner signs in again", async ({
  page,
  browser,
  request,
}, info) => {
  test.setTimeout(300000);
  const dist = process.env.ATLAS_UI_FIXTURE_DIST;
  if (!dist)
    throw Error("Set ATLAS_UI_FIXTURE_DIST to the Web build to measure");
  await mkdir(info.outputDir, { recursive: true });
  const probe = createServer();
  await new Promise<void>((ok) => probe.listen(0, "127.0.0.1", ok));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((ok) => probe.close(() => ok()));
  const origin = "http://127.0.0.1:" + port,
    secret = randomBytes(24).toString("hex");
  const host = await createHost({
    origin,
    secret,
    database: info.outputPath("synthetic.sqlite"),
    vault: openPersonalVault(info.outputPath("fixture-vault")),
    webRoot: resolve(dist),
  });
  try {
    const verifier = await passwordHash(secret);
    await host.db.accounts((store) =>
      store.register("collectionreader", verifier, true),
    );
    await new Promise<void>((ok) => host.server.listen(port, "127.0.0.1", ok));
    const session = await request.post(origin + "/api/session", {
      headers: { Origin: origin },
      data: { username: "collectionreader", password: secret },
    });
    expect(session.status()).toBe(200);
    const { csrf } = await session.json();
    const saved = await request.post(origin + "/api/work/create", {
      headers: {
        Origin: origin,
        "X-CSRF-Token": csrf,
        "Idempotency-Key": randomUUID(),
      },
      data: { title: "Field review" },
    });
    expect(saved.status()).toBe(200);
    await page.goto(origin + "/#account");
    const connection = page.getByRole("region", {
      name: "Account and workspace connection",
    });
    await connection
      .getByLabel("Username", { exact: true })
      .fill("collectionreader");
    await connection.getByLabel("Password", { exact: true }).fill(secret);
    await connection
      .getByRole("button", { name: "Sign in and review options" })
      .click();
    await connection
      .getByRole("button", { name: "Open account workspace" })
      .click({ timeout: 120000 });
    await expect(
      page
        .getByRole("navigation", { name: "Device workspaces" })
        .locator('[aria-current="page"]'),
    ).toContainText("Account workspace", { timeout: 30000 });
    await page.goto(origin + "/#tasks");
    await page
      .locator(".task-card .task-title")
      .filter({ hasText: "Field review" })
      .press("Enter");
    const title = page.getByRole("dialog").getByLabel("Title", { exact: true });
    await title.fill("Unsubmitted field correction");
    const revoked = await request.post(
      origin + "/api/account/sessions/revoke",
      {
        headers: {
          Origin: origin,
          "X-CSRF-Token": csrf,
          "Idempotency-Key": randomUUID(),
        },
        data: { all: true },
      },
    );
    expect(revoked.status()).toBe(200);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByRole("heading", { name: "Sign back in to your workspace" }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".app-shell:visible")).toHaveCount(0);
    const form = page.locator(".login-form");
    await form.locator("input[autocomplete=username]").fill("collectionreader");
    await form.locator("input[type=password]").fill(secret);
    await form.locator("button[type=submit]").click();
    await expect(title).toHaveValue("Unsubmitted field correction");
    // The lock did not send the unsaved task to the Host.
    const snapshot = await page.request.get(origin + "/api/snapshot");
    expect(snapshot.status()).toBe(200);
    const items = (await snapshot.json()).items as { title: string }[];
    expect(items.some((item) => item.title === "Field review")).toBe(true);
    expect(
      items.some((item) => item.title === "Unsubmitted field correction"),
    ).toBe(false);
    await writeFile(
      info.outputPath("result.json"),
      JSON.stringify(
        {
          browser: browser.version(),
          hiddenWhileRevoked: true,
          draftRestored: true,
          serverTitleUnchanged: true,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    const closing = host.close();
    host.server.closeAllConnections();
    await closing;
  }
});
