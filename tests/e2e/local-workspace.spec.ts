import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import type * as localApi from "../../apps/web/test-fixtures/local-storage";
import type { LocalWrite } from "../../packages/application/src/local-persistence";
import type { LibraryFile } from "../../packages/domain/src/library-file";
import type { IndexedDbLocalStore } from "../../packages/storage-local/src/indexed-db";

test("Markdown File references open the original File tab and restore their route offline", async ({
  page,
  context,
}, info) => {
  const requests: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await productionAssets(page, requests);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const zh = info.project.name !== "desktop-en";
  await page.goto(productionOrigin + "/#library");
  await page
    .getByLabel(zh ? "上传文件" : "Upload file", { exact: true })
    .setInputFiles({
      name: "reference-original.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("unaltered original bytes"),
    });
  const detail = page.getByRole("region", {
    name: "reference-original.txt",
    exact: true,
  });
  await expect(detail.locator(".file-text-preview")).toHaveText(
    "unaltered original bytes",
  );
  await detail
    .getByRole("button", {
      name: zh ? "复制引用" : "Copy reference",
      exact: true,
    })
    .click();
  const reference = await page.evaluate(() => navigator.clipboard.readText());
  expect(reference).toMatch(
    /^\[reference-original\.txt\]\(#library\?file=[0-9a-f-]{36}\)$/,
  );
  await detail
    .getByRole("button", { name: zh ? "关闭文件" : "Close file", exact: true })
    .click();
  await page.addScriptTag({
    content: await readFile(
      `.artifacts/local-storage-fixture-${3000 + info.workerIndex}/storage.js`,
      "utf8",
    ),
  });
  await page.evaluate(async (bodyMd) => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: typeof localApi }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalStore.open(
        "orivane-atlas.local-workspace",
      ),
      blobs = await api.IndexedDbLocalBlobStore.open(
        "orivane-atlas.local-workspace",
      );
    try {
      const owner = await db.identity.get();
      if (!owner) throw new Error("MISSING_LOCAL_OWNER");
      const runtime = new api.LocalRuntime(
        new api.LocalWorkspace(
          db.metadata,
          blobs,
          owner,
          {
            extract: (id, body) => api.indexDocument(id, body, []),
            resolve: (links) => [...links],
          },
          { now: () => new Date().toISOString() },
          { next: () => crypto.randomUUID() },
        ),
      );
      const space = await runtime.saveLibrary(null, 0, {
        kind: "SPACE",
        spaceId: null,
        title: "Reference knowledge",
        bodyMd: "",
      });
      await runtime.saveLibrary(null, 0, {
        kind: "DOCUMENT",
        spaceId: space.id,
        title: "Original reference document",
        bodyMd,
      });
    } finally {
      db.close();
      blobs.close();
    }
  }, reference);
  await page.reload();
  await page.locator(".space-card", { hasText: "Reference knowledge" }).click();
  await page
    .locator(".library-document-row", {
      hasText: "Original reference document",
    })
    .click();
  await page
    .locator(".document-pane")
    .getByRole("group", {
      name: zh ? "文档视图" : "Document view",
      exact: true,
    })
    .getByRole("button", { name: zh ? "阅读" : "Read", exact: true })
    .click();
  const link = page
    .locator(".document-reading")
    .getByRole("link", { name: "reference-original.txt", exact: true });
  await expect(link).not.toHaveAttribute("target", "_blank");
  await link.click();
  await expect(detail.locator(".file-text-preview")).toHaveText(
    "unaltered original bytes",
  );
  await expect(
    page.getByRole("tab", { name: "Original reference document", exact: true }),
  ).toBeVisible();
  const route = await page.evaluate(() => location.hash);
  expect(route).toMatch(/^#library\?file=[0-9a-f-]{36}$/);
  await page.reload();
  await expect(detail.locator(".file-text-preview")).toHaveText(
    "unaltered original bytes",
  );
  expect(await page.evaluate(() => location.hash)).toBe(route);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test("File workspace tabs preserve drafts and mount only the active File", async ({
  page,
}, info) => {
  const requests: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await productionAssets(page, requests);
  const zh = info.project.name !== "desktop-en";
  await page.goto(productionOrigin + "/#library");
  const upload = async (name: string) =>
    page
      .getByLabel(zh ? "上传文件" : "Upload file", { exact: true })
      .setInputFiles({
        name,
        mimeType: "text/plain",
        buffer: Buffer.from(name + " original"),
      });
  await upload("first-tab.txt");
  const first = page.getByRole("region", {
    name: "first-tab.txt",
    exact: true,
  });
  await expect(first.locator(".file-text-preview")).toHaveText(
    "first-tab.txt original",
  );
  await first
    .getByLabel(zh ? "文件名称" : "File name", { exact: true })
    .fill("unsaved-first.txt");
  await page
    .locator(".document-tabs")
    .getByRole("button", { name: zh ? "工作台" : "Workspace", exact: true })
    .click();
  await expect(page.locator(".file-detail")).toHaveCount(0);
  await upload("second-tab.txt");
  await expect(
    page.getByRole("region", { name: "second-tab.txt", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".file-detail")).toHaveCount(1);
  await page.getByRole("tab", { name: "● first-tab.txt", exact: true }).click();
  await expect(
    first.getByLabel(zh ? "文件名称" : "File name", { exact: true }),
  ).toHaveValue("unsaved-first.txt");
  await expect(page.locator(".file-detail")).toHaveCount(1);
  const close = page.locator(".document-tabs").getByRole("button", {
    name: (zh ? "关闭 " : "Close ") + "first-tab.txt",
    exact: true,
  });
  await close.click();
  const confirmation = page.getByRole("dialog", {
    name: zh ? "确认操作" : "Confirm action",
    exact: true,
  });
  await confirmation
    .getByRole("button", { name: zh ? "取消" : "Cancel", exact: true })
    .click();
  await expect(first).toBeVisible();
  await close.click();
  await confirmation
    .getByRole("button", { name: zh ? "确认" : "Confirm", exact: true })
    .click();
  await expect(first).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "second-tab.txt", exact: true }),
  ).toBeVisible();
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test("File Atlas opens an independent nonmodal float without sending private content", async ({
  page,
}, info) => {
  const requests: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await productionAssets(page, requests);
  const zh = info.project.name !== "desktop-en";
  await page.goto(productionOrigin + "/#library");
  await page
    .getByLabel(zh ? "上传文件" : "Upload file", { exact: true })
    .setInputFiles({
      name: "atlas-original.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("private canonical content"),
    });
  const detail = page.getByRole("region", {
    name: "atlas-original.txt",
    exact: true,
  });
  await expect(detail.locator(".file-text-preview")).toHaveText(
    "private canonical content",
  );
  await detail
    .getByRole("button", { name: zh ? "询问 Atlas" : "Ask Atlas", exact: true })
    .click();
  const floating = page.getByRole("dialog", {
    name: zh ? "文件 Atlas" : "File Atlas",
    exact: true,
  });
  await expect(floating).toBeVisible();
  await expect(
    floating.getByRole("button", {
      name: zh ? "准备请求" : "Prepare request",
      exact: true,
    }),
  ).toBeDisabled();
  await floating.getByRole("textbox").fill("A local question draft");
  await detail
    .getByRole("heading", { name: "atlas-original.txt", exact: true })
    .click();
  await expect(floating).toBeVisible();
  await expect(floating.getByRole("textbox")).toHaveValue(
    "A local question draft",
  );
  const before = await floating.boundingBox();
  await floating
    .getByRole("button", {
      name: zh
        ? "移动 Atlas（方向键可用）"
        : "Move Atlas (arrow keys available)",
      exact: true,
    })
    .focus();
  await page.keyboard.press("ArrowUp");
  const moved = await floating.boundingBox();
  expect(moved!.y).toBeLessThan(before!.y);
  await floating
    .getByRole("button", {
      name: zh ? "将 Atlas 靠右" : "Dock Atlas to the right",
      exact: true,
    })
    .click();
  const bounds = await floating.boundingBox(),
    viewport = page.viewportSize()!;
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
  await mkdir(info.outputDir, { recursive: true });
  await page.screenshot({
    path: info.outputPath("file-atlas.png"),
    fullPage: true,
  });
  await floating.getByRole("textbox").focus();
  await page.keyboard.press("Escape");
  await expect(floating).toHaveCount(0);
  await expect(detail).toBeVisible();
  await page
    .getByRole("tablist")
    .getByRole("button", {
      name: zh ? "工作台" : "Workspace",
      exact: true,
    })
    .click();
  await expect(detail).toHaveCount(0);
  await page
    .getByRole("tab", { name: "atlas-original.txt", exact: true })
    .click();
  await detail
    .getByRole("button", { name: zh ? "询问 Atlas" : "Ask Atlas", exact: true })
    .click();
  await expect(floating.getByRole("textbox")).toHaveValue(
    "A local question draft",
  );
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test("File content permissions require confirmation and survive local restart without sending content", async ({
  page,
}, info) => {
  const requests: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await productionAssets(page, requests);
  const zh = info.project.name !== "desktop-en";
  await page.goto(productionOrigin + "/#library");
  await page
    .getByLabel(zh ? "上传文件" : "Upload file", { exact: true })
    .setInputFiles({
      name: "private-policy.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("original private bytes"),
    });
  const detail = page.getByRole("region", {
    name: "private-policy.txt",
    exact: true,
  });
  await expect(detail.locator(".file-text-preview")).toHaveText(
    "original private bytes",
  );
  await detail.locator(".content-policy > summary").click();
  await detail
    .getByLabel(zh ? "AI 访问" : "AI access", { exact: true })
    .selectOption("ASK");
  await detail
    .getByRole("button", {
      name: zh ? "保存内容权限" : "Save content permissions",
      exact: true,
    })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: zh ? "确认操作" : "Confirm action",
    exact: true,
  });
  await expect(confirmation).toContainText(
    zh ? "不会向 Atlas 发送内容" : "does not send content to Atlas",
  );
  await confirmation
    .getByRole("button", { name: zh ? "取消" : "Cancel", exact: true })
    .click();
  await expect(
    detail.getByRole("button", {
      name: zh ? "保存内容权限" : "Save content permissions",
      exact: true,
    }),
  ).toBeVisible();
  await detail
    .getByRole("button", {
      name: zh ? "保存内容权限" : "Save content permissions",
      exact: true,
    })
    .click();
  await confirmation
    .getByRole("button", { name: zh ? "确认" : "Confirm", exact: true })
    .click();
  await expect(
    detail.getByRole("button", {
      name: zh ? "保存内容权限" : "Save content permissions",
      exact: true,
    }),
  ).toHaveCount(0);
  await detail
    .getByRole("button", { name: zh ? "关闭文件" : "Close file", exact: true })
    .click();
  await page.reload();
  await page
    .locator(".library-file-row", { hasText: "private-policy.txt" })
    .click();
  await detail.locator(".content-policy > summary").click();
  await expect(
    detail.getByLabel(zh ? "AI 访问" : "AI access", { exact: true }),
  ).toHaveValue("ASK");
  await expect(
    detail.getByLabel(zh ? "处理位置" : "Processing boundary", { exact: true }),
  ).toHaveValue("LOCAL_ONLY");
  await expect(detail.locator(".file-text-preview")).toHaveText(
    "original private bytes",
  );
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test("restart processes a local original into searchable chunks without opening File Detail", async ({
  page,
}, info) => {
  const apiRequests: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await productionAssets(page, apiRequests);
  const zh = info.project.name !== "desktop-en";
  await page.goto(productionOrigin + "/#library");
  await expect(
    page.getByLabel(zh ? "上传文件" : "Upload file", { exact: true }),
  ).toBeAttached();
  const fixture = await readFile(
    ".artifacts/local-storage-fixture-" +
      (3000 + info.workerIndex) +
      "/storage.js",
    "utf8",
  );
  await page.addScriptTag({ content: fixture });
  const created = await page.evaluate(async () => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: typeof localApi }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalStore.open(
      "orivane-atlas.local-workspace",
    );
    const blobs = await api.IndexedDbLocalBlobStore.open(
      "orivane-atlas.local-workspace",
    );
    try {
      const owner = await db.identity.get();
      if (!owner) throw new Error("MISSING_LOCAL_OWNER");
      const runtime = new api.LocalRuntime(
        new api.LocalWorkspace(
          db.metadata,
          blobs,
          owner,
          {
            extract: (id, markdown) => api.indexDocument(id, markdown, []),
            resolve: (links) => [...links],
          },
          { now: () => new Date().toISOString() },
          { next: () => crypto.randomUUID() },
        ),
      );
      const file = await runtime.uploadFile(
        { name: "background-original.txt", mime: "text/plain", spaceId: null },
        new Blob(["restartonlysearchtoken original bytes"]),
      );
      await db.metadata.fileProcessing!.claim(
        owner,
        file,
        "terminated-window",
        new Date(Date.now() - 59000).toISOString(),
        false,
      );
      return {
        id: file.id,
        workspaceId: owner.workspaceId,
        hash: file.contentHash,
      };
    } finally {
      db.close();
      blobs.close();
    }
  });
  await page.reload();
  const state = () =>
    page.evaluate(async ({ id, workspaceId }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("orivane-atlas.local-workspace");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<{
          state?: string;
          leaseId?: string;
          contentHash?: string;
        } | null>((resolve, reject) => {
          const tx = db.transaction("entities", "readonly");
          const request = tx
            .objectStore("entities")
            .get([workspaceId, "$local.fileProcessing", id]);
          tx.oncomplete = () => resolve(request.result?.value ?? null);
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    }, created);
  await expect.poll(async () => (await state())?.state).toBe("READY");
  const firstLease = (await state())?.leaseId;
  await page.evaluate(async ({ id, workspaceId }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("orivane-atlas.local-workspace");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("entities", "readwrite");
        tx.objectStore("entities").delete([
          workspaceId,
          "$local.fileExtractions",
          id,
        ]);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, created);
  await page.reload();
  await expect.poll(async () => (await state())?.leaseId).not.toBe(firstLease);
  await expect.poll(async () => (await state())?.state).toBe("READY");
  expect(await state()).toMatchObject({ contentHash: created.hash });
  expect((await state())?.leaseId).not.toBe("terminated-window");
  await expect(
    page.getByRole("region", { name: "background-original.txt", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel(zh ? "搜索" : "Search", { exact: true })
    .fill("restartonlysearchtoken");
  await expect(page.locator(".library-file-row")).toHaveCount(1);
  await expect(page.locator(".library-file-row")).toContainText(
    "background-original.txt",
  );
  await page.evaluate(async ({ id, workspaceId }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("orivane-atlas.local-workspace");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("entities", "readwrite"),
          entities = tx.objectStore("entities");
        const request: IDBRequest<{
          value: { chunks: Record<string, unknown>[] };
          [key: string]: unknown;
        }> = entities.get([workspaceId, "$local.fileExtractions", id]);
        request.onsuccess = () => {
          const record = request.result;
          entities.put({
            ...record,
            value: {
              ...record.value,
              chunks: record.value.chunks.map((chunk, i) =>
                i === 0 ? { ...chunk, text: 17 } : chunk,
              ),
            },
          });
        };
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, created);
  await page
    .locator(".library-file-row", { hasText: "background-original.txt" })
    .click();
  await expect(
    page
      .getByRole("region", { name: "background-original.txt", exact: true })
      .locator(".file-text-preview"),
  ).toHaveText("restartonlysearchtoken original bytes");
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

let assetServer: Server;
let productionOrigin: string;

test("malformed File processing exposes retry and preserves the downloadable original across restart", async ({
  page,
}, info) => {
  const apiRequests: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await productionAssets(page, apiRequests);
  const zh = info.project.name !== "desktop-en";
  await page.goto(productionOrigin + "/#library");
  const original = Buffer.from("{malformed original JSON}");
  await page
    .getByLabel(zh ? "上传文件" : "Upload file", { exact: true })
    .setInputFiles({
      name: "malformed-original.json",
      mimeType: "application/json",
      buffer: original,
    });
  const detail = page.getByRole("region", {
    name: "malformed-original.json",
    exact: true,
  });
  await expect(detail.getByRole("alert").locator("p")).toHaveText(
    zh
      ? "无法完成文件操作，请重试。"
      : "The file operation failed. Please try again.",
  );
  const retry = detail.getByRole("button", {
    name: zh ? "重试处理" : "Retry processing",
    exact: true,
  });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(retry).toBeEnabled();
  const downloaded = page.waitForEvent("download");
  await detail
    .getByRole("button", {
      name: zh ? "下载原始文件" : "Download original",
      exact: true,
    })
    .click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("malformed-original.json");
  const path = await download.path();
  if (!path) throw new Error("MISSING_ORIGINAL_DOWNLOAD");
  expect(await readFile(path)).toEqual(original);
  await detail
    .getByRole("button", { name: zh ? "关闭文件" : "Close file", exact: true })
    .click();
  await page.reload();
  await page
    .locator(".library-file-row")
    .filter({ hasText: "malformed-original.json" })
    .click();
  await expect(
    page.getByRole("button", {
      name: zh ? "重试处理" : "Retry processing",
      exact: true,
    }),
  ).toBeEnabled();
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test.beforeAll(async ({}, info) => {
  assetServer = createServer((request, response) => {
    void serveAsset(request.url ?? "/", response);
  });
  await new Promise<void>((resolve) =>
    assetServer.listen(0, "127.0.0.1", resolve),
  );
  const address = assetServer.address();
  if (!address || typeof address === "string")
    throw new Error("MISSING_ASSET_PORT");
  productionOrigin = `http://127.0.0.1:${address.port}`;
  await promisify(execFile)(
    process.execPath,
    [
      "scripts/build-local-storage-fixture.mjs",
      String(3000 + info.workerIndex),
    ],
    { timeout: 30000 },
  );
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    assetServer.close((error) => (error ? reject(error) : resolve())),
  );
});

test("production bootstrap opens and edits a durable local workspace while all server APIs are unavailable", async ({
  page,
}, info) => {
  const apiRequests: string[] = [],
    pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await productionAssets(page, apiRequests);
  const zh = info.project.name !== "desktop-en";
  await page.goto(`${productionOrigin}/#tasks`);
  await expect(page.locator(".tasks-workspace")).toBeVisible();
  await expect(
    page.getByLabel(zh ? "用户名" : "Username", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: zh ? "新建任务" : "New task", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel(zh ? "标题" : "Title", { exact: true })
    .fill("Durable offline UI task");
  await dialog
    .getByRole("button", { name: zh ? "新建任务" : "Create task", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator(".task-title", { hasText: "Durable offline UI task" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.locator(".task-title", { hasText: "Durable offline UI task" }),
  ).toBeVisible();
  await page.goto(`${productionOrigin}/#library`);
  const original = Buffer.from("原始文件\nSecond line\n", "utf8");
  await page
    .getByLabel(zh ? "上传文件" : "Upload file", { exact: true })
    .setInputFiles({
      name: "original.txt",
      mimeType: "text/plain",
      buffer: original,
    });
  const fileDetail = page.getByRole("region", {
    name: "original.txt",
    exact: true,
  });
  await expect(fileDetail).toBeVisible();
  await expect(fileDetail.locator(".file-text-preview")).toHaveText(
    "原始文件\nSecond line\n",
  );
  await fileDetail
    .getByLabel(zh ? "文件名称" : "File name", { exact: true })
    .fill("renamed.txt");
  await fileDetail
    .getByRole("button", { name: zh ? "保存名称" : "Save name", exact: true })
    .click();
  const renamedDetail = page.getByRole("region", {
    name: "renamed.txt",
    exact: true,
  });
  await expect(renamedDetail).toBeVisible();
  await expect(renamedDetail.locator(".file-text-preview")).toHaveText(
    "原始文件\nSecond line\n",
  );
  await mkdir(info.outputDir, { recursive: true });
  await page.screenshot({
    path: info.outputPath("files.png"),
  });
  const originalDownload = page.waitForEvent("download");
  await renamedDetail
    .getByRole("button", {
      name: zh ? "下载原始文件" : "Download original",
      exact: true,
    })
    .click();
  const originalResult = await originalDownload;
  expect(originalResult.suggestedFilename()).toBe("original.txt");
  const originalPath = await originalResult.path();
  if (!originalPath) throw new Error("MISSING_ORIGINAL_DOWNLOAD");
  expect(await readFile(originalPath)).toEqual(original);
  await renamedDetail
    .getByRole("button", { name: zh ? "关闭文件" : "Close file", exact: true })
    .click();
  await page.reload();
  const contentType = page.getByRole("group", {
    name: zh ? "内容类型" : "Content type",
    exact: true,
  });
  await contentType
    .getByRole("button", { name: zh ? "文档" : "Documents", exact: true })
    .click();
  await expect(page.locator(".library-file-row")).toHaveCount(0);
  await contentType
    .getByRole("button", { name: zh ? "文件" : "Files", exact: true })
    .click();
  const fileType = page.getByLabel(zh ? "文件类型" : "File type", {
    exact: true,
  });
  await fileType.selectOption("PDF");
  await expect(page.locator(".library-file-row")).toHaveCount(0);
  await fileType.selectOption("OTHER");
  await expect(page.locator(".library-file-row")).toHaveCount(1);
  await fileType.selectOption("ALL");
  const librarySearch = page.getByLabel(zh ? "搜索" : "Search", {
    exact: true,
  });
  await librarySearch.fill("Second line");
  await expect(page.locator(".library-file-row")).toHaveCount(1);
  await expect(page.locator(".library-file-row")).toContainText("renamed.txt");
  await librarySearch.fill("missing-file");
  await expect(page.locator(".library-file-row")).toHaveCount(0);
  await librarySearch.fill("renamed");
  await expect(page.locator(".library-file-row")).toHaveCount(1);
  await librarySearch.fill("");
  await page.locator(".library-file-row", { hasText: "renamed.txt" }).click();
  await expect(
    page.getByRole("region", { name: "renamed.txt", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: zh ? "更多操作：renamed.txt" : "More actions: renamed.txt",
      exact: true,
    })
    .last()
    .click();
  await page
    .getByRole("menuitem", {
      name: zh ? "移至回收站" : "Move to Trash",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: zh ? "撤销" : "Undo", exact: true })
    .click();
  await expect(
    page.locator(".library-file-row", { hasText: "renamed.txt" }),
  ).toBeVisible();
  await page
    .locator(".library-file-row", { hasText: "renamed.txt" })
    .getByRole("button", {
      name: zh ? "更多操作：renamed.txt" : "More actions: renamed.txt",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", {
      name: zh ? "移至回收站" : "Move to Trash",
      exact: true,
    })
    .click();
  await expect(
    page.locator(".library-file-row", { hasText: "renamed.txt" }),
  ).toHaveCount(0);
  await page.goto(`${productionOrigin}/#trash?filter=library`);
  const trashRow = page.locator(".trash-list > div", {
    hasText: "renamed.txt",
  });
  await expect(trashRow).toBeVisible();
  await trashRow
    .getByRole("button", { name: zh ? "恢复" : "Restore", exact: true })
    .click();
  await expect(trashRow).toHaveCount(0);
  await page.goto(`${productionOrigin}/#settings`);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: zh ? "备份本地工作区" : "Back up local workspace",
      exact: true,
    })
    .click();
  const result = await download;
  expect(result.suggestedFilename()).toMatch(/\.oab$/);
  const backupPath = await result.path();
  if (!backupPath) throw new Error("MISSING_LOCAL_BACKUP_DOWNLOAD");
  const bytes = await readFile(backupPath);
  expect(bytes.subarray(0, 8).toString()).toBe("ORIVANE1");
  const length = bytes.readUInt32BE(8);
  const manifest = JSON.parse(bytes.subarray(16, 16 + length).toString());
  expect(manifest.credentialVault).toBe("EXCLUDED");
  expect(manifest.archive.entities).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        collection: "items",
        value: expect.objectContaining({ title: "Durable offline UI task" }),
      }),
    ]),
  );
  const fixture = await readFile(
    `.artifacts/local-storage-fixture-${3000 + info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.addScriptTag({ content: fixture });
  await page.evaluate(async () => {
    const api = (
      window as unknown as {
        OrivaneLocalStorageFixture: {
          IndexedDbLocalStore: typeof IndexedDbLocalStore;
        };
      }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalStore.open(
      "orivane-atlas.local-workspace",
    );
    const identity = await db.identity.get();
    if (!identity) throw new Error("MISSING_PRODUCT_LOCAL_IDENTITY");
    const existing = await db.metadata.list(identity.workspaceId, "files");
    const original = existing[0]?.value as unknown as LibraryFile;
    if (!original?.contentHash)
      throw new Error("MISSING_VERIFIED_FILE_FIXTURE");
    const writes: LocalWrite[] = Array.from({ length: 1500 }, (_, index) => {
      const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      return {
        expectedVersion: null,
        entity: {
          workspaceId: identity.workspaceId,
          collection: "files",
          id,
          version: 1,
          value: {
            ...original,
            id,
            version: 1,
            name: `Fixture${String(index).padStart(4, "0")}.txt`,
            deletedAt: null,
          },
        },
        mutation: {
          id: crypto.randomUUID(),
          deviceId: identity.deviceId,
          workspaceId: identity.workspaceId,
          principalId: identity.principalId,
          operation: "CREATE",
          entityType: "files",
          entityId: id,
          baseVersion: null,
          payload: {},
          createdAt: "2026-10-13T00:00:00Z",
          attemptCount: 0,
          lastAttemptAt: null,
          state: "PENDING",
        },
      };
    });
    const revision = await db.metadata.get(
      identity.workspaceId,
      "$local.workspace",
      "revision",
    );
    const nextRevision = (revision?.version ?? 0) + 1;
    await db.metadata.commit(
      identity.workspaceId,
      identity.principalId,
      writes,
      [
        {
          expectedVersion: revision?.version ?? null,
          entity: {
            workspaceId: identity.workspaceId,
            collection: "$local.workspace",
            id: "revision",
            version: nextRevision,
            value: { revision: nextRevision },
          },
        },
      ],
    );
    if ((await db.metadata.list(identity.workspaceId, "files")).length !== 1501)
      throw new Error("INCOMPLETE_DURABLE_FILE_FIXTURE");
    db.close();
  });
  await page.goto(`${productionOrigin}/#library`);
  const fileScroll = page.locator(".library-files .virtual-task-scroll");
  await expect(fileScroll).toHaveAttribute("data-task-count", "1501");
  await expect(page.locator(".library-file-row").first()).toBeVisible();
  const liveRows = await page.locator(".library-file-row").count();
  expect(liveRows).toBeGreaterThan(0);
  expect(liveRows).toBeLessThan(80);
  await fileScroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.locator(".library-file-row")).not.toHaveCount(1501);
  await page
    .getByLabel(zh ? "搜索" : "Search", { exact: true })
    .fill("Fixture1499");
  await expect(page.locator(".library-file-row")).toHaveCount(1);
  await page.locator(".library-file-row").click();
  await expect(
    page.getByRole("region", { name: "Fixture1499.txt", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".file-text-preview")).toHaveText(
    "原始文件\nSecond line\n",
  );
  await mkdir(info.outputDir, { recursive: true });
  await writeFile(
    info.outputPath("files-virtualization.json"),
    JSON.stringify(
      {
        project: info.project.name,
        fileMetadataCount: 1501,
        liveFileRows: liveRows,
        verifiedOriginalBlobCount: 1,
        originalBytes: original.length,
        offline: true,
        filteredFileOpened: "Fixture1499.txt",
        scope:
          "Targeted File list virtualization; not full v3 performance acceptance",
      },
      null,
      2,
    ),
  );
  expect(apiRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

async function productionAssets(page: Page, apiRequests: string[]) {
  await page.context().route("**/api/**", async (route) => {
    apiRequests.push(new URL(route.request().url()).pathname);
    await route.abort();
  });
}
async function serveAsset(
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
    if (!path.startsWith(dist + sep)) throw new Error("UNSAFE_ASSET_PATH");
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
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.end(await readFile(path));
  } catch {
    response.writeHead(404);
    response.end();
  }
}

function browserPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const content = "BT /F1 12 Tf 10 100 Td (Original PDF text) Tj ET";
  objects.push(
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  );
  let text = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(text.length);
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    text += `${String(offset).padStart(10, "0")} 00000 n \n`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(text);
}

test("production PDF worker extracts pages offline and body search survives restart", async ({
  page,
}, info) => {
  const apiRequests: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await productionAssets(page, apiRequests);
  const zh = info.project.name !== "desktop-en";
  await page.goto(`${productionOrigin}/#library`);
  await page
    .getByLabel(zh ? "上传文件" : "Upload file", { exact: true })
    .setInputFiles({
      name: "pages.pdf",
      mimeType: "application/pdf",
      buffer: browserPdf(),
    });
  await expect(
    page.getByRole("tab", { name: "pages.pdf", exact: true }),
  ).toBeVisible();
  const detail = page.getByRole("region", { name: "pages.pdf", exact: true });
  await expect(detail).toBeVisible();
  await expect(detail.locator(".file-text-preview")).toContainText(
    "Original PDF text",
  );
  await detail
    .getByRole("button", { name: zh ? "关闭文件" : "Close file", exact: true })
    .click();
  await page.reload();
  await page
    .getByLabel(zh ? "搜索" : "Search", { exact: true })
    .fill("Original PDF text");
  await expect(page.locator(".library-file-row")).toHaveCount(1);
  await expect(page.locator(".library-file-row")).toContainText("pages.pdf");
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("large local text extraction uses virtualized chunks and indexed body search", async ({
  page,
}, info) => {
  const apiRequests: string[] = [],
    errors: string[] = [];
  const measurements: {
    bytes: number;
    extractionMilliseconds: number;
    searchMilliseconds: number;
    searchDomMilliseconds: number;
    liveChunks: number;
    totalChunks: number;
  }[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await productionAssets(page, apiRequests);
  const zh = info.project.name !== "desktop-en";
  await page.goto(`${productionOrigin}/#library`);
  for (const bytes of [50 * 1024, 100 * 1024]) {
    const marker = `indexedtail${bytes}`;
    const body = Buffer.from(
      "abcdefghij "
        .repeat(Math.ceil(bytes / 11))
        .slice(0, bytes - marker.length) + marker,
    );
    expect(body.length).toBe(bytes);
    const start = performance.now();
    await page
      .getByLabel(zh ? "上传文件" : "Upload file", { exact: true })
      .setInputFiles({
        name: `large-${bytes}.txt`,
        mimeType: "text/plain",
        buffer: body,
      });
    const detail = page.getByRole("region", {
      name: `large-${bytes}.txt`,
      exact: true,
    });
    await expect(detail.locator(".file-text-preview")).toBeVisible();
    const extractionMilliseconds = performance.now() - start;
    const totalChunks = Math.ceil(bytes / 4000);
    const scroll = detail.locator(".virtual-task-scroll");
    await expect(scroll).toHaveAttribute(
      "data-task-count",
      String(totalChunks),
    );
    const liveChunks = await detail
      .locator(".file-text-preview section")
      .count();
    expect(liveChunks).toBeGreaterThan(0);
    expect(liveChunks).toBeLessThan(totalChunks);
    await detail
      .getByRole("button", {
        name: zh ? "关闭文件" : "Close file",
        exact: true,
      })
      .click();
    const search = page.getByLabel(zh ? "搜索" : "Search", { exact: true });
    const searchStart = performance.now();
    const domSettled = page.evaluate(
      ({ marker, filename }) =>
        new Promise<number>((resolve, reject) => {
          const host = document.querySelector(".library-view"),
            input = document.querySelector<HTMLInputElement>(
              ".library-view > label.field input",
            );
          if (!host || !input) {
            reject(new Error("MISSING_SEARCH_SURFACE"));
            return;
          }
          let started = 0;
          const begin = () => {
            started = performance.now();
          };
          input.addEventListener("input", begin, { once: true });
          const timer = setTimeout(() => {
            observer.disconnect();
            input.removeEventListener("input", begin);
            reject(new Error("SEARCH_DOM_TIMEOUT"));
          }, 10000);
          const observer = new MutationObserver(() => {
            const rows = host.querySelectorAll(".library-file-row");
            if (
              started &&
              input.value === marker &&
              host.getAttribute("aria-busy") === "false" &&
              rows.length === 1 &&
              rows[0]?.textContent?.includes(filename)
            ) {
              observer.disconnect();
              clearTimeout(timer);
              input.removeEventListener("input", begin);
              resolve(performance.now() - started);
            }
          });
          observer.observe(host, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["aria-busy"],
          });
        }),
      { marker, filename: "large-" + bytes + ".txt" },
    );
    await search.fill(marker);
    await expect(page.locator(".library-view")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(page.locator(".library-view")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.locator(".library-file-row")).toHaveCount(1);
    await expect(page.locator(".library-file-row")).toContainText(
      `large-${bytes}.txt`,
    );
    measurements.push({
      bytes,
      extractionMilliseconds,
      searchMilliseconds: performance.now() - searchStart,
      searchDomMilliseconds: await domSettled,
      liveChunks,
      totalChunks,
    });
    await search.fill("");
  }
  await mkdir(info.outputDir, {
    recursive: true,
  });
  await mkdir(info.outputDir, { recursive: true });
  await writeFile(
    info.outputPath("file-processing-performance.json"),
    JSON.stringify(
      {
        project: info.project.name,
        sample: info.repeatEachIndex,
        measurements,
        scope:
          "Targeted production File processing/index worker/search, all repeated measurements retained",
      },
      null,
      2,
    ),
  );
  await writeFile(
    info.outputPath("file-extraction-performance.json"),
    JSON.stringify(
      {
        project: info.project.name,
        measurements,
        scope:
          "Targeted release-build File extraction/index/search; not full FINAL editor or performance acceptance",
      },
      null,
      2,
    ),
  );
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("File project links use durable original commands and survive a local restart", async ({
  page,
}, info) => {
  const apiRequests: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await productionAssets(page, apiRequests);
  const zh = info.project.name !== "desktop-en";
  await page.goto(`${productionOrigin}/#projects`);
  await page
    .getByRole("button", { name: zh ? "新建项目" : "New project", exact: true })
    .first()
    .click();
  const editor = page.getByRole("dialog");
  await editor
    .getByLabel(zh ? "标题" : "Title", { exact: true })
    .fill("Related project");
  await editor
    .getByRole("button", {
      name: zh ? "新建项目" : "Create project",
      exact: true,
    })
    .click();
  await expect(editor).toHaveCount(0);
  await page.goto(`${productionOrigin}/#library`);
  await page
    .getByLabel(zh ? "上传文件" : "Upload file", { exact: true })
    .setInputFiles({
      name: "linked.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("original linked bytes"),
    });
  const detail = page.getByRole("region", { name: "linked.txt", exact: true });
  await expect(detail.locator(".file-text-preview")).toHaveText(
    "original linked bytes",
  );
  await detail.locator(".file-project-links > summary").click();
  await detail
    .getByRole("button", {
      name: zh ? "选择关联项目" : "Choose a project to link",
      exact: true,
    })
    .click();
  await page
    .locator(".hierarchy-browser")
    .getByRole("button", { name: "Related project", exact: true })
    .click();
  await detail
    .getByRole("button", { name: zh ? "关联" : "Link", exact: true })
    .click();
  await expect(
    detail.getByRole("link", { name: "Related project", exact: true }),
  ).toBeVisible();
  await detail
    .getByRole("button", { name: zh ? "关闭文件" : "Close file", exact: true })
    .click();
  await page.reload();
  await page.locator(".library-file-row", { hasText: "linked.txt" }).click();
  await detail.locator(".file-project-links > summary").click();
  await expect(
    detail.getByRole("link", { name: "Related project", exact: true }),
  ).toHaveAttribute("href", /^#projects\/[^?]+\?tab=overview&scope=SUBTREE$/);
  const fixture = await readFile(
    `.artifacts/local-storage-fixture-${3000 + info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.addScriptTag({ content: fixture });
  const evidence = await page.evaluate(async () => {
    const api = (
      window as unknown as {
        OrivaneLocalStorageFixture: {
          IndexedDbLocalStore: typeof IndexedDbLocalStore;
        };
      }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalStore.open(
      "orivane-atlas.local-workspace",
    );
    try {
      const owner = await db.identity.get();
      if (!owner) throw new Error("MISSING_LOCAL_OWNER");
      const mutations = await db.outbox.list(owner.workspaceId);
      return await Promise.all(
        mutations
          .filter((m) => m.entityType === "links")
          .map(async (m) => {
            if (!m.commandId) throw new Error("MISSING_ORIGINAL_LINK_COMMAND");
            const command = await db.metadata.get(
              owner.workspaceId,
              "$local.command",
              m.commandId,
            );
            if (!command) throw new Error("MISSING_DURABLE_LINK_COMMAND");
            return { payload: m.payload, command: command.value };
          }),
      );
    } finally {
      db.close();
    }
  });
  expect(evidence).toHaveLength(1);
  expect(evidence[0]).toMatchObject({
    payload: { from: { kind: "FILE" }, to: { kind: "WORK" } },
    command: {
      name: "link.create",
      input: { from: { kind: "FILE" }, to: { kind: "WORK" } },
    },
  });
  await detail
    .getByRole("button", { name: zh ? "解除关联" : "Unlink", exact: true })
    .click();
  await expect(
    detail.getByRole("link", { name: "Related project", exact: true }),
  ).toHaveCount(0);
  await expect(detail.locator(".file-text-preview")).toHaveText(
    "original linked bytes",
  );
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("File document links drill down by Space and open the existing document", async ({
  page,
}, info) => {
  const apiRequests: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await productionAssets(page, apiRequests);
  const zh = info.project.name !== "desktop-en";
  await page.goto(`${productionOrigin}/#library`);
  const fixture = await readFile(
    `.artifacts/local-storage-fixture-${3000 + info.workerIndex}/storage.js`,
    "utf8",
  );
  await page.addScriptTag({ content: fixture });
  await page.evaluate(async () => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: typeof localApi }
    ).OrivaneLocalStorageFixture;
    const db = await api.IndexedDbLocalStore.open(
        "orivane-atlas.local-workspace",
      ),
      blobs = await api.IndexedDbLocalBlobStore.open(
        "orivane-atlas.local-workspace",
      );
    try {
      const owner = await db.identity.get();
      if (!owner) throw new Error("MISSING_LOCAL_OWNER");
      const runtime = new api.LocalRuntime(
        new api.LocalWorkspace(
          db.metadata,
          blobs,
          owner,
          {
            extract: (id, body) => api.indexDocument(id, body, []),
            resolve: (links) => [...links],
          },
          { now: () => "2026-10-14T00:00:00Z" },
          { next: () => crypto.randomUUID() },
        ),
      );
      const space = await runtime.saveLibrary(null, 0, {
        kind: "SPACE",
        spaceId: null,
        title: "Related knowledge",
        bodyMd: "",
      });
      await runtime.saveLibrary(null, 0, {
        kind: "DOCUMENT",
        spaceId: space.id,
        title: "Existing source",
        bodyMd: "Original document body preserved",
      });
    } finally {
      db.close();
      blobs.close();
    }
  });
  await page.reload();
  await page
    .getByLabel(zh ? "上传文件" : "Upload file", { exact: true })
    .setInputFiles({
      name: "document-linked.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("separate original file"),
    });
  const detail = page.getByRole("region", {
    name: "document-linked.txt",
    exact: true,
  });
  await expect(detail.locator(".file-text-preview")).toHaveText(
    "separate original file",
  );
  await detail.locator(".file-document-links > summary").click();
  await detail
    .getByRole("button", {
      name: zh ? "选择关联文档" : "Choose a document to link",
      exact: true,
    })
    .click();
  const picker = page.locator(".hierarchy-browser");
  await expect(
    picker.getByRole("button", { name: "Related knowledge", exact: true }),
  ).toBeDisabled();
  await picker
    .getByRole("button", {
      name: zh
        ? "浏览子项：Related knowledge"
        : "Browse children: Related knowledge",
      exact: true,
    })
    .click();
  await picker
    .getByRole("button", { name: "Existing source", exact: true })
    .click();
  await detail
    .locator(".file-document-links")
    .getByRole("button", { name: zh ? "关联" : "Link", exact: true })
    .click();
  await expect(
    detail.getByRole("button", { name: "Existing source", exact: true }),
  ).toBeVisible();
  await detail
    .getByRole("button", { name: zh ? "关闭文件" : "Close file", exact: true })
    .click();
  await page.reload();
  await page
    .locator(".library-file-row", { hasText: "document-linked.txt" })
    .click();
  await detail.locator(".file-document-links > summary").click();
  await detail
    .getByRole("button", { name: "Existing source", exact: true })
    .click();
  await expect(detail).toHaveCount(0);
  await expect(page.locator(".document-pane")).toContainText(
    "Original document body preserved",
  );
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});
