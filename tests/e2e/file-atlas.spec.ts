import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import type * as localApi from "../../apps/web/test-fixtures/local-storage";
import type * as hostApi from "../fixtures/local-sync-host";

test.beforeAll(async ({}, info) => {
  await Promise.all(
    [
      "scripts/build-local-sync-host-fixture.mjs",
      "scripts/build-local-storage-fixture.mjs",
    ].map((script) =>
      promisify(execFile)(
        process.execPath,
        [script, String(6000 + info.workerIndex)],
        { timeout: 30000 },
      ),
    ),
  );
});

test("File Atlas uses the real Host and canonical worker, waits for approval and keeps temporary discussion out of conversation history", async ({
  page,
}, info) => {
  const worker = 6000 + info.workerIndex;
  const api = (await import(
    pathToFileURL(
      resolve(
        `.artifacts/local-sync-host-fixture-${worker}/local-sync-host.js`,
      ),
    ).href
  )) as typeof hostApi;
  const reserve = createServer();
  await new Promise<void>((done) => reserve.listen(0, "127.0.0.1", done));
  const port = (reserve.address() as AddressInfo).port;
  await new Promise<void>((done, reject) =>
    reserve.close((error) => (error ? reject(error) : done())),
  );
  const origin = `http://127.0.0.1:${port}`,
    directory = await mkdtemp(join(tmpdir(), "orivane-file-atlas-"));
  let calls = 0;
  const host = await api.createHost({
    database: join(directory, "workspace.sqlite"),
    secret: randomBytes(32).toString("hex"),
    origin,
    webRoot: resolve("apps/web/dist"),
    fileParser: new api.NodeFileParser(
      pathToFileURL(resolve("packages/host/dist/file-parser-worker.js")),
    ),
    model: {
      route: {
        fingerprint: "file-ui-ci",
        provider: "ci",
        model: "ci",
        maxInputChars: 32000,
        maxOutputTokens: 100,
        maxRunsPerDay: 10,
        timeoutMs: 5000,
      },
      complete: async (_prompt) => {
        calls++;
        return "Canonical answer\n第二行";
      },
    },
  });
  const errors: string[] = [],
    fullRunRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/ai")
      fullRunRequests.push(request.url());
  });
  await new Promise<void>((done) =>
    host.server.listen(port, "127.0.0.1", done),
  );
  try {
    const verifier = await api.passwordHash("Test-only-password-123");
    await host.db.accounts((store) => store.register("owner", verifier, true));
    await page.route(origin + "/fixture.html", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>File Atlas setup</title>",
      }),
    );
    await page.goto(origin + "/fixture.html");
    const login = await page.request.post(origin + "/api/session", {
      headers: { Origin: origin },
      data: { username: "owner", password: "Test-only-password-123" },
    });
    expect(login.status()).toBe(200);
    const session = await login.json();
    const bytes = Buffer.from("Canonical File source about satellites."),
      contentHash = createHash("sha256").update(bytes).digest("hex");
    const headers = {
      Origin: origin,
      "X-CSRF-Token": session.csrf,
      "Idempotency-Key": "",
    };
    const post = (path: string, data: unknown) =>
      page.request.post(origin + path, {
        headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
        data,
      });
    expect(
      (
        await post("/api/v1/files/binary/begin", {
          contentHash,
          size: bytes.length,
          mime: "text/plain",
          chunkSize: 262144,
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await page.request.post(
          origin + `/api/v1/files/binary/chunk?hash=${contentHash}&index=0`,
          {
            headers: {
              ...headers,
              "Content-Type": "application/octet-stream",
              "X-File-Chunk-Hash": contentHash,
            },
            data: bytes,
          },
        )
      ).status(),
    ).toBe(200);
    expect(
      (await post("/api/v1/files/binary/complete", { contentHash })).status(),
    ).toBe(200);
    const fileResponse = await post("/api/v1/files/register", {
      name: "canonical-atlas.txt",
      contentHash,
      size: bytes.length,
      mime: "text/plain",
      spaceId: null,
      aiPolicy: {
        classification: "PRIVATE",
        processingBoundary: "ANY",
        aiAccess: "ASK",
      },
    });
    expect(fileResponse.status()).toBe(200);
    const file = await fileResponse.json();
    const policy = {
      classification: "PRIVATE",
      processingBoundary: "ANY",
      aiAccess: "ASK",
    };
    const spaceResponse = await post("/api/library/save", {
      id: null,
      version: 0,
      input: {
        kind: "SPACE",
        spaceId: null,
        title: "Editor knowledge",
        bodyMd: "",
        aiPolicy: policy,
      },
    });
    expect(spaceResponse.status()).toBe(200);
    const space = await spaceResponse.json();
    const documentResponse = await post("/api/library/save", {
      id: null,
      version: 0,
      input: {
        kind: "DOCUMENT",
        spaceId: space.id,
        title: "Editor original",
        bodyMd:
          "First\nSelected paragraph\n\n" + "x".repeat(100000) + "\n\nLast",
        aiPolicy: policy,
      },
    });
    expect(documentResponse.status()).toBe(200);
    await page.addScriptTag({
      content: await readFile(
        `.artifacts/local-storage-fixture-${worker}/storage.js`,
        "utf8",
      ),
    });
    await page.evaluate(async () => {
      const api = (
        window as unknown as { OrivaneLocalStorageFixture: typeof localApi }
      ).OrivaneLocalStorageFixture;
      const session = await (await fetch("/api/session")).json(),
        remote = await (await fetch("/api/v1/sync?after=0")).json();
      const db = await api.IndexedDbLocalStore.open(
        "orivane-atlas.local-workspace",
      );
      try {
        const actor = await db.identity.ensure({
          workspaceId: crypto.randomUUID(),
          principalId: crypto.randomUUID(),
          deviceId: crypto.randomUUID(),
          schemaVersion: 1,
        });
        await db.syncState.save(
          {
            workspaceId: actor.workspaceId,
            remoteWorkspaceId: session.context.workspaceId,
            remotePrincipalId: session.context.principalId,
            serverOrigin: location.origin,
            epoch: remote.epoch,
            cursor: 0,
            version: 1,
          },
          null,
        );
        await new api.LocalWorkSyncCoordinator(actor, {
          metadata: db.metadata,
          outbox: db.outbox,
          syncState: db.syncState,
          replica: db.replica,
          clock: { now: () => new Date().toISOString() },
          transport: {
            lookup: async () => {
              throw new Error("UNEXPECTED_RECEIPT");
            },
            send: async () => {
              throw new Error("UNEXPECTED_MUTATION");
            },
            pull: async (binding) => {
              const response = await fetch(
                `/api/v1/sync?after=${binding.cursor}&epoch=${encodeURIComponent(binding.epoch!)}&bodyMode=metadata`,
              );
              if (!response.ok) throw new Error("PULL_FAILED");
              return response.json();
            },
          },
        }).run();
      } finally {
        db.close();
      }
    });
    await page.goto(`${origin}/#library?file=${file.id}`);
    const zh = info.project.name !== "desktop-en",
      detail = page.getByRole("region", { name: file.name, exact: true });
    await expect(detail).toBeVisible();
    await detail
      .getByRole("button", {
        name: zh ? "询问 Atlas" : "Ask Atlas",
        exact: true,
      })
      .click();
    const floating = page.getByRole("dialog", {
      name: zh ? "文件 Atlas" : "File Atlas",
      exact: true,
    });
    await floating.getByRole("textbox").fill("satellites");
    expect(calls).toBe(0);
    const proposalResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/ai/propose",
    );
    await floating
      .getByRole("button", {
        name: zh ? "准备请求" : "Prepare request",
        exact: true,
      })
      .click();
    const prepared = await proposalResponse;
    expect((await prepared.json()).error).toBeNull();
    expect(prepared.status()).toBe(200);
    await expect(
      floating.getByRole("button", {
        name: zh ? "批准并发送" : "Approve and send",
        exact: true,
      }),
    ).toBeVisible();
    await floating
      .getByText(zh ? "查看片段与来源" : "View excerpts and citations", {
        exact: true,
      })
      .click();
    await expect(floating.locator("pre")).toContainText(
      "Canonical File source about satellites.",
    );
    expect(calls).toBe(0);
    await floating
      .getByRole("button", {
        name: zh ? "批准并发送" : "Approve and send",
        exact: true,
      })
      .click();
    await expect(floating).toContainText("Canonical answer");
    expect(calls).toBe(1);
    await expect(
      floating.getByRole("button", {
        name: zh ? "继续讨论" : "Continue discussion",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await (await page.request.get(origin + "/api/ai/sessions")).json(),
    ).toEqual([]);
    expect(
      Buffer.from(
        await (
          await page.request.get(origin + `/api/v1/files/bytes?id=${file.id}`)
        ).body(),
      ),
    ).toEqual(bytes);
    await floating
      .getByRole("button", {
        name: zh ? "关闭 Atlas" : "Close Atlas",
        exact: true,
      })
      .click();
    await page
      .getByRole("tablist")
      .getByRole("button", { name: zh ? "工作台" : "Workspace", exact: true })
      .click();
    await page.locator(".space-card", { hasText: "Editor knowledge" }).click();
    await page
      .locator(".library-document-row", { hasText: "Editor original" })
      .click();
    const content = page.locator(".cm-content:visible");
    await expect(content).toContainText("Selected paragraph");
    await content.click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Control+j");
    const editorFloat = page.getByRole("dialog", {
      name: zh ? "编辑器 Atlas" : "Editor Atlas",
      exact: true,
    });
    await expect(editorFloat).toBeVisible();
    await editorFloat
      .getByRole("textbox", {
        name: zh ? "写作要求" : "Writing instruction",
        exact: true,
      })
      .fill("Make the wording concise");
    await page.keyboard.press("Escape");
    await expect(editorFloat).toHaveCount(0);
    await content.focus();
    await page.keyboard.press("Control+j");
    await expect(
      editorFloat.getByRole("textbox", {
        name: zh ? "写作要求" : "Writing instruction",
        exact: true,
      }),
    ).toHaveValue("Make the wording concise");
    expect(calls).toBe(1);
    await editorFloat
      .getByRole("button", {
        name: zh ? "固定当前上下文" : "Pin current context",
        exact: true,
      })
      .click();
    await content.focus();
    await page.keyboard.press("Control+End");
    expect(calls).toBe(1);
    await editorFloat
      .getByRole("button", { name: zh ? "提问" : "Ask", exact: true })
      .click();
    await editorFloat
      .getByRole("button", {
        name: zh ? "准备请求" : "Prepare request",
        exact: true,
      })
      .click();
    const reviewedContext = editorFloat.locator("pre");
    expect(
      (await reviewedContext.allTextContents()).join("").length,
    ).toBeLessThan(12000);
    await expect(reviewedContext.last()).toContainText("Selected paragraph");
    await editorFloat
      .getByRole("button", {
        name: zh ? "批准并发送" : "Approve and send",
        exact: true,
      })
      .click();
    await expect(editorFloat).toContainText("Canonical answer");
    await expect(editorFloat.locator(".document-diff")).toHaveCount(0);
    await expect(content).not.toContainText("Canonical answer");
    expect(calls).toBe(2);
    expect(
      await (await page.request.get(origin + "/api/ai/sessions")).json(),
    ).toEqual([]);
    await editorFloat
      .getByRole("button", {
        name: zh ? "继续讨论" : "Continue discussion",
        exact: true,
      })
      .click();
    await editorFloat
      .getByRole("button", { name: zh ? "润色" : "Polish", exact: true })
      .click();
    await editorFloat
      .getByRole("button", {
        name: zh ? "准备请求" : "Prepare request",
        exact: true,
      })
      .click();
    await editorFloat
      .getByRole("button", {
        name: zh ? "批准并发送" : "Approve and send",
        exact: true,
      })
      .click();
    await expect(editorFloat.locator(".document-diff")).toContainText(
      "Canonical answer",
    );
    expect(calls).toBe(3);
    await content.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("!");
    await expect(
      editorFloat.getByRole("button", {
        name: zh ? "接受" : "Accept",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(content).toContainText("Last!");
    await expect(content).not.toContainText("Canonical answer");
    await page.screenshot({
      path: info.outputPath("file-editor-atlas.png"),
      fullPage: false,
    });
    await editorFloat
      .getByRole("button", {
        name: zh ? "保存为 Atlas 对话" : "Save as Atlas conversation",
        exact: true,
      })
      .click();
    await expect(
      editorFloat.getByRole("button", {
        name: zh ? "已保存到 Atlas 对话" : "Saved to Atlas conversations",
        exact: true,
      }),
    ).toBeDisabled();
    const editorSessions = await (
      await page.request.get(origin + "/api/ai/sessions")
    ).json();
    expect(editorSessions).toHaveLength(1);
    const editorConversation = await (
      await page.request.get(
        origin + "/api/ai/sessions/messages?id=" + editorSessions[0].id,
      )
    ).json();
    expect(
      editorConversation.session.messages.map(
        (message: { kind: string }) => message.kind,
      ),
    ).toEqual(["USER", "ASSISTANT", "USER", "ASSISTANT"]);
    await editorFloat
      .getByRole("button", {
        name: zh ? "拒绝 / 继续调整" : "Reject / continue adjusting",
        exact: true,
      })
      .click();
    await editorFloat
      .getByRole("button", {
        name: zh ? "准备请求" : "Prepare request",
        exact: true,
      })
      .click();
    await expect(editorFloat.getByRole("alert")).toContainText(
      zh ? "固定的上下文已变化" : "The pinned context changed",
    );
    expect(calls).toBe(3);
    await editorFloat
      .getByRole("button", {
        name: zh ? "关闭 Atlas" : "Close Atlas",
        exact: true,
      })
      .click();
    await content.focus();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Control+b");
    await expect(content).toContainText("**First**");
    const selectionToolbar = page.getByRole("toolbar", {
      name: zh ? "选区工具栏" : "Selection toolbar",
      exact: true,
    });
    await expect(selectionToolbar).toBeVisible();
    await page.screenshot({
      path: info.outputPath("selection-toolbar.png"),
      fullPage: true,
    });
    await selectionToolbar
      .getByRole("button", { name: zh ? "粗体" : "Bold", exact: true })
      .click();
    await expect(content).not.toContainText("**First**");
    await page
      .getByRole("combobox", {
        name: zh ? "编辑器工具栏" : "Editor toolbar",
        exact: true,
      })
      .selectOption("PINNED");
    await content.focus();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page
      .getByRole("toolbar")
      .getByRole("button", {
        name: zh ? "更多格式" : "More formatting",
        exact: true,
      })
      .click();
    const chooser = page.waitForEvent("filechooser");
    await page
      .locator(".markdown-command-menu")
      .getByRole("button", {
        name: zh ? "附加文件" : "Attach file",
        exact: true,
      })
      .click();
    await (await chooser).setFiles({
      name: "editor-attachment.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Original editor attachment"),
    });
    await expect(content).toContainText("editor-attachment.txt");
    expect(calls).toBe(3);
    await page.getByRole("tab", { name: file.name, exact: true }).click();
    await detail
      .getByRole("button", {
        name: zh ? "询问 Atlas" : "Ask Atlas",
        exact: true,
      })
      .click();
    const savedFileResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/ai/sessions/promote",
    );
    await floating
      .getByRole("button", {
        name: zh ? "保存为 Atlas 对话" : "Save as Atlas conversation",
        exact: true,
      })
      .click();
    const savedFile = await savedFileResponse;
    expect(await savedFile.json()).not.toHaveProperty("error");
    expect(savedFile.status()).toBe(200);
    await expect(
      floating.getByRole("button", {
        name: zh ? "已保存到 Atlas 对话" : "Saved to Atlas conversations",
        exact: true,
      }),
    ).toBeDisabled();
    expect(
      await (await page.request.get(origin + "/api/ai/sessions")).json(),
    ).toHaveLength(2);
    expect(calls).toBe(3);
    await floating
      .getByRole("button", {
        name: zh ? "在 Atlas 中继续" : "Continue in Atlas",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/#ai\?session=[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("dialog", {
        name: zh ? "文件 Atlas" : "File Atlas",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(page.locator(".conversation-messages")).toContainText(
      "satellites",
    );
    await expect(page.locator(".conversation-messages")).toContainText(
      "Canonical answer",
    );
    const fileConversationUrl = page.url();
    await page
      .locator(".conversation-list .conversation-entry")
      .filter({ hasText: editorSessions[0].title })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`#ai\\?session=${editorSessions[0].id}$`),
    );
    await expect(page.locator(".conversation-title")).toHaveText(
      editorSessions[0].title,
    );
    await page.reload();
    await expect(page.locator(".conversation-title")).toHaveText(
      editorSessions[0].title,
    );
    await page.goBack();
    await expect(page).toHaveURL(fileConversationUrl);
    await expect(page.locator(".conversation-messages")).toContainText(
      "satellites",
    );
    await page.reload();
    await expect(page.locator(".conversation-messages")).toContainText(
      "Canonical answer",
    );
    const citations = page.locator(".answer-sources");
    await expect(
      citations.getByRole("button", { name: file.name, exact: true }),
    ).not.toBeVisible();
    await citations.locator("summary").click();
    await citations
      .getByRole("button", { name: file.name, exact: true })
      .click();
    await expect(detail).toBeVisible();
    await page.goBack();
    await expect(page.locator(".conversation-messages")).toContainText(
      "satellites",
    );
    expect(calls).toBe(3);
    expect(fullRunRequests).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await host.close();
  }
});
