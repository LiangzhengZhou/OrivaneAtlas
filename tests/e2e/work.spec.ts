import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";

const resources = Object.fromEntries(
  ["en-US", "zh-CN"].map((locale) => [
    locale,
    Object.fromEntries(
      [
        "desk",
        "common",
        "work",
        "settings",
        "errors",
        "connected",
        "spaces",
      ].map((ns) => [
        ns,
        JSON.parse(
          readFileSync(
            resolve("packages/i18n/src/locales", locale, ns + ".json"),
            "utf8",
          ),
        ),
      ]),
    ),
  ]),
) as typeof import("../../packages/i18n/src/index").resources;

import { passwordHash } from "../../packages/host/src/password";
import { openPersonalVault } from "../../packages/host/src/personal-model";
import { createHost } from "../../packages/host/src/server";

const test = base.extend<{ workbench: { url: string; secret: string } }>({
  workbench: async ({}, use, info) => {
    const directory = mkdtempSync(join(tmpdir(), "arclattice-e2e-"));
    const secret = randomBytes(32).toString("hex");
    const port = 1420 + info.parallelIndex;
    const host = await createHost({
      database: join(directory, "test.sqlite"),
      secret,
      origin: "http://127.0.0.1:" + port,
      webRoot: resolve("apps/web/dist"),
      vault: openPersonalVault(join(directory, "vault")),
      ...(info.title.includes("AI approval")
        ? {
            model: {
              route: {
                fingerprint: "e2e-only",
                provider: "https://test.invalid",
                model: "Test-only adapter",
                maxInputChars: 1000,
                maxOutputTokens: 100,
                timeoutMs: 2000,
                maxRunsPerDay: 2,
              },
              complete: async (prompt: string) =>
                "# Reviewed result\n\n" + prompt,
            },
          }
        : {}),
    });
    try {
      {
        const verifier = await passwordHash(secret);
        await host.db.accounts((store) =>
          store.register("image-editor", verifier, true),
        );
        if (info.title.includes("account experience"))
          await host.db.accounts((store) => {
            const member = store.register("second-user", verifier, false);
            store.status(member.id, member.version, "ACTIVE");
          });
        if (info.title.includes("accounts admin review"))
          await host.db.accounts((store) =>
            store.register("student", verifier, false),
          );
      }
      await new Promise<void>((done, reject) => {
        host.server.once("error", reject);
        host.server.listen(port, "127.0.0.1", done);
      });
      await use({ url: "http://127.0.0.1:" + port, secret });
    } finally {
      if (host.server.listening) {
        // Test assertions are finished; do not let browser preconnect sockets
        // keep the disposable HTTP fixture alive during teardown.
        const closing = host.close();
        host.server.closeAllConnections();
        await closing;
      } else await host.db.close();
      if (
        !resolve(directory).startsWith(
          resolve(tmpdir()) + sep + "arclattice-e2e-",
        )
      )
        throw new Error("Unsafe cleanup");
      rmSync(directory, { recursive: true });
    }
  },
});
function words(locale: string) {
  return resources[locale.endsWith("zh") ? "zh-CN" : "en-US"];
}

test("named AI profiles persist independently and bind reviewed proposals", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  const zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.ai);
  await page.locator(".personal-ai-settings > summary").click();
  await page.locator("#ai-profile-id").fill("research");
  await page
    .getByRole("button", {
      name: zh ? "打开 / 新建配置" : "Open / create profile",
      exact: true,
    })
    .click();
  await page.locator(".personal-ai-settings > summary").click();
  await page
    .getByLabel(zh ? "HTTPS API 基址" : "HTTPS API base URL", { exact: true })
    .fill("https://provider.example/v1");
  await page
    .getByLabel(zh ? "模型标识" : "Model identifier", { exact: true })
    .fill("test-research");
  await page
    .getByLabel(
      zh
        ? "API 密钥（留空保留已有密钥）"
        : "API key (blank keeps existing key)",
      { exact: true },
    )
    .fill("TEST-ONLY-PROFILE-SECRET");
  await page
    .getByRole("button", {
      name: zh ? "保存个人配置" : "Save personal configuration",
      exact: true,
    })
    .click();
  await expect(
    page.locator(".personal-ai-settings [role=status]"),
  ).toBeVisible();
  await expect(
    page.locator(".personal-ai-settings input[type=password]"),
  ).toHaveValue("");
  await page.reload();
  await nav(page, w.desk.ai);
  const selector = page.getByRole("combobox", {
    name: zh ? "本次使用的模型配置" : "Model profile for this request",
    exact: true,
  });
  await expect(selector.locator("option[value=research]")).toHaveCount(1);
  await selector.selectOption("research");
  await expect(page.locator(".connected-notice")).toContainText(
    "test-research",
  );
  await page
    .getByLabel(w.connected.prompt, { exact: true })
    .fill("Review without sending");
  await page
    .getByRole("button", { name: w.connected.propose, exact: true })
    .click();
  await expect(page.locator(".ai-run")).toContainText(
    w.connected.WAITING_APPROVAL,
  );
  const result = await (
    await page.request.get(workbench.url + "/api/ai?profileId=research")
  ).json();
  expect(result.runs[0].route.profileId).toBe("research");
  expect(JSON.stringify(result)).not.toContain("TEST-ONLY-PROFILE-SECRET");
  await page.screenshot({
    path: info.outputPath("named-ai-profile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("reviewed plan and recurrence publish real tasks without duplication", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const project = await mutation(page, "/api/work/create", {
    title: "Workflow project",
    type: "PROJECT",
  });
  await page.reload();
  await nav(page, w.desk.projects);
  await page.getByText(w.desk.workflows.plans, { exact: true }).click();
  const plans = page.locator("details").filter({
    has: page.locator("summary", { hasText: w.desk.workflows.plans }),
  });
  await plans.getByRole("combobox").selectOption(project.id);
  await plans.getByLabel(w.desk.workflows.manifest, { exact: true }).fill(
    JSON.stringify({
      version: 1,
      tasks: [
        {
          tempId: "first",
          title: "Reviewed first",
          descriptionMd: "Keep **Markdown**",
        },
        { tempId: "next", title: "Reviewed next", dependsOn: ["first"] },
      ],
    }),
  );
  await plans
    .getByRole("button", { name: w.desk.workflows.preview, exact: true })
    .click();
  await expect(
    plans.getByRole("button", { name: w.desk.workflows.publish, exact: true }),
  ).toBeVisible();
  let state = await page.evaluate(async () =>
    (await fetch("/api/snapshot")).json(),
  );
  expect(state.items).toHaveLength(1);
  await plans
    .getByRole("button", { name: w.desk.workflows.publish, exact: true })
    .click();
  await expect(
    plans.getByRole("button", { name: w.desk.workflows.publish, exact: true }),
  ).toHaveCount(0);
  state = await page.evaluate(async () =>
    (await fetch("/api/snapshot")).json(),
  );
  expect(state.items).toHaveLength(3);
  expect(state.edges).toHaveLength(1);
  await page.getByText(w.desk.workflows.recurrences, { exact: true }).click();
  const recurrences = page.locator("details").filter({
    has: page.locator("summary", { hasText: w.desk.workflows.recurrences }),
  });
  await recurrences
    .getByLabel(w.desk.workflows.title, { exact: true })
    .fill("Daily review");
  await recurrences
    .getByLabel(w.desk.workflows.timezone, { exact: true })
    .fill("UTC");
  await recurrences
    .getByLabel(w.desk.workflows.start, { exact: true })
    .fill(new Date().toISOString().slice(0, 10));
  await recurrences
    .getByRole("button", { name: w.desk.workflows.save, exact: true })
    .click();
  await recurrences
    .getByRole("button", { name: w.desk.workflows.generate, exact: true })
    .click();
  await expect(
    recurrences.getByText(new RegExp(w.desk.workflows.CREATED)),
  ).toBeVisible();
  await recurrences
    .getByRole("button", { name: w.desk.workflows.generate, exact: true })
    .click();
  await expect(
    recurrences.getByRole("button", {
      name: w.desk.workflows.generate,
      exact: true,
    }),
  ).toBeEnabled();
  state = await page.evaluate(async () =>
    (await fetch("/api/snapshot")).json(),
  );
  expect(
    state.items.filter((i: { title: string }) => i.title === "Daily review"),
  ).toHaveLength(1);
  await page.screenshot({
    path: info.outputPath("workflows.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("AI context permission defaults deny and persists explicit human edits", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  const zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const note = await mutation(page, "/api/note/save", {
    id: null,
    version: 0,
    input: {
      title: "Permission test",
      bodyMd: "Original private Markdown",
      kind: "NOTE",
      day: null,
    },
  });
  await page.reload();
  await nav(page, w.desk.notes);
  await page
    .locator(".note-card")
    .filter({ hasText: "Permission test" })
    .click();
  await pane(page)
    .getByText(zh ? "AI 数据许可" : "AI data permission", { exact: false })
    .click();
  const access = pane(page).getByRole("combobox", {
    name: zh ? "AI 访问" : "AI access",
    exact: true,
  });
  await expect(access).toHaveValue("DENY");
  await access.selectOption("ASK");
  await pane(page)
    .getByRole("combobox", {
      name: zh ? "处理位置" : "Processing boundary",
      exact: true,
    })
    .selectOption("ANY");
  await expect
    .poll(async () => {
      const snapshot = await (
        await page.request.get(new URL("/api/snapshot", page.url()).href)
      ).json();
      return snapshot.notes.find(
        (entry: { id: string }) => entry.id === note.id,
      )?.aiPolicy;
    })
    .toEqual({
      classification: "PRIVATE",
      processingBoundary: "ANY",
      aiAccess: "ASK",
    });
  await page.screenshot({
    path: info.outputPath("ai-permission.png"),
    fullPage: true,
  });
  await page.reload();
  await nav(page, w.desk.notes);
  await page
    .locator(".note-card")
    .filter({ hasText: "Permission test" })
    .click();
  await expect(pane(page).getByText(/AI.*ASK/)).toBeVisible();
});

