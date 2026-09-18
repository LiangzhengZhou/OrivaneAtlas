import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("native secure account selector switches without password and forgets locally", async ({
  page,
}, info) => {
  const root = resolve("apps/web/dist");
  const host = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const file = resolve(
      root,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    if (!file.startsWith(root)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const bytes = await readFile(file);
      response.setHeader(
        "Content-Type",
        (
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".png": "image/png",
          } as Record<string, string>
        )[extname(file)] ?? "application/octet-stream",
      );
      response.end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => host.listen(0, "127.0.0.1", done));
  const address = host.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  try {
    await page.addInitScript(() => {
      let selected: string | null = null;
      let entries = ["Research", "Personal"].map((name) => ({
        id: "https://" + name.toLowerCase() + ".example|same-account",
        serverUrl: "https://" + name.toLowerCase() + ".example",
        userId: "same-account",
        displayName: name,
        credentialReference: "reference-" + name,
      }));
      const reply = (status: number, value: unknown) => ({
        status,
        contentType: "application/json",
        body: btoa(JSON.stringify(value)),
      });
      Object.assign(window, {
        isTauri: true,
        __TAURI_INTERNALS__: {
          invoke: async (
            command: string,
            args: { reference?: string; path?: string },
          ) => {
            if (command === "saved_accounts") return entries;
            if (command === "configure_server") return;
            if (command === "select_account") {
              selected = args.reference ?? null;
              return reply(200, {});
            }
            if (command === "detach_account") {
              selected = null;
              return;
            }
            if (command === "forget_account") {
              entries = entries.filter(
                (entry) => entry.credentialReference !== args.reference,
              );
              return;
            }
            if (command === "server_request") {
              const entry = entries.find(
                (item) => item.credentialReference === selected,
              );
              if (!entry) return reply(401, { error: "UNAUTHORIZED" });
              if (args.path === "/api/session")
                return reply(200, {
                  context: {
                    workspaceId: "workspace",
                    principalId: "same-account",
                  },
                  csrf: "csrf-" + selected,
                  account: {
                    id: "same-account",
                    username: entry.displayName,
                    role: "MEMBER",
                  },
                });
              if (args.path?.startsWith("/api/sync"))
                return reply(200, {
                  cursor: "cursor",
                  snapshot: {
                    items: [],
                    edges: [],
                    notes: [
                      {
                        id: "shared-note",
                        workspaceId: "workspace",
                        kind: "NOTE",
                        title: "Remote note",
                        bodyMd: "Remote body",
                        version: 1,
                        day: null,
                        createdAt: "2026-09-18T00:00:00Z",
                        updatedAt: "2026-09-18T00:00:00Z",
                        createdBy: "same-account",
                        updatedBy: "same-account",
                        deletedAt: null,
                      },
                    ],
                    library: [],
                    links: [],
                    organization: [],
                    categories: [],
                    workflows: [],
                    projectMaterials: [],
                  },
                });
              if (args.path === "/api/logout")
                throw new Error("Switch must never logout");
              if (args.path === "/api/note/save")
                return reply(503, { error: "UNAVAILABLE" });
              return reply(200, []);
            }
            throw new Error("Unexpected IPC");
          },
        },
      });
    });
    await page.goto("http://127.0.0.1:" + address.port);
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("orivane-atlas-local", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("drafts");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("drafts", "readwrite");
          for (const name of ["research", "personal"]) {
            transaction.objectStore("drafts").put(
              {
                title: name + " private draft",
                body: name + " private body",
                updatedAt: Date.now(),
              },
              JSON.stringify([
                "https://" + name + ".example",
                "workspace",
                "same-account",
                "shared-note",
              ]),
            );
          }
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    });
    await expect(
      page.getByRole("button", { name: "Research", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("secure-account-selector.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Research", exact: true }).click();
    await expect(page.locator(".app-shell")).toBeVisible();
    await page.evaluate(() => {
      location.hash = "notes";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await page.locator(".note-card").filter({ hasText: "Remote note" }).click();
    await expect(
      page.getByRole("tab", { name: /research private draft/ }),
    ).toBeVisible();
    await page.evaluate(() => {
      location.hash = "account";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    const switcher = page.getByRole("button", {
      name: /^(Switch account|切换账户)$/,
    });
    page.once("dialog", (dialog) => dialog.accept());
    await switcher.click();
    await expect(page.locator(".login-form")).toBeVisible();
    await page.getByRole("button", { name: "Personal", exact: true }).click();
    await expect(page.locator(".app-shell")).toBeVisible();
    await page.evaluate(() => {
      location.hash = "notes";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await page.locator(".note-card").filter({ hasText: "Remote note" }).click();
    await expect(
      page.getByRole("tab", { name: /personal private draft/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: /research private draft/ }),
    ).toHaveCount(0);
    await page.evaluate(() => {
      location.hash = "account";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    page.once("dialog", (dialog) => dialog.accept());
    await switcher.click();
    await page
      .getByRole("button", { name: /^(Forget account|忘记账户) Research$/ })
      .click();
    await expect(
      page.getByRole("button", { name: "Research", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Personal", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    host.closeAllConnections();
    await new Promise<void>((done, reject) =>
      host.close((error) => (error ? reject(error) : done())),
    );
  }
});
