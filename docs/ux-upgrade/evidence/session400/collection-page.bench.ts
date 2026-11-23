import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { passwordHash } from "../../../../packages/host/src/password";
import { openPersonalVault } from "../../../../packages/host/src/personal-model";
import { createHost } from "../../../../packages/host/src/server";

test("move a full page of 60 collection members and reopen the canonical destination", async ({
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
    const folders = [randomUUID(), randomUUID(), randomUUID()];
    const mutate = async (path: string, data: unknown) => {
      const response = await request.post(origin + "/api/" + path, {
        headers: {
          Origin: origin,
          "X-CSRF-Token": csrf,
          "Idempotency-Key": randomUUID(),
        },
        data,
      });
      expect(response.status()).toBe(200);
      const value = await response.json();
      await response.dispose();
      return value;
    };
    for (const [i, id] of folders.entries())
      await mutate("organize", {
        kind: "FOLDER",
        action: "create",
        id,
        name: ["Survey", "Reviewed", "Backup"][i],
        parentId: "",
        scope: "GENERAL",
      });
    const space = await mutate("library/save", {
      id: null,
      version: 0,
      input: {
        kind: "SPACE",
        spaceId: null,
        title: "Synthetic atlas",
        bodyMd: "",
      },
    });
    const records: {
      kind: string;
      id: string;
      bodyMd: string;
      association: string;
    }[] = [];
    for (let i = 0; i < 60; i++) {
      const kind = i % 2 === 0 ? "NOTE" : "DOCUMENT",
        bodyMd = "Unchanged synthetic text " + i;
      const entity = await mutate(
        kind === "NOTE" ? "note/save" : "library/save",
        {
          id: null,
          version: 0,
          input: {
            kind,
            title: "Station " + String(i).padStart(2, "0"),
            bodyMd,
            ...(kind === "NOTE" ? { day: null } : { spaceId: space.id }),
          },
        },
      );
      const association = await mutate("folders/link", {
        folderId: folders[0],
        targetKind: kind,
        targetId: entity.id,
      });
      records.push({
        kind,
        id: entity.id,
        bodyMd,
        association: association.id,
      });
    }
    const other = await mutate("folders/link", {
      folderId: folders[2],
      targetKind: records[1].kind,
      targetId: records[1].id,
    });
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
    await page.goto(origin + "/#files");
    const browserView = page.locator(".files-resource-browser");
    const folder = browserView.getByRole("combobox", {
      name: "Collection folder",
      exact: true,
    });
    await folder.selectOption(folders[0]);
    await expect(browserView.locator(".files-resource-row")).toHaveCount(60);
    await browserView
      .getByRole("button", { name: "Select items", exact: true })
      .click();
    await browserView
      .getByRole("checkbox", { name: "Select this page" })
      .check();
    await browserView
      .getByRole("combobox", { name: "Destination collection", exact: true })
      .selectOption(folders[1]);
    await browserView
      .getByRole("button", { name: "Move to selected collection" })
      .click();
    const confirm = page.getByRole("dialog", { name: "Confirm action" });
    await expect(confirm).toContainText("Reviewed");
    // Optional recovery rehearsal: retain one committed response while the
    // owner revokes the browser, then verify all association IDs after recovery.
    const interrupt = process.env.ATLAS_BENCH_REVOKE_MOVE === "1";
    let markCommitted!: () => void, releaseReply!: () => void;
    const committed = new Promise<void>((resolve) => {
      markCommitted = resolve;
    });
    const held = new Promise<void>((resolve) => {
      releaseReply = resolve;
    });
    const moveRoute = /\/api\/(?:v1\/)?folders\/move(?:\?|$)/;
    if (interrupt) {
      await page.route(
        moveRoute,
        async (route) => {
          const upstream = await route.fetch();
          try {
            expect(upstream.status()).toBe(200);
            markCommitted();
            await held;
            await route.fulfill({ response: upstream }).catch(() => undefined);
          } finally {
            await upstream.dispose();
          }
        },
        { times: 1 },
      );
    }
    const start = performance.now();
    await confirm.getByRole("button", { name: "Confirm", exact: true }).click();
    let atRevocation: number | undefined;
    if (interrupt) {
      try {
        await committed;
        await mutate("account/sessions/revoke", { all: true });
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(
          page.getByRole("heading", { name: "Sign back in to your workspace" }),
        ).toBeVisible();
        await expect(browserView).toBeHidden();
      } finally {
        releaseReply();
        await page.unroute(moveRoute);
      }
      // Re-authenticate the independent auditor before reading canonical state.
      const loginReply = await request.post(origin + "/api/session", {
        headers: { Origin: origin },
        data: { username: "collectionreader", password: secret },
      });
      expect(loginReply.status()).toBe(200);
      await loginReply.dispose();
      const during = await snapshot();
      atRevocation = (during.folderLinks as Association[]).filter(
        (item) => item.folderId === folders[1] && !item.deletedAt,
      ).length;
      expect(atRevocation).toBe(1);
      const login = page.locator(".login-form");
      await login
        .locator("input[autocomplete=username]")
        .fill("collectionreader");
      await login.locator("input[type=password]").fill(secret);
      await login.locator("button[type=submit]").click();
      await expect(browserView).toBeVisible();
      const { waitForLocalReplay } = await import(
        "../../../../tests/e2e/replica-evidence"
      );
      await waitForLocalReplay(page);
      // Reopen the persisted replica after resolving the interrupted receipt.
      await page.reload();
      await expect(browserView).toBeVisible();
      // Previously enqueued work can replay. Explicitly finish only the rows
      // that still belong to the source collection on this device.
      await folder.selectOption(folders[0]);
      const remaining = browserView.locator(".files-resource-row");
      if (await remaining.count()) {
        const selectPage = browserView.getByRole("checkbox", {
          name: "Select this page",
        });
        if (!(await selectPage.isVisible()))
          await browserView
            .getByRole("button", { name: "Select items", exact: true })
            .click();
        await selectPage.check();
        await browserView
          .getByRole("combobox", {
            name: "Destination collection",
            exact: true,
          })
          .selectOption(folders[1]);
        await browserView
          .getByRole("button", { name: "Move to selected collection" })
          .click();
        await info.attach("recovery-selection", {
          body: await confirm.innerText(),
          contentType: "text/plain",
        });
        await confirm
          .getByRole("button", { name: "Confirm", exact: true })
          .click();
      }
    }
    await expect(browserView.locator(".files-resource-row")).toHaveCount(0, {
      timeout: interrupt ? 30000 : 120000,
    });
    const clearedMs = Math.round(performance.now() - start);
    await folder.selectOption(folders[1]);
    await expect(browserView.locator(".files-resource-row")).toHaveCount(60);
    const displayedMs = Math.round(performance.now() - start);
    type Association = {
      id: string;
      folderId: string;
      targetId: string;
      version: number;
      deletedAt: string | null;
    };
    async function snapshot() {
      const response = await request.get(origin + "/api/snapshot");
      expect(response.ok()).toBe(true);
      const value = await response.json();
      await response.dispose();
      return value;
    }
    await expect
      .poll(
        async () =>
          ((await snapshot()).folderLinks as Association[]).filter(
            (x) => x.folderId === folders[1] && !x.deletedAt,
          ).length,
        { timeout: 120000 },
      )
      .toBe(60);
    const canonicalMs = Math.round(performance.now() - start);
    const saved = await snapshot();
    expect(
      saved.folderLinks.filter(
        (x: Association) => x.folderId === folders[0] && !x.deletedAt,
      ),
    ).toHaveLength(0);
    for (const item of records) {
      expect(saved.folderLinks).toContainEqual(
        expect.objectContaining({
          id: item.association,
          folderId: folders[1],
          targetId: item.id,
          version: 2,
        }),
      );
      const row = (item.kind === "NOTE" ? saved.notes : saved.library).find(
        (x: { id: string }) => x.id === item.id,
      );
      expect(row).toMatchObject({
        bodyMd: item.bodyMd,
        version: 1,
        ...(item.kind === "DOCUMENT" ? { spaceId: space.id } : {}),
      });
    }
    expect(saved.folderLinks).toContainEqual(
      expect.objectContaining({
        id: other.id,
        folderId: folders[2],
        version: 1,
      }),
    );
    await page.reload();
    await folder.selectOption(folders[1]);
    await expect(browserView.locator(".files-resource-row")).toHaveCount(60);
    await page.screenshot({ path: info.outputPath("destination.png") });
    await writeFile(
      info.outputPath("result.json"),
      JSON.stringify(
        {
          browser: browser.version(),
          viewport: page.viewportSize(),
          notes: 30,
          documents: 30,
          clearedMs,
          displayedMs,
          canonicalMs,
          ...(interrupt
            ? {
                canonicalMovesWhileLocked: atRevocation,
                recoveredAfterReauth: true,
              }
            : {}),
          unchangedOriginals: 60,
          unchangedThirdMembership: 1,
          reopened: 60,
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
  } finally {
    const closing = host.close();
    host.server.closeAllConnections();
    await closing;
  }
});