test("project category management persists, filters and restores", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  await mutation(page, "/api/work/create", {
    title: "Categorized project",
    type: "PROJECT",
  });
  await mutation(page, "/api/work/create", {
    title: "Other project",
    type: "PROJECT",
  });
  await page.reload();
  await nav(page, w.desk.projects);
  await page.getByText(w.desk.categories.manage, { exact: true }).click();
  await page
    .getByLabel(w.desk.categories.name, { exact: true })
    .fill("Research");
  await page
    .getByRole("checkbox", { name: "Categorized project", exact: true })
    .check();
  await page
    .getByRole("button", { name: w.desk.categories.save, exact: true })
    .click();
  await expect(
    page.getByLabel(w.desk.categories.name, { exact: true }),
  ).toHaveValue("");
  const snapshot = await page.evaluate(async () =>
    (await fetch("/api/snapshot")).json(),
  );
  await page
    .getByLabel(w.desk.categories.filter, { exact: true })
    .selectOption(snapshot.categories[0].id);
  await expect(page.locator(".project-card")).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath("categories.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: w.desk.categories.delete, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: w.desk.categories.restore, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: w.desk.categories.restore, exact: true })
    .click();
  await page.reload();
  const restored = await page.evaluate(async () =>
    (await fetch("/api/snapshot")).json(),
  );
  expect(restored.categories[0]).toMatchObject({
    version: 3,
    deletedAt: null,
    projectIds: snapshot.categories[0].projectIds,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("multiple project task authoring persists across reload", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const a = await mutation(page, "/api/work/create", {
    title: "Project A",
    type: "PROJECT",
  });
  const b = await mutation(page, "/api/work/create", {
    title: "Project B",
    type: "PROJECT",
  });
  await page.reload();
  await nav(page, w.desk.tasks);
  await page
    .getByRole("button", { name: w.desk.newTask, exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(w.work.title, { exact: true }).fill("Shared task");
  await dialog.getByLabel(w.desk.project, { exact: true }).selectOption(a.id);
  await dialog
    .getByRole("checkbox", { name: "Project B", exact: true })
    .check();
  await page.screenshot({
    path: info.outputPath("multi-project-editor.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: w.common.create, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  const snapshot = await page.evaluate(async () =>
    (await fetch("/api/snapshot")).json(),
  );
  expect(
    snapshot.items.find(
      (item: { title: string }) => item.title === "Shared task",
    ),
  ).toMatchObject({ projectId: a.id, projectIds: [a.id, b.id] });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("work planning: activation and nested project authoring", async ({
  page,
  request,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await page.goto(workbench.url);
  await page
    .getByLabel(w.spaces.username, { exact: true })
    .fill("image-editor");
  await page
    .getByLabel(w.spaces.password, { exact: true })
    .fill(workbench.secret);
  await page.getByRole("button", { name: w.desk.enter, exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await page.goto(workbench.url + "/#projects");
  await page.getByRole("button", { name: w.desk.newProject }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(w.work.title, { exact: true }).fill("Parent project");
  await dialog
    .getByRole("button", { name: w.common.create, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: w.desk.newProject }).first().click();
  await dialog.getByLabel(w.work.title, { exact: true }).fill("Child project");
  await dialog
    .getByLabel(w.desk.parentProject, { exact: true })
    .selectOption({ label: "Parent project" });
  await dialog
    .getByLabel(w.desk.activationPolicy, { exact: true })
    .selectOption("AT_SCHEDULED_TIME");
  await dialog.getByLabel(w.desk.startDate, { exact: true }).fill("2099-01-01");
  await page.screenshot({
    path: info.outputPath("work-planning-editor.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: w.common.create, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const session = await request.post(workbench.url + "/api/session", {
    data: { username: "image-editor", password: workbench.secret },
    headers: { Origin: workbench.url },
  });
  expect(session.status()).toBe(200);
  const { csrf } = await session.json();
  const snapshot = await (
    await request.get(workbench.url + "/api/snapshot")
  ).json();
  const parent = snapshot.items.find(
    (item: { title: string }) => item.title === "Parent project",
  );
  const child = snapshot.items.find(
    (item: { title: string }) => item.title === "Child project",
  );
  expect(child).toMatchObject({
    projectId: parent.id,
    activationPolicy: "AT_SCHEDULED_TIME",
    activationState: "SCHEDULED",
    startDate: "2099-01-01",
  });
  const headers = {
    Origin: workbench.url,
    "X-CSRF-Token": csrf,
    "Idempotency-Key": randomUUID(),
  };
  const invalid = await request.post(workbench.url + "/api/work/create", {
    headers,
    data: { title: "invalid", activationPolicy: "UNKNOWN" },
  });
  expect(invalid.status()).toBe(400);
  const createdTask = await request.post(workbench.url + "/api/work/create", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: { title: "Nested task", projectId: child.id },
  });
  expect(createdTask.status()).toBe(200);
  await page.reload();
  await expect(
    page.getByText("Child project", { exact: true }).first(),
  ).toBeVisible();
  const parentCard = page.locator(".project-card").filter({
    has: page.getByRole("heading", { name: "Parent project", exact: true }),
  });
  const childCard = page.locator(".project-card").filter({
    has: page.getByRole("heading", { name: "Child project", exact: true }),
  });
  await expect(parentCard.locator(".progress-label strong")).toHaveText(
    "0 / 1",
  );
  await parentCard
    .getByRole("button", { name: w.desk.archive, exact: true })
    .click();
  await expect(page.locator(".project-card")).toHaveCount(0);
  await page
    .getByRole("button", { name: new RegExp(w.desk.archivedProjects) })
    .click();
  await expect(page.locator(".project-card")).toHaveCount(2);
  await expect(
    childCard.getByRole("button", { name: w.desk.unarchive, exact: true }),
  ).toBeDisabled();
  await expect(
    childCard.getByText(
      w.desk.inheritedArchive.replace("{{title}}", "Parent project"),
    ),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("project-archive.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await parentCard
    .getByRole("button", { name: w.desk.unarchive, exact: true })
    .click();
  await expect(page.locator(".project-card")).toHaveCount(0);
  await page
    .getByRole("button", { name: new RegExp(w.desk.archivedProjects) })
    .click();
  await expect(page.locator(".project-card")).toHaveCount(2);
  await parentCard
    .getByRole("button", { name: w.desk.projectTasks, exact: true })
    .click();
  await expect(
    page.locator(".task-card").filter({ hasText: "Nested task" }),
  ).toBeVisible();
});

test("account experience: revoke, switch, isolate and forget shortcuts", async ({
  page,
  request,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await page.goto(workbench.url);
  await page
    .getByLabel(w.spaces.username, { exact: true })
    .fill("image-editor");
  await page
    .getByLabel(w.spaces.password, { exact: true })
    .fill(workbench.secret);
  await page.getByRole("button", { name: w.desk.enter, exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  const external = await request.post(workbench.url + "/api/session", {
    data: { username: "image-editor", password: workbench.secret },
    headers: { Origin: workbench.url },
  });
  expect(external.status()).toBe(200);
  await page.goto(workbench.url + "/#account");
  await expect(
    page.getByText(w.spaces.currentSession, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(w.spaces.otherSession, { exact: true }),
  ).toBeVisible();
  await page
    .getByText(w.spaces.otherSession, { exact: true })
    .locator("../..")
    .getByRole("button", { name: w.spaces.revoke, exact: true })
    .click();
  await expect(
    page.getByText(w.spaces.otherSession, { exact: true }),
  ).toHaveCount(0);
  expect((await request.get(workbench.url + "/api/session")).status()).toBe(
    401,
  );
  await page.screenshot({
    path: info.outputPath("account-sessions.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  // Browser logout failure must keep the authenticated view available for retry.
  await page.route("**/api/logout", (route) => route.abort());
  await page
    .getByRole("button", { name: w.spaces.signOut, exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByText(w.spaces.currentSession, { exact: true }),
  ).toBeVisible();
  await page.unroute("**/api/logout");
  await page
    .getByRole("button", { name: w.spaces.switchAccount, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: w.spaces.login, exact: true }),
  ).toBeVisible();
  await page.getByLabel(w.spaces.username, { exact: true }).fill("second-user");
  await page
    .getByLabel(w.spaces.password, { exact: true })
    .fill(workbench.secret);
  await page.getByRole("button", { name: w.desk.enter, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "second-user", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "image-editor", exact: true }),
  ).toHaveCount(0);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: w.spaces.revokeAllSessions, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: w.spaces.login, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "image-editor", exact: true }).click();
  await expect(page.getByLabel(w.spaces.username, { exact: true })).toHaveValue(
    "image-editor",
  );
  await expect(page.getByLabel(w.spaces.password, { exact: true })).toHaveValue(
    "",
  );
  await page
    .getByRole("button", {
      name: w.spaces.forgetAccount + " image-editor",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "image-editor", exact: true }),
  ).toHaveCount(0);
});
test("login feedback: invalid origin, credentials, forbidden, rate limit and deadline", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  let status = 401;
  let hang = false;
  await page.route("**/api/session", async (route) => {
    if (hang && route.request().method() === "POST") return;
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({ error: "UNAUTHORIZED" }),
    });
  });
  await page.goto(workbench.url);
  await page.getByLabel(w.spaces.username, { exact: true }).fill("test-user");
  await page
    .getByLabel(w.spaces.password, { exact: true })
    .fill("wrong-password");
  const server = page.getByLabel(w.spaces.server, { exact: true });
  const enter = page.getByRole("button", { name: w.desk.enter, exact: true });
  await server.fill("https://example.com/path");
  await enter.click();
  await expect(page.getByRole("alert")).toHaveText(w.desk.loginInvalidServer);
  await expect(enter).toBeEnabled();
  await server.fill(workbench.url);
  for (const [code, message] of [
    [401, w.desk.loginCredentials],
    [403, w.desk.loginForbidden],
    [429, w.desk.loginRateLimited],
  ] as const) {
    status = code;
    await enter.click();
    await expect(page.getByRole("alert")).toHaveText(message);
    await expect(enter).toBeEnabled();
  }
  status = 200;
  await enter.click();
  await expect(page.getByRole("alert")).toHaveText(w.desk.loginInvalidResponse);
  hang = true;
  await enter.click();
  await expect(page.getByRole("status")).toHaveText(w.desk.loginDeadline);
  await expect(server).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveText(w.desk.loginTimeout, {
    timeout: 11000,
  });
  await expect(enter).toBeEnabled();
  await page.screenshot({
    path: info.outputPath("login-feedback.png"),
    fullPage: true,
  });
});
test("native session restoration after restart and expired session", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  // UI bridge substitute only: native encrypted persistence is separately tested in Rust.
  await page.addInitScript(() => {
    localStorage.setItem("orivane.atlas.server-origin", location.origin);
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        invoke: async (
          command: string,
          args: { path: string; payload?: string; csrf?: string },
        ) => {
          if (command === "configure_server") return;
          if (command !== "server_request")
            throw new Error("unexpected native command");
          const response = await fetch(args.path, {
            method: args.payload ? "POST" : "GET",
            credentials: "same-origin",
            ...(args.payload
              ? {
                  body: args.payload,
                  headers: {
                    "Content-Type": "application/json",
                    "X-CSRF-Token": args.csrf ?? "",
                  },
                }
              : {}),
          });
          const bytes = new Uint8Array(await response.arrayBuffer());
          return {
            status: response.status,
            contentType: response.headers.get("Content-Type"),
            body: btoa(
              Array.from(bytes, (b) => String.fromCharCode(b)).join(""),
            ),
          };
        },
      },
    });
  });
  await page.goto(workbench.url);
  await page
    .getByLabel(w.spaces.username, { exact: true })
    .fill("image-editor");
  await page
    .getByLabel(w.spaces.password, { exact: true })
    .fill(workbench.secret);
  await page.getByRole("button", { name: w.desk.enter, exact: true }).click();
  await expect(page.locator(".login-form")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".login-form")).toHaveCount(0);
  await expect(page.locator(".app-shell")).toBeVisible();
  await page.screenshot({
    path: info.outputPath("native-restored.png"),
    fullPage: true,
  });
  await page.context().clearCookies();
  await page.reload();
  await expect(page.locator(".login-form")).toBeVisible();
});

test("native updater UI: check, consent, progress, failure and retry", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    let attempts = 0;
    let installs = 0;
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (
          command: string,
          args: { progress: { onmessage: (value: unknown) => void } },
        ) => {
          if (command === "check_app_update") {
            attempts++;
            if (attempts === 1) throw new Error("offline");
            return {
              currentVersion: "0.0.4",
              version: attempts === 2 ? "0.0.5" : null,
              notes: "Verified release <script>not executed</script>",
              channel: "stable",
            };
          }
          if (command === "install_app_update") {
            installs++;
            args.progress.onmessage({ downloaded: 50, total: 100 });
            await new Promise((resolve) => setTimeout(resolve, 200));
            if (installs === 1) throw new Error("signature invalid");
            return;
          }
          throw new Error("unexpected native command");
        },
      },
    });
  });
  await page.goto(workbench.url);
  const panel = page.getByRole("region", { name: w.settings.updateTitle });
  await panel.getByRole("button", { name: w.settings.updateCheck }).click();
  await expect(panel.getByRole("status")).toHaveText(
    w.settings.updateState_error,
  );
  await panel.getByRole("button", { name: w.settings.updateCheck }).click();
  await expect(panel.getByRole("status")).toHaveText(
    w.settings.updateState_ready,
  );
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("native-updater.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  page.once("dialog", (dialog) => dialog.dismiss());
  await panel.getByRole("button", { name: w.settings.updateInstall }).click();
  await expect(panel.getByRole("status")).toHaveText(
    w.settings.updateState_ready,
  );
  page.once("dialog", (dialog) => dialog.accept());
  await panel.getByRole("button", { name: w.settings.updateInstall }).click();
  await expect(panel.getByRole("progressbar")).toHaveAttribute("value", "50");
  await expect(panel.getByRole("status")).toHaveText(
    w.settings.updateState_error,
  );
  page.once("dialog", (dialog) => dialog.accept());
  await panel.getByRole("button", { name: w.settings.updateInstall }).click();
  await expect(panel.getByRole("status")).toHaveText(
    w.settings.updateState_installer,
  );
  await panel.getByRole("button", { name: w.settings.updateCheck }).click();
  await expect(panel.getByRole("status")).toHaveText(
    w.settings.updateState_current,
  );
  expect(errors).toEqual([]);
});

test("web browser has no native updater", async ({ page, workbench }, info) => {
  await page.goto(workbench.url);
  await expect(
    page.getByRole("region", {
      name: words(info.project.name).settings.updateTitle,
    }),
  ).toHaveCount(0);
});
test("private image editing: modern picker, clipboard, concurrent typing and retry", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(workbench.url);
  await page
    .getByLabel(w.spaces.username, { exact: true })
    .fill("image-editor");
  await page
    .getByLabel(w.spaces.password, { exact: true })
    .fill(workbench.secret);
  await page.getByRole("button", { name: w.desk.enter, exact: true }).click();
  await nav(page, w.desk.notes);
  await page.locator(".page-heading").getByRole("button").click();
  await pane(page)
    .getByRole("button", { name: /^(Source|源码)$/ })
    .click();
  await pane(page)
    .locator(".document-tools > summary")
    .filter({ hasText: /^(Import, images and revisions|导入、图片与修订)$/ })
    .click();
  await pane(page)
    .getByLabel(w.desk.importMarkdown, { exact: true })
    .setInputFiles({
      name: "Image notebook.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Image notebook\n\nOriginal text"),
    });
  const editor = pane(page).getByLabel(w.desk.noteBody, { exact: true });
  await expect(editor).toContainText("Original text");
  await editor.focus();
  await page.keyboard.press("Control+End");
  await editor.evaluate((element) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", " plain paste");
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(editor).toContainText("plain paste");
  await saveDocument(page, w);
  await page.screenshot({
    path: info.outputPath("modern-upload.png"),
    fullPage: true,
  });
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXs8AAAAASUVORK5CYII=";
  async function paste(mime = "image/png") {
    await editor.evaluate(
      (element, data) => {
        const clipboard = new DataTransfer();
        clipboard.items.add(
          new File(
            [Uint8Array.from(atob(data.png), (c) => c.charCodeAt(0))],
            "pasted.png",
            { type: data.mime },
          ),
        );
        element.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: clipboard,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      { png, mime },
    );
  }
  await editor.focus();
  await page.keyboard.press("Control+End");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let uploadStarted = false;
  await page.route("**/api/library/upload-chunk", async (route) => {
    uploadStarted = true;
    expect(route.request().postDataJSON().spaceId).toBeNull();
    await held;
    await route.continue();
  });
  await paste();
  await expect.poll(() => uploadStarted).toBe(true);
  await page.keyboard.type(" kept while uploading");
  await nav(page, w.desk.tasks);
  release();
  await page.getByRole("tab", { name: /Image notebook/ }).click();
  await expect(editor).toContainText(/api\/library\/asset/);
  await expect(editor).toContainText("kept while uploading");
  await page.unroute("**/api/library/upload-chunk");
  await saveDocument(page, w);
  await paste("image/svg+xml");
  await expect(pane(page).getByRole("alert")).toContainText("PNG");
  await page.route("**/api/library/upload-chunk", (route) => route.abort());
  await paste();
  await expect(pane(page).getByRole("alert").last()).toContainText(
    /上传失败|upload failed/,
  );
  await expect(editor).toContainText("kept while uploading");
  await page.unroute("**/api/library/upload-chunk");
  await pane(page)
    .getByLabel(w.spaces.image, { exact: true })
    .setInputFiles({
      name: "selected.png",
      mimeType: "image/png",
      buffer: Buffer.concat([Buffer.from(png, "base64"), Buffer.alloc(700000)]),
    });
  await expect
    .poll(
      async () =>
        ((await editor.textContent())?.match(/api\/library\/asset/g) ?? [])
          .length,
    )
    .toBe(2);
  await saveDocument(page, w);
  await pane(page)
    .getByRole("button", { name: w.desk.read, exact: true })
    .click();
  const images = pane(page).locator(".document-reading img");
  await expect(images).toHaveCount(2);
  await expect
    .poll(() =>
      images.evaluateAll((items) =>
        items.every((item) => (item as HTMLImageElement).naturalWidth > 0),
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("private-images.png"),
    fullPage: true,
  });
  const snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(snapshot.notes[0].bodyMd).toContain("kept while uploading");
  expect(snapshot.notes[0].bodyMd).toContain("plain paste");
  expect(snapshot.notes[0].bodyMd.match(/api\/library\/asset/g)).toHaveLength(
    2,
  );
  expect(errors).toEqual([]);
});
test("organization selection archive delete gradients and readable typography", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await unlock(page, workbench.url, workbench.secret, w);
  const tasks = [];
  for (const title of ["First task", "Second task", "Third task"])
    tasks.push(await mutation(page, "/api/work/create", { title }));
  await mutation(page, "/api/work/update", {
    id: tasks[1].id,
    version: 1,
    input: { status: "DONE" },
  });
  for (const title of ["Lecture A", "Lecture B"])
    await mutation(page, "/api/note/save", {
      id: null,
      version: 0,
      input: { title, bodyMd: "Keep $E=mc^2$ intact", kind: "NOTE", day: null },
    });
  await page.reload();
  await nav(page, w.desk.tasks);
  await expect(page.locator(".task-card")).toHaveCount(3);
  await expect(page.locator(".task-title").first()).toHaveCSS(
    "font-size",
    "16px",
  );
  const backgrounds = await page
    .locator(".task-card")
    .evaluateAll((elements) =>
      elements.map((e) => getComputedStyle(e).backgroundImage),
    );
  expect(new Set(backgrounds).size).toBe(3);
  expect(backgrounds.every((b) => b.includes("linear-gradient"))).toBe(true);
  await page.screenshot({
    path: info.outputPath("task-gradients.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: w.desk.archive + ": First task", exact: true })
    .click();
  await expect(page.locator(".task-card")).toHaveCount(2);
  await page.getByLabel(w.desk.showArchived).check();
  await expect(page.locator(".task-card")).toHaveCount(1);
  await page
    .getByRole("button", {
      name: w.desk.unarchive + ": First task",
      exact: true,
    })
    .click();
  await expect(page.locator(".task-card")).toHaveCount(0);
  await page.getByLabel(w.desk.showArchived).uncheck();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", {
      name: w.desk.deleteItem + ": Second task",
      exact: true,
    })
    .click();
  await expect(page.locator(".task-card")).toHaveCount(2);
  await nav(page, w.desk.notes);
  await page.getByLabel(w.desk.selectVisible).check();
  await page.getByLabel(w.desk.destinationFolder).fill("量子场论");
  await page
    .getByRole("button", { name: w.desk.moveSelected, exact: true })
    .click();
  await expect(page.locator(".note-selection span").first()).toHaveText(
    "量子场论",
  );
  await page.getByLabel(w.desk.folderFilter).selectOption("folder:");
  await expect(page.locator(".note-card")).toHaveCount(0);
  await page.getByLabel(w.desk.folderFilter).selectOption("folder:量子场论");
  await expect(page.locator(".note-card")).toHaveCount(2);
  await page.getByLabel(w.desk.selectVisible).check();
  await page.screenshot({
    path: info.outputPath("bulk-notes.png"),
    fullPage: true,
  });
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: w.desk.deleteSelected, exact: true })
    .click();
  await expect(page.locator(".note-card")).toHaveCount(0);
  await nav(page, w.desk.trash);
  await expect(page.locator(".trash-list")).toContainText("Lecture A");
  await expect(page.locator(".trash-list")).toContainText("Second task");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("inline and block math render while editing without changing source", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.notes);
  await page.locator(".page-heading").getByRole("button").click();
  await pane(page).getByLabel(w.desk.noteTitle).fill("Math live");
  const body = pane(page).getByLabel(w.desk.noteBody);
  const tick = String.fromCharCode(96);
  const text =
    "# Lecture\n\nEnergy $E=mc^2$ and $x$.\n\n$$\n\\int_0^1 x\\,dx = \\frac12\n$$\n\n" +
    tick +
    "$code$" +
    tick +
    "\n\n~~~tex\n$notmath$\n~~~\n\nEnd";
  await body.fill(text);
  await body.press("Control+End");
  await expect(pane(page).locator(".md-live-math .katex")).toHaveCount(3);
  await expect(body).toHaveCSS("font-size", "18px");
  await pane(page).locator(".md-live-math").first().click();
  await expect(body).toContainText("$E=mc^2$");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.insertText("0");
  await expect(
    pane(page).locator(".md-live-math .katex").first(),
  ).toContainText("0");
  await page.screenshot({
    path: info.outputPath("inline-math-live.png"),
    fullPage: true,
  });
  await expect
    .poll(
      async () =>
        (await (await page.request.get(workbench.url + "/api/snapshot")).json())
          .notes[0]?.bodyMd,
    )
    .toBe(text.replace("$E=mc^2$", "$E0=mc^2$"));
  expect(errors).toEqual([]);
});
test("brand stays transparent and compact on login and sidebar", async ({
  page,
  workbench,
}, info) => {
  await page.goto(workbench.url);
  const logo = page.getByRole("img", { name: "Orivane Atlas", exact: true });
  await expect(logo).toBeVisible();
  await expect(logo).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(logo).toHaveCSS("border-radius", "0px");
  await expect(logo).toHaveCSS("filter", "brightness(0) invert(0.93)");
  expect((await logo.boundingBox())?.width).toBeLessThanOrEqual(260);
  // Verify that the shipped image itself retains transparency, not just CSS.
  expect(
    await logo.evaluate(async (element) => {
      const image = element as HTMLImageElement;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, 1, 1).data[3];
    }),
  ).toBe(0);
  await page.screenshot({
    path: info.outputPath("brand-login.png"),
    fullPage: true,
  });
  await unlock(page, workbench.url, workbench.secret, words(info.project.name));
  await expect(logo).toBeVisible();
  await expect(logo).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(logo).toHaveCSS("border-radius", "0px");
  expect((await logo.boundingBox())?.width).toBeLessThanOrEqual(
    info.project.name.startsWith("mobile") ? 126 : 180,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("brand-sidebar.png"),
    fullPage: true,
  });
});
test("accounts admin review and lecture Markdown images PDF work end to end", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    a = w.spaces;
  // Accounts are provisioned offline; public registration/legacy claim stay disabled.
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, a.admin);
  await expect(page.getByText("student", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: a.approve, exact: true }).click();
  await expect(
    page.getByRole("button", { name: a.disable, exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("admin.png"), fullPage: true });
  await nav(page, w.desk.settings);
  await page.getByRole("button", { name: w.desk.lock, exact: true }).click();
  await page.getByLabel(a.username, { exact: true }).fill("image-editor");
  await page.getByLabel(a.password, { exact: true }).fill(workbench.secret);
  await page.getByRole("button", { name: w.desk.enter, exact: true }).click();
  await nav(page, a.account);
  await page.getByLabel(a.tokenName, { exact: true }).fill("Local research AI");
  await page.getByRole("button", { name: a.issue, exact: true }).click();
  await expect(page.getByText(a.once, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: a.closeSecret, exact: true }).click();
  await page.screenshot({
    path: info.outputPath("account-api.png"),
    fullPage: true,
  });
  await nav(page, a.library);
  await page.getByRole("button", { name: a.newSpace, exact: true }).click();
  await page
    .getByLabel(a.spaceTitle, { exact: true })
    .fill("量子场论 / Quantum Field Theory");
  await page
    .getByLabel(a.body, { exact: true })
    .fill("A dedicated space for lecture notes and illustrations.");
  await saveDocument(page, w);
  await browseDocuments(page);
  await page
    .locator(".note-card")
    .filter({ hasText: "Quantum Field Theory" })
    .click();
  await page.getByRole("button", { name: a.newLecture, exact: true }).click();
  await page
    .getByLabel(a.title, { exact: true })
    .fill("第一讲：场与对称性 / Fields and symmetry");
  const markdown =
    "## 1. Overview\n\nA **field** assigns a value to every point in spacetime.\n\n$$ E^2=p^2c^2+m^2c^4 $$\n\n| Symbol | Meaning |\n| --- | --- |\n| E | Energy |\n| p | Momentum |\n\n- [x] Review the notation\n- [ ] Derive the equations\n\n<script>window.untrusted=true</script>\n\n![blocked](https://example.invalid/private.png)";
  await pane(page).getByLabel(a.body, { exact: true }).fill(markdown);
  await pane(page)
    .locator(".document-tools > summary")
    .filter({ hasText: /^(Import, images and revisions|导入、图片与修订)$/ })
    .click();
  await pane(page)
    .getByLabel(a.image, { exact: true })
    .setInputFiles({
      name: "figure.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXs8AAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await expect(pane(page).getByLabel(a.body, { exact: true })).toContainText(
    /api\/library\/asset/,
  );
  await nav(page, w.desk.tasks);
  await expect(
    page.getByRole("tab", { name: /Fields and symmetry/ }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Fields and symmetry/ }).click();
  await saveDocument(page, w);
  await pane(page)
    .getByRole("button", { name: w.desk.read, exact: true })
    .click();
  await expect(pane(page).locator(".document-reading .katex")).toHaveCount(1);
  await expect(pane(page).locator(".document-reading table")).toHaveCount(1);
  await expect(pane(page).locator(".document-reading img")).toHaveCount(1);
  await expect(pane(page).locator(".document-reading script")).toHaveCount(0);
  expect(
    await pane(page)
      .locator(".document-reading img")
      .evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      ),
  ).toBe(true);
  const savedMetadata = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("orivane.atlas.saved-accounts") ?? "[]"),
  );
  expect(savedMetadata).toHaveLength(1);
  expect(JSON.stringify(savedMetadata)).not.toContain(workbench.secret);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("lecture.png"),
    fullPage: true,
  });
  if (info.project.name === "desktop-zh") {
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({
      path: info.outputPath("lecture.pdf"),
      format: "A4",
      printBackground: true,
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }
  await pane(page)
    .getByRole("button", { name: w.desk.revisions, exact: true })
    .click();
  await expect(
    pane(page).locator(".document-tools details").first(),
  ).toBeAttached();
  await nav(page, a.library);
  await page.reload();
  await page
    .locator(".note-card")
    .filter({ hasText: "Quantum Field Theory" })
    .click();
  await page
    .locator(".note-card")
    .filter({ hasText: "Fields and symmetry" })
    .click();
  await pane(page)
    .getByRole("button", { name: w.desk.read, exact: true })
    .click();
  await expect(pane(page).locator(".document-reading .katex")).toHaveCount(1);
});
test("knowledge references and AI approval preserve private content and never auto-edit", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    c = w.connected;
  await unlock(page, workbench.url, workbench.secret, w);
  const note = await mutation(page, "/api/note/save", {
    id: null,
    version: 0,
    input: {
      title: "Research note",
      bodyMd: "PRIVATE fulltext-marker",
      kind: "NOTE",
      day: null,
    },
  });
  const task = await mutation(page, "/api/work/create", {
    title: "Follow-up task",
  });
  await nav(page, w.desk.knowledge);
  await expect(page.locator(".knowledge-result")).toHaveCount(2, {
    timeout: 10000,
  });
  await page.getByLabel(c.search, { exact: true }).fill("fulltext-marker");
  await expect(page.locator(".knowledge-result")).toHaveCount(1);
  await page.locator(".knowledge-result").click();
  await page
    .getByLabel(c.target, { exact: true })
    .selectOption("WORK:" + task.id);
  await page.getByRole("button", { name: c.addLink, exact: true }).click();
  await expect(page.locator(".knowledge-link")).toContainText("Follow-up task");
  await page.locator(".knowledge-link").getByRole("button").first().click();
  await expect(page.locator(".knowledge-link")).toContainText(c.incoming);
  await expect(page.locator(".knowledge-link")).toContainText("Research note");
  await page.getByLabel(c.search, { exact: true }).fill("");
  await page.screenshot({
    path: info.outputPath("knowledge.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await nav(page, w.desk.ai);
  await page
    .getByLabel(c.prompt, { exact: true })
    .fill("Only explicit request");
  await page.getByRole("button", { name: c.propose, exact: true }).click();
  await expect(page.locator(".ai-run")).toContainText(c.WAITING_APPROVAL);
  await expect(page.locator(".ai-run .markdown")).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("ai-approval.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: c.approve, exact: true }).click();
  await expect(page.locator(".ai-run")).toContainText(c.SUCCEEDED, {
    timeout: 10000,
  });
  await expect(page.locator(".ai-run .markdown")).toContainText(
    "Only explicit request",
  );
  await expect(page.locator(".ai-run")).not.toContainText("PRIVATE");
  const snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(snapshot.notes[0]).toEqual(note);
  expect(snapshot.items).toEqual([task]);
  expect(snapshot.links).toHaveLength(1);
  await page.screenshot({
    path: info.outputPath("ai-result.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("mixed knowledge canvas renders undirected cycles and opens a lecture", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const note = await mutation(page, "/api/note/save", {
    id: null,
    version: 0,
    input: {
      title: "Field notes",
      bodyMd: "Raw note",
      kind: "NOTE",
      day: null,
    },
  });
  const task = await mutation(page, "/api/work/create", {
    title: "Research task",
  });
  const space = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "SPACE",
      spaceId: null,
      title: "Quantum fields",
      bodyMd: "Space",
    },
  });
  const lecture = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "DOCUMENT",
      spaceId: space.id,
      title: "Symmetry lecture",
      bodyMd: "# Symmetry",
    },
  });
  const refs = [
    { kind: "NOTE", id: note.id },
    { kind: "WORK", id: task.id },
    { kind: "SPACE", id: space.id },
    { kind: "DOCUMENT", id: lecture.id },
  ];
  for (let i = 0; i < refs.length; i++)
    await mutation(page, "/api/link/create", {
      from: refs[i],
      to: refs[(i + 1) % refs.length],
      relation: "RELATED",
    });
  await mutation(page, "/api/link/create", {
    from: refs[0],
    to: refs[2],
    relation: "REFERENCES",
  });
  await nav(page, w.desk.knowledge);
  const graph = page.locator(".graph-section");
  await expect(graph.locator(".react-flow__node")).toHaveCount(4, {
    timeout: 10000,
  });
  await expect(graph.locator(".react-flow__edge")).toHaveCount(5);
  await expect(graph.locator(".react-flow__edge-path[marker-end]")).toHaveCount(
    1,
  );
  await page.screenshot({
    path: info.outputPath("mixed-knowledge.png"),
    fullPage: true,
  });
  const filter = graph.getByLabel(
    info.project.name.endsWith("zh") ? "节点类型" : "Node type",
  );
  await filter.selectOption("DOCUMENT");
  await expect(graph.locator(".react-flow__node")).toHaveCount(1);
  await graph.locator(".react-flow__node").dblclick();
  await expect(
    pane(page).getByLabel(w.spaces.title, { exact: true }),
  ).toHaveValue("Symmetry lecture");
  await expect(
    pane(page).getByLabel(w.spaces.body, { exact: true }),
  ).toContainText("# Symmetry");
});

