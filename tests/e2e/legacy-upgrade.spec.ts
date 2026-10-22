import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { passwordHash } from "../../packages/host/src/password";
import { createHost } from "../../packages/host/src/server";
import {
  migrate,
  migrations,
} from "../../packages/storage-sqlite/src/migrations";
import { work } from "../fixtures";
import { activeReplicaIdentity } from "./replica-evidence";

test("real pre-change-log v29 workspace upgrades with original projects, Markdown and chunked PNG", async ({
  page,
}, info) => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-legacy-upgrade-"));
  const database = join(directory, "old.sqlite");
  const password = randomBytes(24).toString("hex");
  const ws = "11111111-1111-4111-8111-111111111111",
    principal = "22222222-2222-4222-8222-222222222222";
  const old = new DatabaseSync(database);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXs8AAAAASUVORK5CYII=",
    "base64",
  );
  const markdown =
    "# Original research\r\n中文 $Z=0$\n\n![Original](/api/library/asset?id=historical-image)";
  const rows = [
    {
      ...work("historical-root", ws),
      type: "PROJECT",
      title: "Historical root",
      lifecycle: "PLANNED",
    },
    {
      ...work("historical-child", ws),
      type: "PROJECT",
      title: "Historical child",
      lifecycle: "PLANNED",
      parentProjectId: "historical-root",
    },
    {
      ...work("historical-task", ws),
      title: "Historical task",
      projectIds: ["historical-root"],
    },
    {
      ...work("historical-milestone", ws),
      type: "MILESTONE",
      title: "Historical milestone",
    },
  ].map((row) => ({ ...row, createdBy: principal, updatedBy: principal }));
  try {
    await migrate(old, database, 100, migrations.slice(0, 29));
    old
      .prepare("INSERT INTO workspace VALUES (?,?)")
      .run(ws, "Historical workspace");
    old
      .prepare("INSERT INTO principal VALUES (?,'USER',?)")
      .run(principal, "Historical owner");
    old
      .prepare("INSERT INTO workspace_principal VALUES (?,?)")
      .run(ws, principal);
    old
      .prepare("INSERT INTO account VALUES (?,?,?,?,?,'ADMIN','ACTIVE',1,?)")
      .run(
        "33333333-3333-4333-8333-333333333333",
        "upgrade-owner",
        await passwordHash(password),
        ws,
        principal,
        "2026-10-01T00:00:00Z",
      );
    const columns = old
      .prepare("PRAGMA table_info(work_item)")
      .all()
      .map((row) => String(row.name));
    for (const row of rows) {
      const values = columns.map(
        (column) =>
          Reflect.get(
            row,
            column.replace(/_([a-z])/g, (_all, letter) => letter.toUpperCase()),
          ) ?? null,
      ) as SQLInputValue[];
      old
        .prepare(
          `INSERT INTO work_item (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
        )
        .run(...values);
    }
    old
      .prepare("INSERT INTO task_project VALUES (?,?,?,0)")
      .run(ws, "historical-task", "historical-root");
    const note = {
      id: "historical-note",
      workspaceId: ws,
      title: "Historical scientific note",
      bodyMd: markdown,
      kind: "NOTE",
      day: null,
      version: 1,
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
      createdBy: principal,
      updatedBy: principal,
      deletedAt: null,
      classification: "PRIVATE",
      boundary: "REMOTE",
      aiAccess: "DENY",
      provenance: "HUMAN",
    };
    old
      .prepare("INSERT INTO notebook VALUES (?,?,1,'NOTE',NULL,NULL,?)")
      .run(ws, note.id, JSON.stringify(note));
    old
      .prepare("INSERT INTO library_asset VALUES (?,?,NULL,?,'image/png','')")
      .run(ws, "historical-image", "original.png");
    old
      .prepare(
        "INSERT INTO library_asset_upload VALUES (?,?,?,NULL,?,'image/png',2,1,?)",
      )
      .run(ws, "historical-image", principal, "original.png", Date.now());
    for (const [index, bytes] of [
      png.subarray(0, 24),
      png.subarray(24),
    ].entries())
      old
        .prepare("INSERT INTO library_asset_chunk VALUES (?,?,?,?)")
        .run(ws, "historical-image", index, bytes.toString("base64"));
  } finally {
    old.close();
  }
  const reserve = createServer();
  await new Promise<void>((done) => reserve.listen(0, "127.0.0.1", done));
  const port = (reserve.address() as AddressInfo).port;
  await new Promise<void>((done, reject) =>
    reserve.close((error) => (error ? reject(error) : done())),
  );
  const origin = `http://127.0.0.1:${port}`;
  const host = await createHost({
    database,
    secret: randomBytes(32).toString("hex"),
    origin,
    webRoot: resolve("apps/web/dist"),
  });
  try {
    await new Promise<void>((done) =>
      host.server.listen(port, "127.0.0.1", done),
    );
    await page.goto(origin + "/#account");
    const connection = page.getByRole("region", {
      name: /^(Account and workspace connection|连接账户与工作区)$/,
    });
    await connection.getByLabel(/^(Username|用户名)$/).fill("upgrade-owner");
    await connection.getByLabel(/^(Password|密码)$/).fill(password);
    await connection
      .getByRole("button", {
        name: /^(Sign in and review options|登录并查看选项)$/,
      })
      .click();
    await Promise.all([
      page.waitForEvent("load"),
      connection
        .getByRole("button", {
          name: /^(Open account workspace|打开账户工作区)$/,
        })
        .click(),
    ]);
    const identity = await activeReplicaIdentity(page);
    const databaseName = await page.evaluate(async () => {
      const read = <T>(request: IDBRequest<T>) =>
        new Promise<T>((done, reject) => {
          request.onsuccess = () => done(request.result);
          request.onerror = () => reject(request.error);
        });
      const catalog = await read(
        indexedDB.open("orivane-atlas.workspace-catalog"),
      );
      try {
        const tx = catalog.transaction(["state", "entries"], "readonly");
        const selected = await read(tx.objectStore("state").get("active"));
        return String(
          (await read(tx.objectStore("entries").get(selected))).databaseName,
        );
      } finally {
        catalog.close();
      }
    });
    const audit = async () =>
      page.evaluate(async (databaseName) => {
        const db = await new Promise<IDBDatabase>((done, reject) => {
          const r = indexedDB.open(databaseName);
          r.onsuccess = () => done(r.result);
          r.onerror = () => reject(r.error);
        });
        try {
          return await new Promise<{ id: string; version: number }[]>(
            (done, reject) => {
              const tx = db.transaction("entities", "readonly");
              const request = tx.objectStore("entities").getAll();
              tx.oncomplete = () =>
                done(
                  request.result
                    .filter((row) => row.collection === "items")
                    .map((row) => ({ id: row.id, version: row.version })),
                );
              tx.onabort = () => reject(tx.error);
            },
          );
        } finally {
          db.close();
        }
      }, databaseName);
    await expect
      .poll(audit)
      .toEqual(
        rows
          .map((row) => ({ id: row.id, version: row.version }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      );
    await page.goto(origin + "/#projects");
    await expect(
      page.locator(".project-card").filter({ hasText: "Historical root" }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("historical-projects-restored.png"),
      fullPage: true,
    });
    await page.goto(origin + "/#notes");
    await page
      .locator(".note-card")
      .filter({ hasText: "Historical scientific note" })
      .click();
    await page
      .getByRole("button", { name: /^(Read|阅读)$/, exact: true })
      .click();
    await expect(
      page.locator(".document-pane:visible .document-reading img"),
    ).toHaveJSProperty("naturalWidth", 1);
    await page.reload();
    await expect.poll(audit).toHaveLength(4);
    await info.attach("upgrade-identity-diff", {
      body: JSON.stringify(
        {
          identity,
          original: rows.map((row) => ({ id: row.id, version: row.version })),
          upgraded: await audit(),
          markdown,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  } finally {
    await new Promise<void>((done) => {
      host.server.close(() => done());
      host.server.closeAllConnections();
    });
    await host.db.close();
    if (
      !resolve(directory).startsWith(
        resolve(tmpdir()) + sep + "atlas-legacy-upgrade-",
      )
    )
      throw Error("UNSAFE_FIXTURE_CLEANUP");
    rmSync(directory, { recursive: true, force: true });
  }
});
