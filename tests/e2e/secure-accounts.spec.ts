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
      let selected: string | null = sessionStorage.getItem(
        "fixture-selected-account",
      );
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
        encoding: "utf8",
        body: JSON.stringify(value),
      });
      Object.assign(window, {
        isTauri: true,
        __TAURI_INTERNALS__: {
          invoke: async (
            command: string,
            args: { reference?: string; path?: string },
          ) => {
            if (command === "saved_accounts") return entries;
            if (
              command === "notification_permission" ||
              command === "notification_request_permission"
            )
              return "prompt";
            if (
              command === "notification_reconcile" ||
              command === "notification_cancel" ||
              command === "notification_take_route"
            )
              return;
            if (command === "configure_server") return;
            if (command === "select_account") {
              selected = args.reference ?? null;
              if (selected)
                sessionStorage.setItem("fixture-selected-account", selected);
              return reply(200, {});
            }
            if (command === "detach_account") {
              selected = null;
              sessionStorage.removeItem("fixture-selected-account");
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
              const note = {
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
                provenance: "HUMAN",
                classification: "PRIVATE",
                boundary: "REMOTE",
                aiAccess: "DENY",
              };
              if (args.path?.split("?")[0] === "/api/bootstrap") {
                const { bodyMd, ...metadata } = note;
                return reply(200, {
                  schemaVersion: 1,
                  cursor: 1,
                  epoch: "secure-account-fixture",
                  library: [],
                  workspace: {
                    items: [],
                    edges: [],
                    links: [],
                    organization: [],
                    categories: [],
                    workflows: [],
                    projectMaterials: [],
                    reminders: [],
                    calendarTimezone: "UTC",
                    calendarSettingsVersion: 1,
                  },
                  notes: [
                    {
                      ...metadata,
                      bodyState: "UNLOADED",
                      bodyCharacterCount: bodyMd.length,
                    },
                  ],
                });
              }
              if (args.path?.startsWith("/api/document/body"))
                return reply(200, note);
              if (
                args.path?.startsWith("/api/sync") ||
                args.path?.startsWith("/api/v1/sync")
              ) {
                const privateOnly =
                  new URL(
                    args.path,
                    "https://fixture.example",
                  ).searchParams.get("privateMemos") === "only";
                const after = Number(
                  new URL(
                    args.path,
                    "https://fixture.example",
                  ).searchParams.get("after") ?? 0,
                );
                const { bodyMd, ...metadata } = note;
                return reply(200, {
                  cursor: 1,
                  epoch: "secure-account-fixture",
                  snapshot: null,
                  recovery: false,
                  hasMore: false,
                  records:
                    !privateOnly && after < 1
                      ? [
                          {
                            seq: 1,
                            workspaceId: "workspace",
                            collection: "notes",
                            entityId: note.id,
                            op: "UPSERT",
                            version: 1,
                          },
                        ]
                      : [],
                  changes: {
                    collections:
                      !privateOnly && after < 1
                        ? {
                            notes: {
                              upserts: [
                                {
                                  ...metadata,
                                  bodyState: "UNLOADED",
                                  bodyCharacterCount: bodyMd.length,
                                },
                              ],
                              removed: [],
                            },
                          }
                        : {},
                    values: {},
                  },
                });
              }
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
    await page.goto("http://127.0.0.1:" + address.port + "/#account");
    await expect(
      page.getByRole("button", { name: "Research", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("secure-account-selector.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Research", exact: true }).click();
    const openReplica = async () => {
      await page
        .getByRole("button", { name: /^(Review sync options|查看同步选项)$/ })
        .click();
      await page
        .getByRole("button", {
          name: /^(Open account workspace|打开账户工作区)$/,
        })
        .click();
    };
    await openReplica();
    await expect(page.locator(".app-shell")).toBeVisible();
    await page.evaluate(() => {
      location.hash = "notes";
    });
    await expect(
      page.locator(".note-card").filter({ hasText: "Remote note" }),
    ).toBeVisible();
    await page.locator(".note-card").filter({ hasText: "Remote note" }).click();
    // A legacy remote-keyed draft must not automatically enter a new local replica.
    await expect(
      page.getByRole("tab", { name: /research private draft/ }),
    ).toHaveCount(0);
    await expect(page.locator(".document-title")).toHaveValue("Remote note");
    await expect(page.locator(".cm-content")).toHaveText("Remote body");
    await page.locator(".document-title").fill("research private draft");
    // CodeMirror owns selection; DOM contenteditable fill can insert before its
    // existing document. Exercise the same select-all/replace path as a user.
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText("research private body");
    await expect(page.locator(".cm-content")).toHaveText(
      "research private body",
    );
    await page.keyboard.press("Control+s");
    await expect(page.locator(".document-pane [role=status]")).toContainText(
      /Saved on this device|已保存到本机/,
    );
    await expect(
      page.getByRole("tab", { name: /research private draft/ }),
    ).toBeVisible();
    await page.evaluate(() => {
      location.hash = "account";
    });
    await page.getByRole("button", { name: "Personal", exact: true }).click();
    const confirmation = page.getByRole("dialog", {
      name: /^(确认操作|Confirm action)$/,
    });
    await expect(confirmation).toHaveCount(0);
    await openReplica();
    await expect(page.locator(".app-shell")).toBeVisible();
    await page.evaluate(() => {
      location.hash = "notes";
    });
    await page.locator(".note-card").filter({ hasText: "Remote note" }).click();
    await expect(page.locator(".document-title")).toHaveValue("Remote note");
    await expect(page.locator(".cm-content")).toHaveText("Remote body");
    await page.locator(".document-title").fill("personal private draft");
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.insertText("personal private body");
    await expect(page.locator(".cm-content")).toHaveText(
      "personal private body",
    );
    await page.keyboard.press("Control+s");
    await expect(page.locator(".document-pane [role=status]")).toContainText(
      /Saved on this device|已保存到本机/,
    );
    await expect(
      page.getByRole("tab", { name: /personal private draft/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: /research private draft/ }),
    ).toHaveCount(0);
    // Returning to a prior origin must recover its durable local edit without
    // importing the other origin's body, despite identical remote IDs.
    await page.evaluate(() => {
      location.hash = "account";
    });
    await page.getByRole("button", { name: "Research", exact: true }).click();
    await openReplica();
    await page.evaluate(() => {
      location.hash = "notes";
    });
    const research = page.locator(".note-card").filter({
      hasText: "research private draft",
    });
    await research.press("Enter");
    await expect(page.locator(".document-title")).toHaveValue(
      "research private draft",
    );
    await expect(page.locator(".cm-content")).toHaveText(
      "research private body",
    );
    await expect(
      page.getByRole("tab", { name: /personal private draft/ }),
    ).toHaveCount(0);
    await page.evaluate(() => {
      location.hash = "account";
    });
    await page.getByRole("button", { name: "Personal", exact: true }).click();
    await openReplica();
    await page.evaluate(() => {
      location.hash = "account";
    });
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