test("two independent sessions sync updates without replacing an open draft", async ({
  page,
  browser,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const task = await mutation(page, "/api/work/create", {
    title: "Shared task",
  });
  await nav(page, w.desk.tasks);
  await expect(page.locator(".task-card")).toContainText("Shared task", {
    timeout: 10000,
  });
  await page
    .getByRole("button", { name: /Shared task/ })
    .first()
    .click();
  const title = page
    .getByRole("dialog")
    .getByLabel(w.work.title, { exact: true });
  await title.fill("My unsaved draft");
  const other = await browser.newContext({ locale: "en-US" });
  try {
    const second = await other.newPage();
    await unlock(second, workbench.url, workbench.secret, words("en"));
    await mutation(second, "/api/work/update", {
      id: task.id,
      version: 1,
      input: { title: "Changed on second device" },
    });
    await page.bringToFront();
    await expect(page.locator(".task-card")).toContainText(
      "Changed on second device",
      { timeout: 10000 },
    );
    await expect(title).toHaveValue("My unsaved draft");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: w.common.save, exact: true })
      .click();
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await expect(title).toHaveValue("My unsaved draft");
    await page.route("**/api/sync?*", (route) => route.abort("failed"));
    await expect(page.locator(".topbar")).toContainText(w.connected.offline, {
      timeout: 10000,
    });
    await expect(title).toHaveValue("My unsaved draft");
  } finally {
    await other.close();
  }
});

test("projects, dates, calendar, Markdown import and full backup are real", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.projects);
  await page.locator(".page-heading").getByRole("button").click();
  await page
    .getByRole("dialog")
    .getByLabel(w.work.title, { exact: true })
    .fill("Autumn launch");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: w.common.create, exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".project-card")).toHaveCount(1);
  await nav(page, w.desk.tasks);
  await page.locator(".page-heading").getByRole("button").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(w.work.title, { exact: true }).fill("Ship planning");
  await dialog
    .getByLabel(w.desk.project, { exact: true })
    .selectOption({ label: "Autumn launch" });
  await dialog.getByLabel(w.desk.startDate).fill("2026-09-14");
  await dialog.getByLabel(w.desk.dueDate).fill("2026-09-21");
  await dialog
    .getByRole("button", { name: w.common.create, exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.locator(".task-card")).toContainText("2026-09-21");
  await expect(page.locator(".task-project")).toHaveText("Autumn launch");
  await nav(page, w.desk.projects);
  await expect(page.locator(".project-card")).toContainText("0 / 1");
  await page.screenshot({
    path: info.outputPath("projects.png"),
    fullPage: true,
  });
  await nav(page, w.desk.calendar);
  // Calendar follows the local day; fixture dates are picked from the visible month.
  const currentDay = await page
    .locator(".calendar-day.is-today")
    .getAttribute("aria-label");
  const snap = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  const task = snap.items.find(
    (item: { title: string }) => item.title === "Ship planning",
  );
  await mutation(page, "/api/work/update", {
    id: task.id,
    version: task.version,
    input: { startDate: null, dueDate: currentDay },
  });
  await page.reload();
  await page.locator(".calendar-day.is-today").click();
  await expect(pane(page)).toBeVisible();
  expect(
    (await (await page.request.get(workbench.url + "/api/snapshot")).json())
      .notes,
  ).toEqual([]);
  await browseDocuments(page);
  await expect(page.locator(".agenda-item")).toContainText("Ship planning");
  await page.screenshot({
    path: info.outputPath("calendar.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await nav(page, w.desk.notes);
  await page.locator(".page-heading").getByRole("button").click();
  const markdown = "# 原始 Markdown\r\n\r\n- [ ] 仅是正文，不是任务\r\n";
  // Wait for the new tab, not the calendar tab briefly visible during navigation.
  await expect(pane(page).getByLabel(w.desk.noteTitle)).toHaveValue("");
  await pane(page)
    .locator(".document-tools > summary")
    .filter({ hasText: /^(Import, images and revisions|导入、图片与修订)$/ })
    .click();
  await pane(page)
    .getByLabel(w.desk.importMarkdown)
    .setInputFiles({
      name: "Research.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(markdown),
    });
  await expect(pane(page).getByLabel(w.desk.noteBody)).toContainText(
    "仅是正文，不是任务",
  );
  await saveDocument(page, w);
  const after = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(after.items).toHaveLength(2);
  expect(after.notes[0].bodyMd).toBe(markdown);
  await nav(page, w.desk.settings);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: w.desk.backupDatabase }).click();
  const file = await downloaded;
  const target = info.outputPath("database.sqlite");
  await file.saveAs(target);
  expect(readFileSync(target).subarray(0, 16).toString()).toBe(
    "SQLite format 3\0",
  );
});

test("uncertain network retry is idempotent and committed saves close after refresh failure", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.tasks);
  let first = true;
  await page.route("**/api/work/create", async (route) => {
    if (first) {
      first = false;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.locator(".page-heading").getByRole("button").click();
  await page
    .getByRole("dialog")
    .getByLabel(w.work.title, { exact: true })
    .fill("Uncertain save");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: w.common.create, exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: w.common.create, exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.route("**/api/sync?*", (route) => route.abort("failed"));
  await page.locator(".page-heading").getByRole("button").click();
  await page
    .getByRole("dialog")
    .getByLabel(w.work.title, { exact: true })
    .fill("Committed without refresh");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: w.common.create, exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.unroute("**/api/sync?*");
  await page
    .locator(".topbar")
    .getByRole("button", { name: w.desk.refresh })
    .click();
  await expect(page.getByRole("article")).toHaveCount(2);
});
async function unlock(
  page: Page,
  url: string,
  secret: string,
  w: ReturnType<typeof words>,
) {
  await page.goto(url);
  await page
    .getByLabel(w.spaces.username, { exact: true })
    .fill("image-editor");
  await page.getByLabel(w.spaces.password, { exact: true }).fill(secret);
  await page.getByRole("button", { name: w.desk.enter, exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
}
async function mutation(page: Page, path: string, value: unknown) {
  const origin = new URL(page.url()).origin;
  const session = await (
    await page.request.get(origin + "/api/session")
  ).json();
  const response = await page.request.post(origin + path, {
    data: value,
    headers: {
      Origin: origin,
      "X-CSRF-Token": session.csrf,
      "Idempotency-Key": randomUUID(),
    },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}
async function nav(page: Page, name: string) {
  await page
    .locator(".sidebar")
    .getByRole("button", { name: new RegExp("^" + name + "(?: [0-9]+)?$") })
    .click();
}
function pane(page: Page) {
  return page.locator(".document-pane:visible");
}
async function browseDocuments(page: Page) {
  await page.locator(".document-tabs > button").click();
}
async function saveDocument(page: Page, w: ReturnType<typeof words>) {
  await pane(page)
    .getByRole("button", { name: w.common.save, exact: true })
    .click();
  await expect(
    pane(page).locator(".document-toolbar [role=status]"),
  ).toHaveText(/^(Saved|已保存)$/);
}
async function createTask(
  page: Page,
  w: ReturnType<typeof words>,
  title: string,
) {
  await page.locator(".page-heading").getByRole("button").click();
  await page
    .getByRole("dialog")
    .getByLabel(w.work.title, { exact: true })
    .fill(title);
  await page
    .getByLabel(w.work.description, { exact: true })
    .fill("# 原文\n\n- [ ] Keep Markdown");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: w.common.create, exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
}

test("task edits, persistence, language, trash and recovery", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.tasks);
  await createTask(page, w, "第一项 task");
  await page.reload();
  const openTask = page
    .locator(".task-title")
    .filter({ hasText: "第一项 task" });
  await expect(openTask).toBeVisible();
  await openTask.click();
  await expect(
    page.getByLabel(w.work.description, { exact: true }),
  ).toHaveValue("# 原文\n\n- [ ] Keep Markdown");
  await page.getByLabel(w.work.title, { exact: true }).fill("Edited 中文 task");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: w.common.save, exact: true })
    .click();
  await nav(page, w.desk.settings);
  await page
    .getByLabel(w.settings.language, { exact: true })
    .selectOption("en-US");
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await nav(page, "Tasks");
  await page.getByLabel("Status for Edited 中文 task").selectOption("DONE");
  await expect(page.getByLabel("Status for Edited 中文 task")).toHaveValue(
    "DONE",
  );
  await page
    .getByRole("button", { name: "Open task: Edited 中文 task", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Move to trash", exact: true })
    .click();
  await nav(page, "Trash");
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await nav(page, "Tasks");
  await page.reload();
  await expect(page.getByLabel("Status for Edited 中文 task")).toHaveValue(
    "DONE",
  );
  expect(errors).toEqual([]);
});

test("dependencies, filters and board transitions", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const a = await mutation(page, "/api/work/create", {
    title: "Prerequisite A",
    priority: "HIGH",
  });
  const b = await mutation(page, "/api/work/create", {
    title: "Dependent B",
    priority: "LOW",
  });
  await mutation(page, "/api/edge/create", { fromId: a.id, toId: b.id });
  await page.reload();
  await nav(page, w.desk.tasks);
  const statusB = page.getByLabel(
    w.common.statusLabel.replace("{{title}}", "Dependent B"),
  );
  await statusB.selectOption("IN_PROGRESS");
  await expect(page.getByRole("alert")).toContainText(
    w.errors.WORK_ITEM_BLOCKED,
  );
  await nav(page, w.desk.dependencies);
  await page
    .getByLabel(w.work.prerequisite, { exact: true })
    .selectOption(b.id);
  await page.getByLabel(w.work.dependent, { exact: true }).selectOption(a.id);
  await page
    .getByRole("button", { name: w.work.addDependency, exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    w.errors.WORK_GRAPH_CYCLE_DETECTED,
  );
  await nav(page, w.desk.tasks);
  await page
    .getByLabel(w.common.statusLabel.replace("{{title}}", "Prerequisite A"))
    .selectOption("DONE");
  await statusB.selectOption("IN_PROGRESS");
  await expect(statusB).toHaveValue("IN_PROGRESS");
  await page.getByLabel(w.desk.priority, { exact: true }).selectOption("HIGH");
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByLabel(w.desk.priority, { exact: true }).selectOption("ALL");
  await page.getByRole("textbox", { name: w.desk.search }).fill("Dependent");
  await expect(page.getByRole("article")).toHaveCount(1);
  await nav(page, w.desk.board);
  if (!info.project.name.startsWith("mobile")) {
    await page
      .getByRole("article")
      .filter({ hasText: "Dependent B" })
      .dragTo(
        page.locator(".board-column").filter({
          has: page.getByRole("heading", {
            name: new RegExp(w.work.statuses.DONE),
          }),
        }),
      );
  } else
    await page
      .getByLabel(w.common.statusLabel.replace("{{title}}", "Dependent B"))
      .selectOption("DONE");
  await expect(
    page.getByLabel(w.common.statusLabel.replace("{{title}}", "Dependent B")),
  ).toHaveValue("DONE");
});

test("notes, safe reading, revision restore, journal and export", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.notes);
  await page.locator(".page-heading").getByRole("button").click();
  await page
    .getByLabel(w.desk.noteTitle, { exact: true })
    .fill("Original note");
  const text =
    "# 原文\n<script>window.hacked=true</script>\n- [ ] Preserve this";
  await page.getByLabel(w.desk.noteBody, { exact: true }).fill(text);
  await page.getByRole("button", { name: w.desk.read, exact: true }).click();
  await expect(pane(page).locator(".document-reading .markdown")).toContainText(
    "<script>window.hacked=true</script>",
  );
  expect(
    await page.evaluate(() => Reflect.get(window, "hacked")),
  ).toBeUndefined();
  await saveDocument(page, w);
  await page.reload();
  await page.locator(".note-card").click();
  await pane(page)
    .getByRole("button", { name: /^(Source|源码)$/ })
    .click();
  await expect(
    pane(page).getByLabel(w.desk.noteBody, { exact: true }),
  ).toHaveText(text, { useInnerText: true });
  await page
    .getByLabel(w.desk.noteBody, { exact: true })
    .fill("Second revision");
  await saveDocument(page, w);
  await page
    .getByRole("button", { name: w.desk.revisions, exact: true })
    .click();
  await pane(page)
    .locator(".document-tools > summary")
    .filter({ hasText: /^(Import, images and revisions|导入、图片与修订)$/ })
    .click();
  await pane(page)
    .locator(".document-tools details")
    .last()
    .locator("summary")
    .click();
  await page
    .locator("details")
    .last()
    .getByRole("button", { name: w.desk.useRevision })
    .click();
  await expect(
    pane(page).getByLabel(w.desk.noteBody, { exact: true }),
  ).toHaveText(text, { useInnerText: true });
  await saveDocument(page, w);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: w.desk.exportMarkdown, exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("Original note.md");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: w.common.delete, exact: true })
    .click();
  await nav(page, w.desk.trash);
  await page
    .getByRole("button", { name: w.common.restore, exact: true })
    .click();
  await nav(page, w.desk.journal);
  await page.locator(".page-heading").getByRole("button").click();
  await page
    .getByLabel(w.desk.noteBody, { exact: true })
    .fill("Today's reflection");
  await saveDocument(page, w);
  await browseDocuments(page);
  await page.locator(".page-heading").getByRole("button").click();
  await expect(
    pane(page).getByLabel(w.desk.noteBody, { exact: true }),
  ).toHaveText("Today's reflection");
  await browseDocuments(page);
  await expect(page.locator(".note-card")).toHaveCount(1);
});

test("live blocks autosave IME tabs and calendar journal recovery", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  const snapshot = async () =>
    await (await page.request.get(workbench.url + "/api/snapshot")).json();
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.notes);
  await page.locator(".page-heading").getByRole("button").click();
  const title = pane(page).getByLabel(w.desk.noteTitle);
  const body = pane(page).getByLabel(w.desk.noteBody);
  await title.fill("Live lecture");
  const markdown =
    "# Lecture\n\n$$E=mc^2$$\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nEnd";
  await body.fill(markdown);
  await body.press("Control+End");
  await expect(
    pane(page).locator(".md-live-math .katex").first(),
  ).toBeVisible();
  await expect(pane(page).locator(".md-live-widget table")).toBeVisible();
  expect(
    await pane(page)
      .locator(".md-live-widget")
      .evaluateAll((elements) =>
        elements.every((e) => e.getBoundingClientRect().height < 200),
      ),
  ).toBe(true);
  await expect
    .poll(async () => (await snapshot()).notes[0]?.bodyMd)
    .toBe(markdown);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("live-editor.png"),
    fullPage: true,
  });
  // A composition session must not create an intermediate revision.
  const version = (await snapshot()).notes[0].version;
  await title.dispatchEvent("compositionstart");
  await title.fill("输入中的讲义");
  await page.waitForTimeout(1200);
  expect((await snapshot()).notes[0].version).toBe(version);
  await title.dispatchEvent("compositionend");
  await title.press("Control+s");
  await expect
    .poll(async () => (await snapshot()).notes[0].title)
    .toBe("输入中的讲义");
  await nav(page, w.desk.calendar);
  await page.locator(".calendar-day.is-today").click();
  await expect(pane(page).getByLabel(w.desk.noteTitle)).not.toHaveValue(
    "输入中的讲义",
  );
  await page.waitForTimeout(1100);
  expect((await snapshot()).notes).toHaveLength(1);
  await body.fill("Today's unique journal");
  await body.press("Control+s");
  await expect.poll(async () => (await snapshot()).notes.length).toBe(2);
  await page.getByRole("tab", { name: "输入中的讲义", exact: true }).click();
  await expect(pane(page).locator(".md-live-widget table")).toBeVisible();
  await nav(page, w.desk.calendar);
  await page.locator(".calendar-day.is-today").click();
  await expect(body).toHaveText("Today's unique journal");
  expect(await page.getByRole("tab").count()).toBe(2);
  page.once("dialog", (dialog) => dialog.accept());
  await pane(page)
    .getByRole("button", { name: w.common.delete, exact: true })
    .click();
  await nav(page, w.desk.calendar);
  await page.locator(".calendar-day.is-today").click();
  await pane(page)
    .getByRole("button", { name: /^(恢复文档|Restore document)$/ })
    .click();
  await expect
    .poll(
      async () =>
        (await snapshot()).notes.filter(
          (n: { deletedAt: string | null }) => !n.deletedAt,
        ).length,
    )
    .toBe(2);
  await expect(body).toHaveText("Today's unique journal");
});

test("localized product layouts, unsaved draft guard and lock", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await page.goto(workbench.url);
  await page.screenshot({ path: info.outputPath("login.png"), fullPage: true });
  await unlock(page, workbench.url, workbench.secret, w);
  await page.screenshot({
    path: info.outputPath("empty-overview.png"),
    fullPage: true,
  });
  const titles = info.project.name.endsWith("zh")
    ? [
        "整理本周工作优先级",
        "完成产品交互走查",
        "准备下一轮用户访谈",
        "发布第一版使用指南",
      ]
    : [
        "Plan this week’s priorities",
        "Review the product experience",
        "Prepare the next user interviews",
        "Publish the first quick-start guide",
      ];
  for (const [index, title] of titles.entries()) {
    const task = await mutation(page, "/api/work/create", {
      title,
      priority: index === 0 ? "HIGH" : "MEDIUM",
    });
    if (index === 1 || index === 3)
      await mutation(page, "/api/work/update", {
        id: task.id,
        version: 1,
        input: { status: index === 1 ? "IN_PROGRESS" : "DONE" },
      });
  }
  for (const title of info.project.name.endsWith("zh")
    ? ["让工作更有方向", "一个值得探索的想法", "本周回顾"]
    : [
        "A little more clarity",
        "An idea worth exploring",
        "Weekly reflection",
      ]) {
    await mutation(page, "/api/note/save", {
      id: null,
      version: 0,
      input: {
        title,
        bodyMd: info.project.name.endsWith("zh")
          ? "# 思考与记录\n\n把模糊的想法写下来，下一步就会逐渐清晰。\n- [ ] 为重要的事情留一点空间。"
          : "# Thoughts and observations\n\nPut the idea into words. The next step will follow.\n- [ ] Make room for what matters.",
        kind: "NOTE",
        day: null,
      },
    });
  }
  await page.reload();
  await page.screenshot({
    path: info.outputPath("overview.png"),
    fullPage: true,
  });
  for (const view of ["tasks", "board", "notes", "settings"] as const) {
    await nav(page, w.desk[view]);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(view + ".png"),
      fullPage: true,
    });
  }
  await nav(page, w.desk.notes);
  await page.locator(".note-card").first().click();
  await page.screenshot({
    path: info.outputPath("note-editor.png"),
    fullPage: true,
  });
  await page.route("**/api/note/save", (route) => route.abort("failed"));
  // Select through CodeMirror's keymap: DOM fill can race live decorations
  // and replace only the visible DOM selection on mobile.
  const draftBody = pane(page).getByLabel(w.desk.noteBody, { exact: true });
  await draftBody.press("ControlOrMeta+a");
  await page.keyboard.insertText("unsaved");
  await expect(draftBody).toHaveText("unsaved");
  await expect(pane(page).getByRole("alert")).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .locator(".document-tab")
    .getByRole("button", { name: /^(Close|关闭) / })
    .click();
  await expect(
    pane(page).getByLabel(w.desk.noteBody, { exact: true }),
  ).toHaveText("unsaved");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .locator(".document-tab")
    .getByRole("button", { name: /^(Close|关闭) / })
    .click();
  await nav(page, w.desk.settings);
  await page.getByRole("button", { name: w.desk.lock, exact: true }).click();
  await expect(page.getByLabel(w.spaces.username)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(w.spaces.username)).toBeVisible();
});
