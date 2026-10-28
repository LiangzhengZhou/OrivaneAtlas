import {
  activeReplicaIdentity,
  setLocalCommandFailure,
  waitForLocalReplay,
} from "./replica-evidence";

/** Fixture ingestion is setup, outside the measured interaction budget. */
async function waitForFixtureReplica(page: Page, projectTitle?: string) {
  const response = await page.request.get(
    new URL("/api/bootstrap", page.url()).href,
  );
  expect(response.ok()).toBe(true);
  const manifest: { cursor: number; epoch: string } = await response.json();
  const readiness = { ...manifest, projectTitle };
  await expect
    .poll(
      () =>
        page.evaluate(async ({ cursor, epoch, projectTitle }) => {
          if (
            projectTitle &&
            document.querySelector(".project-workspace h1")?.textContent !==
              projectTitle
          )
            return false;
          for (const database of await indexedDB.databases()) {
            if (!database.name) continue;
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const request = indexedDB.open(database.name!);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            try {
              if (!db.objectStoreNames.contains("sync")) continue;
              const states = await new Promise<
                { cursor: number; epoch: string }[]
              >((resolve, reject) => {
                const request = db
                  .transaction("sync")
                  .objectStore("sync")
                  .getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              });
              if (
                states.some(
                  (state) => state.epoch === epoch && state.cursor >= cursor,
                )
              )
                return true;
            } finally {
              db.close();
            }
          }
          return false;
        }, readiness),
      {
        timeout: 120000,
        message: "fixture canonical cursor durably ingested before measurement",
      },
    )
    .toBe(true);
}
async function prepareOfflineShell(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => resolve(),
          { once: true },
        ),
      );
  });
}
async function openCalendarJournal(page: Page, title: string) {
  const action = page
    .locator(".calendar-agenda-actions")
    .getByRole("button", { name: title, exact: true });
  await action.evaluate((element) =>
    element.scrollIntoView({ block: "center" }),
  );
  await action.click();
}
async function answerConfirmation(
  page: Page,
  accept: boolean,
  message?: string,
) {
  const dialog = page.getByRole("dialog", {
    name: /^(确认操作|Confirm action)$/,
  });
  await expect(dialog).toBeVisible();
  if (message) await expect(dialog).toContainText(message);
  await dialog
    .getByRole("button", {
      name: accept ? /^(确认|Confirm)$/ : /^(取消|Cancel)$/,
      exact: true,
    })
    .press("Enter");
}
async function openProjectDependencyScope(
  page: Page,
  taskTitle: string,
  zh: boolean,
) {
  await page
    .getByRole("button", {
      name: zh ? "打开依赖视图" : "Open dependency view",
      exact: true,
    })
    .click();
  const graph = page.locator(".project-workspace .dependency-focus-graph");
  const scope = graph.getByRole("button", {
    name: zh ? "范围内全部任务" : "All tasks in scope",
    exact: true,
  });
  await expect(scope).toBeDisabled();
  const snapshot: {
    items: {
      id: string;
      title: string;
      projectIds?: string[];
      parentProjectId?: string | null;
    }[];
  } = await page.evaluate(async () => {
    const response = await fetch("/api/snapshot");
    if (!response.ok) throw new Error("Snapshot HTTP " + response.status);
    return response.json();
  });
  const task = snapshot.items.find((item) => item.title === taskTitle);
  expect(task).toBeDefined();
  const projectId = await graph.getAttribute("data-project-id");
  if (!task?.projectIds?.includes(projectId ?? "")) {
    await graph
      .getByRole("button", {
        name: zh ? "包含子项目" : "Include subprojects",
        exact: true,
      })
      .click();
  }
  await graph
    .getByRole("button", {
      name: zh ? "选择焦点任务" : "Choose focus task",
      exact: true,
    })
    .click();
  const path: string[] = [];
  let project = snapshot.items.find(
    (item) => item.id === task?.projectIds?.[0],
  );
  while (project) {
    path.unshift(project.title);
    project = snapshot.items.find(
      (item) => item.id === project?.parentProjectId,
    );
  }
  const picker = page.locator(".hierarchy-browser");
  await expect(
    picker.getByRole("button", { name: zh ? "项目" : "Projects", exact: true }),
  ).toHaveCount(0);
  for (const title of path) {
    const child = picker.getByRole("button", {
      name: title + " ›",
      exact: true,
    });
    if (await child.count()) await child.click();
  }
  await picker
    .getByRole("button", { name: new RegExp("^" + taskTitle) })
    .click();
  await expect(scope).toBeEnabled();
  await scope.click();
}

async function chooseDate(page: Page, field: Locator, iso: string) {
  await field.click();
  const calendar = page.locator(".calendar-popover");
  await calendar
    .locator('input[type="number"]')
    .fill(String(Number(iso.slice(0, 4))));
  await calendar
    .locator("select")
    .selectOption(String(Number(iso.slice(5, 7))));
  await calendar.getByRole("button", { name: iso, exact: true }).click();
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => {
    localStorage.setItem("orivane-atlas.theme", value);
    document.documentElement.dataset.theme = value;
  }, theme);
}

async function openTaskAdvanced(dialog: Locator) {
  const summary = dialog.locator(".task-advanced > summary");
  if (!(await summary.isVisible()))
    await dialog
      .getByRole("button", { name: /^(\+ 更多设置|\+ More settings)$/ })
      .click();
  if (
    !(await summary
      .locator("..")
      .evaluate((element) => element.hasAttribute("open")))
  )
    await summary.click();
}

import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  test as base,
  expect,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";
import type * as memoLocalApi from "../../apps/web/test-fixtures/local-storage";
import type { ActorContext } from "../../packages/domain/src/index";
import { localCalendarDay } from "../../packages/domain/src/index";
import { v22PerformanceFixture } from "../performance/v2.2-fixture";

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

const test = base.extend<{
  workbench: {
    url: string;
    secret: string;
    advanceRecurrenceTime(now: string): Promise<void>;
    seedPerformance(actor: ActorContext): Promise<void>;
  };
}>({
  workbench: async ({}, use, info) => {
    const directory = mkdtempSync(join(tmpdir(), "arclattice-e2e-"));
    const secret = randomBytes(32).toString("hex");
    const port =
      Number(process.env.ATLAS_E2E_BASE_PORT ?? 1420) + info.parallelIndex;
    let recurrenceNow: string | null = null;
    let modelAttempts = 0;
    const host = await createHost({
      clock: { now: () => recurrenceNow ?? new Date().toISOString() },
      calendarTimezone: info.title.includes("authoritative calendar")
        ? "Pacific/Kiritimati"
        : "UTC",
      database: join(directory, "test.sqlite"),
      secret,
      origin: "http://127.0.0.1:" + port,
      webRoot: resolve("apps/web/dist"),
      vault: openPersonalVault(join(directory, "vault")),
      ...(info.title.includes("Agent Harness")
        ? {
            model: {
              route: {
                fingerprint: "harness-e2e",
                provider: "https://test.invalid",
                model: "Harness test",
                maxInputChars: 32000,
                maxOutputTokens: 100,
                timeoutMs: 5000,
                maxRunsPerDay: info.title.includes("safety boundaries")
                  ? 100
                  : 20,
              },
              complete: async () => "",
              providerAdapter: {
                capabilities: {
                  tools: true,
                  jsonSchema: true,
                  streaming: false,
                  vision: false,
                  embedding: false,
                },
                complete: async () => "",
                listModels: async () => ["Harness test"],
                stream: async function* () {},
                respond: async (
                  messages: readonly import("../../packages/application/src/provider-adapter").ModelMessage[],
                ) => {
                  if (info.title.includes("safety boundaries")) {
                    const mode = messages[0]!.text
                      .split("boundary:")[1]!
                      .split(/\s/)[0];
                    const results = messages.filter(
                      (message) => message.role === "tool",
                    );
                    if (mode === "unknown")
                      return {
                        text: "",
                        toolCalls: [
                          {
                            id: "unknown",
                            name: "unregistered_tool",
                            input: {},
                          },
                        ],
                      };
                    if (mode === "invalid")
                      return {
                        text: "",
                        toolCalls: [
                          {
                            id: "invalid",
                            name: "create_task",
                            input: { title: "Unsafe", approved: true },
                          },
                        ],
                      };
                    if (mode === "steps")
                      return {
                        text: "",
                        toolCalls: [
                          {
                            id: `step-${results.length}`,
                            name: "get_project",
                            input: { id: "missing-project" },
                          },
                        ],
                      };
                    if (mode === "writes")
                      return {
                        text: "",
                        toolCalls: results.length
                          ? []
                          : [1, 2, 3, 4, 5, 6].map((n) => ({
                              id: `write-${n}`,
                              name: "create_task",
                              input: { title: `Bounded write ${n}` },
                            })),
                      };
                    if (results.length)
                      return { text: "Boundary handled", toolCalls: [] };
                    if (mode === "conflict") {
                      const id = messages[0]!.text
                        .split("task=")[1]!
                        .slice(0, 36);
                      return {
                        text: "",
                        toolCalls: [
                          {
                            id: "stale-update",
                            name: "complete_task",
                            input: { id, version: 1 },
                          },
                        ],
                      };
                    }
                    return {
                      text: "",
                      toolCalls: [
                        {
                          id: "review-boundary",
                          name: "create_task",
                          input: { title: "Must not be created" },
                        },
                      ],
                    };
                  }
                  if (info.title.includes("batch plan")) {
                    const published = messages.find(
                      (message) =>
                        message.role === "tool" &&
                        message.toolName === "publish_plan",
                    );
                    if (published)
                      return {
                        text: "Reviewed course plan imported",
                        toolCalls: [],
                      };
                    const preview = messages.find(
                      (message) =>
                        message.role === "tool" &&
                        message.toolName === "preview_plan",
                    );
                    if (preview) {
                      const plan = JSON.parse(preview.text);
                      return {
                        text: "",
                        toolCalls: [
                          {
                            id: "publish-reviewed-plan",
                            name: "publish_plan",
                            input: { id: plan.id, version: plan.version },
                          },
                        ],
                      };
                    }
                    const projectId = messages[0]!.text
                      .split("project=")[1]!
                      .slice(0, 36);
                    return {
                      text: "",
                      toolCalls: [
                        {
                          id: "preview-course-plan",
                          name: "preview_plan",
                          input: {
                            projectId,
                            manifest: {
                              version: 1,
                              projects: [],
                              tasks: [1, 2, 3].map((index) => ({
                                tempId: `lecture-${index}`,
                                title: `Lecture ${index}`,
                                descriptionMd: "Course lecture",
                                startDate: null,
                                dueDate: null,
                                dependsOn: [],
                              })),
                            },
                          },
                        },
                      ],
                    };
                  }
                  if (
                    messages.some(
                      (message) =>
                        message.role === "tool" &&
                        message.toolName === "create_task",
                    )
                  )
                    return { text: "Reviewed task created", toolCalls: [] };
                  if (
                    messages.some(
                      (message) =>
                        message.role === "tool" &&
                        message.toolName === "search_documents",
                    )
                  )
                    return {
                      text: "",
                      toolCalls: [
                        {
                          id: "task-proposal",
                          name: "create_task",
                          input: { title: "Agent reviewed task" },
                        },
                      ],
                    };
                  return {
                    text: "",
                    toolCalls: [
                      {
                        id: "evidence-search",
                        name: "search_documents",
                        input: { query: "Atlas evidence" },
                      },
                    ],
                  };
                },
              },
            },
          }
        : {}),
      ...(info.title.includes("AI approval")
        ? {
            model: {
              route: {
                fingerprint: "e2e-only",
                provider: "https://test.invalid",
                model: "Test-only adapter",
                maxInputChars:
                  info.title.includes("project scope") ||
                  info.title.includes("private Memo AI approval")
                    ? 16000
                    : 1000,
                maxOutputTokens: 100,
                timeoutMs: info.title.includes("streaming") ? 6000 : 2000,
                maxRunsPerDay: 2,
              },
              complete: async (prompt: string) => {
                if (info.title.includes("private Memo AI approval"))
                  return "# Reviewed result\n\n- Check the next action.";
                if (
                  info.title.includes("model failure") &&
                  modelAttempts++ === 0
                )
                  throw new Error("MODEL_REQUEST_FAILED");
                return JSON.stringify({
                  kind: "FINAL",
                  text: "# Reviewed result\n\n" + prompt,
                });
              },
              ...(info.title.includes("streaming")
                ? {
                    providerAdapter: {
                      capabilities: {
                        tools: false,
                        jsonSchema: false,
                        vision: false,
                        streaming: true,
                        embedding: false,
                      },
                      complete: async () => {
                        throw new Error("Unexpected non-streaming call");
                      },
                      async *stream(_prompt: string, signal: AbortSignal) {
                        yield {
                          type: "text-delta" as const,
                          text: "Visible streaming ",
                        };
                        await new Promise((resolve) =>
                          setTimeout(
                            resolve,
                            info.title.includes("cursor fallback")
                              ? 4200
                              : 2200,
                          ),
                        );
                        if (signal.aborted) throw new Error("Cancelled");
                        yield { type: "text-delta" as const, text: "answer" };
                        yield {
                          type: "usage" as const,
                          usage: {
                            inputTokens: 5,
                            outputTokens: 3,
                            source: "PROVIDER_REPORTED" as const,
                          },
                        };
                        yield { type: "completed" as const };
                      },
                      listModels: async () => ["Test-only adapter"],
                    },
                  }
                : {}),
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
      await use({
        url: "http://127.0.0.1:" + port,
        secret,
        seedPerformance: async (actor) => {
          const fixture = v22PerformanceFixture(
            actor,
            new Date().toISOString().slice(0, 10),
          );
          await host.db.request(
            actor,
            null,
            async (
              uow,
              _notes,
              _connected,
              library,
              _organization,
              _projects,
              sessions,
            ) => {
              await uow.run(actor.workspaceId, async (tx) => {
                for (const item of [...fixture.projects, ...fixture.tasks]) {
                  await tx.insert(item);
                  const event = {
                    id: randomUUID(),
                    workspaceId: actor.workspaceId,
                    principalId: actor.principalId,
                    entityId: item.id,
                    type: "WORK_ITEM_CREATED" as const,
                    occurredAt: item.createdAt,
                    entityVersion: 1,
                  };
                  await tx.appendActivity(event);
                  await tx.appendOutbox({
                    ...event,
                    activityId: event.id,
                    type: "WORK_CHANGED",
                  });
                }
                for (const edge of fixture.edges) await tx.addEdge(edge);
              });
              await library.save(fixture.space, 0);
              for (const document of fixture.documents)
                await library.save(document, 0);
              for (const session of fixture.sessions)
                await sessions.save(session, 0);
            },
          );
        },
        advanceRecurrenceTime: async (now) => {
          recurrenceNow = now;
          await host.reconcileRecurrences();
        },
      });
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

test("v2.2 1500 tasks release virtualization and scope benchmark", async ({
  page,
  workbench,
}, info) => {
  test.setTimeout(180000);
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const session = await (
    await page.request.get(workbench.url + "/api/session")
  ).json();
  for (let index = 0; index < 1500; index++) {
    const response = await page.request.post(
      workbench.url + "/api/work/create",
      {
        data: { title: `Perf task ${String(index).padStart(4, "0")}` },
        headers: {
          Origin: workbench.url,
          "X-CSRF-Token": session.csrf,
          "Idempotency-Key": randomUUID(),
        },
      },
    );
    expect(response.ok()).toBe(true);
  }
  await page.reload();
  await nav(page, w.desk.tasks);
  await page.getByLabel(w.desk.sort, { exact: true }).selectOption("title");
  const scroll = page.locator(".task-list .virtual-task-scroll");
  await expect(scroll).toHaveAttribute("data-task-count", "1500");
  await expect
    .poll(() => page.locator(".task-list .task-card").count())
    .toBeGreaterThan(0);
  const listRows = await page.locator(".task-list .task-card").count();
  expect(listRows).toBeLessThan(100);
  await expect
    .poll(() =>
      page.locator(".task-list .task-card").evaluateAll((elements) => {
        const rows = elements.map((element) => element.getBoundingClientRect());
        return (
          rows.length > 1 &&
          rows
            .slice(1)
            .every((row, index) => row.top >= rows[index]!.bottom - 0.5)
        );
      }),
    )
    .toBe(true);
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    page.locator(".task-list .task-card").filter({ hasText: "Perf task 1499" }),
  ).toBeVisible();
  const started = performance.now();
  await page
    .locator(".ui-segmented")
    .getByRole("button", { name: w.desk.taskWorkspace.board, exact: true })
    .click();
  await expect(page.locator(".virtual-board-scroll")).toHaveCount(1);
  const boardRows = await page.locator(".board .task-card").count();
  expect(boardRows).toBeLessThan(100);
  await expect
    .poll(() =>
      page.locator(".board .task-card").evaluateAll((elements) => {
        const rows = elements.map((element) => element.getBoundingClientRect());
        return (
          rows.length > 1 &&
          rows
            .slice(1)
            .every((row, index) => row.top >= rows[index]!.bottom - 0.5)
        );
      }),
    )
    .toBe(true);
  const evidence = {
    tasks: 1500,
    listRows,
    boardRows,
    boardInteractionWallMs: performance.now() - started,
    measurement: "Playwright action to settled DOM; wall clock, not JS CPU",
  };
  writeFileSync(
    resolve(
      ".artifacts",
      `${process.env.ATLAS_BENCHMARK_PREFIX ?? "session107"}-task-benchmark-${info.project.name}.json`,
    ),
    JSON.stringify(evidence, null, 2),
  );
  await page.screenshot({
    path: resolve(
      ".artifacts",
      `session107-task-board-${info.project.name}.png`,
    ),
    fullPage: true,
  });
  await info.attach("release-task-benchmark.json", {
    body: JSON.stringify({
      tasks: 1500,
      listRows,
      boardRows,
      boardInteractionWallMs: performance.now() - started,
    }),
    contentType: "application/json",
  });
});

test("v2.2 recurrence skip is distinct from missed and version protected", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh"),
    today = new Date().toISOString().slice(0, 10);
  await workbench.advanceRecurrenceTime(today + "T00:30:00Z");
  await unlock(page, workbench.url, workbench.secret, w);
  const definition = await mutation(page, "/api/recurrences/save", {
    version: 0,
    deleted: false,
    rule: {
      title: "Skip series",
      descriptionMd: "",
      startDate: today,
      timezone: "UTC",
      frequency: "DAILY",
      interval: 1,
    },
  });
  await mutation(page, "/api/recurrences/generate", {
    id: definition.id,
    version: definition.version,
    from: today,
    to: today,
  });
  await page.reload();
  await nav(page, w.desk.tasks);
  await page
    .getByRole("button", {
      name: zh ? "管理周期任务" : "Manage recurring tasks",
      exact: true,
    })
    .click();
  const series = page.locator(".recurrence-manager .workflow-proposal");
  await expect(series.locator("details")).not.toHaveAttribute("open", "");
  await expect(
    series.getByRole("button", {
      name: zh ? "跳过本次" : "Skip this occurrence",
      exact: true,
    }),
  ).toBeVisible();
  await series
    .getByRole("button", {
      name: zh ? "跳过本次" : "Skip this occurrence",
      exact: true,
    })
    .click();
  await expect(series).toContainText(zh ? "已跳过" : "Skipped");
  await expect
    .poll(async () => {
      const remote = await (
        await page.request.get(workbench.url + "/api/snapshot")
      ).json();
      const occurrence = remote.workflows.find(
        (record: { payload: { kind: string; definitionId?: string } }) =>
          record.payload.kind === "OCCURRENCE" &&
          record.payload.definitionId === definition.id,
      );
      return {
        status: occurrence?.payload.status,
        taskStatus: remote.items.find(
          (item: { id: string }) => item.id === occurrence?.payload.taskId,
        )?.status,
      };
    })
    .toEqual({ status: "SKIPPED", taskStatus: "CANCELED" });
  const snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  const occurrence = snapshot.workflows.find(
    (record: { payload: { kind: string; definitionId?: string } }) =>
      record.payload.kind === "OCCURRENCE" &&
      record.payload.definitionId === definition.id,
  );
  expect(occurrence.payload.status).toBe("SKIPPED");
  expect(
    snapshot.items.find(
      (item: { id: string }) => item.id === occurrence.payload.taskId,
    ).status,
  ).toBe("CANCELED");
  await workbench.advanceRecurrenceTime(today + "T23:59:59Z");
  const after = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    after.workflows.find(
      (record: { id: string }) => record.id === occurrence.id,
    ).payload.status,
  ).toBe("SKIPPED");
});

test("hardening recurring lifecycle expiry auto-close pause resume end and calendar statistics", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh"),
    today = new Date().toISOString().slice(0, 10);
  await workbench.advanceRecurrenceTime(today + "T00:30:00.000Z");
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.tasks);
  await page
    .getByRole("button", {
      name: zh ? "管理周期任务" : "Manage recurring tasks",
      exact: true,
    })
    .click();
  const manager = page.locator(".recurrence-manager");
  await expect(
    manager.getByText(w.desk.workflows.recurrences, { exact: true }),
  ).toBeVisible();
  const definition = await mutation(page, "/api/recurrences/save", {
    version: 0,
    deleted: false,
    rule: {
      title: "Expiry daily",
      descriptionMd: "",
      startDate: today.slice(0, 7) + "-01",
      timezone: "UTC",
      frequency: "DAILY",
      interval: 1,
      closePolicy: "DURATION",
      durationValue: 1,
      durationUnit: "HOUR",
      closeIncomplete: true,
    },
  });
  await mutation(page, "/api/recurrences/generate", {
    id: definition.id,
    version: definition.version,
    from: today.slice(0, 7) + "-01",
    to: today,
  });
  await page.reload();
  await page
    .getByRole("button", {
      name: zh ? "管理周期任务" : "Manage recurring tasks",
      exact: true,
    })
    .click();
  await expect(
    manager.getByRole("heading", { name: "Expiry daily" }),
  ).toBeVisible();
  let snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  const open = snapshot.workflows.find(
    (r: { payload: { definitionId?: string; status?: string } }) =>
      r.payload.definitionId === definition.id && r.payload.status === "OPEN",
  );
  expect(open.payload.expiresAt).toBe(today + "T01:00:00.000Z");
  await workbench.advanceRecurrenceTime(today + "T02:00:00.000Z");
  await page.reload();
  snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    snapshot.workflows.find((r: { id: string }) => r.id === open.id).payload
      .status,
  ).toBe("MISSED");
  expect(
    snapshot.items.find((r: { id: string }) => r.id === open.payload.taskId)
      .status,
  ).toBe("CANCELED");
  await page
    .getByRole("button", {
      name: zh ? "查看统计" : "View statistics",
      exact: true,
    })
    .click();
  const board = page.locator(".recurrence-statistics");
  await board.getByRole("combobox").selectOption(definition.id);
  const todayBoard = board.getByRole("article").filter({
    has: page.getByRole("heading", {
      name: zh ? "今天" : "Today",
      exact: true,
    }),
  });
  await expect(todayBoard.locator("dd")).toHaveText(["1", "0", "1", "0%"]);
  for (const name of [
    zh ? "最近 7 天" : "Last 7 Days",
    zh ? "本月" : "Current Month",
  ]) {
    const period = board
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    const due = Math.min(
      Number(today.slice(-2)),
      name === (zh ? "最近 7 天" : "Last 7 Days") ? 7 : 31,
    );
    await expect(period.locator("dd")).toHaveText([
      String(due),
      "0",
      String(due),
      "0%",
    ]);
  }
  await page
    .locator(".recurrence-statistics-dialog")
    .getByRole("button", { name: zh ? "关闭" : "Close", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: zh ? "管理周期任务" : "Manage recurring tasks",
      exact: true,
    })
    .click();
  const ruleRow = manager.locator(".workflow-proposal").filter({
    has: page.getByRole("heading", { name: "Expiry daily", exact: true }),
  });
  await ruleRow
    .getByRole("button", { name: w.desk.workflows.pause, exact: true })
    .click();
  await expect(ruleRow).toContainText(zh ? "已暂停" : "Paused");
  snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    snapshot.workflows.find((r: { id: string }) => r.id === definition.id)
      .deletedAt,
  ).toBeNull();
  await ruleRow
    .getByRole("button", { name: zh ? "恢复" : "Resume", exact: true })
    .click();
  await expect(ruleRow).toContainText(zh ? "进行中" : "Running");
  await ruleRow
    .getByRole("button", { name: zh ? "结束" : "End", exact: true })
    .click();
  await expect(ruleRow).toContainText(zh ? "已结束" : "Ended");
  await expect(
    ruleRow.getByRole("button", {
      name: w.desk.workflows.generate,
      exact: true,
    }),
  ).toBeDisabled();
  await page.screenshot({
    path: info.outputPath("recurrence-statistics.png"),
    fullPage: true,
  });
});
test("v2.3 quiet shell and command palette keyboard fuzzy recent navigation", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  const zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  await mutation(page, "/api/note/save", {
    id: null,
    version: 0,
    input: {
      kind: "NOTE",
      title: "Command Palette Sample",
      bodyMd: "Preserve this note",
      day: null,
    },
  });
  await page.reload();
  await nav(page, w.desk.tasks);
  await expect(page.locator(".sidebar .nav-item[draggable=true]")).toHaveCount(
    0,
  );
  if (info.project.name.startsWith("mobile")) {
    await page.locator(".mobile-navigation-toggle").click();
    const sheet = page.locator("#mobile-more-sheet");
    await expect(sheet).toBeVisible();
    const handle = sheet.locator(".ui-drag-handle").first();
    await expect(handle).toBeVisible();
    await handle.focus();
    await expect(handle).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  } else {
    await page.locator(".sidebar .ui-sortable-row").first().hover();
    await expect(
      page.locator(".sidebar .ui-drag-handle").first(),
    ).toBeVisible();
  }
  await expect(page.locator(".page-header .mode-badge")).toHaveCount(0);
  await expect(
    page
      .locator(".page-header")
      .getByRole("button", { name: w.desk.refresh, exact: true }),
  ).toHaveCount(0);
  // The page header must not leak the workspace name into the title.
  await expect(page.locator(".page-header").first()).not.toContainText(
    zh ? "个人空间" : "Personal",
  );
  await page.keyboard.press("Control+k");
  let palette = page.locator(".command-palette");
  await palette.getByRole("searchbox").fill("CmdPltSmpl");
  await expect(palette.locator(".command-result")).toHaveCount(1);
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(
    pane(page).getByLabel(w.desk.noteTitle, { exact: true }),
  ).toHaveValue("Command Palette Sample");
  await browseDocuments(page);
  await page.keyboard.press("Control+k");
  palette = page.locator(".command-palette");
  await expect(palette.locator(".command-result").first()).toHaveText(
    "Command Palette Sample",
  );
  await page.keyboard.press("ArrowDown");
  await expect(palette.locator(".command-result[data-active=true]")).toHaveText(
    zh ? "新建" : "Create",
  );
  await page.keyboard.press("ArrowUp");
  await expect(palette.locator(".command-result[data-active=true]")).toHaveText(
    "Command Palette Sample",
  );
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#settings$/);
  await page.keyboard.press("Control+k");
  await page.keyboard.press("Escape");
  await expect(page.locator(".command-palette")).toHaveCount(0);
});

test("v2.3 task rows expose completion and defer management to the menu", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const task = await mutation(page, "/api/work/create", {
    title: "Quiet action",
    priority: "LOW",
  });
  await page.reload();
  await nav(page, w.desk.tasks);
  const row = page.locator(".task-card").filter({ hasText: "Quiet action" });
  await expect(page.locator(".recurrence-summary")).toHaveCount(0);
  await expect(
    row.locator("select, .priority, .activation-badge, .readiness.ready"),
  ).toHaveCount(0);
  await expect(
    row.getByRole("button", { name: w.desk.deleteItem + ": Quiet action" }),
  ).toHaveCount(0);
  await expect(page.getByRole("menuitemradio")).toHaveCount(0);
  const menu = await taskMenu(page, "Quiet action");
  await expect(
    menu.getByRole("menuitem", { name: w.desk.archive + ": Quiet action" }),
  ).toBeVisible();
  await expect(
    menu.getByLabel(w.common.statusLabel.replace("{{title}}", "Quiet action")),
  ).toHaveValue("TODO");
  await page.keyboard.press("Escape");
  await row
    .getByRole("button", {
      name: (zh ? "完成：" : "Complete: ") + "Quiet action",
      exact: true,
    })
    .click();
  await expect(row).toBeVisible();
  const armedSnapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    armedSnapshot.items.find((item: { id: string }) => item.id === task.id)
      .status,
  ).toBe("TODO");
  expect(
    armedSnapshot.items.find((item: { id: string }) => item.id === task.id)
      .version,
  ).toBe(task.version);
  await row
    .getByRole("button", {
      name: (zh ? "确认完成：" : "Confirm completion: ") + "Quiet action",
      exact: true,
    })
    .click();
  await expect(row).toHaveCount(0);
  await taskScope(page, w.desk.taskWorkspace.completed);
  await page.getByLabel(w.desk.status, { exact: true }).selectOption("DONE");
  await expect(
    row.getByRole("button", {
      name: (zh ? "重新打开：" : "Reopen: ") + "Quiet action",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "false");
  await waitForLocalReplay(page);
  const snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    snapshot.items.find((item: { id: string }) => item.id === task.id).status,
  ).toBe("DONE");
});

test("quick completion and restore arm without mutation and support cancellation and version-safe Undo", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const task = await mutation(page, "/api/work/create", {
    title: "Confirm safely",
    priority: "LOW",
  });
  await mutation(page, "/api/work/create", {
    title: "Another confirmation",
    priority: "LOW",
  });
  await page.reload();
  await nav(page, w.desk.tasks);
  const row = page.locator(".task-card").filter({ hasText: "Confirm safely" });
  const label = (zh ? "完成：" : "Complete: ") + "Confirm safely";
  const confirmation =
    (zh ? "确认完成：" : "Confirm completion: ") + "Confirm safely";
  await row.getByRole("button", { name: label, exact: true }).click();
  await page
    .getByRole("button", {
      name: (zh ? "完成：" : "Complete: ") + "Another confirmation",
      exact: true,
    })
    .click();
  await expect(
    row.getByRole("button", { name: label, exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");
  const syncStart = await (
    await page.request.get(workbench.url + "/api/sync")
  ).json();
  const updates: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/work/"))
      updates.push(request.url());
  });
  const read = async () => {
    const snapshot = await (
      await page.request.get(workbench.url + "/api/snapshot")
    ).json();
    return snapshot.items.find((item: { id: string }) => item.id === task.id);
  };
  await row.getByRole("button", { name: label, exact: true }).click();
  await expect(
    row.getByRole("button", { name: confirmation, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(await read()).toMatchObject({ status: "TODO", version: task.version });
  expect(updates).toEqual([]);
  let unchanged = await (
    await page.request.get(
      workbench.url +
        `/api/sync?after=${syncStart.cursor}&epoch=${syncStart.epoch}`,
    )
  ).json();
  expect(unchanged.cursor).toBe(syncStart.cursor);
  expect(unchanged.records).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(
    row.getByRole("button", { name: label, exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await row.getByRole("button", { name: label, exact: true }).click();
  await page
    .locator(".organization-toolbar")
    .click({ position: { x: 2, y: 2 } });
  await expect(
    row.getByRole("button", { name: label, exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await row.getByRole("button", { name: label, exact: true }).click();
  await expect(
    row.getByRole("button", { name: label, exact: true }),
  ).toBeVisible({ timeout: 6000 });
  expect(await read()).toMatchObject({ status: "TODO", version: task.version });
  expect(updates).toEqual([]);
  await row.getByRole("button", { name: label, exact: true }).click();
  await row.getByRole("button", { name: confirmation, exact: true }).click();
  await expect.poll(async () => (await read()).status).toBe("DONE");
  await page
    .locator(".toast")
    .filter({ hasText: zh ? "任务已完成" : "Task completed" })
    .getByRole("button", { name: zh ? "撤销" : "Undo", exact: true })
    .click();
  await expect.poll(async () => (await read()).status).toBe("TODO");
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: label, exact: true }).click();
  await row.getByRole("button", { name: confirmation, exact: true }).click();
  await taskScope(page, w.desk.taskWorkspace.completed);
  // The local completed view can precede the remote replay ACK.
  await expect.poll(async () => (await read()).status).toBe("DONE");
  const reopen = (zh ? "重新打开：" : "Reopen: ") + "Confirm safely";
  const confirmReopen =
    (zh ? "确认重新打开：" : "Confirm reopen: ") + "Confirm safely";
  const done = await read();
  await row.getByRole("button", { name: reopen, exact: true }).click();
  expect(await read()).toMatchObject({ status: "DONE", version: done.version });
  await row.getByRole("button", { name: confirmReopen, exact: true }).click();
  await expect.poll(async () => (await read()).status).toBe("TODO");
  const restored = await read();
  const newer = await mutation(page, "/api/work/update", {
    id: task.id,
    version: restored.version,
    input: { title: "Newer edit stays" },
  });
  await page
    .locator(".toast")
    .filter({ hasText: zh ? "任务已重新打开" : "Task reopened" })
    .getByRole("button", { name: zh ? "撤销" : "Undo", exact: true })
    .click();
  await expect(
    page.locator(".toast").filter({
      hasText: zh
        ? "撤销失败，请刷新后重试"
        : "Undo failed. Refresh and retry.",
    }),
  ).toBeVisible();
  expect(await read()).toMatchObject({
    title: "Newer edit stays",
    status: "TODO",
    version: newer.version,
  });
});

test("v2.3 Project Gantt renders spans milestones unscheduled rows and restores presentation", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const project = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Gantt project",
  });
  for (const input of [
    { title: "Span task", startDate: "2026-10-01", dueDate: "2026-10-09" },
    { title: "Deadline milestone", dueDate: "2026-10-12" },
    { title: "Unscheduled action" },
  ])
    await mutation(page, "/api/work/create", {
      ...input,
      projectIds: [project.id],
    });
  await page.reload();
  await nav(page, w.desk.projects);
  await page
    .getByRole("button", { name: "Gantt project", exact: true })
    .click();
  await expect(page.locator(".context-pane")).toHaveCount(0);
  await expect(page.locator(".project-workspace h1")).toHaveText(
    "Gantt project",
  );
  await expect(
    page.locator(".workspace-main .ui-button-primary:visible"),
  ).toHaveCount(1);
  await expect(
    page.getByLabel(w.desk.projectScope, { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator(".task-gantt, .dependency-focus-graph"),
  ).toHaveCount(0);
  await page
    .getByRole("tab", { name: w.desk.projectHub.tasks, exact: true })
    .click();
  await page
    .locator(".project-workspace .ui-segmented")
    .getByRole("button", { name: zh ? "甘特图" : "Gantt", exact: true })
    .click();
  const gantt = page.locator(".task-gantt");
  await expect(gantt.locator(".gantt-scroll")).toHaveAttribute(
    "data-task-count",
    "3",
  );
  expect(
    await gantt
      .locator(".gantt-scroll")
      .evaluate((element) => element.getBoundingClientRect().height),
  ).toBeLessThanOrEqual(242);
  await expect(gantt.locator(".gantt-bar:not(.gantt-milestone)")).toHaveCount(
    1,
  );
  await expect(gantt.locator(".gantt-milestone")).toHaveCount(1);
  await expect(gantt.locator(".gantt-unscheduled")).toHaveText(
    zh ? "未排期" : "Unscheduled",
  );
  const bar = gantt.locator(".gantt-bar:not(.gantt-milestone)");
  expect(
    await bar.evaluate((element) => element.getBoundingClientRect().width),
  ).toBe(9 * 32);
  await gantt
    .getByRole("button", { name: zh ? "月" : "Month", exact: true })
    .click();
  expect(
    await bar.evaluate((element) => element.getBoundingClientRect().width),
  ).toBe(9 * 12);
  await expect(gantt.getByLabel(zh ? "今日线" : "Today line")).toHaveCount(1);
  await page
    .getByRole("tab", { name: w.desk.projectHub.overview, exact: true })
    .click();
  await expect(gantt).toHaveCount(0);
  await page
    .getByRole("tab", { name: w.desk.projectHub.tasks, exact: true })
    .click();
  await expect(gantt).toBeVisible();
  await page.screenshot({
    path: info.outputPath("project-gantt.png"),
    fullPage: true,
  });
});

test("v2.3 project list keeps hierarchy and category management behind explicit actions", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Quiet project",
  });
  await page.reload();
  await nav(page, w.desk.projects);
  await expect(page.locator(".category-manager")).toHaveCount(0);
  const row = page
    .locator(".project-card")
    .filter({ hasText: "Quiet project" });
  await expect(
    row.getByRole("button", { name: w.desk.archive, exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: zh ? "项目列表选项" : "Project list options",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", {
      name: zh ? "管理项目分类" : "Manage project categories",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("dialog").locator(".category-manager"),
  ).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".category-manager")).toHaveCount(0);
  await (await projectMenu(page, "Quiet project"))
    .getByRole("menuitem", {
      name: zh ? "移动 / 设置" : "Move / settings",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel(w.work.title, { exact: true }),
  ).toHaveValue("Quiet project");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: w.common.cancel, exact: true })
    .click();
  await (await projectMenu(page, "Quiet project"))
    .getByRole("menuitem", { name: w.desk.deleteItem, exact: true })
    .click();
  await expect(row).toHaveCount(0);
  await page
    .getByRole("button", { name: zh ? "撤销" : "Undo", exact: true })
    .click();
  await expect(row).toHaveCount(1);
  // Undo is durable locally before its asynchronous remote replay completes.
  await expect
    .poll(async () => {
      const remote = await (
        await page.request.get(workbench.url + "/api/snapshot")
      ).json();
      return remote.items.find(
        (item: { title: string }) => item.title === "Quiet project",
      )?.deletedAt;
    })
    .toBeNull();
  const snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  const restored = snapshot.items.find(
    (item: { title: string }) => item.title === "Quiet project",
  );
  expect(restored.deletedAt).toBeNull();
  await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Protected child",
    parentProjectId: restored.id,
  });
  await page.reload();
  await nav(page, w.desk.projects);
  await (await projectMenu(page, "Quiet project"))
    .getByRole("menuitem", { name: w.desk.deleteItem, exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    w.errors.DEPENDENCY_EXISTS,
  );
  await expect(row).toHaveCount(1);
});

test("v2.3 Project Gantt virtualizes a real 1500 task workspace", async ({
  page,
  workbench,
}, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const identity = await (
    await page.request.get(workbench.url + "/api/session")
  ).json();
  await workbench.seedPerformance(identity.context);
  const project = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Gantt portfolio",
  });
  for (let index = 0; index < 15; index++)
    await mutation(page, "/api/work/update", {
      id: `perf-project-${index}`,
      version: 1,
      input: { parentProjectId: project.id },
    });
  await waitForFixtureReplica(page);
  await page.goto(
    workbench.url + `/#projects/${project.id}?tab=tasks&scope=SUBTREE`,
  );
  await waitForFixtureReplica(page, "Gantt portfolio");
  try {
    await expect(page.locator(".project-workspace h1")).toHaveText(
      "Gantt portfolio",
    );
  } catch (failure) {
    const canonical = await (
      await page.request.get(workbench.url + "/api/snapshot")
    ).json();
    const local = await page.evaluate(async (projectId) => {
      const result: {
        bases: {
          collection: string;
          id: string;
          version: number;
          value: Record<string, unknown>;
        }[];
        sync: unknown[];
        heads: unknown[];
      } = { bases: [], sync: [], heads: [] };
      for (const entry of await indexedDB.databases()) {
        if (!entry.name) continue;
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(entry.name!);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          for (const store of ["entities", "sync"]) {
            if (!database.objectStoreNames.contains(store)) continue;
            const rows = await new Promise<unknown[]>((resolve, reject) => {
              const request = database
                .transaction(store)
                .objectStore(store)
                .getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            if (store === "sync") result.sync.push(...rows);
            else
              for (const row of rows as {
                collection: string;
                id: string;
                version: number;
                value: {
                  collection: string;
                  id: string;
                  version: number;
                  value: Record<string, unknown>;
                };
              }[]) {
                if (row.collection === "$local.remoteBase")
                  result.bases.push(row.value);
                if (row.collection === "items" && row.id === projectId)
                  result.heads.push({
                    id: row.id,
                    version: row.version,
                    value: row.value,
                  });
              }
          }
        } finally {
          database.close();
        }
      }
      return result;
    }, project.id);
    const { bodyManifest } = await import(
      "../../packages/application/src/workspace-bootstrap"
    );
    const mismatches = [];
    for (const base of local.bases) {
      const entries = canonical[base.collection];
      const found = Array.isArray(entries)
        ? entries.find((entry: { id: string }) => entry.id === base.id)
        : null;
      const remote =
        found && ["library", "notes"].includes(base.collection)
          ? bodyManifest(found)
          : found;
      if (remote && remote.version === base.version) {
        const fields = [
          ...new Set([
            ...Object.keys(base.value ?? {}),
            ...Object.keys(remote),
          ]),
        ].filter(
          (field) =>
            JSON.stringify(base.value?.[field]) !==
            JSON.stringify(remote[field]),
        );
        if (fields.length)
          mismatches.push({
            collection: base.collection,
            id: base.id,
            version: base.version,
            fields,
          });
      }
    }
    const diagnostic = JSON.stringify({
      bases: local.bases.length,
      url: new URL(page.url()).hash,
      projectId: project.id,
      heads: local.heads,
      mismatches,
      sync: local.sync,
    });
    const diagnosticPath = info.outputPath("canonical-fixture-diagnostic.json");
    await (await import("node:fs/promises")).writeFile(
      diagnosticPath,
      diagnostic,
    );
    await info.attach("canonical-fixture-diagnostic.json", {
      path: diagnosticPath,
      contentType: "application/json",
    });
    throw failure;
  }
  await taskScope(page, w.desk.taskWorkspace.all);
  const started = performance.now();
  await page
    .locator(".project-workspace .ui-segmented")
    .getByRole("button", { name: zh ? "甘特图" : "Gantt", exact: true })
    .click();
  const scroll = page.locator(".gantt-scroll");
  await expect(scroll).toHaveAttribute("data-task-count", "1500");
  const liveRows = await page.locator(".gantt-row").count();
  expect(liveRows).toBeGreaterThan(0);
  expect(liveRows).toBeLessThan(50);
  const first = await page
    .locator(".gantt-row")
    .first()
    .getAttribute("data-task-id");
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.scrollLeft = 500;
  });
  await expect
    .poll(() => page.locator(".gantt-row").first().getAttribute("data-task-id"))
    .not.toBe(first);
  expect(await page.locator(".gantt-row").count()).toBeLessThan(50);
  expect(await page.locator(".gantt-axis time").count()).toBeLessThan(100);
  expect(errors).toEqual([]);
  await info.attach("gantt-benchmark.json", {
    body: JSON.stringify({
      tasks: 1500,
      liveRows,
      wallMs: performance.now() - started,
      measurement:
        "Playwright settled DOM wall; functional run with two workers",
    }),
    contentType: "application/json",
  });
});

test("v2.3 feature navigation preserves task query priority scope and presentation", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  const zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  await mutation(page, "/api/work/create", {
    title: "Preserved scheduled task",
    priority: "HIGH",
    activationPolicy: "AT_SCHEDULED_TIME",
    startDate: "2099-10-05",
  });
  await page.reload();
  await nav(page, w.desk.tasks);
  const searchField = page.locator(".content .search input");
  await searchField.fill("Preserved");
  await page.getByLabel(w.desk.priority, { exact: true }).selectOption("HIGH");
  await page
    .getByRole("tab", { name: zh ? "已计划" : "Scheduled", exact: true })
    .click();
  await page
    .getByRole("button", { name: zh ? "看板" : "Board", exact: true })
    .click();
  await expect(page.locator(".board")).toBeVisible();
  await nav(page, w.desk.calendar);
  await nav(page, w.desk.tasks);
  await expect(searchField).toHaveValue("Preserved");
  await expect(page.getByLabel(w.desk.priority, { exact: true })).toHaveValue(
    "HIGH",
  );
  await expect(
    page.getByRole("tab", { name: zh ? "已计划" : "Scheduled", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".board")).toBeVisible();
});

test("v2.3 task single selection Inspector Enter open and shared Atlas context pane", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  await mutation(page, "/api/work/create", { title: "Selected task" });
  await page.reload();
  await nav(page, w.desk.tasks);
  const title = page
    .locator(".task-title")
    .filter({ hasText: "Selected task" });
  const row = page.locator(".task-card").filter({ has: title });
  await row.click({ position: { x: 8, y: 8 } });
  await expect(row).toHaveAttribute("tabindex", "0");
  await expect(page.locator(".task-editor-surface")).toHaveCount(0);
  const context = page.locator(".context-pane");
  await expect(
    context.getByRole("heading", { name: "Selected task" }),
  ).toBeVisible();
  await expect(page.locator(".task-card[data-selected=true]")).toHaveCount(1);
  if (info.project.name.startsWith("mobile")) {
    await context
      .getByRole("button", { name: zh ? "打开" : "Open", exact: true })
      .click();
  } else {
    await row.press("Enter");
  }
  await expect(page.locator(".task-editor-surface")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".task-editor-surface")).toHaveCount(0);
  // Selection != Inspector, and Atlas is never an Inspector tab.
  await expect(
    context.getByRole("button", { name: "Atlas", exact: true }),
  ).toHaveCount(0);
  await expect(
    context.getByRole("button", { name: zh ? "详情" : "Details", exact: true }),
  ).toHaveCount(0);
  await expect(context.locator(".assistant-pane")).toHaveCount(0);
  await context
    .getByRole("button", {
      name: zh ? "关闭上下文" : "Close context",
      exact: true,
    })
    .click();
  await expect(context).toHaveCount(0);
});

test("command palette contextual create and document trash undo preserve content", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  const zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  await mutation(page, "/api/note/save", {
    id: null,
    version: 0,
    input: {
      kind: "NOTE",
      title: "Palette note",
      bodyMd: "Keep original Markdown",
      day: null,
    },
  });
  await page.reload();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", {
    name: zh ? "搜索与命令" : "Search and commands",
  });
  await palette.getByRole("searchbox").fill("Palette note");
  await palette
    .getByRole("button", { name: "Palette note", exact: true })
    .click();
  await expect(
    pane(page).getByLabel(w.desk.noteTitle, { exact: true }),
  ).toHaveValue("Palette note");
  await documentAction(page, w.common.delete);
  await expect(pane(page)).toHaveCount(0);
  await page
    .getByRole("button", { name: zh ? "撤销" : "Undo", exact: true })
    .click();
  await nav(page, w.desk.notes);
  await page
    .locator(".note-card, .library-document-row, .space-card")
    .filter({ hasText: "Palette note" })
    .press("Enter");
  await expect(
    pane(page).getByLabel(w.desk.noteBody, { exact: true }),
  ).toContainText("Keep original Markdown");
  await browseDocuments(page);
  await page.keyboard.press("Control+n");
  await expect(
    pane(page).getByLabel(w.desk.noteTitle, { exact: true }),
  ).toHaveValue("");
});
test("project knowledge creates multiple owned spaces and links an existing space before document creation", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  const zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const project = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Knowledge bindings",
  });
  await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "SPACE",
      spaceId: null,
      title: "External research",
      bodyMd: "",
    },
  });
  await page.goto(
    workbench.url + `/#projects/${project.id}?tab=knowledge&scope=DIRECT`,
  );
  await page.reload();
  await expect(
    page.getByText(zh ? "尚无项目知识" : "No project knowledge yet", {
      exact: true,
    }),
  ).toBeVisible();
  for (const title of ["Primary project wiki", "Architecture wiki"]) {
    const createSpace = page.locator(".project-knowledge-list details").filter({
      has: page.locator("summary", {
        hasText: zh ? "新建知识空间" : "New knowledge space",
      }),
    });
    if ((await createSpace.getAttribute("open")) === null)
      await createSpace.locator("summary").click();
    await page
      .getByLabel(zh ? "知识空间名称" : "Wiki space title", { exact: true })
      .fill(title);
    await page
      .getByRole("button", {
        name: zh ? "创建 Wiki" : "Create Wiki",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: title === "Primary project wiki" ? "★ " + title : title,
        exact: true,
      }),
    ).toBeVisible();
  }
  await page
    .getByText(zh ? "链接现有空间" : "Link existing space", { exact: true })
    .click();
  await page
    .getByLabel(zh ? "搜索空间" : "Search spaces")
    .fill("External research");
  await page
    .getByRole("button", { name: "External research", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: zh ? "链接空间" : "Linked spaces" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: zh ? "新建页面" : "Create page", exact: true })
    .click();
  await page
    .getByRole("region", { name: zh ? "选择页面空间" : "Choose page space" })
    .getByRole("button", { name: "Architecture wiki", exact: true })
    .click();
  await pane(page)
    .getByLabel(w.spaces.title, { exact: true })
    .fill("Storage architecture");
  await documentMode(page, zh ? "源码" : "Source");
  await pane(page)
    .getByLabel(w.spaces.body, { exact: true })
    .fill("# Storage architecture");
  await saveDocument(page, w);
  await browseDocuments(page);
  await expect(
    page.getByRole("button", { name: "Storage architecture", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "★ Primary project wiki", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Architecture wiki", exact: true }),
  ).toBeVisible();
  const child = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Inherited knowledge",
    parentProjectId: project.id,
  });
  await page.goto(
    workbench.url + `/#projects/${child.id}?tab=knowledge&scope=DIRECT`,
  );
  const inherited = page.getByRole("region", {
    name: zh ? "继承空间" : "Inherited spaces",
    exact: true,
  });
  await expect(
    inherited.getByRole("button", {
      name: "Primary project wiki",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    inherited.getByRole("button", { name: "Architecture wiki", exact: true }),
  ).toBeVisible();
  await expect(inherited).not.toContainText("External research");
});
test("wiki save creates unresolved links and new pages re-resolve with backlinks after rename", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  const zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.spaces.library);
  await page
    .getByRole("button", { name: w.spaces.newSpace, exact: true })
    .click();
  const spaceDialog = page.getByRole("dialog", {
    name: zh ? "新建知识空间" : "Create knowledge space",
    exact: true,
  });
  await spaceDialog
    .getByLabel(zh ? "空间名称" : "Space name", { exact: true })
    .fill("Wiki integration");
  await spaceDialog
    .getByRole("button", { name: zh ? "创建" : "Create", exact: true })
    .click();
  await expect(spaceDialog).toHaveCount(0);
  await expect(page.locator(".library-view h2")).toHaveText("Wiki integration");
  await page
    .getByRole("button", { name: w.spaces.newLecture, exact: true })
    .click();
  await pane(page)
    .getByLabel(w.spaces.title, { exact: true })
    .fill("Wiki Home");
  await documentMode(page, /^(Source|源码)$/);
  await pane(page)
    .getByLabel(w.spaces.body, { exact: true })
    .fill("[[Future Architecture|Design]]");
  await saveDocument(page, w);
  const relations = pane(page).locator(".wiki-relations");
  await expect(relations).toContainText("Design");
  await relations
    .getByRole("button", {
      name: /Create page · Future Architecture|创建页面 · Future Architecture/,
    })
    .click();
  await expect(
    pane(page).getByLabel(w.spaces.title, { exact: true }),
  ).toHaveValue("Future Architecture");
  await expect(
    pane(page)
      .locator(".wiki-relations")
      .getByRole("button", { name: "Wiki Home", exact: true }),
  ).toBeVisible();
  await pane(page)
    .getByLabel(w.spaces.title, { exact: true })
    .fill("Renamed Architecture");
  await saveDocument(page, w);
  await pane(page)
    .locator(".wiki-relations")
    .getByRole("button", { name: "Wiki Home", exact: true })
    .click();
  await expect(
    pane(page)
      .locator(".wiki-relations")
      .getByRole("button", { name: /Create page|创建页面/ }),
  ).toHaveCount(0);
  await expect(
    pane(page).getByLabel(w.spaces.body, { exact: true }),
  ).toContainText("[[Future Architecture|Design]]");
  await expect(
    pane(page).getByRole("heading", {
      name: zh ? "未解析链接" : "Unresolved links",
    }),
  ).toBeVisible();
});

test("task workspace views and inspector preserve drafts while switching tasks", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  await mutation(page, "/api/work/create", { title: "Inspector A" });
  await mutation(page, "/api/work/create", { title: "Inspector B" });
  await mutation(page, "/api/work/create", {
    title: "Later task",
    activationState: "INACTIVE",
  });
  await page.reload();
  await nav(page, w.desk.tasks);
  const workspace = page.locator(".tasks-workspace");
  await expect(workspace.getByRole("article")).toHaveCount(2);
  await workspace
    .getByRole("tab", { name: w.desk.taskWorkspace.later, exact: true })
    .click();
  await expect(workspace.getByRole("article")).toHaveCount(1);
  await expect(workspace.getByTestId("task-scope-count")).toHaveAttribute(
    "data-count",
    "1",
  );
  await workspace
    .getByRole("tab", { name: w.desk.taskWorkspace.now, exact: true })
    .click();
  await workspace
    .getByRole("article")
    .filter({ hasText: "Inspector A" })
    .locator(".task-title")
    .press("Enter");
  const detail = page.getByRole("dialog");
  await page.screenshot({
    path: info.outputPath("task-inspector.png"),
    fullPage: true,
  });
  await detail.getByLabel(w.work.title, { exact: true }).fill("Unsaved A");
  if (!info.project.name.startsWith("mobile")) {
    await workspace
      .getByRole("article")
      .filter({ hasText: "Inspector B" })
      .locator(".task-title")
      .press("Enter");
    await expect(detail.getByLabel(w.work.title, { exact: true })).toHaveValue(
      "Unsaved A",
    );
    await detail
      .getByRole("button", { name: w.desk.discard, exact: true })
      .click();
    await expect(detail.getByLabel(w.work.title, { exact: true })).toHaveValue(
      "Inspector B",
    );
  } else {
    await detail
      .getByRole("button", { name: w.common.close, exact: true })
      .click();
    await detail
      .getByRole("button", { name: w.desk.discard, exact: true })
      .click();
    await expect(detail).toHaveCount(0);
  }
});

test("project milestones are editable and appear in overview without task-count pollution", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  const zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const project = await mutation(page, "/api/work/create", {
    title: "Paper",
    type: "PROJECT",
    lifecycle: "ACTIVE",
  });
  for (const title of ["Draft", "Submission", "Revision"]) {
    const milestone = await mutation(page, "/api/work/create", {
      title,
      type: "MILESTONE",
      parentProjectId: project.id,
      dueDate: "2026-10-01",
    });
    if (title === "Submission")
      await mutation(page, "/api/work/update", {
        id: milestone.id,
        version: milestone.version,
        input: { status: "IN_PROGRESS" },
      });
  }
  await page.reload();
  await page.evaluate((id) => {
    location.hash = `projects/${id}`;
  }, project.id);
  const workspace = page.locator(".project-workspace");
  await expect(workspace).toBeVisible();
  await page.screenshot({
    path: info.outputPath("project-header.png"),
    fullPage: true,
  });
  await workspace
    .getByRole("button", { name: w.desk.newMilestone, exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel(zh ? "里程碑名称" : "Milestone name", { exact: true })
    .fill("Accepted");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: zh ? "创建" : "Create", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const title of ["Draft", "Submission", "Revision", "Accepted"])
    await expect(
      workspace.getByRole("button", {
        name: new RegExp("^[^ ]* " + title + "$"),
      }),
    ).toBeVisible();
  await workspace
    .getByRole("button", { name: /Draft$/ })
    .first()
    .click();
  const detail = page.getByRole("dialog");
  await detail.getByLabel(zh ? "已达成" : "Reached", { exact: true }).check();
  await detail
    .getByRole("button", { name: zh ? "保存" : "Save", exact: true })
    .click();
  await expect(detail).toHaveCount(0);
  await expect(
    workspace.getByRole("button", { name: /✓ Draft/ }).first(),
  ).toBeVisible();
  await workspace
    .getByRole("button", { name: /Submission$/ })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByLabel(zh ? "成果与达成标准" : "Outcome and success criteria")
    .fill("Reviewed outcome, retain in-progress state");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: zh ? "保存" : "Save", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(async () => {
      const items = await page.evaluate(async () => {
        const response = await fetch("/api/snapshot");
        if (!response.ok) throw new Error(`Snapshot ${response.status}`);
        return (await response.json()).items;
      });
      return items.find(
        (item: { title: string }) => item.title === "Submission",
      )?.status;
    })
    .toBe("IN_PROGRESS");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath("milestone-overview.png"),
    fullPage: true,
  });
  for (const title of ["Draft", "Submission", "Revision", "Accepted"])
    await expect(workspace).toContainText(title);
  await nav(page, w.desk.tasks);
  await expect(page.locator(".task-card")).toHaveCount(0);
});

test("activation separates execution views from task planning", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const active = await mutation(page, "/api/work/create", {
    title: "Active pending",
  });
  await mutation(page, "/api/work/create", {
    title: "Inactive unassigned",
    activationPolicy: "MANUAL",
    activationState: "INACTIVE",
  });
  await mutation(page, "/api/work/create", {
    title: "Future scheduled",
    activationPolicy: "AT_SCHEDULED_TIME",
    startDate: "2099-01-01",
  });
  await mutation(page, "/api/work/create", {
    title: "Due scheduled",
    activationPolicy: "AT_SCHEDULED_TIME",
    startDate: "2000-01-01",
  });
  const waiting = await mutation(page, "/api/work/create", {
    title: "Waiting for dependency",
    activationPolicy: "WHEN_DEPENDENCIES_COMPLETED",
  });
  await mutation(page, "/api/edge/create", {
    fromId: active.id,
    toId: waiting.id,
  });
  const blocked = await mutation(page, "/api/work/create", {
    title: "Active blocked",
  });
  await mutation(page, "/api/edge/create", {
    fromId: active.id,
    toId: blocked.id,
  });
  for (const status of ["DONE", "CANCELED", "IN_PROGRESS"]) {
    const task = await mutation(page, "/api/work/create", {
      title: `Active ${status}`,
    });
    await mutation(page, "/api/work/update", {
      id: task.id,
      version: task.version,
      input: { status },
    });
  }
  await page.reload();
  await nav(page, w.desk.tasks);
  const cards = page.locator(".task-card");
  await expect(page.getByLabel(w.desk.status, { exact: true })).toHaveValue(
    "UNFINISHED",
  );
  await expect(cards).toHaveCount(4);
  await expect(page.getByTestId("task-scope-count")).toHaveAttribute(
    "data-count",
    "4",
  );
  await expect(cards.filter({ hasText: "Active blocked" })).toBeVisible();
  await page.getByLabel(w.desk.status, { exact: true }).selectOption("ALL");
  await expect(cards).toHaveCount(9);
  await page
    .getByRole("textbox", { name: w.desk.search })
    .fill("Inactive unassigned");
  await expect(cards).toHaveCount(1);
  await nav(page, w.desk.board);
  await expect(page.getByRole("textbox", { name: w.desk.search })).toHaveValue(
    "Inactive unassigned",
  );
  await page.getByRole("textbox", { name: w.desk.search }).fill("");
  await page
    .getByLabel(w.desk.status, { exact: true })
    .selectOption("UNFINISHED");
  await expect(cards).toHaveCount(4);
  await expect(page.locator(".board-column")).toHaveCount(4);
  for (const title of [
    "Inactive unassigned",
    "Future scheduled",
    "Waiting for dependency",
  ])
    await expect(cards.filter({ hasText: title })).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("active-board.png"),
    fullPage: true,
  });
  await taskScope(page, w.desk.taskWorkspace.all);
  await expect(cards).toHaveCount(9);
  await page.getByRole("button", { name: /^(More filters|更多筛选)$/ }).click();
  await page
    .getByLabel(w.desk.activationState, { exact: true })
    .selectOption("INACTIVE");
  await expect(cards).toHaveCount(3);
  await expect(cards.locator(".readiness.ready")).toHaveCount(0);
  await cards
    .filter({ hasText: "Inactive unassigned" })
    .locator(".task-title")
    .press("Enter");
  await page.getByRole("dialog").locator(".task-advanced > summary").click();
  await page
    .getByRole("dialog")
    .getByLabel(w.desk.activationState, { exact: true })
    .selectOption("ACTIVE");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: w.common.save, exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(cards).toHaveCount(2);
  await nav(page, w.desk.tasks);
  await page.getByRole("button", { name: /^(More filters|更多筛选)$/ }).click();
  await page
    .getByLabel(w.desk.activationState, { exact: true })
    .selectOption("ALL");
  await page
    .getByRole("tab", { name: w.desk.taskWorkspace.now, exact: true })
    .click();
  await expect(cards).toHaveCount(5);
  await expect(cards.filter({ hasText: "Inactive unassigned" })).toBeVisible();
  await taskScope(page, w.desk.taskWorkspace.completed);
  await page.getByLabel(w.desk.status, { exact: true }).selectOption("DONE");
  await expect(cards).toHaveCount(1);
  await page.reload();
  await expect(page.getByLabel(w.desk.status, { exact: true })).toHaveValue(
    "UNFINISHED",
  );
  await expect(cards).toHaveCount(5);
  await page.screenshot({
    path: info.outputPath("active-tasks.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await nav(page, w.desk.planning);
  await page.getByRole("button", { name: /^(More filters|更多筛选)$/ }).click();
  await expect(
    page.getByLabel(w.desk.activationState, { exact: true }),
  ).toHaveValue("ALL");
  await expect(cards).toHaveCount(9);
  await page.screenshot({
    path: info.outputPath("task-planning.png"),
    fullPage: true,
  });
});

test("project workspace connects materials, children and external dependencies", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const project = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Research workspace",
    descriptionMd: "## Purpose\n\nKeep **original** Markdown.",
  });
  const note = await mutation(page, "/api/note/save", {
    id: null,
    version: 0,
    input: {
      kind: "NOTE",
      title: "Design record",
      bodyMd: "Unchanged source",
      day: null,
    },
  });
  const space = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "SPACE",
      spaceId: null,
      title: "Sources",
      bodyMd: "Source index",
    },
  });
  const document = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "DOCUMENT",
      spaceId: space.id,
      title: "Specification",
      bodyMd: "# Requirements",
    },
  });
  await page.reload();
  await nav(page, w.desk.projects);
  await page
    .getByRole("button", { name: "Research workspace", exact: true })
    .press("Enter");
  await expect(page.locator(".project-workspace h1")).toHaveText(
    "Research workspace",
  );
  await expect(page.getByRole("tabpanel").locator("strong")).toHaveText(
    "original",
  );
  await projectAction(page, w.desk.projectHub.newChild);
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByLabel(w.desk.parentProject, { exact: true }),
  ).toContainText("Research workspace");
  await dialog.getByLabel(w.work.title, { exact: true }).fill("Experiment");
  await dialog
    .getByRole("button", { name: w.desk.createProject, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("tab", { name: w.desk.projectHub.overview, exact: true })
    .click();
  await page
    .getByRole("tabpanel")
    .getByRole("button", { name: /Experiment/ })
    .press("Enter");
  await expect(page.locator(".project-workspace h1")).toHaveText("Experiment");
  await page.getByRole("button", { name: w.desk.newTask, exact: true }).click();
  await dialog.getByLabel(w.work.title, { exact: true }).fill("Measure sample");
  await dialog
    .getByRole("button", { name: w.common.create, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await waitForLocalReplay(page);
  const snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  const child = snapshot.items.find(
    (item: { title: string }) => item.title === "Experiment",
  );
  const task = snapshot.items.find(
    (item: { title: string }) => item.title === "Measure sample",
  );
  expect(child.parentProjectId).toBe(project.id);
  expect(task).toMatchObject({ type: "TASK", projectIds: [child.id] });
  const external = await mutation(page, "/api/work/create", {
    title: "External approval",
  });
  await mutation(page, "/api/work/create", { title: "Unrelated task" });
  await mutation(page, "/api/edge/create", {
    fromId: external.id,
    toId: task.id,
  });
  await projectAction(page, `${w.desk.parentProject} · Research workspace`);
  await page
    .getByRole("tab", { name: w.desk.projectHub.knowledge, exact: true })
    .click();
  await page.getByLabel(/知识空间名称|Wiki space title/).fill("Primary Wiki");
  await page.getByRole("button", { name: /Create Wiki|创建 Wiki/ }).click();
  for (const entry of [note, document]) {
    await page
      .getByLabel(w.desk.projectHub.chooseDocument, { exact: true })
      .fill(entry.title);
    await page.getByRole("button", { name: entry.title, exact: true }).click();
    await expect(
      page
        .locator(".project-material")
        .getByRole("button", { name: entry.title, exact: true }),
    ).toBeVisible();
  }
  const documentReference = page.locator(".project-material").filter({
    has: page.getByRole("button", { name: document.title, exact: true }),
  });
  await documentReference
    .getByRole("button", { name: w.desk.projectHub.detach, exact: true })
    .click();
  await expect(documentReference).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("project-materials.png"),
    fullPage: true,
  });
  const after = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    after.notes.find((entry: { id: string }) => entry.id === note.id),
  ).toMatchObject({ bodyMd: "Unchanged source", deletedAt: null });
  expect(
    after.library.find((entry: { id: string }) => entry.id === document.id),
  ).toMatchObject({ deletedAt: null });
  await page
    .getByRole("tab", { name: w.desk.projectHub.tasks, exact: true })
    .click();
  await expect(
    page.locator(".project-workspace .project-brief-editor"),
  ).toHaveCount(0);
  await expect(
    page.locator(".project-workspace .dependency-focus-graph"),
  ).toHaveCount(0);
  await openProjectDependencyScope(
    page,
    "Measure sample",
    info.project.name.endsWith("zh"),
  );
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await expect(
    page.locator(".react-flow__node").filter({ hasText: "Unrelated task" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("project-graph.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("project knowledge documents files and overview summaries persist", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  const zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const project = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Owned workspace",
  });
  await mutation(page, "/api/work/create", {
    title: "Scheduled experiment",
    projectIds: [project.id],
    startDate: "2026-09-18",
    dueDate: "2026-09-20",
  });
  await page.reload();
  await nav(page, w.desk.projects);
  await page
    .getByRole("button", { name: "Owned workspace", exact: true })
    .press("Enter");
  await page
    .getByRole("tab", { name: w.desk.projectHub.knowledge, exact: true })
    .click();
  await page
    .getByLabel(zh ? "知识空间名称" : "Wiki space title", { exact: true })
    .fill("Primary Wiki");
  await page.getByRole("button", { name: /创建 Wiki|Create Wiki/ }).click();
  await expect(
    page.getByRole("button", { name: /★ Primary Wiki/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: zh ? "新建页面" : "Create page", exact: true })
    .click();
  await pane(page)
    .getByLabel(w.spaces.title, { exact: true })
    .fill("Owned research note");
  await documentMode(page, zh ? "源码" : "Source");
  await pane(page)
    .getByLabel(w.spaces.body, { exact: true })
    .fill("# Original\n- [ ] preserve as prose");
  await saveDocument(page, w);
  await browseDocuments(page);
  await expect(
    page
      .getByRole("button", { name: "Owned research note", exact: true })
      .first(),
  ).toBeVisible();
  await page.locator('.project-workspace input[type="file"]').setInputFiles({
    name: "experiment.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,value\nsample,42\n"),
  });
  const fileRow = page
    .locator(".project-material")
    .filter({ hasText: "experiment.csv" });
  await expect(fileRow).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await fileRow
    .getByRole("button", {
      name: zh ? "文件操作：experiment.csv" : "File actions: experiment.csv",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: zh ? "下载" : "Download", exact: true })
    .click();
  expect((await downloaded).suggestedFilename()).toBe("experiment.csv");
  await fileRow
    .getByRole("button", {
      name: zh ? "文件操作：experiment.csv" : "File actions: experiment.csv",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", {
      name: zh ? "移至回收站" : "Move to Trash",
      exact: true,
    })
    .click();
  await expect(fileRow).toHaveCount(0);
  await page
    .getByLabel(zh ? "包含已删除资料" : "Include deleted materials")
    .check();
  await fileRow
    .getByRole("button", {
      name: zh ? "文件操作：experiment.csv" : "File actions: experiment.csv",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: zh ? "恢复" : "Restore", exact: true })
    .click();
  await expect(
    fileRow.getByRole("button", { name: "experiment.csv", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: info.outputPath("owned-project-materials.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("tab", { name: w.desk.projectHub.overview, exact: true })
    .click();
  await page
    .getByRole("tabpanel")
    .locator("summary")
    .filter({ hasText: /^(项目时间线|Project timeline)$/ })
    .click();
  await expect(page.getByRole("tabpanel")).toContainText("2026-09-20");
  await page.screenshot({
    path: info.outputPath("owned-project-activity.png"),
    fullPage: true,
  });
  const fileSyncDiagnostic = await page.evaluate(async () => {
    const result: unknown[] = [];
    for (const database of await indexedDB.databases()) {
      if (!database.name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(database.name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        if (!db.objectStoreNames.contains("outbox")) continue;
        const rows = await new Promise<{ entityType?: string }[]>(
          (resolve, reject) => {
            const request = db
              .transaction("outbox")
              .objectStore("outbox")
              .getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          },
        );
        result.push(...rows.filter((row) => row.entityType === "files"));
      } finally {
        db.close();
      }
    }
    return result;
  });
  writeFileSync(
    info.outputPath("project-file-outbox.json"),
    JSON.stringify(fileSyncDiagnostic, null, 2),
  );
  await expect
    .poll(
      async () => {
        const current = await (
          await page.request.get(workbench.url + "/api/snapshot")
        ).json();
        return current.files.find(
          (entry: { name: string }) => entry.name === "experiment.csv",
        )?.deletedAt;
      },
      {
        message: "restored local File durably replayed to the bound workspace",
      },
    )
    .toBe(null);
  const snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(snapshot.projectMaterials).toHaveLength(2);
  expect(
    snapshot.projectMaterials.some(
      (entry: { kind: string }) => entry.kind === "FILE",
    ),
  ).toBe(false);
  const uploaded = snapshot.files.find(
    (entry: { name: string }) => entry.name === "experiment.csv",
  );
  expect(uploaded).toEqual(
    expect.objectContaining({
      name: "experiment.csv",
      deletedAt: null,
      size: Buffer.byteLength("name,value\nsample,42\n"),
    }),
  );
  expect(snapshot.links).toContainEqual(
    expect.objectContaining({
      from: { kind: "WORK", id: project.id },
      to: { kind: "FILE", id: uploaded.id },
      relation: "REFERENCES",
    }),
  );
  expect(snapshot.items).toHaveLength(2);
  expect(
    snapshot.library.find(
      (entry: { title: string }) => entry.title === "Owned research note",
    ).bodyMd,
  ).toBe("# Original\n- [ ] preserve as prose");
});

test("legacy Project original migrates once to the same first-class File identity and survives offline reload", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const project = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Legacy originals",
  });
  const original = Buffer.from([0, 128, 255, 10, 13, 0]);
  const legacy = await mutation(page, "/api/projects/upload", {
    projectId: project.id,
    name: "Legacy original.bin",
    mime: "application/octet-stream",
    base64: original.toString("base64"),
  });
  await page.goto(workbench.url + `/#projects/${project.id}?tab=knowledge`);
  await expect(page.locator(".project-workspace h1")).toHaveText(
    "Legacy originals",
  );
  const legacyRow = page
    .locator(".project-material")
    .filter({ hasText: "Legacy original.bin" });
  await expect(legacyRow).toBeVisible();
  await prepareOfflineShell(page);
  await page.context().setOffline(true);
  await legacyRow
    .getByRole("button", {
      name: zh
        ? "更多操作：Legacy original.bin"
        : "More actions: Legacy original.bin",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", {
      name: zh ? "移至回收站" : "Move to Trash",
      exact: true,
    })
    .click();
  await expect(legacyRow).toHaveCount(0);
  await page
    .getByLabel(zh ? "包含已删除资料" : "Include deleted materials")
    .check();
  await legacyRow
    .getByRole("button", { name: zh ? "恢复" : "Restore", exact: true })
    .click();
  // Deleted rows are already visible with "Include deleted materials" checked.
  // Wait for the committed restored state before interrupting the page.
  await expect(
    legacyRow.getByRole("button", { name: "Legacy original.bin", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await expect(legacyRow).toBeVisible();
  await page.context().setOffline(false);
  await expect
    .poll(async () => {
      const snapshot = await (
        await page.request.get(workbench.url + "/api/snapshot")
      ).json();
      return snapshot.projectMaterials.find(
        (entry: { id: string }) => entry.id === legacy.id,
      )?.version;
    })
    .toBe(3);
  const firstDownload = page.waitForEvent("download");
  await legacyRow
    .getByRole("button", {
      name: zh
        ? "更多操作：Legacy original.bin"
        : "More actions: Legacy original.bin",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: zh ? "下载" : "Download", exact: true })
    .click();
  const firstDownloaded = await firstDownload;
  expect(await readFile((await firstDownloaded.path())!)).toEqual(original);
  const fileRow = page.locator(`.project-file[data-file-id="${legacy.id}"]`);
  await expect(fileRow).toBeVisible();
  await expect(legacyRow).toHaveCount(1);
  await expect
    .poll(async () => {
      const snapshot = await (
        await page.request.get(workbench.url + "/api/snapshot")
      ).json();
      return snapshot.files.find(
        (file: { id: string }) => file.id === legacy.id,
      )?.contentHash;
    })
    .toBe(createHash("sha256").update(original).digest("hex"));
  await prepareOfflineShell(page);
  await page.context().setOffline(true);
  await page.reload();
  await expect(fileRow).toBeVisible();
  const offlineDownload = page.waitForEvent("download");
  await fileRow
    .getByRole("button", {
      name: zh
        ? "文件操作：Legacy original.bin"
        : "File actions: Legacy original.bin",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: zh ? "下载" : "Download", exact: true })
    .click();
  const downloaded = await offlineDownload;
  expect(await readFile((await downloaded.path())!)).toEqual(original);
  await page.screenshot({
    path: info.outputPath("legacy-file-offline.png"),
    fullPage: true,
  });
  await fileRow
    .getByRole("button", { name: "Legacy original.bin", exact: true })
    .click();
  await expect(page.locator(".file-detail")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`file=${legacy.id}`));
  await page.screenshot({
    path: info.outputPath("legacy-file-detail-offline.png"),
    fullPage: true,
  });
  await page.context().setOffline(false);
  const snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    snapshot.files.filter((file: { id: string }) => file.id === legacy.id),
  ).toHaveLength(1);
  expect(
    snapshot.projectMaterials.find(
      (entry: { id: string }) => entry.id === legacy.id,
    ),
  ).toMatchObject({
    ...legacy,
    version: 3,
    updatedAt: expect.any(String),
    updatedBy: expect.any(String),
  });
});

test("navigation collapses independently on desktop and mobile", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  await page.setViewportSize({ width: 1280, height: 850 });
  const sidebarBounds = await page.locator(".sidebar").boundingBox();
  const collapseBounds = await page
    .locator(".sidebar-collapse-button")
    .boundingBox();
  expect(collapseBounds!.x + collapseBounds!.width).toBeLessThanOrEqual(
    sidebarBounds!.x + sidebarBounds!.width,
  );
  await page.locator(".sidebar-collapse-button").click();
  await expect(page.locator(".sidebar-collapse-button")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await nav(page, w.desk.projects);
  await page.reload();
  await expect(page.locator(".sidebar-collapse-button")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.screenshot({
    path: info.outputPath("navigation-desktop-collapsed.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 412, height: 850 });
  await page.locator(".mobile-navigation-toggle").click();
  await expect(page.locator(".mobile-navigation-toggle")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.locator(".mobile-more-sheet")).toBeVisible();
  await expect(page.locator(".sidebar nav")).toBeHidden();
  await page.screenshot({
    path: info.outputPath("navigation-mobile-more-sheet.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.locator(".sidebar nav")).toBeHidden();
  await expect(page.locator(".mobile-navigation-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.screenshot({
    path: info.outputPath("navigation-mobile-collapsed.png"),
    fullPage: true,
  });
  await nav(page, w.desk.notes);
  await page.screenshot({
    path: info.outputPath("navigation-mobile-expanded.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 850 });
  await expect(page.locator(".sidebar-collapse-button")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.locator(".sidebar-collapse-button").click();
  await expect(page.locator(".sidebar-collapse-button")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});

test("v2.4 provider connection test and discovery have separate friendly diagnostics", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  await openAccountApiModels(page, zh);
  await page
    .getByRole("button", {
      name: zh ? "添加服务连接" : "Add provider connection",
      exact: true,
    })
    .click();
  const form = page.getByRole("form", {
    name: zh ? "连接编辑" : "Connection editor",
  });
  await form.getByRole("combobox").selectOption("DEEPSEEK");
  await form.locator("summary").click();
  await expect(
    form.getByLabel(zh ? "API 基址" : "API base URL", { exact: true }),
  ).toHaveValue("https://api.deepseek.com/");
  await form.locator('input[type="password"]').fill("TEST-ONLY-PROVIDER-KEY");
  await form
    .getByRole("button", {
      name: zh ? "保存连接" : "Save connection",
      exact: true,
    })
    .click();
  await expect(form).toHaveCount(0);
  const testButton = page.getByRole("button", {
    name: zh ? "测试连接" : "Test connection",
    exact: true,
  });
  const discover = page.getByRole("button", {
    name: zh ? "发现模型" : "Discover models",
    exact: true,
  });
  await expect(testButton).toBeVisible();
  await expect(discover).toBeVisible();
  await page.route("**/api/ai/connections/test", (route) =>
    route.fulfill({
      status: 502,
      json: {
        error: "PROVIDER_REQUEST_FAILED",
        providerError: {
          category: "AUTH_INVALID",
          provider: "DEEPSEEK",
          status: 401,
          retryable: false,
          messageKey: "provider.error.AUTH_INVALID",
        },
      },
    }),
  );
  await testButton.click();
  await expect(page.getByRole("alert")).toContainText(
    zh ? "密钥无效或已过期" : "The key is invalid or expired",
  );
  await expect(page.getByRole("alert").locator("pre")).toBeHidden();
  await page.getByRole("alert").locator("summary").click();
  await expect(page.getByRole("alert").locator("pre")).toContainText("401");
  await expect(page.getByRole("alert")).not.toContainText(
    "TEST-ONLY-PROVIDER-KEY",
  );
  await page.unroute("**/api/ai/connections/test");
  await page.route("**/api/ai/connections/test", (route) =>
    route.fulfill({ json: { connected: true, discovery: "UNSUPPORTED" } }),
  );
  await testButton.click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: zh ? "连接成功" : "Connection successful" }),
  ).toBeVisible();
  await page.route("**/api/ai/connections/models", (route) =>
    route.fulfill({
      status: 502,
      json: {
        error: "PROVIDER_REQUEST_FAILED",
        providerError: {
          category: "UNSUPPORTED_DISCOVERY",
          provider: "DEEPSEEK",
          status: 404,
          retryable: false,
          messageKey: "provider.error.UNSUPPORTED_DISCOVERY",
        },
      },
    }),
  );
  await discover.click();
  await expect(page.getByRole("alert")).toContainText(
    zh ? "手动添加模型" : "Add a model manually",
  );
  await expect(
    page.getByRole("button", {
      name: zh ? "添加模型" : "Add model",
      exact: true,
    }),
  ).toBeEnabled();
});

test("named AI profiles persist independently and bind reviewed proposals", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  const zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  await openAccountApiModels(page, zh);
  await page
    .getByRole("button", {
      name: zh ? "添加服务连接" : "Add provider connection",
      exact: true,
    })
    .click();
  const connection = page.getByRole("form", {
    name: zh ? "连接编辑" : "Connection editor",
  });
  await connection
    .getByLabel(zh ? "连接名称" : "Connection name", { exact: true })
    .fill("Research provider");
  await connection
    .locator("summary")
    .filter({ hasText: zh ? "高级" : "Advanced" })
    .click();
  await connection
    .getByLabel(zh ? "API 基址" : "API base URL", { exact: true })
    .fill("https://provider.example/v1");
  await connection
    .getByLabel(
      zh
        ? "API 密钥（留空保留已有密钥）"
        : "API key (blank keeps existing key)",
      { exact: true },
    )
    .fill("TEST-ONLY-PROFILE-SECRET");
  await connection
    .getByRole("button", {
      name: zh ? "保存连接" : "Save connection",
      exact: true,
    })
    .click();
  await expect(connection).toHaveCount(0);
  await page
    .getByRole("button", {
      name: zh ? "添加模型" : "Add model",
      exact: true,
    })
    .click();
  const modelForm = page.getByRole("form", {
    name: zh ? "手工添加模型" : "Add model manually",
  });
  await modelForm
    .getByRole("combobox", {
      name: zh ? "所属连接" : "Provider connection",
      exact: true,
    })
    .selectOption({ label: "Research provider" });
  await modelForm
    .getByLabel(zh ? "模型标识" : "Model identifier", { exact: true })
    .fill("test-research");
  await modelForm
    .getByRole("button", { name: zh ? "添加模型" : "Add model", exact: true })
    .click();
  await expect(modelForm).toHaveCount(0);
  await page
    .getByRole("button", {
      name: zh ? "添加模型配置" : "Add model profile",
      exact: true,
    })
    .click();
  const profile = page.getByRole("form", {
    name: zh ? "配置编辑" : "Profile editor",
  });
  await profile
    .getByLabel(zh ? "配置名称" : "Profile name", { exact: true })
    .fill("Research");
  await profile
    .getByRole("combobox", {
      name: zh ? "首选模型" : "Primary model",
      exact: true,
    })
    .selectOption({ label: "Research provider / test-research" });
  await profile
    .locator("summary")
    .filter({ hasText: zh ? "高级" : "Advanced" })
    .click();
  await profile
    .getByLabel(zh ? "配置 ID" : "Profile ID", { exact: true })
    .fill("research");
  await profile
    .getByRole("button", {
      name: zh ? "保存模型配置" : "Save model profile",
      exact: true,
    })
    .click();
  await expect(profile).toHaveCount(0);
  await expect(
    page.locator(".model-settings input[type=password]"),
  ).toHaveCount(0);
  await page.reload();
  await openAccountApiModels(page, zh);
  await page.locator("summary").filter({ hasText: w.connected.newRun }).click();
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

test("2.1 Provider catalog routing Explicit Space Project Personal and Unlimited budget fallback survive refresh", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const project = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Routing Project",
  });
  const space = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: { kind: "SPACE", spaceId: null, title: "Routing Space", bodyMd: "" },
  });
  const connections = [
    {
      id: "openai",
      name: "OpenAI connection",
      kind: "OPENAI",
      endpoint: "https://provider.example/v1/",
      credentialRef: "openai",
      credentialConfigured: false,
    },
    {
      id: "anthropic",
      name: "Anthropic connection",
      kind: "ANTHROPIC",
      endpoint: "https://anthropic.example/v1/",
      credentialRef: "anthropic",
      credentialConfigured: false,
    },
  ];
  const models = ["personal", "project", "space", "explicit"].map(
    (kind, index) => ({
      id: `model-${kind}`,
      connectionId: index < 2 ? "openai" : "anthropic",
      modelId: `${kind}-model`,
      capabilities: {
        tools: true,
        jsonSchema: true,
        vision: false,
        streaming: false,
        embedding: false,
      },
    }),
  );
  const profiles = models.map((model, index) => ({
    id: `profile-${["personal", "project", "space", "explicit"][index]}`,
    name: [
      "Personal default",
      "Project profile",
      "Space profile",
      "Explicit profile",
    ][index],
    primaryModelId: model.id,
    fallbackModelIds: index === 0 ? ["model-space", "model-explicit"] : [],
    requestLimit: { kind: "UNLIMITED" },
    budget: {
      currency: "USD",
      dailyMicros: "UNLIMITED",
      inputMicrosPerMillion: 0,
      outputMicrosPerMillion: 0,
    },
  }));
  await mutation(page, "/api/ai/configuration/save", {
    version: 0,
    input: {
      connections,
      models,
      profiles,
      bindings: [
        { scope: "PERSONAL", entityId: null, profileId: "profile-personal" },
        {
          scope: "PROJECT",
          entityId: project.id,
          profileId: "profile-project",
        },
        { scope: "SPACE", entityId: space.id, profileId: "profile-space" },
      ],
      credentials: [
        { connectionId: "openai", key: "test-only-openai-key" },
        { connectionId: "anthropic", key: "test-only-anthropic-key" },
      ],
    },
  });
  await page.reload();
  await openAccountApiModels(page, zh);
  await expect(
    page
      .locator(".model-settings-row")
      .filter({ has: page.getByText("OpenAI connection", { exact: true }) }),
  ).toHaveCount(1);
  await expect(
    page
      .locator(".model-settings-row")
      .filter({ has: page.getByText("Anthropic connection", { exact: true }) }),
  ).toHaveCount(1);
  const personal = page
    .locator(".model-settings-row")
    .filter({ has: page.getByText("Personal default", { exact: true }) });
  await personal
    .getByRole("button", {
      name: zh ? "编辑配置" : "Edit profile",
      exact: true,
    })
    .click();
  let editor = page.getByRole("form", {
    name: zh ? "配置编辑" : "Profile editor",
  });
  await editor
    .getByRole("radio", {
      name: zh ? "限制次数" : "Limited requests",
      exact: true,
    })
    .check();
  await editor
    .getByRole("spinbutton", {
      name: zh ? "每天次数" : "Requests per day",
      exact: true,
    })
    .fill("100");
  await editor
    .getByRole("checkbox", {
      name: zh ? "预算不限" : "Unlimited budget",
      exact: true,
    })
    .uncheck();
  await editor
    .getByRole("spinbutton", {
      name: zh ? "每日美元预算" : "Daily budget in dollars",
      exact: true,
    })
    .fill("5");
  await editor
    .getByRole("button", {
      name: zh ? "保存模型配置" : "Save model profile",
      exact: true,
    })
    .click();
  await expect(editor).toHaveCount(0);
  let config = await (
    await page.request.get(workbench.url + "/api/ai/configuration")
  ).json();
  expect(
    config.profiles.find(
      (profile: { id: string }) => profile.id === "profile-personal",
    ),
  ).toMatchObject({
    requestLimit: { kind: "LIMITED", count: 100 },
    budget: { dailyMicros: 5_000_000 },
    fallbackModelIds: ["model-space", "model-explicit"],
  });
  expect(JSON.stringify(config)).not.toMatch(
    /test-only-(?:openai|anthropic)-key/,
  );
  await personal
    .getByRole("button", {
      name: zh ? "编辑配置" : "Edit profile",
      exact: true,
    })
    .click();
  editor = page.getByRole("form", { name: zh ? "配置编辑" : "Profile editor" });
  await editor
    .getByRole("radio", { name: zh ? "不限" : "Unlimited", exact: true })
    .check();
  await editor
    .getByRole("button", {
      name: zh ? "保存模型配置" : "Save model profile",
      exact: true,
    })
    .click();
  await expect(editor).toHaveCount(0);
  await page.reload();
  config = await (
    await page.request.get(workbench.url + "/api/ai/configuration")
  ).json();
  expect(
    config.profiles.find(
      (profile: { id: string }) => profile.id === "profile-personal",
    ).requestLimit,
  ).toEqual({ kind: "UNLIMITED" });
  const defaultRoute = await (
    await page.request.get(workbench.url + "/api/ai")
  ).json();
  expect(defaultRoute.route.fallbackRoutes).toHaveLength(2);
  await nav(page, w.desk.ai);
  const atlas = page.locator(".atlas-conversation");
  const ask = async (kind: string) => {
    await atlas
      .getByRole("textbox", {
        name: zh ? "向 Atlas 提问" : "Ask Atlas",
        exact: true,
      })
      .fill(`Check ${kind} routing`);
    await atlas
      .getByRole("button", { name: zh ? "发送" : "Send", exact: true })
      .click();
    await expect(atlas.locator(".approval-card")).toBeVisible();
    const state = await (
      await page.request.get(workbench.url + "/api/ai")
    ).json();
    const run = state.runs.find((run: { prompt: string }) =>
      run.prompt.includes(`Check ${kind} routing`),
    );
    expect(run.route.model).toBe(`${kind}-model`);
    expect(run.route.profileId).toBe(`profile-${kind}`);
    await atlas
      .getByRole("button", { name: zh ? "拒绝" : "Reject", exact: true })
      .click();
    await expect(atlas.locator(".approval-card")).toHaveCount(0);
  };
  await ask("personal");
  await atlas
    .getByRole("button", {
      name: zh ? "添加上下文" : "Add context",
      exact: true,
    })
    .click();
  await chooseProject(atlas.locator(".context-picker .hierarchy-picker"), [
    "Routing Project",
  ]);
  await atlas
    .getByRole("button", {
      name: zh ? "添加上下文" : "Add context",
      exact: true,
    })
    .click();
  await ask("project");
  await atlas
    .getByRole("button", {
      name: zh ? "添加上下文" : "Add context",
      exact: true,
    })
    .click();
  await atlas
    .locator(".space-picker .hierarchy-selected > button")
    .last()
    .click();
  await page
    .locator(".hierarchy-browser")
    .getByRole("button", { name: "Routing Space", exact: true })
    .click();
  await atlas
    .getByRole("button", {
      name: zh ? "添加上下文" : "Add context",
      exact: true,
    })
    .click();
  await ask("space");
  const selector = atlas.getByRole("combobox", {
    name: zh ? "对话模型配置" : "Conversation model profile",
    exact: true,
  });
  await selector.selectOption("profile-explicit");
  await expect(selector).toHaveValue("profile-explicit");
  await ask("explicit");
  await page.reload();
  await expect(selector).toHaveValue("profile-explicit");
  await selector.selectOption("");
  await expect(selector).toHaveValue("");
  expect(
    (
      await (
        await page.request.get(
          workbench.url +
            "/api/ai/sessions/messages?id=" +
            (
              await (
                await page.request.get(workbench.url + "/api/ai/sessions")
              ).json()
            )[0].id,
        )
      ).json()
    ).session.modelProfileOverride,
  ).toBeNull();
  await page.screenshot({
    path: info.outputPath("model-routing-catalog.png"),
    fullPage: true,
  });
});

test("reviewed plan and recurrence publish real tasks without duplication", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  await mutation(page, "/api/work/create", {
    title: "Workflow project",
    type: "PROJECT",
  });
  await page.reload();
  await nav(page, w.desk.projects);
  await page.getByText(w.desk.workflows.plans, { exact: true }).click();
  const plans = page.locator("details").filter({
    has: page.locator("summary", { hasText: w.desk.workflows.plans }),
  });
  await chooseProject(plans.locator(".hierarchy-picker"), ["Workflow project"]);
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
  await waitForLocalReplay(page);
  state = await page.evaluate(async () =>
    (await fetch("/api/snapshot")).json(),
  );
  expect(state.items).toHaveLength(3);
  expect(state.edges).toHaveLength(1);
  await nav(page, w.desk.tasks);
  await expect(page.locator(".recurrence-manager")).toHaveCount(0);
  await page.locator(".page-header .compact-create").click();
  const repeatEditor = page.getByRole("dialog").first();
  await repeatEditor
    .getByLabel(w.work.title, { exact: true })
    .fill("Daily review");
  await repeatEditor
    .getByRole("button", {
      name: /^(\+ 更多设置|\+ More settings)$/,
      exact: true,
    })
    .click();
  await repeatEditor.locator(".task-advanced summary").click();
  await repeatEditor
    .getByLabel(info.project.name.endsWith("zh") ? "重复" : "Repeat", {
      exact: true,
    })
    .selectOption("DAILY");
  await repeatEditor
    .getByText(
      info.project.name.endsWith("zh")
        ? "高级重复设置"
        : "Advanced recurrence settings",
      { exact: true },
    )
    .click();
  await repeatEditor
    .getByRole("button", {
      name: info.project.name.endsWith("zh") ? "时区" : "Timezone",
      exact: true,
    })
    .click();
  const utcLabel = await page.evaluate(
    () =>
      new Intl.DateTimeFormat(document.documentElement.lang || "en-US", {
        timeZone: "UTC",
        timeZoneName: "longGeneric",
      })
        .formatToParts(new Date("2026-01-15T12:00:00Z"))
        .find((part) => part.type === "timeZoneName")!.value,
  );
  await page.getByRole("option", { name: utcLabel, exact: true }).click();
  await chooseDate(
    page,
    repeatEditor.getByRole("button", {
      name: info.project.name.endsWith("zh") ? "首次日期" : "First date",
      exact: true,
    }),
    new Date().toISOString().slice(0, 10),
  );
  await repeatEditor
    .getByRole("button", { name: w.common.create, exact: true })
    .click();
  await expect(repeatEditor).not.toBeVisible();
  await page
    .getByRole("button", {
      name: info.project.name.endsWith("zh")
        ? "管理周期任务"
        : "Manage recurring tasks",
      exact: true,
    })
    .click();
  const recurrences = page.locator(".recurrence-manager");
  await expect(
    recurrences.getByText(new RegExp(w.desk.workflows.OPEN)),
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
    .locator(".note-card, .library-document-row, .space-card")
    .filter({ hasText: "Permission test" })
    .press("Enter");
  await documentAction(page, zh ? "AI 权限" : "AI permissions");
  await pane(page)
    .getByText(zh ? "AI 数据许可 · 禁止" : "AI data permission · Denied", {
      exact: true,
    })
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
    .locator(".note-card, .library-document-row, .space-card")
    .filter({ hasText: "Permission test" })
    .press("Enter");
  await documentAction(page, zh ? "AI 权限" : "AI permissions");
  await pane(page)
    .getByText(
      zh ? "AI 数据许可 · 逐次询问" : "AI data permission · Ask each time",
      { exact: true },
    )
    .click();
  await expect(access).toHaveValue("ASK");
});

test("project category management persists, filters and restores", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  const chinese = info.project.name.endsWith("zh");
  const iconLabel = chinese ? "图标（文字或表情）" : "Icon (text or emoji)";
  const colorLabel = chinese ? "颜色" : "Color";
  const positionLabel = chinese
    ? "排序（小值优先）"
    : "Position (lowest first)";
  const densityLabel = chinese ? "界面密度" : "Interface density";
  await unlock(page, workbench.url, workbench.secret, w);
  const categorizedProject = await mutation(page, "/api/work/create", {
    title: "Categorized project",
    type: "PROJECT",
  });
  await mutation(page, "/api/work/create", {
    title: "Other project",
    type: "PROJECT",
  });
  await page.reload();
  await nav(page, w.desk.projects);
  await page
    .getByRole("button", {
      name: /^(项目列表选项|Project list options)$/,
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: w.desk.categories.manage, exact: true })
    .click();
  await page
    .getByLabel(w.desk.categories.name, { exact: true })
    .fill("Research");
  await page.getByLabel(iconLabel, { exact: true }).fill("🔬");
  await page.getByLabel(colorLabel, { exact: true }).fill("#123456");
  await expect(page.getByLabel(positionLabel, { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: w.desk.categories.save, exact: true })
    .click();
  await expect(
    page.getByLabel(w.desk.categories.name, { exact: true }),
  ).toHaveValue("");
  await waitForLocalReplay(page);
  const snapshot = await page.evaluate(async () =>
    (await fetch("/api/snapshot")).json(),
  );
  expect(snapshot.categories[0]).toMatchObject({
    icon: "🔬",
    color: "#123456",
    position: 0,
  });
  await mutation(page, "/api/work/update", {
    id: categorizedProject.id,
    version: categorizedProject.version,
    input: { categoryId: snapshot.categories[0].id },
  });
  await page.reload();
  await page
    .getByRole("button", {
      name: /^(项目列表选项|Project list options)$/,
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: w.desk.categories.manage, exact: true })
    .click();
  const categoryRow = page
    .locator(".category-manager li")
    .filter({ hasText: "Research" });
  await expect(categoryRow).toContainText("🔬");
  await expect(categoryRow.locator(".category-color")).toHaveCSS(
    "background-color",
    "rgb(18, 52, 86)",
  );
  await categoryRow
    .getByRole("button", { name: w.desk.categories.edit, exact: true })
    .click();
  await expect(page.getByLabel(iconLabel, { exact: true })).toHaveValue("🔬");
  await page.getByLabel(iconLabel, { exact: true }).fill("📚");
  await page.getByLabel(colorLabel, { exact: true }).fill("#abcdef");
  await expect(page.getByLabel(positionLabel, { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: w.desk.categories.save, exact: true })
    .click();
  await expect(
    page.getByLabel(w.desk.categories.name, { exact: true }),
  ).toHaveValue("");
  await expect(
    page
      .locator(".project-hierarchy > section")
      .filter({
        has: page.getByRole("heading", { name: "Research", exact: true }),
      })
      .locator(".project-card"),
  ).toHaveCount(1);
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
  await expect
    .poll(async () => {
      const response = await page.request.get(workbench.url + "/api/snapshot");
      return (await response.json()).categories[0];
    })
    .toMatchObject({ version: 4, deletedAt: null });
  await waitForLocalReplay(page);
  await page.reload();
  const restored = await page.evaluate(async () =>
    (await fetch("/api/snapshot")).json(),
  );
  expect(restored.categories[0]).toMatchObject({
    version: 4,
    icon: "📚",
    color: "#abcdef",
    position: 0,
    deletedAt: null,
  });
  await mutation(page, "/api/categories/save", {
    name: "First category",
    version: 0,
    deleted: false,
    position: 1,
    icon: "⭐",
    color: "#998877",
  });
  await page.reload();
  await page
    .getByRole("button", {
      name: /^(项目列表选项|Project list options)$/,
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: w.desk.categories.manage, exact: true })
    .click();
  await page
    .getByRole("button", {
      name: (chinese ? "调整顺序：" : "Reorder: ") + "First category",
      exact: true,
    })
    .press("Alt+ArrowUp");
  await expect(page.locator(".category-manager li").first()).toContainText(
    "First category",
  );
  await expect(page.locator(".category-manager li").nth(1)).toContainText("📚");
  await waitForLocalReplay(page);
  const reordered = await page.evaluate(async () =>
    (await fetch("/api/snapshot")).json(),
  );
  expect(
    reordered.categories.map((category: { name: string; position: number }) => [
      category.name,
      category.position,
    ]),
  ).toEqual([
    ["First category", 1024],
    ["Research", 2048],
  ]);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: w.common.close, exact: true })
    .click();
  await nav(page, w.desk.settings);
  await page
    .getByRole("combobox", { name: densityLabel, exact: true })
    .selectOption("compact");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await nav(page, w.desk.projects);
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.locator(".project-card").first()).toHaveCSS(
    "padding-top",
    "10px",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await nav(page, w.desk.settings);
  await expect(
    page.getByRole("combobox", { name: densityLabel, exact: true }),
  ).toHaveValue("compact");
  await page.screenshot({
    path: info.outputPath("density-compact.png"),
    fullPage: true,
  });
  await page
    .getByRole("combobox", { name: densityLabel, exact: true })
    .selectOption("comfortable");
  await nav(page, w.desk.projects);
  await expect(page.locator("html")).toHaveAttribute(
    "data-density",
    "comfortable",
  );
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
  await chooseProject(
    dialog.locator(".project-memberships .hierarchy-picker"),
    ["Project A"],
  );
  await chooseProject(
    dialog.locator(".project-memberships .hierarchy-picker"),
    ["Project B"],
  );
  await page.screenshot({
    path: info.outputPath("multi-project-editor.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: w.common.create, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await waitForLocalReplay(page);
  await page.reload();
  const snapshot = await page.evaluate(async () =>
    (await fetch("/api/snapshot")).json(),
  );
  expect(
    snapshot.items.find(
      (item: { title: string }) => item.title === "Shared task",
    ),
  ).toMatchObject({ parentProjectId: null, projectIds: [a.id, b.id] });
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
  await unlock(page, workbench.url, workbench.secret, w);
  await page.goto(workbench.url + "/#projects");
  await page.getByRole("button", { name: w.desk.newProject }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(w.work.title, { exact: true }).fill("Parent project");
  await dialog
    .getByRole("button", { name: w.desk.createProject, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: w.desk.newProject }).first().click();
  await dialog.getByLabel(w.work.title, { exact: true }).fill("Child project");
  await chooseProject(dialog.locator(".hierarchy-picker"), ["Parent project"]);
  await page.screenshot({
    path: info.outputPath("work-planning-editor.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: w.desk.createProject, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await waitForLocalReplay(page);
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
    parentProjectId: parent.id,
    activationPolicy: "MANUAL",
    activationState: "ACTIVE",
    startDate: null,
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
    data: { title: "Nested task", projectIds: [child.id] },
  });
  expect(createdTask.status()).toBe(200);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Child project", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: w.desk.expandProject.replace("{{title}}", "Parent project"),
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Child project", exact: true }),
  ).toBeVisible();
  const parentCard = page.locator(".project-card").filter({
    has: page.getByRole("heading", { name: "Parent project", exact: true }),
  });
  const childCard = page.locator(".project-card").filter({
    has: page.getByRole("heading", { name: "Child project", exact: true }),
  });
  await expect(parentCard.locator(".project-compact-progress span")).toHaveText(
    "0 / 1",
  );
  await (await projectMenu(page, "Parent project"))
    .getByRole("menuitem", { name: w.desk.archive, exact: true })
    .click();
  await expect(page.locator(".project-card")).toHaveCount(0);
  await page
    .getByRole("button", { name: new RegExp(w.desk.archivedProjects) })
    .click();
  await expect(page.locator(".project-card")).toHaveCount(2);
  await expect(
    (await projectMenu(page, "Child project")).getByRole("menuitem", {
      name: w.desk.unarchive,
      exact: true,
    }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
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
  await (await projectMenu(page, "Parent project"))
    .getByRole("menuitem", { name: w.desk.unarchive, exact: true })
    .click();
  await expect(page.locator(".project-card")).toHaveCount(0);
  await page
    .getByRole("button", { name: new RegExp(w.desk.archivedProjects) })
    .click();
  await expect(page.locator(".project-card")).toHaveCount(2);
  await (await projectMenu(page, "Parent project"))
    .getByRole("menuitem", { name: w.desk.projectTasks, exact: true })
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
  await unlock(page, workbench.url, workbench.secret, w);
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
    page.getByLabel(w.spaces.username, { exact: true }),
  ).toBeVisible();
  await page.getByLabel(w.spaces.username, { exact: true }).fill("second-user");
  await page
    .getByLabel(w.spaces.password, { exact: true })
    .fill(workbench.secret);
  await page
    .getByRole("button", {
      name: /^(Sign in and review options|登录并查看选项)$/,
      exact: true,
    })
    .click();
  await expect(
    page.getByText("second-user", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.locator(".account-panel").getByText("image-editor", { exact: true }),
  ).toHaveCount(0);
  const confirmation1 = answerConfirmation(page, true);
  await page
    .getByRole("button", { name: w.spaces.revokeAllSessions, exact: true })
    .click();
  await confirmation1;
  await expect(
    page.getByLabel(w.spaces.username, { exact: true }),
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
      name: /^(Forget account|忘记账户) image-editor$/,
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
  await page.goto(workbench.url + "/#account");
  await page.getByLabel(w.spaces.username, { exact: true }).fill("test-user");
  await page
    .getByLabel(w.spaces.password, { exact: true })
    .fill("wrong-password");
  const server = page.getByLabel(/^(Server|服务器)$/, { exact: true });
  const enter = page.getByRole("button", {
    name: /^(Sign in and review options|登录并查看选项)$/,
    exact: true,
  });
  await server.fill("https://example.com/path");
  await enter.click();
  await expect(page.getByRole("alert").locator("p")).toHaveText(
    w.desk.loginInvalidServer,
  );
  await expect(enter).toBeEnabled();
  await server.fill(workbench.url);
  for (const [code, message] of [
    [401, w.desk.loginCredentials],
    [403, w.desk.loginForbidden],
    [429, w.desk.loginRateLimited],
  ] as const) {
    status = code;
    await enter.click();
    await expect(page.getByRole("alert").locator("p")).toHaveText(message);
    await expect(enter).toBeEnabled();
  }
  status = 200;
  await enter.click();
  await expect(page.getByRole("alert").locator("p")).toHaveText(
    w.desk.loginInvalidResponse,
  );
  hang = true;
  await enter.click();
  await expect(page.getByRole("status")).toHaveText(w.desk.loginDeadline);
  await expect(server).toBeDisabled();
  await expect(page.getByRole("alert").locator("p")).toHaveText(
    w.desk.loginTimeout,
    {
      timeout: 11000,
    },
  );
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
          if (command === "saved_accounts") return [];
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
  await unlock(page, workbench.url, workbench.secret, w);
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
  await page.goto(workbench.url + "/#account");
  await expect(
    page.getByLabel(w.spaces.username, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(w.spaces.currentSession, { exact: true }),
  ).toHaveCount(0);
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
  await page.goto(workbench.url + "/#settings");
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
  const confirmation2 = answerConfirmation(page, false);
  await panel.getByRole("button", { name: w.settings.updateInstall }).click();
  await confirmation2;
  await expect(panel.getByRole("status")).toHaveText(
    w.settings.updateState_ready,
  );
  const confirmation3 = answerConfirmation(page, true);
  await panel.getByRole("button", { name: w.settings.updateInstall }).click();
  await confirmation3;
  await expect(panel.getByRole("progressbar")).toHaveAttribute("value", "50");
  await expect(panel.getByRole("status")).toHaveText(
    w.settings.updateState_error,
  );
  const confirmation4 = answerConfirmation(page, true);
  await panel.getByRole("button", { name: w.settings.updateInstall }).click();
  await confirmation4;
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
  await page.goto(workbench.url + "/#settings");
  await expect(
    page.getByRole("region", {
      name: words(info.project.name).settings.updateTitle,
    }),
  ).toHaveCount(0);
});
test("Delta Space and Milestone creation use their own entity fields", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const project = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Delta entity project",
  });
  await page.reload();
  await nav(page, w.spaces.library);
  await page
    .getByRole("button", { name: w.spaces.newSpace, exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: zh ? "新建知识空间" : "Create knowledge space",
    exact: true,
  });
  await expect(dialog.locator(".cm-editor")).toHaveCount(0);
  await expect(
    dialog.getByLabel(w.desk.noteTitle, { exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByLabel(zh ? "空间名称" : "Space name", { exact: true })
    .fill("Delta compact space");
  await dialog
    .getByLabel(zh ? "描述（可选）" : "Description (optional)", { exact: true })
    .fill("Container description");
  await dialog
    .getByRole("button", { name: zh ? "创建" : "Create", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".library-view h2")).toHaveText(
    "Delta compact space",
  );
  await expect(page.locator(".document-pane:visible")).toHaveCount(0);
  await nav(page, w.desk.projects);
  await page
    .getByRole("button", { name: project.title, exact: true })
    .press("Enter");
  await projectAction(page, w.desk.newMilestone);
  const milestone = page.getByRole("dialog", {
    name: zh ? "新建里程碑" : "New milestone",
    exact: true,
  });
  await milestone
    .getByLabel(zh ? "里程碑名称" : "Milestone name", { exact: true })
    .fill("Delta distinct outcome");
  await milestone
    .getByLabel(zh ? "成果与达成标准" : "Outcome and success criteria", {
      exact: true,
    })
    .fill("Outcome preserved");
  await expect(milestone.locator(".task-editor-surface")).toHaveCount(0);
  await expect(
    milestone.getByRole("button", { name: /重复|Repeat|Activation/ }),
  ).toHaveCount(0);
  await milestone
    .getByRole("button", { name: zh ? "创建" : "Create", exact: true })
    .click();
  await expect(milestone).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (
          await (await page.request.get(workbench.url + "/api/snapshot")).json()
        ).items.find(
          (item: { title: string }) => item.title === "Delta distinct outcome",
        )?.type,
    )
    .toBe("MILESTONE");
  await page.screenshot({
    path: info.outputPath("delta-entity-creation.png"),
    fullPage: true,
  });
  await nav(page, w.desk.journal);
  await page.locator(".page-header .compact-create").click();
  await expect(
    pane(page).getByLabel(zh ? "日记标题" : "Journal title", { exact: true }),
  ).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await expect(
    pane(page).getByLabel(w.desk.noteTitle, { exact: true }),
  ).toHaveCount(0);
  await documentMode(page, zh ? "源码" : "Source");
  await pane(page)
    .getByLabel(w.desk.noteBody, { exact: true })
    .fill("Delta date-bound journal");
  await saveDocument(page, w);
  await expect
    .poll(
      async () =>
        (
          await (await page.request.get(workbench.url + "/api/snapshot")).json()
        ).notes.find(
          (note: { bodyMd: string }) =>
            note.bodyMd === "Delta date-bound journal",
        )?.kind,
    )
    .toBe("JOURNAL");
});

test("Delta unbound device can paste and reload images without login or network", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await page.goto(workbench.url + "/#notes");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => resolve(),
          { once: true },
        ),
      );
  });
  await page.reload();
  await page.route("**/api/**", (route) => route.abort("internetdisconnected"));
  await page.context().setOffline(true);
  await page.locator(".page-header .compact-create").click();
  await pane(page)
    .getByLabel(w.desk.noteTitle, { exact: true })
    .fill("Unbound image original");
  await documentMode(page, zh ? "源码" : "Source");
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXs8AAAAASUVORK5CYII=";
  const editor = pane(page).getByLabel(w.desk.noteBody, { exact: true });
  await editor.focus();
  await editor.evaluate((element, png) => {
    const data = new DataTransfer();
    data.items.add(
      new File(
        [Uint8Array.from(atob(png), (char) => char.charCodeAt(0))],
        "unbound.png",
        { type: "image/png" },
      ),
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, png);
  await expect(editor).toContainText("/api/v1/files/bytes?id=");
  await saveDocument(page, w);
  await expect(pane(page).locator('[data-locally-saved="true"]')).toHaveText(
    zh ? "已保存到本机 · 离线" : "Saved on this device · Offline",
  );
  await page.reload();
  await nav(page, w.desk.notes);
  await page
    .locator(".note-card")
    .filter({ hasText: "Unbound image original" })
    .press("Enter");
  await documentMode(page, w.desk.read);
  await expect(pane(page).locator(".document-reading img")).toHaveJSProperty(
    "naturalWidth",
    1,
  );
  await expect(
    page.getByRole("textbox", { name: w.spaces.username, exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  const cached = await page.evaluate(async () =>
    (
      await Promise.all(
        (
          await caches.keys()
        ).map(async (key) =>
          (
            await (await caches.open(key)).keys()
          ).map((request) => new URL(request.url).pathname),
        ),
      )
    ).flat(),
  );
  expect(cached.some((path) => path.startsWith("/api/"))).toBe(false);
  await page.context().setOffline(false);
});

test("Delta Save reports local durable failure and Ctrl S recovers offline without login", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await page.goto(workbench.url + "/#notes");
  await prepareOfflineShell(page);
  await page.context().setOffline(true);
  await page.locator(".page-header .compact-create").click();
  await pane(page)
    .getByLabel(w.desk.noteTitle, { exact: true })
    .fill("Durable save recovery");
  await documentMode(page, zh ? "源码" : "Source");
  const editor = pane(page).getByLabel(w.desk.noteBody, { exact: true });
  await editor.fill("Original locally saved body");
  await saveDocument(page, w);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    Object.assign(window, {
      restoreDocumentPut: () => {
        IDBObjectStore.prototype.put = original;
      },
    });
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("Test durable device full", "QuotaExceededError");
    };
  });
  await editor.fill("Edited body survives failed durable flush");
  await editor.press("Control+s");
  const status = pane(page).locator(".document-toolbar [role=status]");
  await expect(status).toHaveText(zh ? "保存失败" : "Save failed");
  await expect(status).toHaveAttribute("data-locally-saved", "false");
  await expect(editor).toContainText(
    "Edited body survives failed durable flush",
  );
  await page.evaluate(() =>
    (window as unknown as { restoreDocumentPut(): void }).restoreDocumentPut(),
  );
  await saveDocument(page, w);
  await expect(status).toHaveText(
    zh ? "已保存到本机 · 离线" : "Saved on this device · Offline",
  );
  await page.reload();
  await nav(page, w.desk.notes);
  await page
    .locator(".note-card")
    .filter({ hasText: "Durable save recovery" })
    .press("Enter");
  await documentMode(page, zh ? "源码" : "Source");
  await expect(
    pane(page).getByLabel(w.desk.noteBody, { exact: true }),
  ).toContainText("Edited body survives failed durable flush");
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await page.context().setOffline(false);
});

test("Delta completed project visibility stays independent from archive and active children", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const parent = await mutation(page, "/api/work/create", {
    title: "Completed branch",
    type: "PROJECT",
    lifecycle: "COMPLETED",
  });
  const child = await mutation(page, "/api/work/create", {
    title: "Active child survives filter",
    type: "PROJECT",
    parentProjectId: parent.id,
    lifecycle: "ACTIVE",
  });
  await page.reload();
  await nav(page, w.desk.projects);
  const options = page.getByRole("button", {
    name: zh ? "项目列表选项" : "Project list options",
    exact: true,
  });
  await expect(
    page.locator(".project-card").filter({ hasText: parent.title }),
  ).toBeVisible();
  await options.click();
  await page
    .getByRole("menuitem", {
      name: zh ? "隐藏已完成项目" : "Hide completed projects",
      exact: true,
    })
    .click();
  await expect(
    page.locator(".project-card").filter({ hasText: parent.title }),
  ).toHaveCount(0);
  await expect(
    page.locator(".project-card").filter({ hasText: child.title }),
  ).toBeVisible();
  await options.click();
  await page
    .getByRole("menuitem", {
      name: zh ? "显示已完成项目" : "Show completed projects",
      exact: true,
    })
    .click();
  await expect(
    page.locator(".project-card").filter({ hasText: parent.title }),
  ).toBeVisible();
  await page.evaluate((id) => {
    location.hash = `graph/project/${id}?mode=structure&view=tree`;
  }, parent.id);
  await expect(page.locator(".graph-workspace")).toContainText(parent.title);
  await expect(page.locator(".project-structure-tree")).toContainText(
    child.title,
  );
  const snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    snapshot.items.find((item: { id: string }) => item.id === parent.id),
  ).toEqual(parent);
  expect(
    snapshot.items.find((item: { id: string }) => item.id === child.id),
  ).toEqual(child);
});

test("Delta project overflow menu flips at the edge and separates destructive action", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Delta project menu",
  });
  await page.reload();
  await nav(page, w.desk.projects);
  const anchor = page.getByRole("button", {
    name: (zh ? "项目操作：" : "Project actions: ") + "Delta project menu",
    exact: true,
  });
  await anchor.click();
  const menu = page
    .locator(".ui-popover")
    .filter({ has: page.getByRole("menuitem") });
  await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox(),
    source = await anchor.boundingBox();
  expect(bounds!.width).toBeGreaterThanOrEqual(180);
  expect(bounds!.x).toBeGreaterThanOrEqual(8);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width - 7,
  );
  expect(bounds!.x).toBeLessThan(source!.x);
  expect(
    await menu
      .getByRole("menuitem")
      .evaluateAll((items) =>
        items.every((item) => getComputedStyle(item).whiteSpace === "nowrap"),
      ),
  ).toBe(true);
  await expect(menu.locator(".ui-menu-item-danger")).toHaveCount(1);
  expect(
    await menu.locator(".ui-menu-item-danger").evaluate((item) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--danger)";
      item.append(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return getComputedStyle(item).color === expected;
    }),
  ).toBe(true);
  await expect(menu.getByRole("separator")).toBeVisible();
  await page.screenshot({
    path: info.outputPath("delta-project-menu-edge.png"),
    fullPage: true,
  });
  await menu.getByRole("menuitem").first().press("End");
  await expect(menu.locator(".ui-menu-item-danger")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

test("Delta workspace tab stress matrix remains a single row with reachable active tabs", async ({
  page,
  workbench,
}, info) => {
  test.setTimeout(120000);
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  for (let index = 0; index < 20; index++)
    await mutation(page, "/api/note/save", {
      id: null,
      version: 0,
      input: {
        title:
          index < 2
            ? "Untitled"
            : zh
              ? `长标题文档用于检查工作台标签不能逐字换行 ${index} 完整内容`
              : `Long document title for single line workspace tab truncation ${index}`,
        kind: "NOTE",
        day: null,
        bodyMd: `Independent body ${index}\n中文正文使用无衬线字体。`,
      },
    });
  await page.reload();
  await nav(page, w.desk.notes);
  for (let index = 0; index < 20; index++) {
    const expectedTitle = await page
      .locator(".note-card")
      .nth(index)
      .locator("h3")
      .first()
      .innerText();
    await page.locator(".note-card").nth(index).press("Enter");
    await expect(page.locator(".document-tabs .document-tab")).toHaveCount(
      index + 1,
    );
    await expect(pane(page).locator(".document-title")).toHaveValue(
      expectedTitle,
    );
    await expect(
      page.locator('.document-tabs [role="tab"][aria-selected="true"]'),
    ).toHaveText(expectedTitle);
    if ([1, 5, 10, 20].includes(index + 1)) {
      for (const width of info.project.name.startsWith("mobile")
        ? [390, 430]
        : [1024, 1280, 1440, 1920]) {
        await page.setViewportSize({
          width,
          height:
            width < 500
              ? 844
              : width === 1024
                ? 768
                : width === 1280
                  ? 800
                  : width === 1920
                    ? 1080
                    : 900,
        });
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            ),
        );
        const geometry = await page
          .locator(".document-tabs")
          .evaluate((strip) => {
            const bounds = strip.getBoundingClientRect();
            const tabs = [
              ...strip.querySelectorAll<HTMLElement>(".document-tab"),
            ];
            const selected = strip
              .querySelector<HTMLElement>('[aria-selected="true"]')!
              .getBoundingClientRect();
            return {
              height: bounds.height,
              tops: tabs.map((tab) => tab.offsetTop),
              activeVisible:
                selected.width >= 60 &&
                selected.left >= bounds.left - 1 &&
                selected.right <= bounds.right + 1,
              nowrap: tabs.every(
                (tab) => getComputedStyle(tab).whiteSpace === "nowrap",
              ),
              ellipsis: tabs.every((tab) => {
                const label = tab.querySelector<HTMLElement>(
                  ".document-tab-label",
                )!;
                return (
                  getComputedStyle(label).textOverflow === "ellipsis" &&
                  label.clientWidth <= tab.clientWidth
                );
              }),
              viewportFits: document.documentElement.scrollWidth <= innerWidth,
            };
          });
        expect(geometry.height).toBeLessThanOrEqual(width < 500 ? 46 : 38);
        expect(new Set(geometry.tops).size).toBe(1);
        expect(geometry.nowrap).toBe(true);
        expect(geometry.ellipsis).toBe(true);
        expect(geometry.activeVisible).toBe(true);
        expect(geometry.viewportFits).toBe(true);
        for (const theme of ["light", "dark"]) {
          await page.evaluate(
            (value) =>
              document.documentElement.setAttribute("data-theme", value),
            theme,
          );
          const beforePaint = await page
            .locator('.document-tabs [aria-selected="true"]')
            .evaluate((tab) => ({
              right: tab.getBoundingClientRect().right,
              scroll: tab.closest(".document-tabs")!.scrollLeft,
            }));
          await page.screenshot({
            path: info.outputPath(
              `delta-tabs-${index + 1}-${width}-${theme}.png`,
            ),
            // Preserve the specified viewport. Full-page capture temporarily
            // changes viewport geometry and can scroll the horizontal tab strip.
            fullPage: false,
          });
          const painted = await page
            .locator('.document-tabs [role="tab"][aria-selected="true"]')
            .evaluate((tab) => {
              const item = tab.getBoundingClientRect();
              const strip = tab
                .closest(".document-tabs")!
                .getBoundingClientRect();
              return {
                title: tab.textContent,
                left: item.left,
                right: item.right,
                stripLeft: strip.left,
                stripRight: strip.right,
                width: item.width,
                scrollLeft: tab.closest(".document-tabs")!.scrollLeft,
                scrollWidth: tab.closest(".document-tabs")!.scrollWidth,
                parent: {
                  left: tab.parentElement!.getBoundingClientRect().left,
                  right: tab.parentElement!.getBoundingClientRect().right,
                },
              };
            });
          expect(painted.title).toBe(expectedTitle);
          expect(painted.width).toBeGreaterThanOrEqual(60);
          expect(painted.left).toBeGreaterThanOrEqual(painted.stripLeft - 1);
          expect(painted.right).toBeLessThanOrEqual(painted.stripRight + 1);
          writeFileSync(
            info.outputPath(`delta-tabs-${index + 1}-${width}-${theme}.json`),
            JSON.stringify({ beforePaint, painted }),
          );
        }
      }
    }
    await browseDocuments(page);
  }
  expect(
    await page.getByRole("tab", { name: "Untitled", exact: true }).count(),
  ).toBe(2);
});

test("Delta untitled documents autosave independently offline and sync without synthetic titles", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const space = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "SPACE",
      spaceId: null,
      title: "Delta untitled home",
      bodyMd: "",
    },
  });
  await page.reload();
  await nav(page, w.spaces.library);
  await page
    .locator(".space-card")
    .filter({ hasText: "Delta untitled home" })
    .click();
  await prepareOfflineShell(page);
  await page.context().setOffline(true);
  await page.route("**/api/**", (route) => route.abort("internetdisconnected"));
  for (const text of ["Untitled original first", "Untitled original second"]) {
    await page
      .getByRole("button", { name: w.spaces.newLecture, exact: true })
      .click();
    await expect(
      pane(page).getByLabel(w.spaces.title, { exact: true }),
    ).toHaveValue("");
    await documentMode(page, zh ? "源码" : "Source");
    await pane(page).getByLabel(w.spaces.body, { exact: true }).fill(text);
    // Let autosave, rather than the keyboard shortcut, establish the durable entity.
    await expect(
      pane(page).locator(".document-toolbar [role=status]"),
    ).toHaveAttribute("data-locally-saved", "true");
    await saveDocument(page, w);
    await browseDocuments(page);
  }
  await expect(page.locator(".library-document-row")).toHaveCount(2);
  await page.reload();
  await nav(page, w.spaces.library);
  await page
    .locator(".space-card")
    .filter({ hasText: "Delta untitled home" })
    .click();
  await expect(page.locator(".library-document-row")).toHaveCount(2);
  const bodies: string[] = [];
  for (let index = 0; index < 2; index++) {
    await page.locator(".library-document-row").nth(index).click();
    await expect(
      pane(page).getByLabel(w.spaces.title, { exact: true }),
    ).toHaveValue("");
    await documentMode(page, zh ? "源码" : "Source");
    bodies.push(
      (
        await pane(page)
          .getByLabel(w.spaces.body, { exact: true })
          .locator(".cm-line")
          .allTextContents()
      ).join("\n"),
    );
    await browseDocuments(page);
  }
  expect(bodies.sort()).toEqual([
    "Untitled original first",
    "Untitled original second",
  ]);
  await page.context().setOffline(false);
  await page.unroute("**/api/**");
  await page.reload();
  await expect
    .poll(
      async () =>
        (
          await (await page.request.get(workbench.url + "/api/snapshot")).json()
        ).library.filter(
          (entry: { kind: string; spaceId: string }) =>
            entry.kind === "DOCUMENT" && entry.spaceId === space.id,
        ).length,
    )
    .toBe(2);
  const documents = (
    await (await page.request.get(workbench.url + "/api/snapshot")).json()
  ).library.filter(
    (entry: { kind: string; spaceId: string }) =>
      entry.kind === "DOCUMENT" && entry.spaceId === space.id,
  );
  expect(new Set(documents.map((entry: { id: string }) => entry.id)).size).toBe(
    2,
  );
  expect(documents.map((entry: { title: string }) => entry.title)).toEqual([
    "",
    "",
  ]);
  expect(documents.map((entry: { version: number }) => entry.version)).toEqual([
    1, 1,
  ]);
  expect(
    documents.map((entry: { bodyMd: string }) => entry.bodyMd).sort(),
  ).toEqual(bodies);
});

test("unnamed notes save body first and expose explicit save across document focus", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.notes);
  await page.locator(".page-header .compact-create").click();
  const body = pane(page).getByLabel(w.desk.noteBody, { exact: true });
  // Playwright fill can append on an emulated touch CodeMirror surface; select-all +
  // insertText exercises the same editor input contract deterministically.
  const replaceBody = async (text: string) => {
    await body.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.insertText(text);
  };
  const original = "Body first research\n\nOriginal $E=mc^2$ text";
  await replaceBody(original);
  await expect(
    pane(page).getByLabel(w.desk.noteTitle, { exact: true }),
  ).toHaveValue("Body first research");
  await expect(pane(page).locator("[data-locally-saved]")).toHaveAttribute(
    "data-locally-saved",
    "true",
  );
  await replaceBody(original + "\nExplicit save");
  const save = pane(page).getByRole("button", { name: /^(保存|Save)$/ });
  await save.click();
  await waitForLocalReplay(page);
  const read = async () =>
    (
      await (await page.request.get(workbench.url + "/api/snapshot")).json()
    ).notes.find(
      (entry: { title: string }) => entry.title === "Body first research",
    );
  await expect
    .poll(async () => (await read())?.bodyMd)
    .toBe(original + "\nExplicit save");
  await replaceBody(original + "\nKeyboard save");
  await save.focus();
  await page.keyboard.press("Control+s");
  await expect
    .poll(async () => (await read())?.bodyMd)
    .toBe(original + "\nKeyboard save");
  await page.reload();
  await nav(page, w.desk.notes);
  await page
    .locator(".note-card")
    .filter({ hasText: "Body first research" })
    .click();
  await documentMode(
    page,
    info.project.name.endsWith("zh") ? "源码" : "Source",
  );
  await expect(
    pane(page).getByLabel(w.desk.noteBody, { exact: true }),
  ).toContainText("Keyboard save");
});

test("image viewer zooms pans and resets without fetching the original again", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.notes);
  await page.locator(".page-header .compact-create").click();
  await pane(page)
    .getByLabel(w.desk.noteTitle, { exact: true })
    .fill("Image navigation");
  const body = pane(page).getByLabel(w.desk.noteBody, { exact: true });
  await body.focus();
  await body.evaluate(async (element) => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#c7d2fe";
    ctx.fillRect(0, 0, 800, 600);
    ctx.fillStyle = "#312e81";
    ctx.font = "48px sans-serif";
    ctx.fillText("Image navigation", 60, 160);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!), "image/png"),
    );
    const clipboard = new DataTransfer();
    clipboard.items.add(
      new File([blob], "navigation.png", { type: "image/png" }),
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await documentMode(page, w.desk.read);
  const picture = pane(page).locator(".document-reading img");
  await expect(picture).toHaveJSProperty("naturalWidth", 800);
  let downloads = 0;
  page.on("request", (request) => {
    if (/\/api\/(library\/asset|v1\/files\/bytes)\?/.test(request.url()))
      downloads++;
  });
  await picture.click();
  const viewer = page.locator(".image-viewer");
  const zoom = viewer.locator("output");
  const initial = await zoom.textContent();
  await viewer.getByRole("button", { name: /^(放大|Zoom in)$/ }).click();
  await expect(zoom).not.toHaveText(initial!);
  const surface = viewer.locator(".image-viewer-viewport");
  const box = (await surface.boundingBox())!;
  const before = await viewer.locator("img").getAttribute("style");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 60,
    box.y + box.height / 2 + 30,
  );
  await page.mouse.up();
  await expect(viewer.locator("img")).not.toHaveAttribute("style", before!);
  await viewer
    .getByRole("button", { name: /^(适应窗口|Fit to window)$/ })
    .click();
  await expect(zoom).toHaveText(initial!);
  await viewer
    .getByRole("button", { name: /^(原始尺寸|Actual size)$/ })
    .click();
  await expect(zoom).toHaveText("100%");
  await page.screenshot({
    path: info.outputPath("image-viewer.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  expect(downloads).toBe(0);
});

test("Delta image paste is durable offline and reconnects with original bytes without mode fetch loops", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const note = await mutation(page, "/api/note/save", {
    id: null,
    version: 0,
    input: {
      title: "Delta offline image",
      kind: "NOTE",
      day: null,
      bodyMd: "Original text",
    },
  });
  await page.reload();
  await nav(page, w.desk.notes);
  await page
    .locator(".note-card")
    .filter({ hasText: "Delta offline image" })
    .press("Enter");
  await documentMode(page, zh ? "源码" : "Source");
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXs8AAAAASUVORK5CYII=";
  let downloads = 0;
  page.on("request", (request) => {
    if (/\/api\/(library\/asset|v1\/files\/bytes)\?/.test(request.url()))
      downloads++;
  });
  await prepareOfflineShell(page);
  await page.context().setOffline(true);
  await page.route("**/api/**", (route) => route.abort("internetdisconnected"));
  const editor = pane(page).getByLabel(w.desk.noteBody, { exact: true });
  await editor.focus();
  await page.keyboard.press("Control+End");
  await editor.evaluate((element, png) => {
    const clipboard = new DataTransfer();
    clipboard.items.add(
      new File(
        [Uint8Array.from(atob(png), (c) => c.charCodeAt(0))],
        "offline-original.png",
        { type: "image/png" },
      ),
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, png);
  await expect(editor).toContainText("/api/v1/files/bytes?id=");
  await saveDocument(page, w);
  const source = await editor
    .locator(".cm-line")
    .allTextContents()
    .then((lines) => lines.join("\n"));
  const id = /\/api\/v1\/files\/bytes\?id=([a-zA-Z0-9-]+)/.exec(source)![1]!;
  for (let index = 0; index < 2; index++) {
    await documentMode(page, w.desk.read);
    const image = pane(page).locator(".document-reading img");
    await expect(image).toHaveJSProperty("naturalWidth", 1);
    await image.click();
    await expect(page.locator(".image-viewer img")).toHaveJSProperty(
      "naturalWidth",
      1,
    );
    await page.keyboard.press("Escape");
    await documentMode(page, zh ? "源码" : "Source");
    await expect
      .poll(async () =>
        (await editor.locator(".cm-line").allTextContents()).join("\n"),
      )
      .toBe(source);
  }
  expect(downloads).toBe(0);
  await page.reload();
  await nav(page, w.desk.notes);
  await page
    .locator(".note-card")
    .filter({ hasText: "Delta offline image" })
    .press("Enter");
  await documentMode(page, w.desk.read);
  await expect(pane(page).locator(".document-reading img")).toHaveJSProperty(
    "naturalWidth",
    1,
  );
  expect(downloads).toBe(0);
  await page.screenshot({
    path: info.outputPath("delta-offline-image.png"),
    fullPage: true,
  });
  await page.context().setOffline(false);
  await page.unroute("**/api/**");
  await page.reload();
  await expect
    .poll(async () =>
      (
        await page.request.get(
          workbench.url + "/api/v1/files/metadata?id=" + id,
        )
      ).status(),
    )
    .toBe(200);
  const downloaded = await page.request.get(
    workbench.url + "/api/v1/files/bytes?id=" + id,
  );
  expect(await downloaded.body()).toEqual(Buffer.from(png, "base64"));
  const metadata = await (
    await page.request.get(workbench.url + "/api/v1/files/metadata?id=" + id)
  ).json();
  expect(metadata.contentHash).toBe(
    createHash("sha256").update(Buffer.from(png, "base64")).digest("hex"),
  );
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(
              workbench.url + "/api/document/body?kind=NOTE&id=" + note.id,
            )
          ).json()
        ).bodyMd,
    )
    .toBe(source);
  const secondInstallation = await page.context().browser()!.newContext();
  try {
    const second = await secondInstallation.newPage();
    await unlock(second, workbench.url, workbench.secret, w);
    let secondDownloads = 0;
    second.on("request", (request) => {
      if (request.url().includes("/api/v1/files/bytes?id=" + id))
        secondDownloads++;
    });
    await nav(second, w.desk.notes);
    await second
      .locator(".note-card")
      .filter({ hasText: "Delta offline image" })
      .press("Enter");
    await documentMode(second, w.desk.read);
    await expect(
      pane(second).locator(".document-reading img"),
    ).toHaveJSProperty("naturalWidth", 1);
    expect(secondDownloads).toBe(1);
    await documentMode(second, zh ? "源码" : "Source");
    await documentMode(second, w.desk.read);
    await expect(
      pane(second).locator(".document-reading img"),
    ).toHaveJSProperty("naturalWidth", 1);
    expect(secondDownloads).toBe(1);
    await prepareOfflineShell(second);
    await secondInstallation.setOffline(true);
    await second.route("**/api/**", (route) =>
      route.abort("internetdisconnected"),
    );
    await second.reload();
    await nav(second, w.desk.notes);
    await second
      .locator(".note-card")
      .filter({ hasText: "Delta offline image" })
      .press("Enter");
    await documentMode(second, w.desk.read);
    await expect(
      pane(second).locator(".document-reading img"),
    ).toHaveJSProperty("naturalWidth", 1);
    expect(secondDownloads).toBe(1);
  } finally {
    await secondInstallation.close();
  }
});

test("private image editing: modern picker, clipboard, concurrent typing and retry", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.notes);
  await page.locator(".page-header .compact-create").click();
  await documentMode(page, /^(Source|源码)$/);
  await documentTools(page);
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
  async function paste(mime = "image/png", unique = false) {
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
      {
        png: unique
          ? Buffer.concat([
              Buffer.from(png, "base64"),
              Buffer.from("unique"),
            ]).toString("base64")
          : png,
        mime,
      },
    );
  }
  await editor.focus();
  await page.keyboard.press("Control+End");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let uploadStarted = false;
  await page.route("**/api/v1/files/binary/begin", async (route) => {
    uploadStarted = true;
    expect(route.request().postDataJSON()).not.toHaveProperty("base64");
    await held;
    await route.continue();
  });
  await paste();
  await expect.poll(() => uploadStarted).toBe(true);
  await page.keyboard.type(" kept while uploading");
  await nav(page, w.desk.tasks);
  release();
  await page.getByRole("tab", { name: /Image notebook/ }).click();
  await expect(editor).toContainText(/api\/v1\/files\/bytes/);
  await expect(editor).toContainText("kept while uploading");
  await page.unroute("**/api/v1/files/binary/begin");
  await saveDocument(page, w);
  await paste("image/svg+xml");
  await expect(pane(page).getByRole("alert")).toContainText("PNG");
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    Object.assign(window, {
      restoreImageBlobPut: () => {
        IDBObjectStore.prototype.put = original;
      },
    });
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "blobs" && value instanceof Blob)
        throw new DOMException("Test device full", "QuotaExceededError");
      return original.call(this, value, key);
    };
  });
  await paste("image/png", true);
  await expect(pane(page).getByRole("alert").last()).toContainText(
    /未能保存到本机|save the image on this device/,
  );
  await page.evaluate(() =>
    (
      window as unknown as { restoreImageBlobPut(): void }
    ).restoreImageBlobPut(),
  );
  await expect(editor).toContainText("kept while uploading");
  await page.unroute("**/api/v1/files/binary/begin");
  await documentTools(page);
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
        ((await editor.textContent())?.match(/api\/v1\/files\/bytes/g) ?? [])
          .length,
    )
    .toBe(2);
  await saveDocument(page, w);
  await documentMode(page, w.desk.read);
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
  await waitForLocalReplay(page);
  const snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(snapshot.notes[0].bodyMd).toContain("kept while uploading");
  expect(snapshot.notes[0].bodyMd).toContain("plain paste");
  expect(snapshot.notes[0].bodyMd.match(/api\/v1\/files\/bytes/g)).toHaveLength(
    2,
  );
  expect(errors).toEqual([]);
});
test("organization selection archive delete scannable rows and readable typography", async ({
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
  await page.getByLabel(w.desk.status, { exact: true }).selectOption("ALL");
  await expect(page.locator(".task-card")).toHaveCount(3);
  await expect(page.locator(".task-title").first()).toHaveCSS(
    "font-size",
    "16px",
  );
  const heights = await page
    .locator(".task-card")
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().height),
    );
  expect(heights.every((height) => height >= 44 && height <= 160)).toBe(true);
  await page.screenshot({
    path: info.outputPath("task-rows.png"),
    fullPage: true,
  });
  await (await taskMenu(page, "First task"))
    .getByRole("menuitem", {
      name: w.desk.archive + ": First task",
      exact: true,
    })
    .click();
  await expect(page.locator(".task-card")).toHaveCount(2);
  await page.getByRole("button", { name: /^(More filters|更多筛选)$/ }).click();
  await page.getByLabel(w.desk.showArchived).check();
  await expect(page.locator(".task-card")).toHaveCount(1);
  await (await taskMenu(page, "First task"))
    .getByRole("menuitem", {
      name: w.desk.unarchive + ": First task",
      exact: true,
    })
    .click();
  await expect(page.locator(".task-card")).toHaveCount(0);
  await page.getByRole("button", { name: /^(More filters|更多筛选)$/ }).click();
  await page.getByLabel(w.desk.showArchived).uncheck();

  await (await taskMenu(page, "Second task"))
    .getByRole("menuitem", {
      name: w.desk.deleteItem + ": Second task",
      exact: true,
    })
    .click();
  await expect(page.locator(".task-card")).toHaveCount(2);
  await nav(page, w.desk.notes);
  const folderTree = page.locator(".folder-tree");
  await folderTree
    .getByRole("button", { name: w.desk.newFolder, exact: true })
    .click();
  await folderTree.getByLabel(w.desk.folderName).fill("量子场论");
  await folderTree
    .getByRole("button", { name: w.desk.createFolder, exact: true })
    .click();
  await expect(
    folderTree.getByRole("button", { name: "量子场论", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: w.desk.selectionMode, exact: true })
    .click();
  await page.getByLabel(w.desk.selectVisible).check();
  await page
    .getByLabel(w.desk.destinationFolder)
    .selectOption({ label: "量子场论" });
  await page
    .getByRole("button", { name: w.desk.moveSelected, exact: true })
    .click();
  await expect(page.locator(".note-card .note-folder").first()).toHaveText(
    "量子场论",
  );
  await folderTree
    .getByRole("button", { name: w.desk.unfiled, exact: true })
    .click();
  await expect(
    page.locator(".note-card, .library-document-row, .space-card"),
  ).toHaveCount(0);
  await folderTree
    .getByRole("button", { name: "量子场论", exact: true })
    .click();
  await expect(
    page.locator(".note-card, .library-document-row, .space-card"),
  ).toHaveCount(2);
  await page.getByLabel(w.desk.selectVisible).check();
  await page.screenshot({
    path: info.outputPath("bulk-notes.png"),
    fullPage: true,
  });

  await page
    .getByRole("button", { name: w.desk.deleteSelected, exact: true })
    .click();
  await expect(
    page.locator(".note-card, .library-document-row, .space-card"),
  ).toHaveCount(0);
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
test("task timer persists timestamp transitions without per-second writes", async ({
  page,
  workbench,
}, info) => {
  const zh = info.project.name.endsWith("zh"),
    w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const task = await mutation(page, "/api/work/create", {
    title: "Timer research",
    priority: "LOW",
  });
  await page.reload();
  await nav(page, w.desk.tasks);
  const row = () =>
    page.locator(".task-card").filter({ hasText: "Timer research" });
  const timer = row().locator(".task-timer");
  let updates = 0;
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const path = new URL(request.url()).pathname;
    if (path === "/api/work/update" || path === "/api/v1/work/update")
      updates++;
  });
  await timer
    .getByRole("button", { name: zh ? "开始计时" : "Start timer" })
    .click();
  await expect(timer).toHaveAttribute("data-running", "true");
  await page.waitForTimeout(1300);
  await expect(timer.locator(".task-timer-elapsed")).not.toHaveText("00:00:00");
  // The one-second display tick is local; only the transition reaches the Host.
  expect(updates).toBe(1);
  await timer
    .getByRole("button", { name: zh ? "暂停计时" : "Pause timer" })
    .click();
  await expect(timer).toHaveAttribute("data-running", "false");
  await expect(
    timer.getByRole("button", { name: zh ? "继续计时" : "Continue timer" }),
  ).toBeVisible();
  const readTask = async () =>
    (
      await (await page.request.get(workbench.url + "/api/snapshot")).json()
    ).items.find((item: { id: string }) => item.id === task.id);
  await expect.poll(async () => (await readTask()).timerStartedAt).toBeNull();
  await expect
    .poll(async () => (await readTask()).timerAccumulatedMs)
    .toBeGreaterThanOrEqual(1000);
  const paused = await readTask();
  expect(paused.timerStartedAt).toBeNull();
  expect(updates).toBe(2);
  await timer
    .getByRole("button", { name: zh ? "继续计时" : "Continue timer" })
    .click();
  await expect(timer).toHaveAttribute("data-running", "true");
  await timer
    .getByRole("button", { name: zh ? "结束计时" : "End timer" })
    .click();
  await expect(timer).toHaveAttribute("data-running", "false");
  await expect.poll(async () => (await readTask()).timerStartedAt).toBeNull();
  const ended = await readTask();
  expect(ended.timerStartedAt).toBeNull();
  expect(ended.timerAccumulatedMs).toBeGreaterThan(paused.timerAccumulatedMs);
  expect(updates).toBe(4);
  await page.reload();
  await nav(page, w.desk.tasks);
  await expect(row().locator(".task-timer-elapsed")).toHaveText(
    new RegExp(`^00:00:0[1-9]$`),
  );
  await page.screenshot({
    path: info.outputPath("task-timer.png"),
    fullPage: true,
  });
});
test("task due minute keeps date-only work unchanged and clears with the date", async ({
  page,
  workbench,
}, info) => {
  const zh = info.project.name.endsWith("zh"),
    w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  await page.goto(workbench.url + "/#tasks");
  await page
    .getByRole("button", { name: zh ? "新建任务" : "New task", exact: true })
    .first()
    .click();
  const editor = page.getByRole("dialog");
  await editor
    .getByLabel(zh ? "标题" : "Title", { exact: true })
    .fill("Deadline minute");
  await chooseDate(page, editor.getByLabel(w.desk.dueDate), "2099-12-31");
  await expect(
    editor.getByLabel(w.desk.dueTime, { exact: true }),
  ).toBeVisible();
  await editor.getByLabel(w.desk.dueTime, { exact: true }).fill("18:30");
  await editor
    .getByRole("button", { name: zh ? "新建任务" : "Create task", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  const read = async (title: string) =>
    (
      await (await page.request.get(workbench.url + "/api/snapshot")).json()
    ).items.find((item: { title: string }) => item.title === title);
  await expect
    .poll(async () => (await read("Deadline minute"))?.dueTime)
    .toBe("18:30");
  expect((await read("Deadline minute"))?.dueDate).toBe("2099-12-31");
  // Date-only work keeps its existing semantics and renders without a time.
  await mutation(page, "/api/work/create", {
    title: "Date only deadline",
    dueDate: "2099-12-30",
  });
  expect((await read("Date only deadline"))?.dueTime).toBeNull();
  await page.reload();
  await nav(page, w.desk.tasks);
  const row = page.locator(".task-card").filter({ hasText: "Deadline minute" });
  await expect(row.locator(".task-due")).toHaveText("2099-12-31 18:30");
  await expect(
    page.locator(".task-card").filter({ hasText: "Date only deadline" }),
  ).toContainText("2099-12-30");
  await page.screenshot({
    path: info.outputPath("task-due-minute-set.png"),
    fullPage: true,
  });
  await row.locator(".task-title").press("Enter");
  const reopened = page.getByRole("dialog");
  await expect(
    reopened.getByLabel(w.desk.dueTime, { exact: true }),
  ).toHaveValue("18:30");
  await reopened.getByLabel(w.desk.dueDate).click();
  await page
    .locator(".calendar-popover")
    .getByRole("button", { name: zh ? "清除" : "Clear", exact: true })
    .click();
  await expect(
    reopened.getByLabel(w.desk.dueTime, { exact: true }),
  ).toHaveCount(0);
  await reopened
    .getByRole("button", { name: /^(保存修改|Save changes)$/ })
    .click();
  await expect(reopened).toHaveCount(0);
  await expect
    .poll(async () => (await read("Deadline minute"))?.dueDate)
    .toBe(null);
  expect((await read("Deadline minute"))?.dueTime).toBeNull();
  await page.screenshot({
    path: info.outputPath("task-due-minute.png"),
    fullPage: true,
  });
});
test("workspace chrome is frosted and the context header stays sticky with accessible fallbacks", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    mobile = info.project.name.startsWith("mobile");
  await unlock(page, workbench.url, workbench.secret, w);
  await page.goto(workbench.url + "/#tasks");
  const header = page.locator(".page-header").first();
  await expect(header).toBeVisible();
  const readStyle = (locator: typeof header) =>
    locator.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        position: style.position,
        backdrop:
          style.backdropFilter === "none"
            ? ((
                style as CSSStyleDeclaration & {
                  webkitBackdropFilter?: string;
                }
              ).webkitBackdropFilter ?? "none")
            : style.backdropFilter,
      };
    });
  const headerStyle = await readStyle(header);
  // The band is frosted but must stay in flow so it never intercepts row clicks.
  expect(headerStyle.position).not.toBe("sticky");
  const sidebar = page.locator(".app-shell .sidebar");
  const sidebarStyle = await readStyle(sidebar);
  if (mobile) {
    // Mobile compositing keeps chrome opaque.
    expect(headerStyle.backdrop).toBe("none");
    expect(sidebarStyle.backdrop).toBe("none");
  } else {
    expect(headerStyle.backdrop).toContain("blur");
    expect(sidebarStyle.backdrop).toContain("blur");
  }
  await page.emulateMedia({ forcedColors: "active" });
  const forcedHeader = await readStyle(header);
  expect(forcedHeader.backdrop).toBe("none");
  await page.emulateMedia({ forcedColors: "none" });
  await page.screenshot({
    path: info.outputPath("workspace-chrome.png"),
    fullPage: true,
  });
});
test("settings preferences are separated from account, API and model hierarchy", async ({
  page,
  workbench,
}, info) => {
  const zh = info.project.name.endsWith("zh"),
    w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  await page.goto(workbench.url + "/#settings");
  await expect(page.locator(".settings-page")).toBeVisible();
  await expect(
    page.locator(".settings-navigation .settings-nav-group-label"),
  ).toHaveCount(3);
  // API/model configuration is no longer a preference sub-section.
  await expect(page.locator(".settings-page .model-settings")).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("settings-grouped.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", {
      name: zh ? "账户、API 与模型" : "Account, API & models",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/#account/);
  const tabs = page.getByRole("tablist", {
    name: zh ? "账户分区" : "Account sections",
    exact: true,
  });
  await expect(tabs).toBeVisible();
  await page
    .getByRole("tab", { name: zh ? "API 与模型" : "API & models", exact: true })
    .click();
  await expect(page.locator(".model-settings").first()).toBeVisible();
  await page.screenshot({
    path: info.outputPath("account-api-models.png"),
    fullPage: true,
  });
  await page
    .getByRole("tab", {
      name: zh ? "账户与安全" : "Account & security",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: zh ? "查看同步选项" : "Review sync options",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".model-settings")).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("account-security.png"),
    fullPage: true,
  });
  await setTheme(page, "dark");
  await page.goto(workbench.url + "/#settings");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".settings-page")).toBeVisible();
  await page.screenshot({
    path: info.outputPath("settings-dark.png"),
    fullPage: true,
  });
  await page.goto(workbench.url + "/#account");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("tab", { name: zh ? "API 与模型" : "API & models", exact: true })
    .click();
  await expect(page.locator(".model-settings").first()).toBeVisible();
  await page.screenshot({
    path: info.outputPath("account-api-dark.png"),
    fullPage: true,
  });
});
test("note folders keep stable identity through nesting, rename, offline replay and reload", async ({
  page,
  workbench,
}, info) => {
  test.setTimeout(180000);
  const w = words(info.project.name);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.files);
  const tree = page.locator(".folder-tree");
  const createRootFolder = async (name: string) => {
    await tree
      .getByRole("button", { name: w.desk.newFolder, exact: true })
      .click();
    await tree.getByLabel(w.desk.folderName).fill(name);
    await tree
      .getByRole("button", { name: w.desk.createFolder, exact: true })
      .click();
    await expect(tree.getByRole("button", { name, exact: true })).toBeVisible();
  };
  const row = (name: string) =>
    tree.locator(".folder-tree-row").filter({ hasText: name });
  const openActions = async (name: string) => {
    await row(name)
      .getByRole("button", {
        name: new RegExp(`^(Folder actions|文件夹操作): ${name}$`),
      })
      .click();
  };
  const organization = async () =>
    (await (await page.request.get(workbench.url + "/api/snapshot")).json())
      .organization as {
      kind: string;
      id: string;
      name?: string;
      parentId?: string;
    }[];

  await createRootFolder("Alpha");
  await createRootFolder("Beta");
  await createRootFolder("Empty");
  // Empty folders are first-class rows: they survive a reload before any note exists.
  await page.reload();
  await nav(page, w.desk.files);
  await expect(
    tree.getByRole("button", { name: "Empty", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("files-folders.png"),
    fullPage: true,
  });
  await openActions("Beta");
  await page
    .getByRole("menuitem", { name: w.desk.renameFolder, exact: true })
    .click();
  await tree.getByLabel(w.desk.folderName).fill("Gamma");
  await page.getByRole("button", { name: /^(Save changes|保存修改)$/ }).click();
  await expect(
    tree.getByRole("button", { name: "Gamma", exact: true }),
  ).toBeVisible();
  await expect(
    tree.getByRole("button", { name: "Beta", exact: true }),
  ).toHaveCount(0);
  await openActions("Gamma");
  await page
    .getByRole("menuitem", { name: w.desk.moveFolder, exact: true })
    .click();
  await tree
    .getByLabel(w.desk.folderMoveTarget)
    .selectOption({ label: "Alpha" });
  await page
    .getByRole("button", { name: w.desk.moveFolder, exact: true })
    .last()
    .click();
  await expect(tree.locator("ul ul li").first()).toBeVisible();
  await page.screenshot({
    path: info.outputPath("folders-nested.png"),
    fullPage: true,
  });
  await waitForLocalReplay(page);
  await expect
    .poll(async () => {
      const rows = await organization();
      const folder = rows.find(
        (entry) => entry.kind === "FOLDER" && entry.name === "Gamma",
      );
      const target = rows.find(
        (entry) => entry.kind === "FOLDER" && entry.name === "Alpha",
      );
      return folder?.parentId === target?.id;
    })
    .toBe(true);
  // Create a note inside a folder through the tree action, then read it back.
  await openActions("Alpha");
  await page
    .getByRole("menuitem", { name: w.desk.newDocumentInFolder, exact: true })
    .click();
  const pane = page.locator(".document-pane");
  await expect(pane.getByLabel(w.desk.noteTitle, { exact: true })).toHaveValue(
    w.desk.untitledNote,
  );
  await expect
    .poll(async () => {
      const snapshot = await (
        await page.request.get(workbench.url + "/api/snapshot")
      ).json();
      const alpha = snapshot.organization.find(
        (entry: { kind: string; name?: string }) =>
          entry.kind === "FOLDER" && entry.name === "Alpha",
      );
      const note = snapshot.notes.find(
        (entry: { title: string }) => entry.title === w.desk.untitledNote,
      );
      return snapshot.organization.some(
        (entry: { kind: string; id: string; folderId?: string }) =>
          entry.kind === "NOTE" &&
          entry.id === note?.id &&
          entry.folderId === alpha?.id,
      );
    })
    .toBe(true);
  await page
    .getByRole("button", { name: /^(Workspace|工作台)$/, exact: true })
    .click();
  await nav(page, w.desk.files);
  await tree.getByRole("button", { name: "Alpha", exact: true }).click();
  await expect(page.locator(".note-card")).toHaveCount(1);
  await expect(page.locator(".note-card .note-folder")).toHaveText("Alpha");
  // Offline folder creation replays after reconnect without losing the folder.
  await page.route("**/api/v1/sync?*", (route) => route.abort("failed"));
  await createRootFolder("Offline");
  await page.reload();
  await nav(page, w.desk.files);
  await expect(
    tree.getByRole("button", { name: "Offline", exact: true }),
  ).toBeVisible();
  await page.unroute("**/api/v1/sync?*");
  await page.reload();
  await waitForLocalReplay(page);
  expect(
    (await organization()).some(
      (entry) => entry.kind === "FOLDER" && entry.name === "Offline",
    ),
  ).toBe(true);
  // Non-empty folders are protected; empty folders can be deleted.
  await nav(page, w.desk.files);
  await openActions("Alpha");
  await page
    .getByRole("menuitem", { name: w.desk.deleteFolder, exact: true })
    .click();
  await answerConfirmation(page, true);
  await expect(page.getByText(w.desk.folderNotEmpty)).toBeVisible();
  await openActions("Empty");
  await page
    .getByRole("menuitem", { name: w.desk.deleteFolder, exact: true })
    .click();
  await answerConfirmation(page, true);
  await expect(
    tree.getByRole("button", { name: "Empty", exact: true }),
  ).toHaveCount(0);
  await tree.locator(".folder-tree-deleted summary").click();
  await tree
    .locator(".folder-tree-deleted")
    .getByRole("button", { name: w.desk.restoreFolder, exact: true })
    .click();
  await expect(
    tree.getByRole("button", { name: "Empty", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("note-folders.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("files page opens real documents and uploads original files", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const resourceSpace = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "SPACE",
      spaceId: null,
      title: "Resource space",
      bodyMd: "",
    },
  });
  await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "DOCUMENT",
      spaceId: resourceSpace.id,
      title: "Resource document",
      bodyMd: "Original document body",
    },
  });
  await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "DOCUMENT",
      spaceId: resourceSpace.id,
      title:
        "A long bilingual research document title with 中文标题 and a deliberately extended line for truncation checks",
      bodyMd: "Long-form context",
    },
  });
  await mutation(page, "/api/note/save", {
    id: null,
    version: 0,
    input: {
      title:
        "Field notes — 量子场论 weekly review with a deliberately long title for the unified file browser",
      kind: "NOTE",
      day: null,
      bodyMd: "Unfiled note used by the Files benchmark.",
    },
  });
  await page.reload();
  await nav(page, w.desk.files);
  const resources = page.locator(".workspace-resources");
  await resources.getByRole("button", { name: /Resource document/ }).click();
  await expect(page.locator(".document-pane")).toBeVisible();
  await nav(page, w.desk.files);
  await resources.locator('input[type="file"]').setInputFiles({
    name: "resource-proof.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Original uploaded bytes"),
  });
  await expect
    .poll(async () => {
      const snapshot = await (
        await page.request.get(workbench.url + "/api/snapshot")
      ).json();
      return snapshot.files?.some(
        (file: { name: string }) => file.name === "resource-proof.txt",
      );
    })
    .toBe(true);
  await page.reload();
  await nav(page, w.desk.files);
  await expect(
    resources.getByRole("button", { name: /resource-proof.txt/ }),
  ).toBeVisible();
  const filesTree = page.locator(".folder-tree");
  await filesTree
    .getByRole("button", { name: w.desk.newFolder, exact: true })
    .click();
  await filesTree.getByLabel(w.desk.folderName).fill("Research archive");
  await filesTree
    .getByRole("button", { name: w.desk.createFolder, exact: true })
    .click();
  await expect(
    filesTree.getByRole("button", { name: "Research archive", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("workspace-resources.png"),
    fullPage: true,
  });
  await setTheme(page, "dark");
  await page.reload();
  await nav(page, w.desk.files);
  await expect(page.locator(".workspace-resources")).toBeVisible();
  await page.screenshot({
    path: info.outputPath("workspace-resources-dark.png"),
    fullPage: true,
  });
});

test("note and folder emoji icons persist while selection stays behind an explicit toggle", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await unlock(page, workbench.url, workbench.secret, w);
  await mutation(page, "/api/note/save", {
    id: null,
    version: 0,
    input: {
      title: "Icon target",
      bodyMd: "Icon body",
      kind: "NOTE",
      day: null,
    },
  });
  await mutation(page, "/api/note/save", {
    id: null,
    version: 0,
    input: {
      title: "Journal icon target",
      bodyMd: "Journal body",
      kind: "JOURNAL",
      day: "2026-10-26",
    },
  });
  await page.reload();
  await nav(page, w.desk.notes);
  const tree = page.locator(".folder-tree");
  const card = () =>
    page.locator(".note-card").filter({ hasText: "Icon target" });
  // Selection is hidden until the explicit toggle: no per-row checkboxes.
  await expect(page.locator(".note-selection input")).toHaveCount(0);
  await card()
    .getByRole("button", { name: w.desk.chooseIcon, exact: true })
    .click();
  await page.getByRole("button", { name: "🔬", exact: true }).click();
  await expect(card().locator(".entity-emoji")).toHaveText("🔬");
  await page.screenshot({
    path: info.outputPath("note-icons.png"),
    fullPage: true,
  });
  await waitForLocalReplay(page);
  await page.reload();
  await nav(page, w.desk.notes);
  await expect(card().locator(".entity-emoji")).toHaveText("🔬");
  // Custom emoji and reset to the default glyph.
  await card()
    .getByRole("button", { name: w.desk.chooseIcon, exact: true })
    .click();
  await page.getByLabel(w.desk.customIcon).fill("🌊");
  await page
    .getByRole("button", { name: w.desk.applyIcon, exact: true })
    .click();
  await expect(card().locator(".entity-emoji")).toHaveText("🌊");
  await card()
    .getByRole("button", { name: w.desk.chooseIcon, exact: true })
    .click();
  await page
    .getByRole("button", { name: w.desk.defaultIcon, exact: true })
    .click();
  await expect(card().locator(".entity-emoji")).toHaveCount(0);
  // Folder icons follow the same organization metadata path.
  await tree
    .getByRole("button", { name: w.desk.newFolder, exact: true })
    .click();
  await tree.getByLabel(w.desk.folderName).fill("Icons");
  await tree
    .getByRole("button", { name: w.desk.createFolder, exact: true })
    .click();
  const folderRow = () =>
    tree.locator(".folder-tree-row").filter({ hasText: "Icons" });
  await folderRow()
    .getByRole("button", { name: w.desk.chooseIcon, exact: true })
    .click();
  await page.screenshot({
    path: info.outputPath("icon-picker.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "🧪", exact: true }).click();
  await expect(folderRow().locator(".entity-emoji")).toHaveText("🧪");
  await waitForLocalReplay(page);
  await page.reload();
  await nav(page, w.desk.notes);
  await expect(
    tree
      .locator(".folder-tree-row")
      .filter({ hasText: "Icons" })
      .locator(".entity-emoji"),
  ).toHaveText("🧪");
  // The same explicit toggle gates selection on notes and journals.
  const toggle = page.getByRole("button", {
    name: w.desk.selectionMode,
    exact: true,
  });
  await expect(page.locator(".note-selection input")).toHaveCount(0);
  await toggle.click();
  await expect(page.locator(".note-selection input")).toHaveCount(1);
  await page.locator(".note-selection input").check();
  await expect(
    page.locator(".note-selection-toolbar [role=status]"),
  ).toContainText("1");
  await page
    .getByRole("button", { name: w.desk.exitSelectionMode, exact: true })
    .click();
  await expect(page.locator(".note-selection input")).toHaveCount(0);
  await nav(page, w.desk.journal);
  await expect(page.locator(".note-selection input")).toHaveCount(0);
  await page
    .getByRole("button", { name: w.desk.selectionMode, exact: true })
    .click();
  await expect(page.locator(".note-selection input")).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath("icons-and-selection.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("server connectivity probe shows real latency and separates auth from network failure", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.settings);
  const section = page.locator(".server-diagnostics");
  await expect(section).toBeVisible();
  const snapshot = async () =>
    (await (
      await page.request.get(workbench.url + "/api/snapshot")
    ).json()) as {
      items: unknown[];
      notes: unknown[];
      organization: unknown[];
    };
  const before = await snapshot();
  const probe = section.getByRole("button", {
    name: w.desk.testConnection,
    exact: true,
  });
  const result = section.getByRole("status");
  await probe.click();
  await expect(result).toHaveAttribute("data-probe", "OK");
  await expect(result).toContainText(w.desk.connectionOk);
  await expect(result).toContainText(/ms|毫秒/);
  await page.screenshot({
    path: info.outputPath("server-connectivity.png"),
    fullPage: true,
  });
  await page.route("**/api/health", (route) => route.abort("failed"));
  await probe.click();
  await expect(result).toHaveAttribute("data-probe", "NETWORK_FAILURE");
  await expect(result).toContainText(w.desk.connectionNetwork);
  await page.unroute("**/api/health");
  await page.route("**/api/account/sessions", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: "FORBIDDEN" }),
    }),
  );
  await probe.click();
  await expect(result).toHaveAttribute("data-probe", "AUTH_REQUIRED");
  await expect(result).toContainText(w.desk.connectionAuthRequired);
  await page.unroute("**/api/account/sessions");
  await probe.click();
  await expect(result).toHaveAttribute("data-probe", "OK");
  const after = await snapshot();
  expect(after.items).toEqual(before.items);
  expect(after.notes).toEqual(before.notes);
  expect(after.organization).toEqual(before.organization);
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
  await page.locator(".page-header .compact-create").click();
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
  await expect(logo).toHaveCSS("filter", "brightness(0)");
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
for (const nativeImages of [false, true]) {
  test(`accounts admin review and lecture Markdown images PDF work end to end ${nativeImages ? "native bridge" : "web"}`, async ({
    page,
    workbench,
  }, info) => {
    test.setTimeout(90_000);
    const zh = info.project.name.endsWith("zh");
    const w = words(info.project.name),
      a = w.spaces;
    const imageResponses: {
      status: number;
      contentType: string;
      bytes: number;
    }[] = [];
    const imageReads: Promise<void>[] = [];
    const captureImageResponse = (response: Response) => {
      if (
        !["/api/library/asset", "/api/v1/files/bytes"].includes(
          new URL(response.url()).pathname,
        )
      )
        return;
      imageReads.push(
        response.body().then((body) => {
          imageResponses.push({
            status: response.status(),
            contentType: response.headers()["content-type"] ?? "",
            bytes: body.length,
          });
        }),
      );
    };
    page.on("response", captureImageResponse);
    await page.addInitScript(() => {
      const original = URL.createObjectURL.bind(URL);
      const blobs: { type: string; size: number }[] = [];
      Object.assign(window, { imageDiagnosticBlobs: blobs });
      URL.createObjectURL = (blob) => {
        if (blob instanceof Blob)
          blobs.push({ type: blob.type, size: blob.size });
        return original(blob);
      };
    });
    // Accounts are provisioned offline; public registration/legacy claim stay disabled.
    if (nativeImages) {
      const config = JSON.parse(
        readFileSync("src-tauri/tauri.conf.json", "utf8"),
      );
      const imagePolicy = config.app.security.csp
        .split(";")
        .find((directive: string) => directive.trim().startsWith("img-src "));
      await page.route("**/*", async (route) => {
        if (route.request().resourceType() !== "document")
          return route.continue();
        const response = await route.fetch();
        const headers = response.headers();
        const hostPolicy = headers["content-security-policy"];
        if (!hostPolicy) throw new Error("Test host CSP is missing");
        headers["content-security-policy"] = hostPolicy.replace(
          /img-src[^;]+/,
          imagePolicy,
        );
        await route.fulfill({ response, headers });
      });
      await page.addInitScript((policy) => {
        document.addEventListener("DOMContentLoaded", () => {
          const meta = document.createElement("meta");
          meta.httpEquiv = "Content-Security-Policy";
          meta.content = policy;
          document.head.append(meta);
        });
        localStorage.setItem("orivane.atlas.server-origin", location.origin);
        Object.assign(window, {
          isTauri: true,
          __TAURI_INTERNALS__: {
            invoke: async (
              command: string,
              args:
                | {
                    path: string;
                    payload?: string;
                    csrf?: string;
                    idempotencyKey?: string;
                    workspaceId?: string;
                    workspacePrecondition?: string;
                  }
                | Uint8Array,
              options?: { headers?: Record<string, string> },
            ) => {
              if (command === "server_upload_chunk") {
                if (!(args instanceof Uint8Array))
                  throw new Error("Expected raw native chunk bytes");
                const headers = options?.headers ?? {};
                const response = await fetch(headers["X-Atlas-Path"]!, {
                  method: "POST",
                  body: new Uint8Array(args),
                  credentials: "same-origin",
                  headers: {
                    "Content-Type": "application/octet-stream",
                    "X-File-Chunk-Hash": headers["X-Atlas-Chunk-Hash"]!,
                    "X-CSRF-Token": headers["X-Atlas-CSRF"]!,
                    ...(headers["X-Atlas-Workspace-Id"]
                      ? { "X-Workspace-Id": headers["X-Atlas-Workspace-Id"]! }
                      : {}),
                  },
                });
                return {
                  status: response.status,
                  contentType: response.headers.get("Content-Type"),
                  body: await response.text(),
                  encoding: "utf8",
                };
              }
              if (args instanceof Uint8Array)
                throw new Error("Unexpected binary command");
              if (command === "server_download_file") {
                const response = await fetch(args.path, {
                  credentials: "same-origin",
                  headers: args.workspaceId
                    ? { "X-Workspace-Id": args.workspaceId }
                    : {},
                });
                if (response.status === 401) throw "UNAUTHORIZED";
                if (response.status === 403) throw "FORBIDDEN";
                if (response.status === 404) throw "NOT_FOUND";
                if (
                  response.status !== 200 ||
                  response.headers.get("content-type") !==
                    "application/octet-stream"
                )
                  throw "INVALID_RESPONSE";
                return response.arrayBuffer();
              }
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
              if (command === "saved_accounts") return [];
              if (command !== "server_request")
                throw new Error(`unexpected native command: ${command}`);
              const response = await fetch(args.path, {
                method: args.payload ? "POST" : "GET",
                credentials: "same-origin",
                headers: args.workspaceId
                  ? { "X-Workspace-Id": args.workspaceId }
                  : {},
                ...(args.payload
                  ? {
                      body: args.payload,
                      headers: {
                        "Content-Type": "application/json",
                        "X-CSRF-Token": args.csrf ?? "",
                        "Idempotency-Key": args.idempotencyKey ?? "",
                        ...(args.workspaceId
                          ? { "X-Workspace-Id": args.workspaceId }
                          : {}),
                        ...(args.workspacePrecondition
                          ? {
                              "X-Workspace-Precondition":
                                args.workspacePrecondition,
                            }
                          : {}),
                      },
                    }
                  : {}),
              });
              const bytes = new Uint8Array(await response.arrayBuffer());
              const json = (
                response.headers.get("Content-Type") ?? ""
              ).includes("json");
              return {
                status: response.status,
                contentType: response.headers.get("Content-Type"),
                encoding: json ? "utf8" : "base64",
                body: json
                  ? new TextDecoder().decode(bytes)
                  : btoa(
                      Array.from(bytes, (byte) =>
                        String.fromCharCode(byte),
                      ).join(""),
                    ),
              };
            },
          },
        });
      }, imagePolicy);
    }
    await unlock(page, workbench.url, workbench.secret, w);
    await nav(page, a.admin);
    await expect(page.getByText("student", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: a.approve, exact: true }).click();
    await expect(
      page.getByRole("button", { name: a.disable, exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("admin.png"),
      fullPage: true,
    });
    await nav(page, w.desk.settings);
    await page.getByRole("button", { name: w.desk.lock, exact: true }).click();
    // Signing out preserves the independent local workspace; reconnect through
    // the explicit account/binding review rather than expecting a login wall.
    await unlock(page, workbench.url, workbench.secret, w);
    await nav(page, a.account);
    await page
      .getByRole("tab", {
        name: zh ? "API 与模型" : "API & models",
        exact: true,
      })
      .click();
    await page
      .getByLabel(a.tokenName, { exact: true })
      .fill("Local research AI");
    await page.getByRole("button", { name: a.issue, exact: true }).click();
    await expect(page.getByText(a.once, { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: a.closeSecret, exact: true })
      .click();
    await page.screenshot({
      path: info.outputPath("account-api.png"),
      fullPage: true,
    });
    await nav(page, a.library);
    await page.getByRole("button", { name: a.newSpace, exact: true }).click();
    const spaceDialog = page.getByRole("dialog", {
      name: zh ? "新建知识空间" : "Create knowledge space",
      exact: true,
    });
    await spaceDialog
      .getByLabel(zh ? "空间名称" : "Space name", { exact: true })
      .fill("量子场论 / Quantum Field Theory");
    await spaceDialog
      .getByLabel(zh ? "描述（可选）" : "Description (optional)", {
        exact: true,
      })
      .fill("A dedicated space for lecture notes and illustrations.");
    await spaceDialog
      .getByRole("button", { name: zh ? "创建" : "Create", exact: true })
      .click();
    await expect(spaceDialog).toHaveCount(0);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "量子场论 / Quantum Field Theory",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: a.newLecture, exact: true }).click();
    await page
      .getByLabel(a.title, { exact: true })
      .fill("第一讲：场与对称性 / Fields and symmetry");
    const markdown =
      "## 1. Overview\n\nA **field** assigns a value to every point in spacetime.\n\n$$ E^2=p^2c^2+m^2c^4 $$\n\n| Symbol | Meaning |\n| --- | --- |\n| E | Energy |\n| p | Momentum |\n\n- [x] Review the notation\n- [ ] Derive the equations\n\n<script>window.untrusted=true</script>\n\n![blocked](https://example.invalid/private.png)";
    await documentMode(page, /^(Source|源码)$/);
    await pane(page).getByLabel(a.body, { exact: true }).click();
    await page.keyboard.press("Control+a");
    await page.keyboard.insertText(markdown);
    await documentTools(page);
    const imageUpload = {
      name: "figure.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        await page.evaluate(() => {
          const canvas = document.createElement("canvas");
          canvas.width = 941;
          canvas.height = 900;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas unavailable");
          // Exercise multiple 256 KiB upload chunks and binary/native IPC,
          // not only a tiny highly compressible PNG.
          const pixels = context.createImageData(canvas.width, canvas.height);
          let seed = 85;
          for (let i = 0; i < pixels.data.length; i += 4) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            pixels.data[i] = seed & 255;
            pixels.data[i + 1] = (seed >>> 8) & 255;
            pixels.data[i + 2] = (seed >>> 16) & 255;
            pixels.data[i + 3] = 255;
          }
          context.putImageData(pixels, 0, 0);
          context.fillStyle = "#177b65";
          context.fillRect(0, 0, 240, 120);
          context.fillStyle = "#ffffff";
          context.font = "20px sans-serif";
          context.fillText("Image preview", 24, 64);
          return canvas.toDataURL("image/png").split(",")[1] ?? "";
        }),
        "base64",
      ),
    };
    await pane(page)
      .getByLabel(a.image, { exact: true })
      .setInputFiles(imageUpload);
    await expect(pane(page).getByLabel(a.body, { exact: true })).toContainText(
      /api\/v1\/files\/bytes\?id=/,
    );
    // Fill raw Markdown, not the live DOM containing replacement widgets.
    await documentMode(page, /^(Source|源码)$/);
    const editor = pane(page).getByLabel(a.body, { exact: true });
    const uploadedText = await editor.innerText();
    const assetPath = uploadedText.match(
      /\/api\/v1\/files\/bytes\?id=[a-zA-Z0-9-]+/,
    )?.[0];
    if (!assetPath) throw new Error("Uploaded image path missing");
    // Existing documents can have empty alt text and an image in the same paragraph.
    const savedMarkdown = `${markdown}\n\nExisting paragraph\n![](${assetPath})`;
    await editor.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.insertText(savedMarkdown);
    await nav(page, w.desk.tasks);
    await expect(
      page.getByRole("tab", { name: /Fields and symmetry/ }),
    ).toBeVisible();
    await page.getByRole("tab", { name: /Fields and symmetry/ }).click();
    await saveDocument(page, w);
    await documentMode(page, w.desk.read);
    await expect(pane(page).locator(".document-reading .katex")).toHaveCount(1);
    await expect(pane(page).locator(".document-reading table")).toHaveCount(1);
    await expect(pane(page).locator(".document-reading img")).toHaveCount(1);
    await expect(pane(page).locator(".document-reading script")).toHaveCount(0);
    if (nativeImages) {
      await expect(pane(page).locator(".document-reading img")).toHaveAttribute(
        "src",
        /^blob:/,
      );
    }
    await expect
      .poll(() =>
        pane(page)
          .locator(".document-reading img")
          .evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
          ),
      )
      .toBe(true);
    await documentMode(page, /^(Live preview|实时预览)$/);
    await pane(page).locator(".cm-content").press("Control+End");
    await pane(page).locator(".cm-content").press("Enter");
    await pane(page).locator(".cm-content").press("Enter");
    await pane(page).locator(".cm-content").press("Control+Home");
    const liveImage = pane(page).locator(".md-live-widget img");
    await expect(liveImage).toHaveCount(1);
    if (nativeImages) await expect(liveImage).toHaveAttribute("src", /^blob:/);
    await expect
      .poll(() =>
        liveImage.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
      )
      .toBe(true);
    await liveImage.scrollIntoViewIfNeeded();
    page.off("response", captureImageResponse);
    await Promise.all(imageReads);
    const diagnostic = JSON.stringify(
      {
        responses: imageResponses,
        blobs: await page.evaluate(() =>
          Reflect.get(window, "imageDiagnosticBlobs"),
        ),
        image: await liveImage.evaluate((img: HTMLImageElement) => ({
          complete: img.complete,
          naturalWidth: img.naturalWidth,
        })),
      },
      null,
      2,
    );
    writeFileSync(info.outputPath("image-diagnostics.json"), diagnostic);
    await info.attach("image-diagnostics", {
      body: diagnostic,
      contentType: "application/json",
    });
    expect(imageResponses.length).toBe(0);
    expect(
      imageResponses.every(
        (r) => r.status === 200 && r.contentType === "image/png" && r.bytes > 0,
      ),
    ).toBe(true);
    expect(imageUpload.buffer.length).toBeGreaterThan(1895651);
    const renderedHash = await page.evaluate(async (path) => {
      const fileId = new URL(path, location.origin).searchParams.get("id");
      const open = (name: string) =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      let original: Blob | null = null;
      for (const database of await indexedDB.databases()) {
        if (!database.name || database.name.endsWith(".blobs")) continue;
        const db = await open(database.name);
        try {
          if (!db.objectStoreNames.contains("entities")) continue;
          const rows = await new Promise<
            {
              collection: string;
              id: string;
              workspaceId: string;
              value: { contentHash: string };
            }[]
          >((resolve, reject) => {
            const request = db
              .transaction("entities")
              .objectStore("entities")
              .getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const file = rows.find(
            (row) => row.collection === "files" && row.id === fileId,
          );
          if (!file) continue;
          const binary = await open(database.name + ".blobs");
          try {
            original = await new Promise<Blob>((resolve, reject) => {
              const request = binary
                .transaction("blobs")
                .objectStore("blobs")
                .get([file.workspaceId, file.value.contentHash]);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
          } finally {
            binary.close();
          }
          break;
        } finally {
          db.close();
        }
      }
      if (!(original instanceof Blob))
        throw new Error("Original local image Blob missing");
      const bytes = await original.arrayBuffer();
      return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
    }, assetPath);
    expect(renderedHash).toBe(
      createHash("sha256").update(imageUpload.buffer).digest("hex"),
    );
    await page.screenshot({
      path: info.outputPath("image-live.png"),
      fullPage: true,
    });
    await saveDocument(page, w);
    await documentMode(page, w.desk.read);
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
    expect(savedMetadata).toHaveLength(nativeImages ? 0 : 1);
    expect(JSON.stringify(savedMetadata)).not.toContain(workbench.secret);
    const readingImage = pane(page).locator(".document-reading img");
    await readingImage.evaluate((img) => {
      img.setAttribute("data-image-instance", "retained");
    });
    await documentMode(page, /^(Live preview|实时预览)$/);
    await documentMode(page, w.desk.read);
    // A mode change must not tear down a pending/decoded image and restart IPC.
    await expect(readingImage).toHaveAttribute(
      "data-image-instance",
      "retained",
    );
    await documentMode(page, /^(Source|源码)$/);
    await expect
      .poll(async () => {
        const snapshot = await (
          await page.request.get(workbench.url + "/api/snapshot")
        ).json();
        return snapshot.library.find(
          (entry: { title: string }) =>
            entry.title === "第一讲：场与对称性 / Fields and symmetry",
        )?.id;
      })
      .toEqual(expect.any(String));
    const persistedBody = await page.evaluate(async () => {
      const snapshot = await (await fetch("/api/snapshot")).json();
      const entry = snapshot.library.find(
        (entry: { title: string; bodyMd: string }) =>
          entry.title === "第一讲：场与对称性 / Fields and symmetry",
      );
      return (
        await (
          await fetch("/api/document/body?kind=LIBRARY&id=" + entry.id)
        ).json()
      ).bodyMd as string;
    });
    expect(persistedBody.trim()).toBe(savedMarkdown.trim());
    await documentMode(page, w.desk.read);
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
    // Both renderers must show a bilingual, retryable error, including empty-alt images.
    const fileId = new URL(assetPath, workbench.url).searchParams.get("id")!;
    const expectedHash = createHash("sha256")
      .update(imageUpload.buffer)
      .digest("hex");
    await expect
      .poll(async () =>
        (await page.request.get(workbench.url + assetPath)).status(),
      )
      .toBe(200);
    expect(
      await (await page.request.get(workbench.url + assetPath)).body(),
    ).toEqual(imageUpload.buffer);
    for (const fault of ["denied", "html", "empty", "corrupt"] as const) {
      const assetRoute = `**${assetPath}`;
      await page.route(assetRoute, (route) =>
        route.fulfill({
          status: fault === "denied" ? 401 : 200,
          contentType: fault === "html" ? "text/html" : "image/png",
          body: fault === "empty" ? "" : "not an image",
        }),
      );
      // Simulate a missing local original in this isolated test installation.
      // Reload resets the resolver; the original must then hydrate from the host.
      const evicted = await page.evaluate(async (hash) => {
        let removed = 0;
        for (const database of await indexedDB.databases()) {
          if (!database.name?.endsWith(".blobs")) continue;
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(database.name!);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            await new Promise<void>((resolve, reject) => {
              const tx = db.transaction("blobs", "readwrite");
              tx.oncomplete = () => resolve();
              tx.onabort = () => reject(tx.error);
              const store = tx.objectStore("blobs"),
                keys = store.getAllKeys();
              keys.onsuccess = () => {
                for (const key of keys.result)
                  if (Array.isArray(key) && key[1] === hash) {
                    store.delete(key);
                    removed++;
                  }
              };
            });
          } finally {
            db.close();
          }
        }
        return removed;
      }, expectedHash);
      expect(evicted).toBeGreaterThan(0);
      expect(fileId).toMatch(/^[a-zA-Z0-9-]+$/);
      await nav(page, a.library);
      await page.reload();
      await page
        .locator(".note-card, .library-document-row, .space-card")
        .filter({ hasText: "Quantum Field Theory" })
        .press("Enter");
      await page
        .locator(".note-card, .library-document-row, .space-card")
        .filter({ hasText: "Fields and symmetry" })
        .press("Enter");
      await documentMode(page, /^(Source|源码)$/);
      await documentMode(page, /^(Live preview|实时预览)$/);
      await expect(
        pane(page).locator(".md-live-widget .private-image-error"),
      ).toContainText(
        fault === "denied" ? a.imageAccessFailed : a.imageLoadFailed,
      );
      await documentMode(page, w.desk.read);
      await expect(
        pane(page).locator(".document-reading .private-image-error"),
      ).toBeVisible();
      await page.unroute(assetRoute);
      await pane(page)
        .getByRole("button", { name: a.imageRetry, exact: true })
        .click();
      await expect
        .poll(() =>
          pane(page)
            .locator(".document-reading img")
            .evaluate(
              (img: HTMLImageElement) =>
                img.complete && img.naturalWidth === 941,
            ),
        )
        .toBe(true);
      await documentMode(page, /^(Live preview|实时预览)$/);
      await pane(page)
        .locator(".md-live-widget")
        .getByRole("button", { name: a.imageRetry, exact: true })
        .click();
      await expect
        .poll(() =>
          pane(page)
            .locator(".md-live-widget img")
            .evaluate(
              (img: HTMLImageElement) =>
                img.complete && img.naturalWidth === 941,
            ),
        )
        .toBe(true);
    }
    await documentAction(page, w.desk.revisions);
    await expect(
      pane(page).locator(".document-tools details").first(),
    ).toBeAttached();
    await nav(page, a.library);
    await page.reload();
    await page
      .locator(".note-card, .library-document-row, .space-card")
      .filter({ hasText: "Quantum Field Theory" })
      .press("Enter");
    await page
      .locator(".note-card, .library-document-row, .space-card")
      .filter({ hasText: "Fields and symmetry" })
      .press("Enter");
    await documentMode(page, w.desk.read);
    await expect(pane(page).locator(".document-reading .katex")).toHaveCount(1);
  });
}
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
  await page.keyboard.press("Control+j");
  const assistant = page.getByRole("complementary", {
    name: "Atlas Assistant",
  });
  await assistant
    .getByRole("textbox", { name: /^(Ask Atlas|向 Atlas 提问)$/ })
    .fill("Only explicit request");
  await assistant.getByRole("button", { name: /^(Send|发送)$/ }).click();
  await expect(
    assistant.getByRole("heading", { name: /AI will read|AI 将读取/ }),
  ).toBeVisible();
  await expect(
    assistant.locator('[data-message-kind="ASSISTANT"] .markdown'),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("ai-approval.png"),
    fullPage: true,
  });
  await assistant
    .getByRole("button", { name: /Approve request|批准本次请求/ })
    .click();
  await expect(
    assistant.locator('[data-message-kind="ASSISTANT"] .markdown'),
  ).toContainText("Only explicit request");
  await expect(assistant).not.toContainText("PRIVATE");
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

test("opening an account replica preserves original local work and switching back works offline", async ({
  page,
  workbench,
}, info) => {
  const zh = info.project.name.endsWith("zh"),
    w = words(info.project.name);
  await page.goto(workbench.url + "/#tasks");
  await page
    .getByRole("button", { name: zh ? "新建任务" : "New task", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel(zh ? "标题" : "Title", { exact: true })
    .fill("Preserved device task");
  await dialog
    .getByRole("button", { name: zh ? "新建任务" : "Create task", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator(".task-title", { hasText: "Preserved device task" }),
  ).toBeVisible();
  await page.goto(workbench.url + "/#library");
  const bytes = Buffer.from("Original local bytes\n保留本机内容", "utf8");
  await page
    .getByLabel(zh ? "上传文件" : "Upload file", { exact: true })
    .setInputFiles({
      name: "preserved-device.txt",
      mimeType: "text/plain",
      buffer: bytes,
    });
  await expect(page.locator(".file-text-preview")).toHaveText(
    bytes.toString("utf8"),
  );
  await unlock(page, workbench.url, workbench.secret, w, true);
  await page.goto(workbench.url + "/#tasks");
  await expect(
    page.locator(".task-title", { hasText: "Preserved device task" }),
  ).toHaveCount(0);
  await page.route("**/api/**", (route) => route.abort("internetdisconnected"));
  await page.goto(workbench.url + "/#account");
  const navigation = page.getByRole("navigation", {
    name: /^(Device workspaces|本机工作区)$/,
  });
  await Promise.all([
    page.waitForEvent("load"),
    navigation
      .getByRole("button", {
        name: /^(Original device workspace|本机原工作区)$/,
      })
      .click(),
  ]);
  const backups = page.getByRole("region", {
    name: zh ? "合并前备份" : "Backups before merging",
    exact: true,
  });
  const backupDownload = page.waitForEvent("download");
  await backups
    .getByRole("button", {
      name: zh ? "下载原始备份" : "Download original backup",
      exact: true,
    })
    .click();
  const backupPath = await (await backupDownload).path();
  if (!backupPath) throw new Error("MISSING_MERGE_BACKUP_DOWNLOAD");
  const archived = await readFile(backupPath);
  expect(archived.subarray(0, 8).toString()).toBe("ORIVANE1");
  expect(archived.includes(bytes)).toBe(true);
  expect(archived.includes(Buffer.from("Preserved device task"))).toBe(true);
  await page.goto(workbench.url + "/#tasks");
  await expect(
    page.locator(".task-title", { hasText: "Preserved device task" }),
  ).toBeVisible();
  await page.goto(workbench.url + "/#library");
  await page
    .locator(".library-file-row", { hasText: "preserved-device.txt" })
    .click();
  await expect(page.locator(".file-text-preview")).toHaveText(
    bytes.toString("utf8"),
  );
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: zh ? "下载原始文件" : "Download original",
      exact: true,
    })
    .click();
  const path = await (await download).path();
  if (!path) throw new Error("MISSING_ORIGINAL_DOWNLOAD");
  expect(await readFile(path)).toEqual(bytes);
});

test("Agent Harness uses real evidence, reviews a write and keeps structured activity after refresh", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const aiPolicy = {
    classification: "PRIVATE",
    processingBoundary: "ANY",
    aiAccess: "ALLOW",
  };
  const space = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "SPACE",
      spaceId: null,
      title: "Evidence space",
      bodyMd: "",
      aiPolicy,
    },
  });
  await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "DOCUMENT",
      spaceId: space.id,
      title: "Atlas evidence",
      bodyMd: "# Atlas evidence\nVerified source content",
      aiPolicy,
    },
  });
  await page.reload();
  await page.keyboard.press("Control+j");
  const assistant = page.getByRole("complementary", {
    name: "Atlas Assistant",
  });
  const starters = assistant.getByRole("button", {
    name: zh ? "今天最值得做什么" : "What should I do today?",
    exact: true,
  });
  await starters.click();
  expect(
    await (await page.request.get(workbench.url + "/api/ai/sessions")).json(),
  ).toHaveLength(0);
  await assistant
    .getByRole("textbox", { name: /^(Ask Atlas|向 Atlas 提问)$/ })
    .fill("Atlas evidence: read, then propose one task");
  await assistant.getByRole("button", { name: /^(Send|发送)$/ }).click();
  await assistant
    .getByRole("button", { name: /Approve request|批准本次请求/ })
    .click();
  const approval = assistant.getByRole("region", {
    name: zh ? "工具审批" : "Tool approval",
  });
  await expect(approval).toContainText("Agent reviewed task");
  expect(
    (
      await (await page.request.get(workbench.url + "/api/snapshot")).json()
    ).items.filter((item: { type: string }) => item.type === "TASK"),
  ).toHaveLength(0);
  await approval
    .getByRole("button", { name: zh ? "批准" : "Approve", exact: true })
    .click();
  await expect(
    assistant.locator('[data-message-kind="ASSISTANT"]'),
  ).toContainText("Reviewed task created");
  await expect(assistant.locator(".tool-activity")).toHaveCount(4);
  const tasks = (
    await (await page.request.get(workbench.url + "/api/snapshot")).json()
  ).items.filter((item: { type: string }) => item.type === "TASK");
  expect(tasks.map((task: { title: string }) => task.title)).toEqual([
    "Agent reviewed task",
  ]);
  await expect(
    assistant.getByRole("region", { name: zh ? "来源" : "Sources" }),
  ).toContainText("Atlas evidence");
  await expect(
    assistant.getByRole("button", { name: "Atlas evidence", exact: true }),
  ).not.toBeVisible();
  await assistant.locator(".answer-sources summary").click();
  await assistant
    .getByRole("button", { name: "Atlas evidence", exact: true })
    .click();
  await expect(page.locator(".document-workspace")).toContainText(
    "Verified source content",
  );
  await page.reload();
  await page.keyboard.press("Control+j");
  await expect(
    assistant.locator('[data-message-kind="ASSISTANT"]'),
  ).toContainText("Reviewed task created");
  await expect(assistant.locator(".tool-activity")).toHaveCount(4);
  await page.screenshot({
    path: info.outputPath("harness-review.png"),
    fullPage: true,
  });
});

test("Agent Harness batch plan waits for review, accepts task edits and publishes into the selected project", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const project = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Economics learning",
  });
  await page.keyboard.press("Control+j");
  const assistant = page.getByRole("complementary", {
    name: "Atlas Assistant",
  });
  await assistant
    .getByRole("textbox", { name: /^(Ask Atlas|向 Atlas 提问)$/ })
    .fill(
      `Import these lectures into project=${project.id}:\nLecture 1\nLecture 2\nLecture 3`,
    );
  await assistant.getByRole("button", { name: /^(Send|发送)$/ }).click();
  await assistant
    .getByRole("button", { name: /Approve request|批准本次请求/ })
    .click();
  const approval = assistant.getByRole("region", {
    name: zh ? "工具审批" : "Tool approval",
  });
  await expect(approval).toContainText("Lecture 3");
  expect(
    (
      await (await page.request.get(workbench.url + "/api/snapshot")).json()
    ).items.filter((item: { type: string }) => item.type === "TASK"),
  ).toHaveLength(0);
  await approval
    .getByRole("button", { name: zh ? "修改" : "Modify", exact: true })
    .click();
  await approval
    .getByRole("textbox", { name: zh ? "任务 1" : "Task 1", exact: true })
    .fill("Reviewed economics introduction");
  await approval
    .getByRole("button", { name: zh ? "批准" : "Approve", exact: true })
    .click();
  await expect(
    assistant.locator('[data-message-kind="ASSISTANT"]'),
  ).toContainText("Reviewed course plan imported");
  const tasks = (
    await (await page.request.get(workbench.url + "/api/snapshot")).json()
  ).items.filter((item: { type: string }) => item.type === "TASK");
  expect(tasks).toHaveLength(3);
  expect(tasks.map((task: { title: string }) => task.title)).toContain(
    "Reviewed economics introduction",
  );
  expect(
    tasks.every((task: { projectIds: string[] }) =>
      task.projectIds.includes(project.id),
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("plan-review.png"),
    fullPage: true,
  });
});

for (const transport of ["SSE", "cursor fallback"])
  test(`AI approval streaming displays real deltas and resumes persisted conversation after reload (${transport})`, async ({
    page,
    workbench,
  }, info) => {
    const w = words(info.project.name);
    const pollingCursors: number[] = [];
    const pollingTimes: number[] = [];
    if (transport === "cursor fallback") {
      await page.route("**/api/ai/events/stream?*", (route) =>
        route.abort("failed"),
      );
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.pathname === "/api/ai/events") {
          pollingCursors.push(Number(url.searchParams.get("after")));
          pollingTimes.push(performance.now());
        }
      });
    }
    await unlock(page, workbench.url, workbench.secret, w);
    await page.keyboard.press("Control+j");
    const assistant = page.getByRole("complementary", {
      name: "Atlas Assistant",
    });
    await assistant
      .getByRole("textbox", { name: /^(Ask Atlas|向 Atlas 提问)$/ })
      .fill("Streaming question");
    await assistant.getByRole("button", { name: /^(Send|发送)$/ }).click();
    await assistant
      .getByRole("button", { name: /Approve request|批准本次请求/ })
      .click();
    await expect(assistant).toContainText("Visible streaming");
    await expect(
      assistant.locator('[data-message-kind="ASSISTANT"]'),
    ).toHaveCount(0);
    await expect(
      assistant.locator('[data-message-kind="ASSISTANT"]'),
    ).toContainText("Visible streaming answer", {
      timeout: transport === "cursor fallback" ? 10000 : 5000,
    });
    if (transport === "cursor fallback") {
      expect(pollingCursors[0]).toBe(0);
      expect(pollingCursors.some((cursor) => cursor > 0)).toBe(true);
      expect(pollingTimes).toHaveLength(3);
      expect(
        (pollingTimes[1] ?? NaN) - (pollingTimes[0] ?? NaN),
      ).toBeGreaterThanOrEqual(1800);
      expect(
        (pollingTimes[2] ?? NaN) - (pollingTimes[1] ?? NaN),
      ).toBeGreaterThanOrEqual(3800);
    }
    const finishedRuns = await (
      await page.request.get(workbench.url + "/api/ai")
    ).json();
    const finishedId = finishedRuns.runs[0].id;
    const eventPage = await (
      await page.request.get(
        workbench.url + "/api/ai/events?id=" + finishedId + "&after=0",
      )
    ).json();
    expect(eventPage.cursor).toBeGreaterThan(1);
    expect(
      eventPage.events.filter(
        (event: { type: string }) => event.type === "text-delta",
      ),
    ).toHaveLength(2);
    const tail = await (
      await page.request.get(
        workbench.url +
          "/api/ai/events?id=" +
          finishedId +
          "&after=" +
          (eventPage.cursor - 1),
      )
    ).json();
    expect(tail.events).toEqual([eventPage.events.at(-1)]);
    expect(
      (
        await (
          await page.request.get(
            workbench.url +
              "/api/ai/events?id=" +
              finishedId +
              "&after=" +
              eventPage.cursor,
          )
        ).json()
      ).events,
    ).toEqual([]);
    await page.reload();
    await expect(page.locator(".app-shell")).toBeVisible();
    await page.keyboard.press("Control+j");
    await expect(assistant.locator('[data-message-kind="USER"]')).toContainText(
      "Streaming question",
    );
    await expect(
      assistant.locator('[data-message-kind="ASSISTANT"]'),
    ).toContainText("Visible streaming answer");
    await assistant
      .getByRole("textbox", { name: /^(Ask Atlas|向 Atlas 提问)$/ })
      .fill("Continue");
    const proposed = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/ai/propose",
    );
    await assistant.getByRole("button", { name: /^(Send|发送)$/ }).click();
    expect((await proposed).ok()).toBe(true);
    const sessions = await (
      await page.request.get(workbench.url + "/api/ai/sessions")
    ).json();
    expect(sessions).toHaveLength(1);
    expect(
      (
        await (
          await page.request.get(
            workbench.url + "/api/ai/sessions/messages?id=" + sessions[0].id,
          )
        ).json()
      ).session.messages.map((message: { kind: string }) => message.kind),
    ).toEqual(["USER", "ASSISTANT", "USER"]);
    await page.screenshot({
      path: info.outputPath("streaming-session.png"),
      fullPage: true,
    });
  });

test("document knowledge graph preserves wiki neighbors and hides work and isolated pages", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  const zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const space = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "SPACE",
      spaceId: null,
      title: "Quantum fields",
      bodyMd: "",
    },
  });
  await mutation(page, "/api/work/create", { title: "Research task" });
  for (const [title, bodyMd] of [
    ["Symmetry lecture", "# Symmetry\n[[Field equations]]"],
    ["Field equations", "[[Symmetry lecture]]"],
    ["Isolated page", "No outgoing links"],
  ]) {
    await mutation(page, "/api/library/save", {
      id: null,
      version: 0,
      input: { kind: "DOCUMENT", spaceId: space.id, title, bodyMd },
    });
  }
  await page.reload();
  await page.goto(workbench.url + "/#knowledge");
  await page
    .getByRole("button", {
      name: zh ? "知识图谱" : "Knowledge graph",
      exact: true,
    })
    .click();
  const graph = page.locator(".graph-section");
  const documents = graph.locator(
    '.react-flow__node:not([data-id^="space-cluster:"])',
  );
  // Select the intended document explicitly; default focus may be an isolated page.
  await graph
    .getByRole("button", {
      name: zh ? "工作区" : "Entire workspace",
      exact: true,
    })
    .click();
  await graph.getByLabel(zh ? "图谱搜索" : "Graph search").fill("Symmetry");
  await graph.getByRole("option", { name: /Symmetry lecture/ }).click();
  await graph
    .getByRole("button", {
      name: zh ? "局部" : "Connected documents",
      exact: true,
    })
    .click();
  await expect(documents).toHaveCount(2);
  await expect(
    graph.getByRole("button", {
      name: zh ? "局部" : "Connected documents",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await graph.getByLabel(zh ? "图谱搜索" : "Graph search").fill("Symmetry");
  await expect(documents).toHaveCount(2);
  await graph.getByRole("option", { name: /Symmetry lecture/ }).click();
  await graph
    .getByRole("button", {
      name: zh ? "局部" : "Connected documents",
      exact: true,
    })
    .click();
  await expect(documents).toHaveCount(2);
  await expect(graph.locator(".react-flow__edge")).toHaveCount(2);
  await expect(graph).not.toContainText("Research task");
  await expect(graph).not.toContainText("Isolated page");
  await graph
    .getByRole("button", { name: zh ? "空间" : "Current space", exact: true })
    .click();
  await expect(documents).toHaveCount(2);
  await expect(graph).not.toContainText("Isolated page");
  // Scope topology changes preserve the existing viewport; the user can fit explicitly.
  await graph
    .getByRole("button", { name: zh ? "适应视图" : "Fit View", exact: true })
    .click();
  await graph
    .locator(".react-flow__node")
    .filter({ hasText: "Symmetry lecture" })
    .dblclick();
  await expect(
    pane(page).getByLabel(w.spaces.title, { exact: true }),
  ).toHaveValue("Symmetry lecture");
  await page.screenshot({
    path: info.outputPath("document-knowledge-graph.png"),
    fullPage: true,
  });
});
test("AI approval project scope is shared by search, Wiki autocomplete, graph and Assistant retrieval", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const parent = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Scope parent",
  });
  const project = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Project A",
    parentProjectId: parent.id,
  });
  const inherited = await mutation(page, "/api/projects/space/create", {
    projectId: parent.id,
    title: "Inherited",
    inheritToChildren: true,
  });
  const primary = await mutation(page, "/api/projects/space/create", {
    projectId: project.id,
    title: "Primary",
    role: "PRIMARY",
  });
  const secondary = await mutation(page, "/api/projects/space/create", {
    projectId: project.id,
    title: "Secondary",
    role: "SUPPORTING",
  });
  const policy = {
    classification: "PRIVATE",
    processingBoundary: "ANY",
    aiAccess: "ASK",
  };
  const linked = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "SPACE",
      spaceId: null,
      title: "Linked",
      bodyMd: "",
      aiPolicy: policy,
    },
  });
  const unrelated = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "SPACE",
      spaceId: null,
      title: "Unrelated",
      bodyMd: "",
      aiPolicy: policy,
    },
  });
  await mutation(page, "/api/projects/space/link", {
    projectId: project.id,
    spaceId: linked.id,
  });
  const spaces = [
    primary.spaceId,
    secondary.spaceId,
    linked.id,
    inherited.spaceId,
    unrelated.id,
  ];
  const library = await (
    await page.request.get(workbench.url + "/api/library")
  ).json();
  for (const id of spaces.slice(0, 2).concat(inherited.spaceId)) {
    const entry = library.find(
      (candidate: { id: string }) => candidate.id === id,
    );
    await mutation(page, "/api/library/save", {
      id,
      version: entry.version,
      input: {
        kind: "SPACE",
        spaceId: null,
        title: entry.title,
        bodyMd: "",
        aiPolicy: policy,
      },
    });
  }
  for (const [index, spaceId] of spaces.entries())
    await mutation(page, "/api/library/save", {
      id: null,
      version: 0,
      input: {
        kind: "DOCUMENT",
        spaceId,
        title: `Storage ${index}`,
        bodyMd: `[[Storage ${index}]]`,
        aiPolicy: policy,
      },
    });
  await page.goto(workbench.url + `/#projects/${project.id}?tab=knowledge`);
  await page.reload();
  const workspace = page.locator(".project-workspace");
  await workspace
    .getByLabel(zh ? "搜索项目知识" : "Search project knowledge")
    .fill("Storage");
  await expect(workspace.locator("button.agenda-item")).toHaveText([
    "Storage 0",
    "Storage 1",
    "Storage 2",
    "Storage 3",
    "Storage 4",
  ]);
  await workspace
    .getByText(zh ? "知识图谱" : "Knowledge graph", { exact: true })
    .click();
  const graph = workspace.locator(".graph-section");
  await expect(
    graph.getByRole("button", {
      name: zh ? "项目" : "Current project",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    graph.locator('.react-flow__node:not([data-id^="space-cluster:"])'),
  ).toHaveCount(4);
  await expect(
    graph.locator(".react-flow__node").filter({ hasText: "Storage 4" }),
  ).toHaveCount(0);
  await graph
    .getByRole("button", {
      name: zh ? "工作区" : "Entire workspace",
      exact: true,
    })
    .click();
  await expect(
    graph.locator('.react-flow__node:not([data-id^="space-cluster:"])'),
  ).toHaveCount(5);
  await workspace.locator("button.agenda-item").first().click();
  const editor = pane(page).locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n[[Storage");
  await expect(
    page.getByRole("option").filter({ hasText: /Storage [0-4]/ }),
  ).toHaveCount(5);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+s");
  await expect(pane(page).getByRole("status")).toContainText(
    /^(Saved on this device(?: · (?:Syncing|Offline))?|Synced|已保存到本机(?: · (?:正在同步|离线))?|已同步)$/,
  );
  await browseDocuments(page);
  await page.keyboard.press("Control+j");
  const assistant = page.getByRole("complementary", {
    name: "Atlas Assistant",
  });
  await assistant
    .getByRole("textbox", { name: /^(Ask Atlas|向 Atlas 提问)$/ })
    .fill("Storage");
  await assistant.getByRole("button", { name: /^(Send|发送)$/ }).click();
  await expect(
    assistant.getByRole("heading", { name: /AI will read|AI 将读取/ }),
  ).toBeVisible();
  const state = await (
    await page.request.get(workbench.url + "/api/ai")
  ).json();
  expect(
    state.runs[0].context.map((item: { title: string }) => item.title),
  ).toEqual(["Storage 0", "Storage 1", "Storage 2", "Storage 3", "Storage 4"]);
  await assistant
    .getByRole("button", { name: /Approve request|批准本次请求/ })
    .click();
  await expect(
    assistant.locator('[data-message-kind="ASSISTANT"]'),
  ).toContainText("Storage 4");
  await page.screenshot({
    path: info.outputPath("shared-project-scope.png"),
    fullPage: true,
  });
});

test("persistent document hierarchy is visible and can be moved through the knowledge editor", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const space = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: { kind: "SPACE", spaceId: null, title: "Architecture", bodyMd: "" },
  });
  const root = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "DOCUMENT",
      spaceId: space.id,
      title: "Backend",
      bodyMd: "",
    },
  });
  const child = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "DOCUMENT",
      spaceId: space.id,
      title: "Storage",
      bodyMd: "[[Backend]]",
      parentDocumentId: root.id,
    },
  });
  await page.reload();
  await nav(page, w.spaces.library);
  await page
    .locator(".space-card")
    .filter({ hasText: "Architecture" })
    .press("Enter");
  const card = page
    .locator(".note-card, .library-document-row, .space-card")
    .filter({
      has: page.getByRole("heading", { name: "Storage", exact: true }),
    });
  await expect(card.locator("small").first()).toContainText("Backend");
  await card.press("Enter");
  const parentPicker = pane(page).locator(".hierarchy-picker");
  await parentPicker.locator(".hierarchy-selected > button").first().click();
  await expect
    .poll(
      async () =>
        (
          await (await page.request.get(workbench.url + "/api/library")).json()
        ).find((entry: { id: string }) => entry.id === child.id)
          .parentDocumentId,
    )
    .toBe(null);
  await chooseProject(parentPicker, ["Backend"], "DOCUMENT");
  await expect
    .poll(
      async () =>
        (
          await (await page.request.get(workbench.url + "/api/library")).json()
        ).find((entry: { id: string }) => entry.id === child.id)
          .parentDocumentId,
    )
    .toBe(root.id);
  await page.screenshot({
    path: info.outputPath("persistent-hierarchy.png"),
    fullPage: true,
  });
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
    .locator(".task-card .task-title")
    .filter({ hasText: "Shared task" })
    .press("Enter");
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
    await page.route("**/api/v1/sync?*", (route) => route.abort("failed"));
    // A committed external change invalidates the snapshot; idle SSE does not poll.
    await mutation(second, "/api/work/create", {
      title: "Trigger offline snapshot pull",
    });
    await expect(page.locator(".page-header")).toContainText(
      w.connected.offline,
      {
        timeout: 10000,
      },
    );
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
  await page.locator(".page-header .compact-create").click();
  await page
    .getByRole("dialog")
    .getByLabel(w.work.title, { exact: true })
    .fill("Autumn launch");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: w.desk.createProject, exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".project-card")).toHaveCount(1);
  await nav(page, w.desk.tasks);
  await page.locator(".page-header .compact-create").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(w.work.title, { exact: true }).fill("Ship planning");
  await chooseProject(
    dialog.locator(".project-memberships .hierarchy-picker"),
    ["Autumn launch"],
  );
  await chooseDate(page, dialog.getByLabel(w.desk.startDate), "2026-09-14");
  await chooseDate(page, dialog.getByLabel(w.desk.dueDate), "2026-09-21");
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
  await expect(page.locator(".document-pane:not([hidden])")).toHaveCount(0);
  await openCalendarJournal(page, w.desk.journal);
  await expect(pane(page)).toBeVisible();
  expect(
    (await (await page.request.get(workbench.url + "/api/snapshot")).json())
      .notes,
  ).toEqual([]);
  await browseDocuments(page);
  await expect(page.locator(".calendar-event-row")).toContainText(
    "Ship planning",
  );
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
  await page.locator(".page-header .compact-create").click();
  const markdown = "# 原始 Markdown\r\n\r\n- [ ] 仅是正文，不是任务\r\n";
  // Wait for the new tab, not the calendar tab briefly visible during navigation.
  await expect(pane(page).getByLabel(w.desk.noteTitle)).toHaveValue("");
  await documentTools(page);
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
  await waitForLocalReplay(page);
  const after = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(after.items).toHaveLength(2);
  expect(after.notes[0].bodyMd).toBe(markdown);
  await nav(page, w.desk.settings);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: w.desk.localBackup }).click();
  const file = await downloaded;
  const target = info.outputPath("workspace.oab");
  await file.saveAs(target);
  const bytes = readFileSync(target);
  expect(bytes.subarray(0, 8).toString()).toBe("ORIVANE1");
  const manifest = JSON.parse(
    bytes.subarray(16, 16 + bytes.readUInt32BE(8)).toString(),
  );
  expect(manifest.credentialVault).toBe("EXCLUDED");
  expect(
    manifest.archive.entities
      .filter(
        (entry: { collection: string }) =>
          entry.collection === "$local.noteBody",
      )
      .some(
        (entry: { value: { bodyMd?: string } }) =>
          entry.value.bodyMd === markdown,
      ),
  ).toBe(true);
});

test("uncertain network retry is idempotent and committed saves close after refresh failure", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.tasks);
  const attempts: { key: string | undefined; stableId: string }[] = [];
  let first = true;
  await page.route("**/api/v1/work/create", async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"],
      stableId: route.request().postDataJSON().stableId,
    });
    if (first) {
      first = false;
      const committed = await route.fetch();
      expect(committed.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await createTask(page, w, "Uncertain save");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("article.task-card")).toHaveCount(1);
  await expect.poll(() => attempts.length).toBeGreaterThan(0);
  await page.reload();
  await waitForLocalReplay(page);
  const firstState = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(firstState.items).toHaveLength(1);
  expect(firstState.items[0]).toMatchObject({
    title: "Uncertain save",
    id: attempts[0]!.stableId,
    version: 1,
  });
  expect(new Set(attempts.map((row) => row.key)).size).toBe(1);
  expect(attempts[0]!.key).toBeTruthy();
  await page.route("**/api/v1/sync?*", (route) => route.abort("failed"));
  await createTask(page, w, "Committed without refresh");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("article.task-card")).toHaveCount(2);
  await page.reload();
  await expect(page.locator("article.task-card")).toHaveCount(2);
  await page.unroute("**/api/v1/sync?*");
  await page.reload();
  await waitForLocalReplay(page);
  const canonical = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(canonical.items).toHaveLength(2);
  expect(
    canonical.items.map((item: { title: string }) => item.title).sort(),
  ).toEqual(["Committed without refresh", "Uncertain save"]);
  expect(
    canonical.items.every((item: { version: number }) => item.version === 1),
  ).toBe(true);
  await info.attach("receipt-recovery-attempts", {
    body: JSON.stringify(attempts),
    contentType: "application/json",
  });
});

async function unlock(
  page: Page,
  url: string,
  secret: string,
  w: ReturnType<typeof words>,
  reviewMerge: boolean | "prepare" = false,
  username = "image-editor",
) {
  await page.goto(url + "/#account");
  const connection = page.getByRole("region", {
    name: /^(Account and workspace connection|连接账户与工作区)$/,
  });
  await connection
    .getByLabel(w.spaces.username, { exact: true })
    .fill(username);
  await connection.getByLabel(w.spaces.password, { exact: true }).fill(secret);
  await connection
    .getByRole("button", {
      name: /^(Sign in and review options|登录并查看选项)$/,
    })
    .click();
  const preview = connection.getByRole("region", {
    name: /^(Workspace connection preview|工作区连接预览)$/,
  });
  await expect(preview).toBeVisible();
  if (reviewMerge) {
    await preview
      .getByRole("button", { name: /^(Review merge preview|查看合并预览)$/ })
      .click();
    const report = preview.getByRole("region", {
      name: /^(Merge preview|合并预览)$/,
    });
    await expect(report).toBeVisible();
    await expect(report.locator("dt")).toHaveText(
      w.spaces.username === "用户名"
        ? [
            "完全相同的内容",
            "可能重复的内容",
            "标识冲突",
            "项目层级冲突",
            "任务所属项目冲突",
            "文档标题或别名冲突",
            "相同的原始文件",
          ]
        : [
            "Exact duplicates",
            "Possible duplicates",
            "ID collisions",
            "Project hierarchy conflicts",
            "Task membership conflicts",
            "Document title or alias collisions",
            "Duplicate original files",
          ],
    );
    await report
      .getByRole("button", {
        name: /^(Save a backup before merging|保存合并前备份)$/,
      })
      .click();
    await expect(report.getByRole("status")).toHaveText(
      /^(Original content and files are backed up on this device.|原始内容与文件已备份在本机。)$/,
    );
  }
  if (reviewMerge === "prepare") return;
  await Promise.all([
    page.waitForEvent("load"),
    preview
      .getByRole("button", {
        name: /^(Open account workspace|打开账户工作区)$/,
      })
      .click(),
  ]);
  await expect(
    page
      .getByRole("navigation", { name: /^(Device workspaces|本机工作区)$/ })
      .getByRole("button", {
        name: /^(Account workspace|账户工作区)$/,
        exact: true,
      })
      .and(page.locator('[aria-current="page"]')),
  ).toHaveAttribute("aria-current", "page");
  await page.goto(url);
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
  if (!response.ok())
    throw new Error(
      "MUTATION_FAILED " +
        path +
        " " +
        response.status() +
        " " +
        (await response.text()),
    );
  return response.json();
}
async function taskScope(page: Page, name: string) {
  await page
    .getByRole("button", { name: /^(More task scopes|更多任务范围)$/ })
    .click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
}
async function projectAction(page: Page, name: string) {
  await page
    .getByRole("button", { name: /^(项目更多操作|More project actions)$/ })
    .click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

async function projectMenu(page: Page, title: string) {
  await page
    .locator(".project-card")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .getByRole("button", { name: /^(项目操作：|Project actions: )/ })
    .click();
  return page.getByRole("menu", { name: /^(项目操作：|Project actions: )/ });
}

async function taskMenu(page: Page, title: string) {
  await page
    .locator(".task-card")
    .filter({ hasText: title })
    .getByRole("button", { name: /^(更多操作：|More actions: )/ })
    .click();
  return page.getByRole("menu", { name: /^(更多操作：|More actions: )/ });
}
async function openAccountApiModels(page: Page, zh: boolean) {
  await page.evaluate(() => {
    location.hash = "account";
  });
  await expect(
    page.getByRole("tablist", {
      name: zh ? "账户分区" : "Account sections",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("tab", {
      name: zh ? "API 与模型" : "API & models",
      exact: true,
    })
    .click();
}
async function enterSelectionMode(page: Page, selectionLabel: string) {
  const button = page.getByRole("button", {
    name: selectionLabel,
    exact: true,
  });
  if (await button.count()) await button.click();
}
async function openAdvancedSettings(page: Page) {
  const details = page.locator("details.settings-advanced");
  if (
    (await details.count()) > 0 &&
    !(await details.evaluate((node) => (node as HTMLDetailsElement).open))
  )
    await details.locator("summary").first().click();
}
async function nav(page: Page, name: string) {
  await expect(page.locator(".app-shell")).toBeVisible();
  for (const locale of ["en-US", "zh-CN"] as const) {
    const desk = resources[locale].desk;
    if (name === desk.knowledge) {
      await nav(page, desk.settings);
      await openAdvancedSettings(page);
      await page.locator(".advanced-relations > summary").click();
      return;
    }
    if (name === desk.dependencies) {
      await nav(page, desk.tasks);
      await page
        .getByRole("button", { name: /^(More task scopes|更多任务范围)$/ })
        .click();
      await page.getByRole("menuitem", { name, exact: true }).click();
      return;
    }
  }
  for (const locale of ["en-US", "zh-CN"] as const) {
    const desk = resources[locale].desk;
    if (
      [
        desk.settings,
        desk.trash,
        resources[locale].spaces.account,
        resources[locale].spaces.admin,
      ].includes(name) &&
      !(await page.locator(".mobile-navigation-toggle").isVisible())
    ) {
      await page
        .getByRole("button", { name: desk.workspaceMenu, exact: true })
        .click();
      await page.getByRole("menuitem", { name, exact: true }).click();
      return;
    }
  }
  for (const locale of ["en-US", "zh-CN"] as const) {
    if (
      name === resources[locale].desk.planning ||
      name === resources[locale].desk.board
    ) {
      await page.evaluate(
        (view) => {
          location.hash = view;
        },
        name === resources[locale].desk.board ? "board" : "planning",
      );
      await expect(page.locator(".tasks-workspace")).toBeVisible();
      if (name === resources[locale].desk.board)
        await expect(page.locator(".board-column")).toHaveCount(4);
      return;
    }
  }
  await expect(page.locator(".app-shell")).toBeVisible();
  const mobileToggle = page.locator(".mobile-navigation-toggle");
  if (await mobileToggle.isVisible()) {
    const pinned = page
      .locator(".mobile-bottom-navigation")
      .getByRole("button", { name, exact: true });
    if (await pinned.count()) {
      if (await page.locator(".mobile-more-sheet").isVisible())
        await page.keyboard.press("Escape");
      await pinned.click();
    } else {
      if (!(await page.locator(".mobile-more-sheet").isVisible()))
        await mobileToggle.click();
      await page
        .locator(".mobile-more-sheet")
        .getByRole("button", { name, exact: true })
        .click();
    }
    return;
  }
  await page
    .locator(".sidebar")
    .getByRole("button", { name: new RegExp("^" + name + "(?: [0-9]+)?$") })
    .click();
}
export async function documentTools(page: Page) {
  const menu = pane(page).locator(".document-actions-menu");
  if (
    (await menu.locator(":scope > button").getAttribute("aria-expanded")) !==
    "true"
  )
    await menu.locator(":scope > button").click();
  const tools = menu.locator(".document-tools");
  if (
    (await tools.locator(":scope > button").getAttribute("aria-expanded")) !==
    "true"
  )
    await tools.locator(":scope > button").click();
}
async function chooseProject(
  picker: Locator,
  path: string[],
  kind: "PROJECT" | "DOCUMENT" = "PROJECT",
) {
  picker = picker.and(picker.page().locator(`[data-picker-kind="${kind}"]`));
  const trigger = picker.locator(".hierarchy-selected > button").last();
  if ((await trigger.getAttribute("aria-expanded")) !== "true")
    await trigger.click();
  const browser = picker.page().locator(".hierarchy-browser");
  await browser.locator("nav > button").click();
  for (const [index, title] of path.entries()) {
    const row = browser.locator("li").filter({
      has: picker.page().getByRole("button", {
        name: new RegExp("^" + title + "(?: ›)?$"),
        exact: true,
      }),
    });
    if (index === path.length - 1)
      await row.locator(".ui-entity-picker-choice").click();
    else await row.locator(".ui-icon-button").click();
  }
  if (await browser.isVisible()) {
    await browser
      .getByRole("button", { name: /^(完成|Done)$/, exact: true })
      .click();
    await expect(browser).toBeHidden();
  }
}
function pane(page: Page) {
  return page.locator(".document-pane:visible");
}
async function documentMode(page: Page, name: string | RegExp) {
  const actions = pane(page).locator(".document-actions-menu > button");
  if ((await actions.getAttribute("aria-expanded")) === "true") {
    await page.keyboard.press("Escape");
    await expect(actions).toHaveAttribute("aria-expanded", "false");
  }
  const presentation = pane(page).getByRole("group", {
    name: /^(文档视图|Document view)$/,
  });
  const read = presentation.getByRole("button", { name, exact: true });
  if (await read.count()) {
    await read.click();
    return;
  }
  const menu = pane(page).locator(".document-mode-menu");
  if (
    (await menu.locator(":scope > button").getAttribute("aria-expanded")) !==
    "true"
  )
    await menu.locator(":scope > button").click();
  await menu.getByRole("button", { name, exact: true }).click();
}
async function documentAction(page: Page, name: string, exported = false) {
  const menu = pane(page).locator(".document-actions-menu");
  if (
    (await menu.locator(":scope > button").getAttribute("aria-expanded")) !==
    "true"
  )
    await menu.locator(":scope > button").click();
  if (exported) {
    const exports = menu.locator(".document-export > button");
    if ((await exports.getAttribute("aria-expanded")) !== "true")
      await exports.click();
  }
  await menu.getByRole("button", { name, exact: true }).click();
}
async function browseDocuments(page: Page) {
  await page.locator(".document-tabs > button").click();
}
async function saveDocument(page: Page, w: ReturnType<typeof words>) {
  void w;
  await page.keyboard.press("Control+s");
  await expect(
    pane(page).locator(".document-toolbar [role=status]"),
  ).toHaveAttribute("data-locally-saved", "true");
  await expect(
    pane(page).locator(".document-toolbar [role=status]"),
  ).toHaveText(
    /^(Saved on this device(?: · (?:Syncing|Offline))?|Synced|已保存到本机(?: · (?:正在同步|离线))?|已同步)$/,
  );
}
async function createTask(
  page: Page,
  w: ReturnType<typeof words>,
  title: string,
) {
  await page.locator(".page-header .compact-create").click();
  await page
    .getByRole("dialog")
    .getByLabel(w.work.title, { exact: true })
    .fill(title);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: w.common.addDescription, exact: true })
    .click();
  await page
    .getByLabel(w.work.description, { exact: true })
    .fill("# 原文\n\n- [ ] Keep Markdown");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: w.common.create, exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
}

test("project task ordering remains independent across parent child and shared memberships", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  const zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const parent = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Order parent",
  });
  const other = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Order other",
  });
  const child = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Order child",
    parentProjectId: parent.id,
  });
  for (const [title, projectIds] of [
    ["Scoped Alpha", [parent.id, other.id]],
    ["Scoped Bravo", [child.id]],
    ["Scoped Charlie", [parent.id, other.id]],
  ] as const)
    await mutation(page, "/api/work/create", { title, projectIds });
  const openTasks = async (id: string) => {
    await page.goto(
      `${workbench.url}#projects/${encodeURIComponent(id)}?tab=tasks&scope=SUBTREE`,
    );
    await page
      .getByRole("combobox", {
        name: zh ? "任务排序" : "Task sort",
        exact: true,
      })
      .selectOption("manual");
  };
  const titles = page.locator(".project-workspace .task-list .task-title");
  await openTasks(parent.id);
  await expect(titles).toHaveText([
    "Scoped Alpha",
    "Scoped Bravo",
    "Scoped Charlie",
  ]);
  await page
    .getByRole("button", {
      name: (zh ? "调整顺序：" : "Reorder: ") + "Scoped Charlie",
      exact: true,
    })
    .press("Alt+ArrowUp");
  await expect(titles).toHaveText([
    "Scoped Alpha",
    "Scoped Charlie",
    "Scoped Bravo",
  ]);
  await openTasks(other.id);
  await expect(titles).toHaveText(["Scoped Alpha", "Scoped Charlie"]);
  await page
    .getByRole("button", {
      name: (zh ? "调整顺序：" : "Reorder: ") + "Scoped Charlie",
      exact: true,
    })
    .press("Alt+ArrowUp");
  await expect(titles).toHaveText(["Scoped Charlie", "Scoped Alpha"]);
  await openTasks(child.id);
  await expect(titles).toHaveText(["Scoped Bravo"]);
  await openTasks(parent.id);
  await expect(titles).toHaveText([
    "Scoped Alpha",
    "Scoped Charlie",
    "Scoped Bravo",
  ]);
});

test("manual task order survives scope switches and reload with keyboard and desktop insertion", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.tasks);
  for (const title of ["Order Alpha", "Order Bravo", "Order Charlie"])
    await createTask(page, w, title);
  const sort = page.locator(".sort-control select");
  await sort.selectOption("title");
  await expect(page.locator(".task-list .ui-drag-handle")).toHaveCount(0);
  await sort.selectOption("manual");
  const titles = page.locator(".task-list article.task-card .task-title");
  await expect(titles).toHaveText([
    "Order Alpha",
    "Order Bravo",
    "Order Charlie",
  ]);
  const zh = info.project.name !== "desktop-en";
  await page
    .getByRole("button", {
      name: (zh ? "调整顺序：" : "Reorder: ") + "Order Charlie",
      exact: true,
    })
    .press("Alt+ArrowUp");
  await expect(titles).toHaveText([
    "Order Alpha",
    "Order Charlie",
    "Order Bravo",
  ]);
  await page
    .getByRole("tab", { name: w.desk.taskWorkspace.later, exact: true })
    .click();
  await expect(titles).toHaveCount(0);
  await page
    .getByRole("tab", { name: w.desk.taskWorkspace.now, exact: true })
    .click();
  await expect(titles).toHaveText([
    "Order Alpha",
    "Order Charlie",
    "Order Bravo",
  ]);
  if (!info.project.name.startsWith("mobile")) {
    const moving = page.getByRole("button", {
      name: (zh ? "调整顺序：" : "Reorder: ") + "Order Bravo",
      exact: true,
    });
    const target = page
      .locator(".ui-sortable-row")
      .filter({ has: page.locator(".task-title", { hasText: "Order Alpha" }) });
    await moving.focus();
    await moving.dragTo(target, { targetPosition: { x: 8, y: 3 } });
    await expect(titles).toHaveText([
      "Order Bravo",
      "Order Alpha",
      "Order Charlie",
    ]);
  }
  const expected = await titles.allTextContents();
  await page.reload();
  await nav(page, w.desk.tasks);
  await sort.selectOption("manual");
  await expect(titles).toHaveText(expected);
  await sort.selectOption("due");
  await expect(page.locator(".task-list .ui-drag-handle")).toHaveCount(0);
});

test("natural recurrence editor persists weekly monthly and completion end choices", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.tasks);
  await page
    .getByRole("button", { name: w.desk.newTask, exact: true })
    .first()
    .click();
  const editor = page.locator(".task-editor-surface");
  await editor
    .getByLabel(w.work.title, { exact: true })
    .fill("Natural monthly series");
  await editor
    .getByRole("button", {
      name: zh ? "+ 更多设置" : "+ More settings",
      exact: true,
    })
    .click();
  await editor.locator(".task-advanced > summary").click();
  const repeat = editor.locator(".repeat-fields");
  await repeat
    .getByLabel(zh ? "重复" : "Repeat", { exact: true })
    .selectOption("WEEKLY");
  await repeat.getByLabel(zh ? "星期一" : "Monday", { exact: true }).check();
  await repeat.getByLabel(zh ? "星期五" : "Friday", { exact: true }).check();
  await expect(
    repeat.getByRole("button", { name: zh ? "时区" : "Timezone", exact: true }),
  ).toBeHidden();
  await repeat
    .getByLabel(zh ? "结束" : "Ends", { exact: true })
    .selectOption("COUNT");
  await repeat
    .getByLabel(zh ? "完成次数" : "Completion count", { exact: true })
    .fill("3");
  await expect(
    repeat.getByRole("button", {
      name: zh ? "结束日期" : "End date",
      exact: true,
    }),
  ).toHaveCount(0);
  await repeat
    .getByLabel(zh ? "重复" : "Repeat", { exact: true })
    .selectOption("MONTHLY");
  await expect(
    repeat.getByRole("checkbox", {
      name: zh ? "星期一" : "Monday",
      exact: true,
    }),
  ).toHaveCount(0);
  await repeat
    .getByLabel(zh ? "每月安排" : "Monthly schedule", { exact: true })
    .selectOption("ORDINAL_WEEKDAY");
  await repeat
    .getByLabel(zh ? "第几个" : "Ordinal", { exact: true })
    .selectOption("2");
  await repeat
    .getByLabel(zh ? "星期" : "Weekday", { exact: true })
    .selectOption("1");
  await expect(repeat.locator(".recurrence-rule-summary")).toContainText(
    zh ? "完成 3 次后结束" : "3 completions",
  );
  await page.screenshot({
    path: info.outputPath("natural-recurrence-editor.png"),
    fullPage: true,
  });
  await editor
    .getByRole("button", { name: w.common.create, exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await expect
    .poll(
      async () => {
        const synced = await (
          await page.request.get(workbench.url + "/api/snapshot")
        ).json();
        return synced.workflows.find(
          (entry: { payload: { title?: string } }) =>
            entry.payload.title === "Natural monthly series",
        )?.payload;
      },
      {
        message:
          "locally saved recurrence definition is replayed with its complete original rule",
      },
    )
    .toMatchObject({
      frequency: "MONTHLY",
      monthlyRule: { kind: "ORDINAL_WEEKDAY", ordinal: 2, weekday: 1 },
      endAfterCompleted: 3,
      endDate: null,
    });
  const snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  const definition = snapshot.workflows.find(
    (entry: { payload: { title?: string } }) =>
      entry.payload.title === "Natural monthly series",
  );
  expect(definition.payload).toMatchObject({
    frequency: "MONTHLY",
    monthlyRule: { kind: "ORDINAL_WEEKDAY", ordinal: 2, weekday: 1 },
    endAfterCompleted: 3,
    endDate: null,
  });
  expect(definition.payload).not.toHaveProperty("weekdays");
});

test("quick task create keeps advanced fields unmounted and full editor has stable shared actions", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.tasks);
  await page
    .getByRole("button", { name: w.desk.newTask, exact: true })
    .first()
    .click();
  const editor = page.locator(".task-editor-surface");
  await expect(editor).toHaveClass(/task-quick-create/);
  await expect(editor.locator("textarea, .task-advanced")).toHaveCount(0);
  await expect(
    editor.getByLabel(w.desk.activationPolicy, { exact: true }),
  ).toHaveCount(0);
  await editor.getByLabel(w.work.title, { exact: true }).fill("Concise draft");
  const more = editor.getByRole("button", {
    name: zh ? "+ 更多设置" : "+ More settings",
    exact: true,
  });
  await more.click();
  await expect(
    editor.getByRole("region", {
      name: zh ? "工作关系" : "Work relationships",
      exact: true,
    }),
  ).toBeVisible();
  await editor
    .getByRole("button", {
      name: zh ? "收起更多设置" : "Hide extra settings",
      exact: true,
    })
    .click();
  await expect(editor.locator(".task-advanced")).toHaveCount(0);
  await expect(editor.getByLabel(w.work.title, { exact: true })).toHaveValue(
    "Concise draft",
  );
  await editor
    .getByRole("button", {
      name: zh ? "+ 添加描述" : "+ Add description",
      exact: true,
    })
    .click();
  await editor
    .getByLabel(w.work.description, { exact: true })
    .fill("Original Markdown\nSecond line");
  await editor
    .locator(".ui-editor-body")
    .evaluate((element) => (element.scrollTop = element.scrollHeight));
  await expect(editor.locator(".ui-editor-footer")).toBeInViewport();
  await expect(
    editor.locator(".ui-editor-footer .ui-button-primary"),
  ).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath("quick-task-create.png"),
    fullPage: true,
  });
  await editor
    .getByRole("button", { name: w.common.create, exact: true })
    .click();
  await expect(editor).toBeHidden();
  await page
    .locator(".task-card")
    .filter({ hasText: "Concise draft" })
    .locator(".task-title")
    .press("Enter");
  await expect(editor).toHaveClass(/task-full-editor/);
  for (const label of zh
    ? ["任务是什么", "属于哪里", "什么时候", "工作关系"]
    : ["What is the task?", "Where it belongs", "When", "Work relationships"])
    await expect(
      editor.getByRole("region", { name: label, exact: true }),
    ).toBeVisible();
  await expect(
    editor.getByLabel(w.work.description, { exact: true }),
  ).toHaveValue("Original Markdown\nSecond line");
  await expect(
    editor
      .locator(".ui-editor-footer")
      .getByRole("button", { name: w.common.delete, exact: true }),
  ).toHaveCount(0);
  await editor
    .getByRole("button", {
      name: zh ? "更多操作" : "More actions",
      exact: true,
    })
    .click();
  await expect(
    editor.getByRole("menuitem", { name: w.common.delete, exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editor).toBeVisible();
  await editor
    .getByRole("button", { name: w.common.close, exact: true })
    .click();
  await expect(editor).toBeHidden();
});

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
  await openTask.press("Enter");
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
  await taskMenu(page, "Edited 中文 task");
  await page.getByLabel("Status for Edited 中文 task").selectOption("DONE");
  await expect(page.getByLabel("Status for Edited 中文 task")).toHaveCount(0);
  await page.getByLabel("Status", { exact: true }).selectOption("DONE");
  await taskMenu(page, "Edited 中文 task");
  await expect(page.getByLabel("Status for Edited 中文 task")).toHaveValue(
    "DONE",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Open task: Edited 中文 task", exact: true })
    .press("Enter");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "More actions", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Move to trash", exact: true })
    .click();
  await nav(page, "Trash");
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await nav(page, "Tasks");
  await page.reload();
  await expect(
    page.locator(".task-card").filter({ hasText: "Edited 中文 task" }),
  ).toHaveCount(0);
  await page.getByLabel("Status", { exact: true }).selectOption("DONE");
  await taskMenu(page, "Edited 中文 task");
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
  await taskMenu(page, "Dependent B");
  await statusB.selectOption("IN_PROGRESS");
  await expect(page.getByRole("alert")).toContainText(
    w.errors.WORK_ITEM_BLOCKED,
  );
  await nav(page, w.desk.dependencies);
  await page
    .getByRole("button", { name: w.work.prerequisite, exact: true })
    .click();
  await page
    .locator(".hierarchy-browser")
    .getByRole("button", { name: /^Dependent B(?:\s|$)/ })
    .click();
  await page
    .getByRole("button", { name: w.work.dependent, exact: true })
    .click();
  await page
    .locator(".hierarchy-browser")
    .getByRole("button", { name: /^Prerequisite A(?:\s|$)/ })
    .click();
  await page
    .getByRole("button", { name: w.work.addDependency, exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    w.errors.WORK_GRAPH_CYCLE_DETECTED,
  );
  await nav(page, w.desk.tasks);
  await taskMenu(page, "Prerequisite A");
  await page
    .getByLabel(w.common.statusLabel.replace("{{title}}", "Prerequisite A"))
    .selectOption("DONE");
  await taskMenu(page, "Dependent B");
  await statusB.selectOption("IN_PROGRESS");
  await expect(statusB).toHaveValue("IN_PROGRESS");
  await page.getByLabel(w.desk.priority, { exact: true }).selectOption("HIGH");
  await expect(page.locator("article.task-card")).toHaveCount(0);
  await page.getByLabel(w.desk.status, { exact: true }).selectOption("ALL");
  await taskScope(page, w.desk.taskWorkspace.all);
  await expect(page.locator("article.task-card")).toHaveCount(1);
  await page.getByLabel(w.desk.priority, { exact: true }).selectOption("ALL");
  await page.getByRole("textbox", { name: w.desk.search }).fill("Dependent");
  await expect(page.locator("article.task-card")).toHaveCount(1);
  await nav(page, w.desk.board);
  await taskScope(page, w.desk.taskWorkspace.all);
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
        { sourcePosition: { x: 8, y: 8 }, targetPosition: { x: 12, y: 12 } },
      );
  } else {
    await taskMenu(page, "Dependent B");
    await page
      .getByLabel(w.common.statusLabel.replace("{{title}}", "Dependent B"))
      .selectOption("DONE");
    await page.keyboard.press("Escape");
  }
  await taskMenu(page, "Dependent B");
  await expect(
    page.getByLabel(w.common.statusLabel.replace("{{title}}", "Dependent B")),
  ).toHaveValue("DONE");
});

test("v3 More sheet destinations and reorder handles fit narrow screens and large text", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator(".mobile-navigation-toggle").click();
    const sheet = page.locator(".mobile-more-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.locator(".ui-drag-handle").first()).toHaveCSS(
      "opacity",
      "1",
    );
    await expect(sheet.locator(".ui-drag-handle").first()).toBeVisible();
    for (const large of [false, true]) {
      await sheet.evaluate((node, large) => {
        node.style.fontSize = large ? "24px" : "16px";
      }, large);
      const rows = await sheet
        .locator(".ui-sortable-row")
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const row = node.getBoundingClientRect();
            const main = node
              .querySelector(".mobile-more-destination")!
              .getBoundingClientRect();
            const handle = node
              .querySelector(".ui-drag-handle")
              ?.getBoundingClientRect();
            return {
              row: row.width,
              main: main.width,
              height: main.height,
              handle: handle?.width ?? 0,
              overflow: node.scrollWidth > node.clientWidth,
            };
          }),
        );
      expect(rows.length).toBeGreaterThan(5);
      for (const row of rows) {
        expect(row.main).toBeGreaterThan(row.row * 0.65);
        expect(row.height).toBeGreaterThanOrEqual(48);
        expect(Math.abs(row.main + row.handle - row.row)).toBeLessThan(2);
        expect(row.overflow).toBe(false);
        if (row.handle) expect(row.handle).toBe(48);
      }
    }
    await page.emulateMedia({
      reducedMotion: "reduce",
      forcedColors: "active",
    });
    await expect(sheet).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`more-${width}.png`),
      fullPage: true,
    });
    await page.emulateMedia({
      reducedMotion: "no-preference",
      forcedColors: "none",
    });
    await page.keyboard.press("Escape");
  }
});

test("notes explorer compact columns and four view sizes preserve opening and selection", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  for (let index = 0; index < 8; index++)
    await mutation(page, "/api/note/save", {
      id: null,
      version: 0,
      input: {
        title:
          index === 0
            ? "Lee–Yang theorem"
            : `Research ${index} · 中文长标题与 English research`,
        kind: "NOTE",
        day: null,
        bodyMd: "Original $E=mc^2$ content",
      },
    });
  await page.reload();
  await nav(page, w.desk.notes);
  const rows = page.locator(".selectable-note");
  await expect(rows).toHaveCount(8);
  await page.screenshot({
    path: info.outputPath("notes-list.png"),
    fullPage: true,
  });
  const boxes = await rows.evaluateAll((nodes) =>
    nodes.map((node) => {
      const row = node.getBoundingClientRect();
      const title = node.querySelector("h3")!.getBoundingClientRect();
      return { height: row.height, titleX: title.x };
    }),
  );
  for (const box of boxes) {
    expect(box.height).toBeLessThanOrEqual(
      info.project.name.startsWith("mobile") ? 52 : 44,
    );
    expect(box.titleX).toBe(boxes[0]!.titleX);
  }
  await enterSelectionMode(page, w.desk.selectionMode);
  const layout = page.getByLabel(/^(View layout|显示方式)$/);
  for (const mode of ["small", "medium", "large", "list"]) {
    await layout.selectOption(mode);
    await expect(page.locator(".note-browser")).toHaveAttribute(
      "data-layout",
      mode,
    );
    const row = rows.filter({ hasText: "Lee–Yang theorem" });
    await row.locator('input[type="checkbox"]').check();
    await expect(page.locator(".document-pane")).toHaveCount(0);
    await row
      .getByRole("heading", { name: "Lee–Yang theorem", exact: true })
      .click();
    await expect(
      pane(page).getByLabel(w.desk.noteTitle, { exact: true }),
    ).toHaveValue("Lee–Yang theorem");
    await expect(page.locator(".entity-inspector")).toHaveCount(0);
    await nav(page, w.desk.notes);
    await expect(layout).toHaveValue(mode);
    await page.screenshot({
      path: info.outputPath(`notes-${mode}.png`),
      fullPage: true,
    });
  }
  await layout.selectOption("medium");
  await page.reload();
  await expect(layout).toHaveValue("medium");
  await layout.selectOption("list");
  await page.locator(".note-card").first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".note-card").nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.locator(".note-card").last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.locator(".note-card").first()).toBeFocused();
});

test("journal explorer year month week day folding preserves dates and search", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const days = [
    "2025-12-28",
    "2025-12-29",
    "2026-01-04",
    "2026-01-05",
    "2026-10-19",
    "2026-10-20",
  ];
  for (const day of days)
    await mutation(page, "/api/note/save", {
      id: null,
      version: 0,
      input: {
        title: day,
        kind: "JOURNAL",
        day,
        bodyMd: `Journal original ${day}`,
      },
    });
  await page.reload();
  await nav(page, w.desk.journal);
  const grouping = page.getByLabel(/^(Group journals by|日记分组)$/);
  const groups = page.locator(".journal-group");
  await expect(grouping).toHaveValue("month");
  await expect(groups).toHaveCount(3);
  await enterSelectionMode(page, w.desk.selectionMode);
  for (const [mode, count] of [
    ["year", 2],
    ["month", 3],
    ["week", 4],
    ["day", 6],
  ] as const) {
    await grouping.selectOption(mode);
    await expect(groups).toHaveCount(count);
    if (mode === "week") {
      const crossYear = groups.filter({
        has: page.locator('h3[title="2025-12-29"]'),
      });
      await expect(crossYear.locator("h3")).toHaveText([
        "2026-01-04",
        "2025-12-29",
      ]);
    }
    const heading = groups.first().locator(".journal-group-toggle");
    await groups.first().locator('input[type="checkbox"]').first().check();
    await heading.press("Enter");
    await expect(heading).toHaveAttribute("aria-expanded", "false");
    await expect(groups.first().locator(".note-card")).toHaveCount(0);
    await heading.press("Space");
    await expect(heading).toHaveAttribute("aria-expanded", "true");
    await expect(
      groups.first().locator('input[type="checkbox"]').first(),
    ).not.toBeChecked();
    await page
      .getByRole("button", { name: /^(Collapse all|全部收起)$/ })
      .click();
    await expect(page.locator(".note-card")).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath(`journal-${mode}-collapsed.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: /^(Expand all|全部展开)$/ }).click();
    await expect(page.locator(".note-card")).toHaveCount(6);
  }
  await grouping.selectOption("week");
  await page.getByRole("button", { name: /^(Collapse all|全部收起)$/ }).click();
  const search = page.locator(".page-header input").first();
  await search.fill("2025-12-29");
  await expect(page.locator(".note-card")).toHaveCount(1);
  await expect(page.locator(".note-card")).toContainText("2025-12-29");
  await search.fill("");
  await expect(page.locator(".note-card")).toHaveCount(0);
  await page.getByRole("button", { name: /^(Expand all|全部展开)$/ }).click();
  await page.getByLabel(/^(View layout|显示方式)$/).selectOption("small");
  await page.reload();
  await expect(grouping).toHaveValue("week");
  await expect(page.getByLabel(/^(View layout|显示方式)$/)).toHaveValue(
    "small",
  );
  await expect(groups).toHaveCount(4);
  await page
    .locator(".note-card")
    .filter({ hasText: "2025-12-29" })
    .press("Enter");
  await expect(
    pane(page).getByRole("textbox", {
      name: /^(Journal title|日记标题)$/,
      exact: true,
    }),
  ).toHaveValue("2025-12-29");
  await expect(pane(page)).toContainText("Journal original 2025-12-29");
  await nav(page, w.desk.journal);
  await page.getByLabel(/^(View layout|显示方式)$/).selectOption("list");
  await grouping.selectOption("month");
  await page.screenshot({
    path: info.outputPath("journal-month-expanded.png"),
    fullPage: true,
  });
  await grouping.selectOption("none");
  await expect(groups).toHaveCount(0);
  await expect(page.locator(".note-card")).toHaveCount(6);
  const snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    snapshot.notes.map((note: { day: string }) => note.day).sort(),
  ).toEqual([...days].sort());
  for (const note of snapshot.notes) {
    expect(note.version).toBe(1);
    expect(note.bodyMd).toBe(`Journal original ${note.day}`);
  }
});

test("notes explorer responsive icon alignment dark mode and enlarged text", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  for (const title of [
    "Short",
    "长标题与 English research " + "verylongfilename".repeat(12),
  ])
    await mutation(page, "/api/note/save", {
      id: null,
      version: 0,
      input: { title, kind: "NOTE", day: null, bodyMd: "Original" },
    });
  await page.reload();
  await nav(page, w.desk.notes);
  const layout = page.getByLabel(/^(View layout|显示方式)$/);
  for (const width of [360, 390, 430, 900, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const mode of ["list", "small", "medium", "large"]) {
      await layout.selectOption(mode);
      await page.evaluate(
        (dark) => {
          document.documentElement.dataset.theme = dark ? "dark" : "light";
        },
        width === 390 || width === 1440,
      );
      const bounds = await page
        .locator(".note-browser")
        .evaluate((element) => ({
          width: element.clientWidth,
          content: element.scrollWidth,
          rows: [...element.querySelectorAll(".selectable-note")].map((row) => {
            const rect = row.getBoundingClientRect();
            const icon = row
              .querySelector(".note-file-icon")!
              .getBoundingClientRect();
            return {
              x: rect.x,
              right: rect.right,
              iconY: icon.y - rect.y,
              iconWidth: icon.width,
            };
          }),
        }));
      expect(bounds.content).toBeLessThanOrEqual(bounds.width + 1);
      for (const row of bounds.rows) {
        expect(row.x).toBeGreaterThanOrEqual(0);
        expect(row.right).toBeLessThanOrEqual(width);
        expect(row.iconWidth).toBe(
          mode === "large"
            ? 64
            : mode === "medium"
              ? 44
              : mode === "small"
                ? 24
                : 18,
        );
      }
      expect(bounds.rows[0]!.iconY).toBe(bounds.rows[1]!.iconY);
      if (mode === "list" || mode === "large")
        await page.screenshot({
          path: info.outputPath(`notes-responsive-${width}-${mode}.png`),
          fullPage: true,
        });
    }
  }
  await page.setViewportSize({ width: 360, height: 900 });
  await layout.selectOption("list");
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.addStyleTag({
    content:
      ".note-browser h3, .note-browser label, .note-browser select { font-size: 20px; }",
  });
  await expect(page.locator(".note-card")).toHaveCount(2);
  expect(
    await page
      .locator(".note-browser")
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("notes-enlarged-forced-colors.png"),
    fullPage: true,
  });
});

test("v3 upgrade notes open on one click with independent selection and details", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  for (const title of ["Single click research", "Another research note"])
    await mutation(page, "/api/note/save", {
      id: null,
      version: 0,
      input: {
        title,
        kind: "NOTE",
        day: null,
        bodyMd: "Original $E=mc^2$ content",
      },
    });
  await page.reload();
  await nav(page, w.desk.notes);
  await enterSelectionMode(page, w.desk.selectionMode);
  const row = page
    .locator(".note-card")
    .filter({ hasText: "Single click research" });
  // The checkbox belongs to the list, not the document-open surface.
  await row.locator("..").locator('input[type="checkbox"]').check();
  await expect(page.locator(".document-pane")).toHaveCount(0);
  await row
    .getByRole("heading", { name: "Single click research", exact: true })
    .click();
  await expect(
    pane(page).getByLabel(w.desk.noteTitle, { exact: true }),
  ).toHaveValue("Single click research");
  await expect(page.locator(".entity-inspector")).toHaveCount(0);
  await documentMode(page, w.desk.read);
  const shortBody = pane(page).locator(".document-reading > .markdown");
  await expect(shortBody.locator(".katex")).toBeVisible();
  expect((await shortBody.boundingBox())!.height).toBeLessThan(150);
  await page.screenshot({
    path: info.outputPath("short-document-reading.png"),
    fullPage: true,
  });
  await nav(page, w.desk.notes);
  await row.focus();
  await row.press("Space");
  await expect(
    pane(page).getByLabel(w.desk.noteTitle, { exact: true }),
  ).toHaveValue("Single click research");
  await nav(page, w.desk.notes);
  const bounds = await row.boundingBox();
  expect(bounds!.height).toBeLessThan(120);
  await page.screenshot({
    path: info.outputPath("dense-notes.png"),
    fullPage: true,
  });
  await row.getByRole("button", { name: /More actions|更多操作/ }).click();
  await page
    .getByRole("menuitem", { name: /Inspect details|检查详情/, exact: true })
    .click();
  await expect(page.locator(".entity-inspector")).toBeVisible();
});

test("v3 upgrade legacy asset survives replica bootstrap and note reopen", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXs8AAAAASUVORK5CYII=";
  const raster = await page.evaluate(async (png) => {
    const source = new Image();
    source.src = `data:image/png;base64,${png}`;
    await source.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext("2d")!;
    const gradient = context.createLinearGradient(0, 0, 640, 480);
    gradient.addColorStop(0, "#1e1b4b");
    gradient.addColorStop(1, "#c7d2fe");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 640, 480);
    for (let index = 0; index < 40; index += 1) {
      context.fillStyle = `rgb(${index % 255},${(index * 7) % 255},${(index * 13) % 255})`;
      context.fillRect((index * 37) % 640, (index * 53) % 480, 18, 18);
    }
    return ["image/png", "image/jpeg", "image/webp"].map((mime) => ({
      mime,
      base64: canvas.toDataURL(mime, 0.8).split(",")[1]!,
    }));
  }, png);
  const byteRequests: string[] = [];
  const metaRequests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/api/library/asset/meta?")) metaRequests.push(url);
    else if (url.includes("/api/library/asset?")) byteRequests.push(url);
  });
  const references: string[] = [];
  for (const image of raster) {
    const asset = await mutation(page, "/api/library/upload", {
      spaceId: null,
      name: "legacy-image",
      ...image,
    });
    references.push(`![Original ${image.mime}](${asset.url})`);
  }
  const markdown = `# Legacy scientific note

Long-form research context that survives the v3 replica upgrade. The reading column stays calm while three original images revalidate.

- Preserve original bytes
- Keep the formula and table readable
- Keep Markdown source intact

$Z=0$

${references.join("\n\n")}`;
  await mutation(page, "/api/note/save", {
    id: null,
    version: 0,
    input: {
      title: "Legacy scientific note",
      kind: "NOTE",
      day: null,
      bodyMd: markdown,
    },
  });
  await prepareOfflineShell(page);
  for (let restart = 0; restart < 3; restart++) {
    if (restart === 2) await page.context().setOffline(true);
    const byteStart = byteRequests.length;
    const metaStart = metaRequests.length;
    await page.reload();
    await nav(page, w.desk.notes);
    await page
      .locator(".note-card")
      .filter({ hasText: "Legacy scientific note" })
      .click();
    await documentMode(page, w.desk.read);
    const images = pane(page).locator(".document-reading img");
    await expect(images).toHaveCount(3);
    for (const image of await images.all())
      await expect(image).toHaveJSProperty("naturalWidth", 640);
    const bytes = byteRequests.length - byteStart;
    const metas = metaRequests.length - metaStart;
    if (restart === 0) {
      // First authorized open has no local copy yet.
      expect(bytes).toBe(3);
      expect(metas).toBe(0);
    } else if (restart === 1) {
      // Online reopen revalidates the authorized cache instead of transferring bytes.
      expect(bytes).toBe(0);
      expect(metas).toBe(3);
    } else {
      // Offline reopen uses the derived cache without touching the network.
      expect(bytes).toBe(0);
      expect(metas).toBe(0);
    }
    await expect(pane(page).locator(".document-reading .katex")).toBeVisible();
    if (restart === 0)
      await page.screenshot({
        path: info.outputPath("legacy-image-reading.png"),
        fullPage: true,
      });
    await documentMode(page, /^(Source|源码)$/);
    await expect(
      pane(page).getByLabel(w.desk.noteBody, { exact: true }),
    ).toHaveText(markdown, { useInnerText: true });
  }
  await page.screenshot({
    path: info.outputPath("legacy-image-reopened.png"),
    fullPage: true,
  });
  await page.context().setOffline(false);
  await setTheme(page, "dark");
  await page.reload();
  await nav(page, w.desk.notes);
  await page
    .locator(".note-card")
    .filter({ hasText: "Legacy scientific note" })
    .click();
  await documentMode(page, w.desk.read);
  await expect(pane(page).locator(".document-reading img")).toHaveCount(3);
  await page.screenshot({
    path: info.outputPath("legacy-image-reading-dark.png"),
    fullPage: true,
  });
});

test("notes, safe reading, revision restore, journal and export", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.notes);
  await page.locator(".page-header .compact-create").click();
  await page
    .getByLabel(w.desk.noteTitle, { exact: true })
    .fill("Original note");
  const text =
    "# 原文\nFirst line\n第二行\n\n<script>window.hacked=true</script>\n- [ ] Preserve this";
  await page.getByLabel(w.desk.noteBody, { exact: true }).fill(text);
  await documentMode(page, w.desk.read);
  await expect(pane(page).locator(".document-reading .markdown")).toContainText(
    "<script>window.hacked=true</script>",
  );
  const lineParagraph = pane(page)
    .locator(".document-reading .markdown p")
    .filter({ hasText: "First line" });
  await expect(lineParagraph.locator("br")).toHaveCount(1);
  expect(
    await lineParagraph.evaluate((element) => {
      const nodes = [...element.childNodes].filter(
        (node) =>
          node.nodeType === Node.TEXT_NODE && !!node.textContent?.trim(),
      );
      const bounds = nodes.map((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getBoundingClientRect().top;
      });
      return (bounds[1] ?? NaN) > (bounds[0] ?? NaN);
    }),
  ).toBe(true);
  expect(
    await page.evaluate(() => Reflect.get(window, "hacked")),
  ).toBeUndefined();
  await saveDocument(page, w);
  await page.reload();
  await page
    .locator(".note-card, .library-document-row, .space-card")
    .press("Enter");
  await documentMode(page, /^(Source|源码)$/);
  await expect(
    pane(page).getByLabel(w.desk.noteBody, { exact: true }),
  ).toHaveText(text, { useInnerText: true });
  await page
    .getByLabel(w.desk.noteBody, { exact: true })
    .fill("Second revision");
  await saveDocument(page, w);
  await documentAction(page, w.desk.revisions);
  await expect(pane(page).locator(".document-tools > button")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
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
  await documentAction(page, w.desk.exportMarkdown, true);
  expect((await download).suggestedFilename()).toBe("Original note.md");
  const deleted = page.waitForResponse(
    (response) =>
      /\/api\/(?:v1\/)?note\/delete$/.test(response.url()) &&
      response.request().method() === "POST",
  );
  await documentAction(page, w.common.delete);
  expect((await deleted).status()).toBe(200);
  await expect(pane(page)).toHaveCount(0);
  await nav(page, w.desk.trash);
  await page
    .getByRole("button", { name: w.common.restore, exact: true })
    .click();
  await nav(page, w.desk.journal);
  await page.locator(".page-header .compact-create").click();
  await page
    .getByLabel(w.desk.noteBody, { exact: true })
    .fill("Today's reflection");
  await saveDocument(page, w);
  await browseDocuments(page);
  await page.locator(".page-header .compact-create").click();
  await expect(
    pane(page).getByLabel(w.desk.noteBody, { exact: true }),
  ).toHaveText("Today's reflection");
  await browseDocuments(page);
  await expect(
    page.locator(".note-card, .library-document-row, .space-card"),
  ).toHaveCount(1);
});

test("v2.3 Library searches bodies on the host and retains hierarchy query and selection", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const space = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "SPACE",
      spaceId: null,
      title: "Search collection",
      bodyMd: "",
    },
  });
  for (const [title, bodyMd] of [
    ["Opaque result", "A body-only needlephrase match"],
    ["Other page", "Unrelated prose"],
  ]) {
    await mutation(page, "/api/library/save", {
      id: null,
      version: 0,
      input: { kind: "DOCUMENT", spaceId: space.id, title, bodyMd },
    });
  }
  await page.reload();
  await nav(page, w.spaces.library);
  const row = page
    .locator(".space-card")
    .filter({ hasText: "Search collection" });
  await row.click();
  // Spaces open on a single click; selection is not an inspector state.
  await expect(page.locator(".library-document-row")).toHaveCount(2);
  await page.keyboard.press("Escape");
  const results = page.waitForResponse(
    (response) =>
      response.url().includes("/api/library/search?") &&
      response.status() === 200,
  );
  await page.locator(".library-view .field input").fill("needlephrase");
  const payload = await (await results).json();
  expect(payload).toHaveLength(1);
  expect(payload[0]).not.toHaveProperty("bodyMd");
  await expect(page.locator(".library-document-row")).toHaveCount(1);
  const document = page
    .locator(".library-document-row")
    .filter({ hasText: "Opaque result" });
  await document.click();
  // Documents also open on a single click.
  await expect(pane(page).getByLabel(w.spaces.body)).toContainText(
    "needlephrase",
  );
  await browseDocuments(page);
  await expect(page.locator(".library-view .field input")).toHaveValue(
    "needlephrase",
  );
  await expect(page.locator(".library-document-row")).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath("library-hierarchy-search.png"),
    fullPage: true,
  });
});

test("v2.3 closing a document flushes latest text and retains an offline draft", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.notes);
  await page.locator(".page-header .compact-create").click();
  await pane(page).getByLabel(w.desk.noteTitle).fill("Close flush note");
  const closeFlushBody = pane(page).getByLabel(w.desk.noteBody);
  // Trace from the mobile failure showed Playwright fill inserting the new text
  // before the existing CodeMirror lines. Drive the real editor input contract
  // deterministically instead of treating that harness artifact as draft merging.
  const replaceCloseFlushBody = async (text: string) => {
    await closeFlushBody.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.insertText(text);
  };
  await replaceCloseFlushBody("Close before debounce\nSecond line");
  await page
    .locator(".document-tab")
    .getByRole("button", { name: /^(Close|关闭) / })
    .click();
  await expect(pane(page)).toHaveCount(0);
  await waitForLocalReplay(page);
  const saved = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    saved.notes.find(
      (note: { title: string }) => note.title === "Close flush note",
    ).bodyMd,
  ).toBe("Close before debounce\nSecond line");
  await page
    .locator(".note-card, .library-document-row, .space-card")
    .filter({ hasText: "Close flush note" })
    .press("Enter");
  await setLocalCommandFailure(page, true);
  await replaceCloseFlushBody("Offline final text");
  await page
    .locator(".document-tab")
    .getByRole("button", { name: /^(Close|关闭) / })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: /^(确认操作|Confirm action)$/,
  });
  await expect(confirmation).toContainText(
    /本地草稿已保留|local draft is retained/,
  );
  await confirmation.getByRole("button", { name: /^(确认|Confirm)$/ }).click();
  await expect(pane(page)).toHaveCount(0);
  await page
    .locator(".note-card, .library-document-row, .space-card")
    .filter({ hasText: "Close flush note" })
    .press("Enter");
  await expect(pane(page).getByLabel(w.desk.noteBody)).toHaveText(
    "Offline final text",
  );
  await setLocalCommandFailure(page, false);
  await saveDocument(page, w);
  await waitForLocalReplay(page);
  const restored = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    restored.notes.find(
      (note: { title: string }) => note.title === "Close flush note",
    ).bodyMd,
  ).toBe("Offline final text");
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
  await page.locator(".page-header .compact-create").click();
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
  await expect(page.locator(".document-pane:not([hidden])")).toHaveCount(0);
  await openCalendarJournal(page, w.desk.journal);
  await expect(
    pane(page).getByLabel(
      info.project.name.endsWith("zh") ? "日记标题" : "Journal title",
    ),
  ).not.toHaveValue("输入中的讲义");
  await page.waitForTimeout(1100);
  expect((await snapshot()).notes).toHaveLength(1);
  await body.fill("Today's unique journal");
  await body.press("Control+s");
  await expect.poll(async () => (await snapshot()).notes.length).toBe(2);
  await page.getByRole("tab", { name: "输入中的讲义", exact: true }).click();
  await expect(pane(page).locator(".md-live-widget table")).toBeVisible();
  await nav(page, w.desk.calendar);
  await page.locator(".calendar-day.is-today").click();
  await expect(page.locator(".document-pane:not([hidden])")).toHaveCount(0);
  await openCalendarJournal(page, w.desk.journal);
  await expect(body).toHaveText("Today's unique journal");
  expect(await page.getByRole("tab").count()).toBe(2);

  await documentAction(page, w.common.delete);
  await nav(page, w.desk.calendar);
  await page.locator(".calendar-day.is-today").click();
  await expect(page.locator(".document-pane:not([hidden])")).toHaveCount(0);
  await openCalendarJournal(page, w.desk.journal);
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
  const primary = page.locator(".page-header .compact-create");
  const contrast = await primary.evaluate((element) => {
    const style = getComputedStyle(element);
    const luminance = (color: string) => {
      const channels =
        color
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map((value) => {
            const channel = Number(value) / 255;
            return channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4;
          }) ?? [];
      return (
        (channels[0] ?? 0) * 0.2126 +
        (channels[1] ?? 0) * 0.7152 +
        (channels[2] ?? 0) * 0.0722
      );
    };
    const text = luminance(style.color),
      background = luminance(style.backgroundColor);
    return (
      (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05)
    );
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
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
    await expect(page.locator(".page-header h1")).toBeVisible();
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
  await page
    .locator(".note-card, .library-document-row, .space-card")
    .first()
    .press("Enter");
  await page.screenshot({
    path: info.outputPath("note-editor.png"),
    fullPage: true,
  });
  await setLocalCommandFailure(page, true);
  // Select through CodeMirror's keymap: DOM fill can race live decorations
  // and replace only the visible DOM selection on mobile.
  const draftBody = pane(page).getByLabel(w.desk.noteBody, { exact: true });
  await draftBody.press("ControlOrMeta+a");
  await page.keyboard.insertText("unsaved");
  await expect(draftBody).toHaveText("unsaved");
  await expect(pane(page).getByRole("alert")).toBeVisible();
  const confirmation5 = answerConfirmation(page, false);
  await page
    .locator(".document-tab")
    .getByRole("button", { name: /^(Close|关闭) / })
    .click();
  await confirmation5;
  await expect(
    pane(page).getByLabel(w.desk.noteBody, { exact: true }),
  ).toHaveText("unsaved");
  const confirmation6 = answerConfirmation(page, true);
  await page
    .locator(".document-tab")
    .getByRole("button", { name: /^(Close|关闭) / })
    .click();
  await confirmation6;
  await nav(page, w.desk.settings);
  await page.getByRole("button", { name: w.desk.lock, exact: true }).click();
  await page.goto(workbench.url + "/#account");
  await expect(page.getByLabel(w.spaces.username)).toBeVisible();
  await page.reload();
  await page.goto(workbench.url + "/#account");
  await expect(page.getByLabel(w.spaces.username)).toBeVisible();
});

test("project settings preserve brief and task fields; canvas saves Markdown with version protection", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const project = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Separate project",
    descriptionMd: "# Original brief",
    priority: "HIGH",
  });
  const child = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Nested child",
    parentProjectId: project.id,
  });
  await page.reload();
  await nav(page, w.desk.projects);
  await page
    .getByRole("button", { name: "Separate project", exact: true })
    .press("Enter");
  await projectAction(page, w.desk.projectSettings);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel(w.work.priority, { exact: true })).toHaveCount(
    0,
  );
  await expect(
    dialog.getByLabel(w.desk.activationPolicy, { exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByLabel(w.work.description, { exact: true }),
  ).toHaveCount(0);
  await expect(dialog.locator('option[value="' + child.id + '"]')).toHaveCount(
    0,
  );
  await expect(
    dialog.locator('option[value="' + project.id + '"]'),
  ).toHaveCount(0);
  await dialog
    .getByLabel(w.work.title, { exact: true })
    .fill("Renamed project");
  await dialog
    .getByRole("button", { name: w.common.save, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator(".project-workspace > .project-summary h1"),
  ).toHaveText("Renamed project");
  let snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    snapshot.items.find((p: { id: string }) => p.id === project.id),
  ).toMatchObject({ priority: "HIGH", descriptionMd: "# Original brief" });
  await page
    .getByRole("button", { name: w.desk.projectHub.edit, exact: true })
    .click();
  await page
    .getByRole("button", { name: w.desk.markdownSource, exact: true })
    .click();
  const brief = page.getByLabel(w.work.description, { exact: true });
  await brief.fill("# Preserved source\n\n- [ ] Not a task\n\n$E=mc^2$");
  await page.screenshot({
    path: info.outputPath("project-brief-source.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: w.common.save, exact: true }).click();
  await expect(brief).toHaveCount(0);
  await waitForLocalReplay(page);
  snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  const saved = snapshot.items.find((p: { id: string }) => p.id === project.id);
  expect(saved.descriptionMd).toBe(
    "# Preserved source\n\n- [ ] Not a task\n\n$E=mc^2$",
  );
  expect(
    snapshot.items.filter((p: { type: string }) => p.type === "TASK"),
  ).toHaveLength(0);
  await page
    .getByRole("button", { name: w.desk.projectHub.edit, exact: true })
    .click();
  await brief.fill("Local conflict draft");
  await mutation(page, "/api/work/update", {
    id: saved.id,
    version: saved.version,
    input: { title: "Remote rename" },
  });
  await expect(
    page.getByText(w.desk.briefVersionConflict, { exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await expect(brief).toHaveValue("Local conflict draft");
  await expect(
    page.getByRole("button", { name: w.common.save, exact: true }),
  ).toBeDisabled();
});

for (const legacy of [false, true])
  test(`local draft recovery (${legacy ? "legacy" : "stale"}) blocks autosave until explicit resolution`, async ({
    page,
    workbench,
  }, info) => {
    const w = words(info.project.name);
    await unlock(page, workbench.url, workbench.secret, w);
    const note = await mutation(page, "/api/note/save", {
      id: null,
      version: 0,
      input: {
        kind: "NOTE",
        title: "Remote authority",
        bodyMd: "Server text",
        day: null,
      },
    });
    const own = await activeReplicaIdentity(page);
    const key = JSON.stringify([
      workbench.url,
      own.workspaceId,
      own.principalId,
      note.id,
    ]);
    await page.evaluate(
      async ({ key, note, legacy }) => {
        await new Promise<void>((resolve, reject) => {
          const open = indexedDB.open("orivane-atlas-local", 1);
          open.onupgradeneeded = () => open.result.createObjectStore("drafts");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction("drafts", "readwrite");
            tx.objectStore("drafts").put(
              {
                title: note.title,
                body: "Stale local text",
                updatedAt: Date.now(),
                ...(legacy
                  ? {}
                  : {
                      entityId: note.id,
                      baseVersion: note.version - 1,
                      baseUpdatedAt: note.updatedAt,
                      savedAt: Date.now(),
                    }),
              },
              key,
            );
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        });
      },
      { key, note, legacy },
    );
    await page.reload();
    await nav(page, w.desk.notes);
    await page
      .locator(".note-card, .library-document-row, .space-card")
      .filter({ hasText: "Remote authority" })
      .press("Enter");
    await expect(pane(page).getByRole("alert")).toContainText(
      "VERSION_CONFLICT",
    );
    await expect(
      pane(page).getByLabel(w.desk.noteBody, { exact: true }),
    ).toHaveText("Stale local text");
    // Both the one-second autosave and an ordinary explicit save must stay blocked.
    await page.keyboard.press("Control+s");
    await page.waitForTimeout(1400);
    let snapshot = await (
      await page.request.get(workbench.url + "/api/snapshot")
    ).json();
    expect(
      snapshot.notes.find((entry: { id: string }) => entry.id === note.id),
    ).toMatchObject({ bodyMd: "Server text", version: note.version });
    await pane(page)
      .locator("details summary")
      .filter({ hasText: /Compare remote|对照远端/ })
      .click();
    await page.screenshot({
      path: info.outputPath("draft-recovery.png"),
      fullPage: true,
    });
    const confirmation7 = answerConfirmation(page, true);
    await pane(page)
      .getByRole("button", {
        name: /^(Confirm merge and save my draft|确认合并并保存我的草稿)$/,
      })
      .click();
    await confirmation7;
    await expect
      .poll(async () => {
        const s = await (
          await page.request.get(workbench.url + "/api/snapshot")
        ).json();
        return s.notes.find((entry: { id: string }) => entry.id === note.id)
          .bodyMd;
      })
      .toBe("Stale local text");
  });

test("equal membership scope counts shared work and canceled outcomes", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const root = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Scope root",
  });
  const child = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Scope child",
    parentProjectId: root.id,
  });
  await mutation(page, "/api/work/create", {
    title: "Root owned",
    projectIds: [root.id],
  });
  const canceled = await mutation(page, "/api/work/create", {
    title: "Child canceled",
    projectIds: [child.id],
  });
  await mutation(page, "/api/work/update", {
    id: canceled.id,
    version: canceled.version,
    input: { status: "CANCELED" },
  });
  await mutation(page, "/api/work/create", {
    title: "Reference only",
    projectIds: [root.id],
  });
  await page.reload();
  await nav(page, w.desk.projects);
  await page
    .getByRole("button", { name: "Scope root", exact: true })
    .press("Enter");
  await page
    .getByRole("tab", { name: w.desk.projectHub.tasks, exact: true })
    .click();
  const panel = page.getByRole("tabpanel");
  await taskScope(page, w.desk.taskWorkspace.all);
  await expect(panel).toContainText("Root owned");
  await expect(panel).toContainText("Child canceled");
  await expect(panel).toContainText("Reference only");
  const progress = page.getByTestId("project-progress");
  await expect(progress).toContainText(
    w.desk.projectProgress
      .replace("{{completed}}", "0")
      .replace("{{canceled}}", "1")
      .replace("{{unfinished}}", "2"),
  );
  await openProjectTaskFilters(page);
  await page
    .getByLabel(w.desk.projectScope, { exact: true })
    .selectOption("DIRECT");
  await expect(panel).not.toContainText("Child canceled");
  await expect(panel).toContainText("Root owned");
  await expect(panel).toContainText("Reference only");
  await expect(progress).toContainText(
    w.desk.projectProgress
      .replace("{{completed}}", "0")
      .replace("{{canceled}}", "0")
      .replace("{{unfinished}}", "2"),
  );
  await page.screenshot({
    path: info.outputPath("ownership-scope.png"),
    fullPage: true,
  });
});

test("Delta project milestone completion is explicit and offline reopen preserves descendants", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const project = await mutation(page, "/api/work/create", {
    title: "Delta milestone parent",
    type: "PROJECT",
  });
  const milestone = await mutation(page, "/api/work/create", {
    title: "Unreached milestone",
    type: "MILESTONE",
    parentProjectId: project.id,
  });
  await page.reload();
  await nav(page, w.desk.projects);
  await page
    .getByRole("button", { name: project.title, exact: true })
    .press("Enter");
  const settings = () =>
    projectAction(
      page,
      info.project.name.endsWith("zh")
        ? "更改项目状态"
        : "Change project status",
    );
  const dialog = page.getByRole("dialog");
  await page.route("**/api/**", (route) => route.abort("internetdisconnected"));
  await settings();
  await dialog
    .getByLabel(w.desk.projectLifecycle, { exact: true })
    .selectOption("COMPLETED");
  const resolution = dialog.getByRole("group", {
    name: w.desk.completionResolution.title,
  });
  await expect(resolution).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: w.common.save, exact: true }),
  ).toBeDisabled();
  await resolution.getByRole("combobox").selectOption("KEEP");
  await dialog
    .getByRole("button", { name: w.common.save, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".project-workspace")).toContainText(
    w.desk.projectLifecycles.COMPLETED,
  );
  await settings();
  await dialog
    .getByLabel(w.desk.projectLifecycle, { exact: true })
    .selectOption("ACTIVE");
  await dialog
    .getByRole("button", { name: w.common.save, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".project-workspace")).toContainText(
    w.desk.projectLifecycles.ACTIVE,
  );
  await page.unroute("**/api/**");
  await page.reload();
  await expect
    .poll(async () => {
      const snapshot = await (
        await page.request.get(workbench.url + "/api/snapshot")
      ).json();
      return snapshot.items.find(
        (item: { id: string }) => item.id === project.id,
      )?.lifecycle;
    })
    .toBe("ACTIVE");
  const snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    snapshot.items.find((item: { id: string }) => item.id === milestone.id),
  ).toEqual(milestone);
});

test("project lifecycle completion and explicit atomic reopen are usable", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const project = await mutation(page, "/api/work/create", {
    title: "Lifecycle project",
    type: "PROJECT",
  });
  const task = await mutation(page, "/api/work/create", {
    title: "Owned unfinished",
    projectIds: [project.id],
  });
  await page.reload();
  await nav(page, w.desk.projects);
  await page
    .getByRole("button", { name: "Lifecycle project", exact: true })
    .press("Enter");
  const settings = () =>
    projectAction(
      page,
      info.project.name.endsWith("zh")
        ? "更改项目状态"
        : "Change project status",
    );
  const dialog = page.getByRole("dialog");
  await settings();
  await dialog
    .getByLabel(w.desk.projectLifecycle, { exact: true })
    .selectOption("COMPLETED");
  await expect(
    dialog.getByRole("group", { name: w.desk.completionResolution.title }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: w.common.save, exact: true }),
  ).toBeDisabled();
  await dialog
    .getByLabel(w.desk.projectLifecycle, { exact: true })
    .selectOption("PAUSED");
  await dialog
    .getByRole("button", { name: w.common.save, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".project-workspace")).toContainText(
    w.desk.projectLifecycles.PAUSED,
  );
  await mutation(page, "/api/work/update", {
    id: task.id,
    version: task.version,
    input: { status: "CANCELED" },
  });
  await expect(page.getByTestId("project-progress")).toContainText(
    w.desk.projectProgress
      .replace("{{completed}}", "0")
      .replace("{{canceled}}", "1")
      .replace("{{unfinished}}", "0"),
    { timeout: 10000 },
  );
  await settings();
  await dialog
    .getByLabel(w.desk.projectLifecycle, { exact: true })
    .selectOption("COMPLETED");
  await dialog
    .getByRole("button", { name: w.common.save, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".project-workspace")).toContainText(
    w.desk.projectLifecycles.COMPLETED,
  );
  await page.getByRole("button", { name: w.desk.newTask, exact: true }).click();
  await dialog
    .getByLabel(w.work.title, { exact: true })
    .fill("After explicit reopen");
  await dialog
    .getByRole("button", { name: w.common.create, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".project-workspace")).toContainText(
    w.desk.projectLifecycles.COMPLETED,
  );
  await expect
    .poll(async () => {
      const snapshot = await (
        await page.request.get(workbench.url + "/api/snapshot")
      ).json();
      return snapshot.items.filter(
        (i: { title: string }) => i.title === "After explicit reopen",
      ).length;
    })
    .toBe(1);
});

test("project hierarchy and URL preserve scope tabs and browser history", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const root = await mutation(page, "/api/work/create", {
    title: "Navigation root",
    type: "PROJECT",
  });
  const child = await mutation(page, "/api/work/create", {
    title: "Navigation child",
    type: "PROJECT",
    parentProjectId: root.id,
  });
  await page.reload();
  await nav(page, w.desk.projects);
  await expect(
    page.getByRole("button", { name: "Navigation child", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: w.desk.expandProject.replace("{{title}}", "Navigation root"),
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Navigation child", exact: true })
    .press("Enter");
  await expect(page).toHaveURL(new RegExp("projects/" + child.id));
  await page
    .locator(".page-header")
    .getByRole("navigation")
    .getByRole("button", { name: "Navigation root", exact: true })
    .press("Enter");
  await page
    .getByRole("tab", { name: w.desk.projectHub.tasks, exact: true })
    .click();
  await openProjectTaskFilters(page);
  await page
    .getByLabel(w.desk.projectScope, { exact: true })
    .selectOption("DIRECT");
  await expect(page).toHaveURL(/tab=tasks&scope=DIRECT/);
  await page.reload();
  await expect(page.locator(".project-workspace h1")).toHaveText(
    "Navigation root",
  );
  await expect(
    page.getByRole("tab", { name: w.desk.projectHub.tasks, exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await openProjectTaskFilters(page);
  await expect(
    page.getByLabel(w.desk.projectScope, { exact: true }),
  ).toHaveValue("DIRECT");
  await page.goBack();
  await expect(
    page.getByLabel(w.desk.projectScope, { exact: true }),
  ).toHaveValue("SUBTREE");
  await page.goForward();
  await expect(
    page.getByLabel(w.desk.projectScope, { exact: true }),
  ).toHaveValue("DIRECT");
  await page.screenshot({
    path: info.outputPath("project-route.png"),
    fullPage: true,
  });
  await page
    .getByRole("tab", { name: w.desk.projectHub.overview, exact: true })
    .click();
  await page
    .getByRole("button", { name: w.desk.projectHub.edit, exact: true })
    .click();
  await page
    .getByRole("button", { name: w.desk.markdownSource, exact: true })
    .click();
  const brief = page.getByLabel(w.work.description, { exact: true });
  await brief.fill("Unsaved route draft");
  await page
    .getByRole("tab", { name: w.desk.projectHub.tasks, exact: true })
    .click();
  await page
    .getByRole("tab", { name: w.desk.projectHub.overview, exact: true })
    .click();
  await expect(brief).toHaveValue("Unsaved route draft");
  const accepted = page.url();
  const confirmation8 = answerConfirmation(page, false);
  await page.evaluate(() => {
    location.hash = "#projects";
  });
  await confirmation8;
  await expect(page).toHaveURL(accepted);
  await expect(brief).toHaveValue("Unsaved route draft");
});

test("inline prerequisites save atomically with availability and reject stale graph edits", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const source = await mutation(page, "/api/work/create", {
    title: "Prerequisite source",
  });
  const extra = await mutation(page, "/api/work/create", {
    title: "Concurrent source",
  });
  await mutation(page, "/api/work/create", {
    title: "Project excluded",
    type: "PROJECT",
  });
  await page.reload();
  await nav(page, w.desk.tasks);
  await page.locator(".page-header .compact-create").click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel(w.work.title, { exact: true })
    .fill("Inline dependent");
  await openTaskAdvanced(dialog);
  const prerequisites = dialog.getByRole("group", {
    name: w.work.prerequisites,
    exact: true,
  });
  await expect(
    prerequisites.getByRole("button", { name: "Project excluded" }),
  ).toHaveCount(0);
  await prerequisites
    .getByRole("button", { name: /Add prerequisite|添加前置任务/ })
    .click();
  await page
    .locator(".hierarchy-browser")
    .getByRole("button", { name: "Prerequisite source", exact: true })
    .click();
  await expect(prerequisites.locator("p")).toContainText(w.work.blocked);
  await page.keyboard.press("Escape");
  await dialog
    .getByRole("button", { name: w.common.create, exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await waitForLocalReplay(page);
  const read = async () =>
    (await page.request.get(workbench.url + "/api/snapshot")).json();
  const initial = await read();
  const task = initial.items.find(
    (item: { title: string }) => item.title === "Inline dependent",
  );
  expect(initial.edges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ fromId: source.id, toId: task.id }),
    ]),
  );
  const openTask = () =>
    page
      .getByRole("button", {
        name: w.common.openTask.replace("{{title}}", "Inline dependent"),
        exact: true,
      })
      .press("Enter");
  await openTask();
  await openTaskAdvanced(dialog);
  await expect(
    prerequisites.getByRole("button", {
      name: "Prerequisite source ×",
      exact: true,
    }),
  ).toBeVisible();
  await prerequisites
    .getByRole("button", { name: "Prerequisite source ×", exact: true })
    .click();
  await expect(prerequisites.locator("p")).toContainText(w.work.ready);
  await dialog
    .getByLabel(w.desk.activationState, { exact: true })
    .selectOption("INACTIVE");
  await expect(prerequisites.locator("p")).toContainText(w.work.paused);
  await dialog
    .getByLabel(w.desk.activationPolicy, { exact: true })
    .selectOption("AT_SCHEDULED_TIME");
  await chooseDate(
    page,
    dialog.getByLabel(w.desk.startDate, { exact: true }),
    "2099-01-01",
  );
  await expect(prerequisites.locator("p")).toContainText(w.work.waiting);
  await dialog
    .getByLabel(w.desk.activationPolicy, { exact: true })
    .selectOption("IMMEDIATE");
  await mutation(page, "/api/edge/create", { fromId: extra.id, toId: task.id });
  await dialog
    .getByRole("button", { name: w.common.save, exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    w.errors.VERSION_CONFLICT,
  );
  expect((await read()).edges).toHaveLength(2);
  await page.screenshot({
    path: info.outputPath("inline-prerequisites-conflict.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: w.common.close, exact: true })
    .click();
  await dialog
    .getByRole("button", { name: w.desk.discard, exact: true })
    .click();
  await page.reload();
  await openTask();
  await openTaskAdvanced(dialog);
  await prerequisites
    .getByRole("button", { name: "Concurrent source ×", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: w.common.save, exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await waitForLocalReplay(page);
  expect((await read()).edges).toHaveLength(1);
  const history = await (
    await page.request.get(workbench.url + "/api/activity")
  ).json();
  expect(history).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "WORK_EDGE_REMOVED",
        fromId: extra.id,
        toId: task.id,
      }),
    ]),
  );
});

test("workspace timezone appearance density and mobile navigation persist", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.settings);
  await page.screenshot({ path: info.outputPath("settings-navigation.png") });
  await page
    .locator(".settings-navigation")
    .getByRole("button", {
      name: info.project.name.endsWith("zh") ? "日历" : "Calendar",
      exact: true,
    })
    .click();
  await expect(
    page.locator('[data-settings-section="calendar"]'),
  ).toBeFocused();
  await page
    .getByLabel(w.desk.workspaceTimezone, { exact: true })
    .fill("Asia/Tokyo");
  await page
    .locator(".calendar-settings")
    .getByRole("button", { name: w.common.save, exact: true })
    .click();
  await expect(
    page.getByLabel(w.desk.workspaceTimezone, { exact: true }),
  ).toHaveValue("Asia/Tokyo");
  // The input already contains this value before the asynchronous save starts.
  // Confirm durable replay before testing that a reload preserves the setting.
  await expect
    .poll(
      async () =>
        (await (await page.request.get(workbench.url + "/api/snapshot")).json())
          .calendarTimezone,
    )
    .toBe("Asia/Tokyo");
  await page
    .getByLabel(w.desk.appearance, { exact: true })
    .selectOption("dark");
  await page
    .getByLabel(
      info.project.name.endsWith("zh") ? "界面密度" : "Interface density",
    )
    .selectOption("compact");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await page.emulateMedia({ media: "print" });
  expect(
    await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return ["--surface", "--accent"].map((name) =>
        style.getPropertyValue(name).trim(),
      );
    }),
  ).toEqual(["#fff", "#5a5bd6"]);
  await page.emulateMedia({ media: "screen" });
  await expect(
    page.getByLabel(w.desk.workspaceTimezone, { exact: true }),
  ).toHaveValue("Asia/Tokyo");
  await page
    .getByLabel(w.desk.workspaceTimezone, { exact: true })
    .fill("Invalid/Zone");
  await page
    .locator(".calendar-settings")
    .getByRole("button", { name: w.common.save, exact: true })
    .click();
  await expect(page.locator(".calendar-settings [role=alert]")).toHaveText(
    w.desk.invalidTimezone,
  );
  await page.screenshot({
    path: info.outputPath("settings-dark.png"),
    fullPage: true,
  });
  await nav(page, w.desk.tasks);
  await createTask(page, w, "Compact task row");
  if (info.project.name.startsWith("mobile")) {
    await expect(page.locator(".mobile-bottom-navigation")).toBeVisible();
    await page
      .locator(".mobile-bottom-navigation")
      .getByRole("button", { name: w.desk.projects, exact: true })
      .click();
    await expect(page).toHaveURL(/#projects/);
    await page
      .locator(".mobile-bottom-navigation")
      .getByRole("button", { name: w.desk.tasks, exact: true })
      .click();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("tasks-dark-compact.png"),
    fullPage: true,
  });
});

test("parent picker excludes descendants and dependency nodes open task inspector", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const root = await mutation(page, "/api/work/create", {
    title: "Tree root",
    type: "PROJECT",
  });
  const child = await mutation(page, "/api/work/create", {
    title: "Tree child",
    type: "PROJECT",
    parentProjectId: root.id,
  });
  const target = await mutation(page, "/api/work/create", {
    title: "Tree target",
    type: "PROJECT",
  });
  await mutation(page, "/api/work/create", {
    title: "Inspect task",
    projectIds: [root.id],
  });
  await page.goto(
    workbench.url + `/#projects/${root.id}?tab=overview&scope=SUBTREE`,
  );
  await projectAction(page, w.desk.projectSettings);
  const dialog = page.getByRole("dialog");
  const picker = dialog.locator(".hierarchy-picker");
  await picker.locator(".hierarchy-selected > button").last().click();
  const browser = page.locator(".hierarchy-browser");
  await expect(
    browser
      .locator("li")
      .filter({ hasText: "Tree root" })
      .locator(".ui-entity-picker-choice"),
  ).toBeDisabled();
  await browser
    .locator("li")
    .filter({ hasText: "Tree root" })
    .locator(".ui-icon-button")
    .click();
  await expect(
    browser
      .locator("li")
      .filter({ hasText: "Tree child" })
      .locator(".ui-entity-picker-choice"),
  ).toBeDisabled();
  await browser.locator("nav > button").click();
  await browser.getByRole("searchbox").fill("target");
  await browser
    .locator("li")
    .filter({ hasText: "Tree target" })
    .locator(".ui-entity-picker-choice")
    .click();
  await dialog
    .getByRole("button", { name: w.common.save, exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await waitForLocalReplay(page);
  const snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    snapshot.items.find((item: { id: string }) => item.id === root.id)
      .parentProjectId,
  ).toBe(target.id);
  expect(
    snapshot.items.find((item: { id: string }) => item.id === child.id)
      .parentProjectId,
  ).toBe(root.id);
  await page
    .getByRole("tab", { name: w.desk.projectHub.tasks, exact: true })
    .click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  expect(snapshot.edges).toHaveLength(0);
  await openProjectDependencyScope(
    page,
    "Inspect task",
    info.project.name.endsWith("zh"),
  );
  await page
    .locator(".react-flow__node")
    .filter({ hasText: "Inspect task" })
    .click();
  const inspector = page.getByRole("complementary", { name: w.desk.inspector });
  await expect(inspector).toContainText("Inspect task");
  await inspector
    .getByLabel(w.work.status, { exact: true })
    .selectOption("IN_PROGRESS");
  await expect(
    inspector.getByLabel(w.work.status, { exact: true }),
  ).toHaveValue("IN_PROGRESS");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("canvas-inspector.png"),
    fullPage: true,
  });
});

test("project sibling ordering persists independently from task membership", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const a = await mutation(page, "/api/work/create", {
    title: "Order root A",
    type: "PROJECT",
  });
  const b = await mutation(page, "/api/work/create", {
    title: "Order root B",
    type: "PROJECT",
  });
  const child = await mutation(page, "/api/work/create", {
    title: "Order child",
    type: "PROJECT",
    parentProjectId: a.id,
  });
  const task = await mutation(page, "/api/work/create", {
    title: "Order task",
    projectIds: [a.id, b.id],
  });
  await page.reload();
  await nav(page, w.desk.projects);
  const second = page.locator(
    `.project-tree-list [data-order-entity="${b.id}"]`,
  );
  await second.locator(".ui-drag-handle").focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect
    .poll(async () =>
      (
        await (await page.request.get(workbench.url + "/api/snapshot")).json()
      ).manualOrders
        .find(
          (order: { scope: { kind: string } }) =>
            order.scope.kind === "PROJECT_CHILDREN",
        )
        ?.entries.map((entry: { entityId: string }) => entry.entityId),
    )
    .toEqual([b.id, a.id]);
  await page.reload();
  await expect(
    page
      .locator(".project-tree-list")
      .first()
      .locator(":scope > .ui-sortable-row")
      .first(),
  ).toHaveAttribute("data-order-entity", b.id);
  const saved = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    saved.items.find((item: { id: string }) => item.id === child.id)
      .parentProjectId,
  ).toBe(a.id);
  expect(
    saved.items.find((item: { id: string }) => item.id === task.id).projectIds,
  ).toEqual([a.id, b.id]);
});

test("project body and category drops preserve cycle safety and task ownership", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const a = await mutation(page, "/api/work/create", {
    title: "Drop parent",
    type: "PROJECT",
  });
  const b = await mutation(page, "/api/work/create", {
    title: "Drop child",
    type: "PROJECT",
  });
  const task = await mutation(page, "/api/work/create", {
    title: "Drop task",
    projectIds: [b.id],
  });
  const category = await mutation(page, "/api/categories/save", {
    name: "Empty drop category",
    version: 0,
    deleted: false,
  });
  await page.reload();
  await nav(page, w.desk.projects);
  const parent = page.locator(
    `[data-order-entity="${a.id}"] > .project-sortable-content`,
  );
  const child = page.locator(
    `[data-order-entity="${b.id}"] > .project-sortable-content`,
  );
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  const sourceBounds = (await child.locator(".project-title").boundingBox())!;
  const targetBounds = (await parent
    .locator(".ui-hierarchy-drop-target")
    .boundingBox())!;
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      {
        x: sourceBounds.x + sourceBounds.width / 2,
        y: sourceBounds.y + sourceBounds.height / 2,
      },
    ],
  });
  await expect(page.locator(`[data-order-entity="${b.id}"]`)).toHaveAttribute(
    "data-reordering",
    "true",
  );
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      {
        x: targetBounds.x + targetBounds.width / 2,
        y: targetBounds.y + targetBounds.height / 2,
      },
    ],
  });
  await expect(parent.locator(".ui-hierarchy-drop-target")).toHaveAttribute(
    "data-hierarchy-over",
    "true",
  );
  expect(
    (
      await (await page.request.get(workbench.url + "/api/snapshot")).json()
    ).items.find((item: { id: string }) => item.id === b.id).parentProjectId,
  ).toBeNull();
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await session.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await session.detach();
  await expect
    .poll(
      async () =>
        (
          await (await page.request.get(workbench.url + "/api/snapshot")).json()
        ).items.find((item: { id: string }) => item.id === b.id)
          .parentProjectId,
    )
    .toBe(a.id);
  await parent.locator("button.project-tree-toggle").click();
  await expect(child).toBeVisible();
  const beforeCycle = (
    await (await page.request.get(workbench.url + "/api/snapshot")).json()
  ).items.find((item: { id: string }) => item.id === a.id);
  await parent.dragTo(child.locator(".ui-hierarchy-drop-target"));
  expect(
    (
      await (await page.request.get(workbench.url + "/api/snapshot")).json()
    ).items.find((item: { id: string }) => item.id === a.id),
  ).toEqual(beforeCycle);
  await parent.dragTo(
    page.locator(".ui-hierarchy-drop-target").filter({
      has: page.getByRole("heading", {
        name: "Empty drop category",
        exact: true,
      }),
    }),
  );
  await expect
    .poll(
      async () =>
        (
          await (await page.request.get(workbench.url + "/api/snapshot")).json()
        ).items.find((item: { id: string }) => item.id === a.id).categoryId,
    )
    .toBe(category.id);
  const snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    snapshot.items.find((item: { id: string }) => item.id === task.id)
      .projectIds,
  ).toEqual([b.id]);
  expect(
    snapshot.items.find((item: { id: string }) => item.id === a.id).type,
  ).toBe("PROJECT");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("project-hierarchy-drop.png"),
    fullPage: true,
  });
});

test("Sidebar keyboard movement persists within its navigation group", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const sidebar = page.locator(".sidebar");
  const mobile = info.project.name.includes("mobile");
  if (mobile) await page.locator(".mobile-navigation-toggle").click();
  const surface = mobile ? page.locator(".mobile-more-sheet") : sidebar;
  const calendar = surface.locator(
    `[data-order-entity="${mobile ? "focus" : "calendar"}"]`,
  );
  await calendar.locator("button[data-reorder-surface]").focus();
  await calendar.locator(".ui-drag-handle").focus();
  await expect(calendar.locator(".ui-drag-handle")).toBeFocused();
  await page.keyboard.press("Alt+ArrowUp");
  await expect
    .poll(async () => {
      const snapshot = await (
        await page.request.get(workbench.url + "/api/snapshot")
      ).json();
      return snapshot.navigationPreference.desktop.order.slice(0, 5);
    })
    .toEqual(
      mobile
        ? ["focus", "overview", "tasks", "projects", "calendar"]
        : ["overview", "tasks", "projects", "calendar", "focus"],
    );
  await page.reload();
  if (mobile) {
    await page.locator(".mobile-navigation-toggle").click();
    await expect(
      surface.locator('[data-order-scope="NAV:workspace:ordinary"]').first(),
    ).toHaveAttribute("data-order-entity", "focus");
  } else
    await expect(
      sidebar.locator("section").first().locator(".nav-item"),
    ).toHaveText([
      new RegExp(w.desk.overview),
      new RegExp(w.desk.tasks),
      new RegExp(w.desk.projects),
      new RegExp(w.desk.calendar),
      new RegExp(w.desk.focus),
    ]);
  const before = (
    await (await page.request.get(workbench.url + "/api/snapshot")).json()
  ).navigationPreference;
  await surface
    .locator(`[data-order-entity="${mobile ? "journal" : "notes"}"]`)
    .evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.setData(
        "application/x-orivane-drag+json",
        JSON.stringify({
          version: 1,
          intent: "NAV_REORDER",
          entityId: "tasks",
          scopeKey: "NAV:workspace:ordinary",
        }),
      );
      element.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
    });
  expect(
    (await (await page.request.get(workbench.url + "/api/snapshot")).json())
      .navigationPreference,
  ).toEqual(before);
});

test("navigation long press uses a real touch gesture and commits only on release", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const mobile = info.project.name.includes("mobile");
  if (mobile) await page.locator(".mobile-navigation-toggle").click();
  const surface = mobile
    ? page.locator(".mobile-more-sheet")
    : page.locator(".sidebar");
  const moving = mobile ? "focus" : "calendar";
  const anchor = mobile ? "overview" : "focus";
  const source = surface.locator(`[data-order-entity="${moving}"]`);
  const target = surface.locator(`[data-order-entity="${anchor}"]`);
  const sourceBounds = (await source.boundingBox())!;
  let targetBounds = (await target.boundingBox())!;
  const before = (
    await (await page.request.get(workbench.url + "/api/snapshot")).json()
  ).navigationPreference;
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      {
        x: sourceBounds.x + sourceBounds.width / 2,
        y: sourceBounds.y + sourceBounds.height / 2,
      },
    ],
  });
  await expect(source).toHaveAttribute("data-reordering", "true");
  // Long press can reveal the drag handle and shift rows by a few pixels;
  // resolve the target against the current layout before moving.
  targetBounds = (await target.boundingBox())!;
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: targetBounds.x + targetBounds.width / 2, y: targetBounds.y + 4 },
    ],
  });
  await expect(target).toHaveAttribute("data-touch-drop", "BEFORE");
  expect(
    (await (await page.request.get(workbench.url + "/api/snapshot")).json())
      .navigationPreference,
  ).toEqual(before);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(async () =>
      (
        await (await page.request.get(workbench.url + "/api/snapshot")).json()
      ).navigationPreference.desktop.order.slice(0, 5),
    )
    .toEqual(
      mobile
        ? ["focus", "overview", "tasks", "projects", "calendar"]
        : ["overview", "tasks", "projects", "calendar", "focus"],
    );
  await expect(surface).toBeVisible();
  await session.detach();
  await page.screenshot({
    path: info.outputPath("navigation-touch-order.png"),
    fullPage: true,
  });
});

test("navigation preferences persist ordered mobile shortcuts and desktop visibility", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.settings);
  await openAdvancedSettings(page);
  const panel = page.locator(".navigation-settings");
  await panel
    .locator(".navigation-choice")
    .filter({ hasText: w.desk.calendar })
    .getByRole("checkbox")
    .uncheck();
  await panel
    .locator(".navigation-choice")
    .filter({ hasText: w.desk.notes })
    .getByRole("checkbox")
    .uncheck();
  await panel.getByRole("button", { name: w.common.save, exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(workbench.url + "/api/snapshot")).json())
          .navigationPreference.mobile.pinned,
    )
    .toEqual(["tasks", "projects"]);
  await page.reload();
  await page.setViewportSize({ width: 412, height: 850 });
  await expect(page.locator(".mobile-bottom-navigation button")).toHaveCount(3);
  await page.locator(".mobile-bottom-navigation button").last().click();
  await expect(
    page
      .locator(".mobile-more-sheet")
      .getByRole("button", { name: w.desk.calendar, exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("custom-mobile-navigation.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  for (const pinned of [
    ["tasks", "projects", "calendar"],
    ["tasks", "projects", "calendar", "notes"],
  ]) {
    const current = (
      await (await page.request.get(workbench.url + "/api/snapshot")).json()
    ).navigationPreference;
    await mutation(page, "/api/work/navigation-preference", {
      ...current,
      mobile: { pinned },
    });
    await page.reload();
    await expect(page.locator(".mobile-bottom-navigation button")).toHaveCount(
      pinned.length + 1,
    );
    await expect(page.locator(".mobile-navigation-toggle")).toBeVisible();
  }
  await page.setViewportSize({ width: 1280, height: 850 });
  await nav(page, w.desk.settings);
  const preference = (
    await (await page.request.get(workbench.url + "/api/snapshot")).json()
  ).navigationPreference;
  await mutation(page, "/api/work/navigation-preference", {
    ...preference,
    desktop: {
      ...preference.desktop,
      hidden: ["journal"],
      pinned: ["projects"],
    },
  });
  await page.reload();
  await expect(
    page
      .locator(".sidebar nav")
      .getByRole("button", { name: w.desk.journal, exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".sidebar nav .nav-item").first()).toContainText(
    w.desk.projects,
  );
  await panel
    .getByRole("button", { name: w.desk.restoreNavigation, exact: true })
    .click();
  await panel.getByRole("button", { name: w.common.save, exact: true }).click();
  await expect(
    page
      .locator(".sidebar nav")
      .getByRole("button", { name: w.desk.journal, exact: true }),
  ).toBeVisible();
});

test("overview task count excludes non-tasks and clears a previous project filter", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const project = await mutation(page, "/api/work/create", {
    title: "Scope",
    type: "PROJECT",
  });
  await mutation(page, "/api/work/create", {
    title: "Inside",
    projectIds: [project.id],
  });
  await mutation(page, "/api/work/create", { title: "Outside" });
  await mutation(page, "/api/work/create", {
    title: "Milestone",
    type: "MILESTONE",
  });
  await mutation(page, "/api/work/create", {
    title: "Later",
    activationState: "INACTIVE",
  });
  await page.reload();
  await nav(page, w.desk.tasks);
  await chooseProject(
    page.locator(".project-filter-picker .hierarchy-picker"),
    [project.title],
  );
  await expect(page.locator(".task-card")).toHaveCount(1);
  await nav(page, w.desk.overview);
  const countLink = page
    .locator(".home-summary-link")
    .filter({ hasText: w.desk.openTasks });
  await expect(countLink.locator("strong")).toHaveText("2");
  await page.screenshot({
    path: info.outputPath("upgrade-overview.png"),
    fullPage: true,
  });
  await countLink.click();
  await expect(page.locator(".task-card")).toHaveCount(2);
  await expect(
    page
      .locator(".project-filter-picker")
      .getByRole("button", { name: w.desk.all, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await nav(page, w.desk.projects);
  await page.screenshot({
    path: info.outputPath("upgrade-project-tree.png"),
    fullPage: true,
  });
  if (info.project.name.startsWith("mobile")) {
    await page.locator(".mobile-bottom-navigation button").last().click();
    await page.screenshot({
      path: info.outputPath("upgrade-more-sheet.png"),
      fullPage: false,
    });
  }
});

test.describe("host calendar authority", () => {
  test.use({ timezoneId: "America/Adak" });
  test("authoritative calendar unifies Tasks Calendar and Journal across client zones", async ({
    page,
    workbench,
  }, info) => {
    const w = words(info.project.name);
    const instant = "2026-10-03T12:00:00.000Z";
    await page.clock.setFixedTime(new Date(instant));
    await workbench.advanceRecurrenceTime(instant);
    await unlock(page, workbench.url, workbench.secret, w);
    const day = localCalendarDay(instant, "Pacific/Kiritimati");
    const initial = await (
      await page.request.get(workbench.url + "/api/snapshot")
    ).json();
    expect(initial.calendarTimezone).toBe("Pacific/Kiritimati");
    await mutation(page, "/api/work/calendar-settings", {
      version: initial.calendarSettings.version,
      timezone: "America/Adak",
    });
    const changed = await (
      await page.request.get(workbench.url + "/api/snapshot")
    ).json();
    expect(changed.calendarTimezone).toBe("America/Adak");
    await mutation(page, "/api/work/calendar-settings", {
      version: changed.calendarSettings.version,
      timezone: "Pacific/Kiritimati",
    });
    expect(localCalendarDay(instant, "America/Adak")).not.toBe(day);
    const task = await mutation(page, "/api/work/create", {
      title: "Host calendar task",
      activationPolicy: "AT_SCHEDULED_TIME",
      startDate: day,
      dueDate: day,
    });
    await page.reload();
    await nav(page, w.desk.tasks);
    await expect(page.locator(".task-card")).toContainText(
      "Host calendar task",
    );
    await expect(page.getByTestId("calendar-timezone")).toHaveCount(0);
    await mutation(page, "/api/work/update", {
      id: task.id,
      version: task.version,
      input: { status: "IN_PROGRESS" },
    });
    await nav(page, w.desk.calendar);
    await expect(page.locator(".calendar-day.is-today")).toHaveAttribute(
      "aria-label",
      day,
    );
    await page.locator(".calendar-day.is-today").click();
    await expect(page.locator(".document-pane:not([hidden])")).toHaveCount(0);
    await openCalendarJournal(page, w.desk.journal);
    const body = pane(page).getByLabel(w.desk.noteBody);
    await body.fill("Journal on the authoritative day");
    await body.press("Control+s");
    await expect
      .poll(async () => {
        const snapshot = await (
          await page.request.get(workbench.url + "/api/snapshot")
        ).json();
        return snapshot.notes.find(
          (n: { bodyMd: string }) =>
            n.bodyMd === "Journal on the authoritative day",
        )?.day;
      })
      .toBe(day);
    await nav(page, w.desk.calendar);
    await page.screenshot({
      path: info.outputPath("calendar-timezone.png"),
      fullPage: true,
    });
  });
});

test("AI approval follows the active document tab and excludes hidden document context", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const policy = {
    classification: "PRIVATE",
    processingBoundary: "ANY",
    aiAccess: "ASK",
  };
  const space = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "SPACE",
      spaceId: null,
      title: "Context wiki",
      bodyMd: "",
      aiPolicy: policy,
    },
  });
  const documents = [];
  for (const title of ["Page one", "Page two"])
    documents.push(
      await mutation(page, "/api/library/save", {
        id: null,
        version: 0,
        input: {
          kind: "DOCUMENT",
          spaceId: space.id,
          title,
          bodyMd: title,
          aiPolicy: policy,
        },
      }),
    );
  await page.reload();
  await nav(page, w.spaces.library);
  await page
    .locator(".space-card")
    .filter({ hasText: "Context wiki" })
    .press("Enter");
  await page
    .locator(".note-card, .library-document-row, .space-card")
    .filter({ hasText: "Page one" })
    .press("Enter");
  await page
    .getByRole("tablist")
    .getByRole("button", { name: zh ? "工作台" : "Workspace", exact: true })
    .click();
  await page
    .locator(".note-card, .library-document-row, .space-card")
    .filter({ hasText: "Page two" })
    .press("Enter");
  await page.getByRole("tab", { name: "Page one", exact: true }).click();
  await page.keyboard.press("Control+j");
  const assistant = page.getByRole("complementary", {
    name: "Atlas Assistant",
  });
  await assistant
    .getByRole("textbox", { name: /^(Ask Atlas|向 Atlas 提问)$/ })
    .fill("Question");
  await assistant.getByRole("button", { name: /^(Send|发送)$/ }).click();
  await expect(
    assistant.getByRole("heading", { name: /AI will read|AI 将读取/ }),
  ).toBeVisible();
  let state = await (await page.request.get(workbench.url + "/api/ai")).json();
  expect(
    state.runs[0].context.map((item: { ref: { id: string } }) => item.ref.id),
  ).toEqual([documents[0].id]);
  await assistant.getByRole("button", { name: /^(Reject|拒绝)$/ }).click();
  // Atlas is a floating surface now; its own header owns the close control.
  await page
    .getByRole("dialog", { name: zh ? "Atlas 助手" : "Atlas assistant" })
    .getByRole("button", { name: zh ? "关闭 Atlas" : "Close Atlas" })
    .click();
  await page
    .getByRole("tablist")
    .getByRole("button", { name: zh ? "工作台" : "Workspace", exact: true })
    .click();
  await page.keyboard.press("Control+j");
  await assistant
    .getByRole("textbox", { name: /^(Ask Atlas|向 Atlas 提问)$/ })
    .fill("Unrelated request");
  await assistant.getByRole("button", { name: /^(Send|发送)$/ }).click();
  await expect(
    assistant.getByRole("heading", { name: /AI will read|AI 将读取/ }),
  ).toBeVisible();
  state = await (await page.request.get(workbench.url + "/api/ai")).json();
  expect(state.runs[0].context).toEqual([]);
});

test("Delta document organization moves its home while links preserve identity and body", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const source = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "SPACE",
      spaceId: null,
      title: "Delta source home",
      bodyMd: "",
    },
  });
  const target = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "SPACE",
      spaceId: null,
      title: "Delta target home",
      bodyMd: "",
    },
  });
  const document = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "DOCUMENT",
      spaceId: source.id,
      title: "Delta stable document",
      bodyMd: "Original 中文正文\nsecond line",
    },
  });
  await page.reload();
  await nav(page, w.spaces.library);
  await page.locator(".space-card").filter({ hasText: source.title }).click();
  await page
    .locator(".library-document-row")
    .filter({ hasText: document.title })
    .click();
  const editFont = await pane(page)
    .locator(".cm-scroller")
    .evaluate((element) => getComputedStyle(element).fontFamily);
  expect(editFont).toContain("sans-serif");
  expect(editFont).not.toMatch(/SimSun|宋体/);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: ".document-pane .cm-line",
  });
  const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  writeFileSync(
    info.outputPath("delta-edit-platform-fonts.json"),
    JSON.stringify(fonts, null, 2),
  );
  await info.attach("actual-document-fonts", {
    body: JSON.stringify(fonts, null, 2),
    contentType: "application/json",
  });
  expect(
    fonts.some((font) => /SimSun|Song|Serif|宋体/i.test(font.familyName)),
  ).toBe(false);
  const titleTop = (await pane(page).locator(".document-title").boundingBox())!
    .y;
  await documentMode(page, zh ? "源码" : "Source");
  expect(
    await pane(page)
      .locator(".cm-scroller")
      .evaluate((element) => getComputedStyle(element).fontFamily),
  ).toContain("monospace");
  await documentMode(page, w.desk.read);
  expect(
    Math.abs(
      (await pane(page).locator(".document-title").boundingBox())!.y - titleTop,
    ),
  ).toBeLessThanOrEqual(1);
  expect(
    await pane(page)
      .locator(".document-reading .markdown")
      .evaluate((element) => getComputedStyle(element).fontFamily),
  ).toContain("sans-serif");
  const readingNode = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: ".document-reading .markdown p",
  });
  const readingFonts = await cdp.send("CSS.getPlatformFontsForNode", {
    nodeId: readingNode.nodeId,
  });
  writeFileSync(
    info.outputPath("delta-read-platform-fonts.json"),
    JSON.stringify(readingFonts.fonts, null, 2),
  );
  expect(
    readingFonts.fonts.some((font) =>
      /SimSun|Song|Serif|宋体/i.test(font.familyName),
    ),
  ).toBe(false);
  await cdp.detach();
  await page.screenshot({
    path: info.outputPath("delta-document-sans-reading.png"),
    fullPage: true,
  });
  const actions = pane(page).locator(".note-knowledge-actions");
  await actions
    .getByRole("button", {
      name: zh ? "关联到知识空间" : "Link to knowledge space",
      exact: true,
    })
    .click();
  await actions.locator(".space-picker button[aria-expanded]").click();
  await page
    .locator(".hierarchy-browser")
    .getByRole("button", { name: target.title, exact: true })
    .click();
  await actions
    .getByRole("button", { name: zh ? "确认" : "Confirm", exact: true })
    .click();
  await expect
    .poll(async () =>
      (
        await (await page.request.get(workbench.url + "/api/snapshot")).json()
      ).links.some(
        (link: { from: { id: string }; to: { id: string } }) =>
          link.from.id === document.id && link.to.id === target.id,
      ),
    )
    .toBe(true);
  let canonical = await (
    await page.request.get(
      workbench.url + "/api/document/body?kind=LIBRARY&id=" + document.id,
    )
  ).json();
  expect(canonical.spaceId).toBe(source.id);
  expect(canonical.bodyMd).toBe(document.bodyMd);
  expect(canonical.version).toBe(document.version);
  await page.route("**/api/**", (route) => route.abort("internetdisconnected"));
  await actions
    .getByRole("button", {
      name: zh ? "整理到知识空间" : "Organize into knowledge space",
      exact: true,
    })
    .click();
  await actions.locator(".space-picker button[aria-expanded]").click();
  await page
    .locator(".hierarchy-browser")
    .getByRole("button", { name: target.title, exact: true })
    .click();
  await actions
    .getByRole("button", { name: zh ? "确认" : "Confirm", exact: true })
    .click();
  await expect(
    actions.getByRole("button", { name: zh ? "确认" : "Confirm", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await nav(page, w.spaces.library);
  await page.locator(".space-card").filter({ hasText: target.title }).click();
  await page
    .locator(".library-document-row")
    .filter({ hasText: document.title })
    .click();
  await documentMode(page, w.desk.read);
  await expect(pane(page).locator(".document-reading")).toContainText(
    "Original 中文正文",
  );
  await page.unroute("**/api/**");
  await page.reload();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(
              workbench.url +
                "/api/document/body?kind=LIBRARY&id=" +
                document.id,
            )
          ).json()
        ).spaceId,
    )
    .toBe(target.id);
  canonical = await (
    await page.request.get(
      workbench.url + "/api/document/body?kind=LIBRARY&id=" + document.id,
    )
  ).json();
  expect(canonical.id).toBe(document.id);
  expect(canonical.bodyMd).toBe(document.bodyMd);
  expect(canonical.version).toBe(document.version + 1);
});

test("capture links to Space and promotes to Wiki with Journal backlinks", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const space = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: { kind: "SPACE", spaceId: null, title: "Capture Wiki", bodyMd: "" },
  });
  const target = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "DOCUMENT",
      spaceId: space.id,
      title: "Architecture",
      bodyMd: "Target",
    },
  });
  const note = await mutation(page, "/api/note/save", {
    id: null,
    version: 0,
    input: {
      kind: "NOTE",
      day: null,
      title: "Capture source",
      bodyMd: "# Preserved\n[[Architecture]]\n- [ ] prose",
    },
  });
  await mutation(page, "/api/note/save", {
    id: null,
    version: 0,
    input: {
      kind: "JOURNAL",
      day: "2026-10-02",
      title: "Journal source",
      bodyMd: "[[Architecture]]",
    },
  });
  await page.reload();
  await nav(page, w.desk.notes);
  await page
    .locator(".note-card, .library-document-row, .space-card")
    .filter({ hasText: "Capture source" })
    .press("Enter");
  const actions = page.locator(
    ".document-pane:visible .note-knowledge-actions",
  );
  await actions
    .getByRole("button", {
      name: zh ? "关联到知识空间" : "Link to knowledge space",
      exact: true,
    })
    .click();
  await actions.locator(".space-picker button[aria-expanded]").click();
  await page
    .locator(".hierarchy-browser")
    .getByRole("button", { name: "Capture Wiki", exact: true })
    .click();
  await actions
    .getByRole("button", { name: zh ? "链接" : "Link", exact: true })
    .click();
  await expect(actions).toContainText(zh ? "已链接到" : "Linked to");
  let snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    snapshot.library.filter(
      (entry: { kind: string }) => entry.kind === "DOCUMENT",
    ),
  ).toHaveLength(1);
  await actions
    .getByRole("button", {
      name: zh ? "创建知识文档" : "Create knowledge document",
      exact: true,
    })
    .click();
  await actions.locator(".space-picker button[aria-expanded]").click();
  await page
    .locator(".hierarchy-browser")
    .getByRole("button", { name: "Capture Wiki", exact: true })
    .click();
  await actions
    .getByRole("button", { name: zh ? "创建页面" : "Create page", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Capture source", exact: true }),
  ).toHaveCount(2);
  await expect
    .poll(async () => {
      const current = await (
        await page.request.get(workbench.url + "/api/snapshot")
      ).json();
      return current.library.some(
        (entry: { kind: string; title: string }) =>
          entry.kind === "DOCUMENT" && entry.title === "Capture source",
      );
    })
    .toBe(true);
  snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  const document = snapshot.library.find(
    (entry: { kind: string; title: string }) =>
      entry.kind === "DOCUMENT" && entry.title === "Capture source",
  );
  expect(document.bodyMd).toBe(note.bodyMd);
  expect(
    snapshot.notes.find((entry: { id: string }) => entry.id === note.id)
      .deletedAt,
  ).toBeNull();
  expect(
    snapshot.wikiLinks.some(
      (link: { sourceDocumentId: string; targetDocumentId: string }) =>
        link.sourceDocumentId === document.id &&
        link.targetDocumentId === target.id,
    ),
  ).toBe(true);
  await page
    .getByRole("tablist")
    .getByRole("button", { name: zh ? "工作台" : "Workspace", exact: true })
    .click();
  await nav(page, w.spaces.library);
  await page
    .locator(".space-card")
    .filter({ hasText: "Capture Wiki" })
    .press("Enter");
  await page
    .locator(".note-card, .library-document-row, .space-card")
    .filter({ has: page.getByText("Architecture", { exact: true }) })
    .press("Enter");
  await expect(pane(page).locator(".wiki-relations")).toContainText(
    "Journal source",
  );
  await expect(pane(page).locator(".wiki-relations")).toContainText(
    "Capture source",
  );
  await page.screenshot({
    path: info.outputPath("capture-knowledge-backlinks.png"),
    fullPage: true,
  });
});

test("shared project picker separates select from explore and restores keyboard focus in mobile sheet", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const root = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Picker parent",
  });
  await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Picker child",
    parentProjectId: root.id,
  });
  await page.reload();
  await nav(page, w.desk.tasks);
  await page
    .getByRole("button", { name: w.desk.newTask, exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog"),
    picker = dialog.locator(".project-memberships .hierarchy-picker");
  const trigger = picker.locator(".hierarchy-selected > button").last();
  await trigger.click();
  const browser = page.locator(".hierarchy-browser");
  const parent = browser.getByRole("button", {
    name: "Picker parent",
    exact: true,
  });
  await parent.click();
  await expect(parent).toHaveAttribute("aria-pressed", "true");
  await expect(
    browser.getByRole("button", { name: "Picker child", exact: true }),
  ).toHaveCount(0);
  await expect(
    browser.getByRole("button", { name: /^(选择|Select)$/ }),
  ).toHaveCount(0);
  await parent.press("ArrowRight");
  const child = browser.getByRole("button", {
    name: "Picker child",
    exact: true,
  });
  await expect(child).toBeVisible();
  await browser.getByRole("searchbox").focus();
  await browser.getByRole("searchbox").press("ArrowDown");
  await expect(child).toBeFocused();
  await child.press("Enter");
  await expect(child).toHaveAttribute("aria-pressed", "true");
  await child.press("ArrowLeft");
  await expect(parent).toBeVisible();
  await expect(picker.locator(".hierarchy-selected")).toContainText(
    "Picker child",
  );
  if (info.project.name.startsWith("mobile")) {
    const rect = await browser.boundingBox();
    expect(rect).not.toBeNull();
    expect(
      Math.abs(rect!.y + rect!.height - page.viewportSize()!.height),
    ).toBeLessThanOrEqual(1);
    expect(rect!.x).toBe(0);
  }
  await page.screenshot({
    path: info.outputPath("entity-picker-sheet.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(browser).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("current level hierarchy search is shared by Task filters and AI scope", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const parent = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Hierarchy root",
  });
  const child = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Deep target",
    parentProjectId: parent.id,
  });
  await mutation(page, "/api/work/create", {
    title: "Scoped child task",
    projectIds: [child.id],
  });
  await mutation(page, "/api/work/create", { title: "Unscoped task" });
  await page.reload();
  await nav(page, w.desk.tasks);
  const filter = page.locator(".project-filter-picker .hierarchy-picker");
  await filter.locator(".hierarchy-selected > button").last().click();
  const browser = page.locator(".hierarchy-browser");
  await browser.getByRole("searchbox").fill("Deep target");
  await expect(browser.locator("li")).toHaveCount(0);
  await browser.getByRole("searchbox").fill("");
  await browser
    .getByRole("button", {
      name: zh ? "浏览子项：Hierarchy root" : "Browse children: Hierarchy root",
      exact: true,
    })
    .click();
  await browser.getByRole("searchbox").fill("Deep target");
  await expect(browser.locator("li")).toHaveCount(1);
  await browser.locator("li .ui-entity-picker-choice").click();
  await expect(page.locator(".task-card")).toHaveCount(1);
  await expect(page.locator(".task-card")).toContainText("Scoped child task");
  await openAccountApiModels(page, zh);
  await page
    .getByText(zh ? "添加项目 / 空间覆盖" : "Add project / space override", {
      exact: true,
    })
    .click();
  const scope = page
    .getByRole("region", {
      name: zh ? "默认与范围覆盖" : "Default and overrides",
    })
    .locator(".hierarchy-picker");
  await chooseProject(scope, ["Hierarchy root", "Deep target"]);
  await expect(scope.locator(".hierarchy-selected")).toContainText(
    "Deep target",
  );
  await page.screenshot({
    path: info.outputPath("ai-scope-drilldown.png"),
    fullPage: true,
  });
});

test("Atlas main workspace is conversation with explicit context and no provider form", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Context project",
  });
  await page.reload();
  await nav(page, w.desk.ai);
  const atlas = page.locator(".atlas-conversation");
  await expect(atlas).toBeVisible();
  await expect(page.locator(".page-header:visible")).toHaveCount(0);
  await expect(
    atlas.getByRole("button", {
      name: zh ? "通知" : "Notifications",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("workspace-atlas.png"),
    animations: "disabled",
  });
  await expect(atlas.locator(".ui-button-primary:visible")).toHaveCount(1);
  await expect(atlas.locator(".personal-ai-settings, .ai-run")).toHaveCount(0);
  const sidebar = await atlas.locator(".conversation-sidebar").boundingBox();
  const messages = await atlas.locator(".conversation-messages").boundingBox();
  const composer = await atlas.locator(".conversation-composer").boundingBox();
  expect(sidebar).not.toBeNull();
  expect(messages).not.toBeNull();
  expect(composer).not.toBeNull();
  if (!info.project.name.startsWith("mobile")) {
    expect(sidebar!.x + sidebar!.width).toBeLessThanOrEqual(messages!.x);
    expect(composer!.x).toBeGreaterThanOrEqual(messages!.x);
  } else {
    expect(sidebar!.y).toBeLessThan(messages!.y);
  }
  await atlas
    .getByRole("button", {
      name: zh ? "添加上下文" : "Add context",
      exact: true,
    })
    .click();
  await atlas
    .locator(".hierarchy-picker")
    .getByRole("button", { name: zh ? "项目" : "Projects", exact: true })
    .click();
  await expect(page.locator(".hierarchy-browser")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".hierarchy-browser")).toHaveCount(0);
  await expect(atlas.locator(".context-picker")).toBeVisible();
  await chooseProject(atlas.locator(".hierarchy-picker"), ["Context project"]);
  await expect(atlas.locator(".context-bar")).toContainText(
    "Context project ×",
  );
  await atlas
    .getByRole("button", { name: "Context project ×", exact: true })
    .first()
    .click();
  await expect(atlas.locator(".context-bar")).not.toContainText(
    "Context project ×",
  );
  const contextTrigger = atlas.getByRole("button", {
    name: zh ? "添加上下文" : "Add context",
    exact: true,
  });
  await expect(contextTrigger).toHaveAttribute("aria-expanded", "false");
  await contextTrigger.click();
  await expect(
    atlas.locator('[data-picker-kind="PROJECT"] .hierarchy-selected'),
  ).not.toContainText("Context project ×");
  await contextTrigger.click();
  if (info.project.name.startsWith("mobile")) {
    const send = await atlas
      .getByRole("button", { name: "发送", exact: true })
      .boundingBox();
    const navigation = await page
      .locator(".mobile-bottom-navigation")
      .boundingBox();
    expect(send!.y + send!.height).toBeLessThanOrEqual(navigation!.y);
  }
  await page.screenshot({
    path: info.outputPath("atlas-conversation.png"),
    fullPage: true,
  });
  await setTheme(page, "dark");
  await page.reload();
  await page.evaluate(() => {
    location.hash = "ai";
  });
  await expect(page.locator(".atlas-conversation")).toBeVisible();
  await page.screenshot({
    path: info.outputPath("atlas-conversation-dark.png"),
    fullPage: true,
  });
});

test("v2.4 dependency Direct and Tree scope bound picker membership and restore URL", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  const text = (cn: string, en: string) => (zh ? cn : en);
  await unlock(page, workbench.url, workbench.secret, w);
  const root = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Scope root",
  });
  const child = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Scope child",
    parentProjectId: root.id,
  });
  const grandchild = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Scope grandchild",
    parentProjectId: child.id,
  });
  const direct = await mutation(page, "/api/work/create", {
    title: "Scope direct task",
    projectIds: [root.id],
  });
  const nested = await mutation(page, "/api/work/create", {
    title: "Scope nested task",
    projectIds: [grandchild.id],
  });
  const outside = await mutation(page, "/api/work/create", {
    title: "Scope outside blocker",
  });
  await mutation(page, "/api/edge/create", {
    fromId: outside.id,
    toId: direct.id,
    type: "BLOCKS",
  });
  await page.goto(
    workbench.url + "/#graph/project/" + root.id + "?mode=dependencies",
  );
  const graph = page.locator(".dependency-focus-graph");
  const directScope = graph.getByRole("button", {
    name: text("本项目", "This project"),
    exact: true,
  });
  const treeScope = graph.getByRole("button", {
    name: text("包含子项目", "Include subprojects"),
    exact: true,
  });
  await expect(directScope).toHaveAttribute("aria-pressed", "true");
  await graph
    .getByRole("button", {
      name: text("选择焦点任务", "Choose focus task"),
      exact: true,
    })
    .click();
  const picker = page.locator(".hierarchy-browser");
  await expect(
    picker.getByRole("button", { name: "Scope child ›", exact: true }),
  ).toHaveCount(0);
  await expect(picker).not.toContainText("Scope outside blocker");
  await picker
    .getByRole("button", { name: /^Scope direct task/ })
    .first()
    .click();
  await expect(graph.locator(".react-flow__node")).toHaveCount(1);
  await treeScope.click();
  await graph
    .getByRole("button", {
      name: text("选择焦点任务", "Choose focus task"),
      exact: true,
    })
    .click();
  await picker
    .getByRole("button", { name: "Scope child ›", exact: true })
    .click();
  await picker
    .getByRole("button", { name: "Scope grandchild ›", exact: true })
    .click();
  await picker.getByRole("button", { name: /^Scope nested task/ }).click();
  await expect(page).toHaveURL(new RegExp("focus=" + nested.id));
  await expect(page).toHaveURL(/taskScope=PROJECT_TREE/);
  await page.reload();
  await expect(treeScope).toHaveAttribute("aria-pressed", "true");
  await expect(graph.locator(".react-flow__node")).toHaveCount(1);
  await directScope.click();
  await expect(graph.locator(".react-flow__node")).toHaveCount(0);
  await expect(graph.getByRole("status")).toContainText(
    text("当前焦点不在此范围内", "The focus task is outside this scope"),
  );
  await graph
    .getByRole("button", {
      name: text("选择焦点任务", "Choose focus task"),
      exact: true,
    })
    .click();
  await picker
    .getByRole("button", { name: /^Scope direct task/ })
    .first()
    .click();
  await graph
    .getByRole("checkbox", {
      name: text("显示项目外阻塞", "Show external blockers"),
      exact: true,
    })
    .check();
  await expect(graph.locator(".react-flow__node")).toHaveCount(2);
  await expect(page).toHaveURL(/external=1/);
  await page.reload();
  await expect(graph.locator(".react-flow__node")).toHaveCount(2);
  await graph
    .getByRole("button", {
      name: text("选择焦点任务", "Choose focus task"),
      exact: true,
    })
    .click();
  await expect(picker).not.toContainText("Scope outside blocker");
  await page.keyboard.press("Escape");
});

test("Project dependency graph shows external blockers only on explicit request", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const project = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Boundary project",
  });
  const task = await mutation(page, "/api/work/create", {
    title: "Local deliverable",
    projectIds: [project.id],
  });
  const blocker = await mutation(page, "/api/work/create", {
    title: "Outside prerequisite",
  });
  const indirect = await mutation(page, "/api/work/create", {
    title: "Outside indirect",
  });
  await mutation(page, "/api/edge/create", {
    fromId: blocker.id,
    toId: task.id,
    type: "BLOCKS",
  });
  await mutation(page, "/api/edge/create", {
    fromId: indirect.id,
    toId: blocker.id,
    type: "BLOCKS",
  });
  await page.goto(workbench.url + "/#projects/" + project.id + "?tab=tasks");
  await openProjectDependencyScope(
    page,
    "Local deliverable",
    info.project.name.endsWith("zh"),
  );
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await page
    .getByRole("checkbox", {
      name: zh ? "显示项目外阻塞" : "Show external blockers",
      exact: true,
    })
    .check();
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  await expect(
    page
      .locator(".react-flow__node")
      .filter({ hasText: "Outside prerequisite" }),
  ).toBeVisible();
  await expect(
    page.locator(".react-flow__node").filter({ hasText: "Outside indirect" }),
  ).toHaveCount(0);
  await page
    .locator(".react-flow__node")
    .filter({ hasText: "Outside prerequisite" })
    .click();
  await expect(page.locator(".project-inspector h3")).toHaveText(
    "Outside prerequisite",
  );
  const graph = page.locator(".project-workspace .dependency-focus-graph");
  await expect(graph.locator(".hierarchy-selected")).toContainText(
    "Local deliverable",
  );
  await expect(graph.locator(".hierarchy-selected")).not.toContainText(
    "Outside prerequisite",
  );
  await graph
    .getByRole("button", {
      name: zh ? "选择焦点任务" : "Choose focus task",
      exact: true,
    })
    .click();
  await expect(page.locator(".hierarchy-browser")).toContainText(
    "Local deliverable",
  );
  await expect(page.locator(".hierarchy-browser")).not.toContainText(
    "Outside prerequisite",
  );
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: info.outputPath("external-blockers.png"),
    fullPage: true,
  });
});

test("action pending permits another Task inspector and rolls back optimistic failures", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const first = await mutation(page, "/api/work/create", {
    title: "Pending A",
  });
  await mutation(page, "/api/work/create", { title: "Independent B" });
  await page.reload();
  await nav(page, w.desk.tasks);
  let release!: () => void, observed!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    observed = resolve;
  });
  await page.route("**/api/v1/work/update", async (route) => {
    if (route.request().postDataJSON().id === first.id) {
      observed();
      await hold;
    }
    await route.continue();
  });
  await (await taskMenu(page, "Pending A"))
    .getByRole("combobox")
    .selectOption("IN_PROGRESS");
  await reached;
  await page.keyboard.press("Escape");
  await page
    .locator(".task-card")
    .filter({ hasText: "Independent B" })
    .locator(".task-title")
    .press("Enter");
  const inspector = page.getByRole("dialog");
  await expect(inspector.getByLabel(w.work.title, { exact: true })).toHaveValue(
    "Independent B",
  );
  await expect(
    inspector.getByLabel(w.work.title, { exact: true }),
  ).toBeEnabled();
  await inspector
    .getByRole("button", { name: w.common.close, exact: true })
    .click();
  release();
  await waitForLocalReplay(page);
  const read = async () =>
    (await page.request.get(workbench.url + "/api/snapshot")).json();
  expect(
    (await read()).items.find((item: { id: string }) => item.id === first.id),
  ).toMatchObject({ status: "IN_PROGRESS", version: 2 });
  // A failed local transaction, unlike a network outage, must roll back optimism.
  await setLocalCommandFailure(page, true);
  const status = (await taskMenu(page, "Pending A")).getByRole("combobox");
  await status.selectOption("TODO");
  await expect(status).toHaveValue("IN_PROGRESS");
  await expect(status).toBeEnabled();
  await expect(page.locator(".toast").last()).toBeVisible();
  await setLocalCommandFailure(page, false);
  await waitForLocalReplay(page);
  expect(
    (await read()).items.find((item: { id: string }) => item.id === first.id),
  ).toMatchObject({ status: "IN_PROGRESS", version: 2 });
  await page.screenshot({
    path: info.outputPath("pending-rollback.png"),
    fullPage: true,
  });
});

test("hardening root-only lazy hierarchy dialog guards floating menu and graph expansion", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const root = await mutation(page, "/api/work/create", {
    title: "Hardening root",
    type: "PROJECT",
  });
  const child = await mutation(page, "/api/work/create", {
    title: "Hardening child",
    type: "PROJECT",
    parentProjectId: root.id,
  });
  await mutation(page, "/api/work/create", {
    title: "Hardening grandchild",
    type: "PROJECT",
    parentProjectId: child.id,
  });
  await page.reload();
  await nav(page, w.desk.projects);
  const title = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await expect(title("Hardening child")).toHaveCount(0);
  await page
    .getByRole("button", {
      name: w.desk.expandProject.replace("{{title}}", "Hardening root"),
      exact: true,
    })
    .click();
  await expect(title("Hardening child")).toBeVisible();
  await expect(title("Hardening grandchild")).toHaveCount(0);
  await page
    .getByRole("button", {
      name: w.desk.collapseProject.replace("{{title}}", "Hardening root"),
      exact: true,
    })
    .click();
  await expect(title("Hardening child")).toHaveCount(0);
  if (info.project.name !== "mobile-zh") {
    await page
      .getByRole("button", { name: w.desk.collapseSidebar, exact: true })
      .click();
    await page
      .getByRole("button", { name: w.desk.workspaceMenu, exact: true })
      .click();
    const menu = page.getByRole("menu", { name: w.desk.workspaceMenu });
    await expect(menu).toBeVisible();
    const rect = await menu.boundingBox();
    expect(rect!.width).toBeGreaterThan(180);
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await page
      .getByRole("button", { name: w.desk.workspaceMenu, exact: true })
      .click();
    await page.locator(".page-header").click({ position: { x: 400, y: 10 } });
    await expect(menu).toHaveCount(0);
  }
  await page.screenshot({
    path: info.outputPath("hardening-projects.png"),
    fullPage: true,
  });
});

test("hardening editors outside click retain dirty drafts settings borders and expanded graph", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.projects);
  await page.locator(".page-header .compact-create").click();
  const project = page.locator(".project-settings-dialog");
  await expect(
    project.getByRole("button", { name: w.desk.createProject, exact: true }),
  ).toBeVisible();
  if (info.project.name.startsWith("mobile"))
    await project
      .getByRole("button", { name: w.common.close, exact: true })
      .click();
  else await page.mouse.click(2, 2);
  await expect(project).toHaveCount(0);
  await page.locator(".page-header .compact-create").click();
  await project
    .getByLabel(w.work.title, { exact: true })
    .fill("Unsaved project");
  if (info.project.name.startsWith("mobile"))
    await project
      .getByRole("button", { name: w.common.close, exact: true })
      .click();
  else await page.mouse.click(2, 2);
  await expect(project).toBeVisible();
  await expect(project.locator(".error")).toBeVisible();
  await expect(project.getByLabel(w.work.title, { exact: true })).toHaveValue(
    "Unsaved project",
  );
  await project
    .getByRole("button", { name: w.desk.discard, exact: true })
    .click();
  await nav(page, w.desk.tasks);
  await page.locator(".page-header .compact-create").click();
  const task = page.locator(".task-inspector");
  if (info.project.name.startsWith("mobile"))
    await task
      .getByRole("button", { name: w.common.close, exact: true })
      .click();
  else await page.mouse.click(2, 2);
  await expect(task).toHaveCount(0);
  await page.locator(".page-header .compact-create").click();
  await task.getByLabel(w.work.title, { exact: true }).fill("Unsaved task");
  if (info.project.name.startsWith("mobile"))
    await task
      .getByRole("button", { name: w.common.close, exact: true })
      .click();
  else await page.mouse.click(2, 2);
  await expect(task).toBeVisible();
  await expect(task.locator(".error")).toBeVisible();
  await expect(task.getByLabel(w.work.title, { exact: true })).toHaveValue(
    "Unsaved task",
  );
  await task.getByRole("button", { name: w.desk.discard, exact: true }).click();
  await nav(page, w.desk.settings);
  await openAdvancedSettings(page);
  expect(
    await page
      .locator(".settings-panel:visible")
      .last()
      .evaluate((node) => getComputedStyle(node).borderLeftWidth),
  ).toBe("1px");
  for (const fieldset of await page.locator(".settings-panel fieldset").all())
    expect(
      await fieldset.evaluate((node) => getComputedStyle(node).borderLeftWidth),
    ).toBe("0px");
  await expect(
    page
      .locator(".navigation-settings")
      .getByRole("button", { name: "↑", exact: true }),
  ).toHaveCount(0);
  const handle = page.locator(".navigation-drag-handle").nth(1);
  const previous = await handle.getAttribute("aria-label");
  await handle.focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.locator(".navigation-drag-handle").first()).toHaveAttribute(
    "aria-label",
    previous!,
  );
  await page.screenshot({
    path: info.outputPath("hardening-settings.png"),
    fullPage: true,
  });
  const root = await mutation(page, "/api/work/create", {
    title: "Graph hardening",
    type: "PROJECT",
  });
  await mutation(page, "/api/work/create", {
    title: "Graph selected task",
    projectIds: [root.id],
  });
  await page.goto(workbench.url + "/#projects/" + root.id + "?tab=tasks");
  await openProjectDependencyScope(
    page,
    "Graph selected task",
    info.project.name.endsWith("zh"),
  );
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await page.locator(".react-flow__node").first().click();
  const viewport = await page
    .locator(".react-flow__viewport")
    .getAttribute("style");
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);
  await page
    .getByRole("button", { name: w.desk.expandGraph, exact: true })
    .click();
  await expect(page.locator(".graph-expanded-dialog")).toBeVisible();
  await expect(
    page.locator(".graph-expanded-dialog .project-inspector"),
  ).toContainText("Graph selected task");
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  const bounds = await page.locator(".graph-expanded-dialog").boundingBox();
  expect(bounds!.height).toBeGreaterThan(page.viewportSize()!.height * 0.8);
  await page.screenshot({
    path: info.outputPath("hardening-graph.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.locator(".graph-expanded-dialog")).toHaveCount(0);
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);
  await expect(page.locator(".react-flow__viewport")).toHaveAttribute(
    "style",
    viewport!,
  );
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
});

test("workspace SSE applies external mutations without idle polling and resumes after visibility and offline changes", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  await page.goto(workbench.url + "/#tasks");
  let syncRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/sync") ++syncRequests;
  });
  await mutation(page, "/api/work/create", { title: "SSE external task" });
  await expect(page.locator(".task-card")).toContainText("SSE external task", {
    timeout: 4000,
  });
  const settled = syncRequests;
  await page.waitForTimeout(6200);
  expect(syncRequests).toBe(settled);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await mutation(page, "/api/work/create", { title: "Hidden window task" });
  await page.waitForTimeout(400);
  expect(syncRequests).toBe(settled);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.locator(".task-card").filter({ hasText: "Hidden window task" }),
  ).toBeVisible({
    timeout: 4000,
  });
  await page.context().setOffline(true);
  await mutation(page, "/api/work/create", { title: "Offline recovery task" });
  await page.context().setOffline(false);
  await expect(
    page.locator(".task-card").filter({ hasText: "Offline recovery task" }),
  ).toBeVisible({ timeout: 4000 });
});

test("Library links to the single global Trash and preserves its library filter on refresh", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const space = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "SPACE",
      spaceId: null,
      title: "Library trash space",
      bodyMd: "",
    },
  });
  const doc = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "DOCUMENT",
      spaceId: space.id,
      title: "Trashed library document",
      bodyMd: "",
    },
  });
  const task = await mutation(page, "/api/work/create", {
    title: "Trashed unrelated task",
  });
  await mutation(page, "/api/library/delete", {
    id: doc.id,
    version: doc.version,
    deleted: true,
  });
  await mutation(page, "/api/work/delete", {
    id: task.id,
    version: task.version,
    deleted: true,
  });
  await page.goto(workbench.url + "/#library");
  await expect(
    page
      .locator(".library-view")
      .getByText("Trashed library document", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: zh ? "查看回收站 →" : "View Trash →",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/#trash\?filter=library$/);
  await expect(page.locator(".trash-list")).toContainText(
    "Trashed library document",
  );
  await expect(page.locator(".trash-list")).not.toContainText(
    "Trashed unrelated task",
  );
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: zh ? "类型" : "Type", exact: true }),
  ).toHaveValue("library");
  await page
    .getByRole("combobox", { name: zh ? "类型" : "Type", exact: true })
    .selectOption("all");
  await expect(page.locator(".trash-list")).toContainText(
    "Trashed unrelated task",
  );
});

test("hardening Trash soft delete Undo restore and permanent purge across entity kinds", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const task = await mutation(page, "/api/work/create", {
    title: "Purge UI task",
  });
  await page.reload();
  await nav(page, w.desk.tasks);
  let softConfirm = 0;
  const rejectUnexpected = async (
    dialog: import("@playwright/test").Dialog,
  ) => {
    softConfirm++;
    await dialog.dismiss();
  };
  page.on("dialog", rejectUnexpected);
  const row = page.locator(".task-card").filter({ hasText: "Purge UI task" });
  await (await taskMenu(page, "Purge UI task"))
    .getByRole("menuitem", {
      name: w.desk.deleteItem + ": Purge UI task",
      exact: true,
    })
    .click();
  await expect(row).toHaveCount(0);
  expect(softConfirm).toBe(0);
  await page
    .locator(".toast")
    .getByRole("button", { name: zh ? "撤销" : "Undo", exact: true })
    .click();
  await expect(row).toBeVisible();
  await (await taskMenu(page, "Purge UI task"))
    .getByRole("menuitem", {
      name: w.desk.deleteItem + ": Purge UI task",
      exact: true,
    })
    .click();
  await nav(page, w.desk.trash);
  const trashRow = page
    .locator(".trash-list > div")
    .filter({ hasText: "Purge UI task" });
  await trashRow
    .getByRole("button", { name: w.common.restore, exact: true })
    .click();
  await expect(trashRow).toHaveCount(0);
  for (const toast of await page.locator(".toast").all())
    await toast
      .getByRole("button", { name: zh ? "关闭" : "Dismiss", exact: true })
      .click();
  await nav(page, w.desk.tasks);
  await (await taskMenu(page, "Purge UI task"))
    .getByRole("menuitem", {
      name: w.desk.deleteItem + ": Purge UI task",
      exact: true,
    })
    .click();
  await nav(page, w.desk.trash);
  page.off("dialog", rejectUnexpected);
  const confirmation9 = answerConfirmation(page, false, "Purge UI task");
  await trashRow
    .getByRole("button", { name: w.desk.permanentDelete, exact: true })
    .click();
  await confirmation9;
  await expect(trashRow).toBeVisible();
  const confirmation10 = answerConfirmation(page, true);
  await trashRow
    .getByRole("button", { name: w.desk.permanentDelete, exact: true })
    .click();
  await confirmation10;
  await expect(trashRow).toHaveCount(0);
  const note = await mutation(page, "/api/note/save", {
    id: null,
    version: 0,
    input: {
      title: "Purge UI note",
      bodyMd: "Keep until purge",
      kind: "NOTE",
      day: null,
    },
  });
  const space = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      title: "Purge UI space",
      bodyMd: "",
      kind: "SPACE",
      spaceId: null,
    },
  });
  const doc = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      title: "Purge UI document",
      bodyMd: "Keep until purge",
      kind: "DOCUMENT",
      spaceId: space.id,
    },
  });
  await mutation(page, "/api/note/delete", {
    id: note.id,
    version: note.version,
    deleted: true,
  });
  await mutation(page, "/api/library/delete", {
    id: doc.id,
    version: doc.version,
    deleted: true,
  });
  await mutation(page, "/api/library/delete", {
    id: space.id,
    version: space.version,
    deleted: true,
  });
  await page.reload();
  for (const title of [
    "Purge UI note",
    "Purge UI document",
    "Purge UI space",
  ]) {
    const entry = page.locator(".trash-list > div").filter({ hasText: title });
    await expect(entry).toBeVisible();
    const confirmation11 = answerConfirmation(page, true);
    await entry
      .getByRole("button", { name: w.desk.permanentDelete, exact: true })
      .click();
    await confirmation11;
    await expect(entry).toHaveCount(0);
  }
  await waitForLocalReplay(page);
  const snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    snapshot.items.some((entry: { id: string }) => entry.id === task.id),
  ).toBe(false);
  expect(
    snapshot.notes.some((entry: { id: string }) => entry.id === note.id),
  ).toBe(false);
  expect(
    snapshot.library.some(
      (entry: { id: string }) => entry.id === space.id || entry.id === doc.id,
    ),
  ).toBe(false);
  await page.screenshot({
    path: info.outputPath("hardening-trash.png"),
    fullPage: true,
  });
});

test("account experience: picker recent survives refresh and isolates workspace and principal", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "A ordinary",
  });
  const recent = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Z recent",
    descriptionMd: "Private project body",
  });
  await page.reload();
  await nav(page, w.desk.tasks);
  await chooseProject(
    page.locator(".project-filter-picker .hierarchy-picker"),
    ["Z recent"],
  );
  await page.reload();
  await nav(page, w.desk.tasks);
  const picker = page.locator(".project-filter-picker .hierarchy-picker");
  await picker.locator(".hierarchy-selected > button").last().click();
  await expect(page.locator(".hierarchy-browser li").first()).toContainText(
    "Z recent",
  );
  await page.keyboard.press("Escape");
  const stored = await page.evaluate(() =>
    Object.entries(localStorage).filter(([key]) =>
      key.startsWith("orivane.atlas.picker-recent.v1:"),
    ),
  );
  expect(
    stored.some(([, value]) => JSON.parse(value).includes(recent.id)),
  ).toBe(true);
  expect(JSON.stringify(stored)).not.toContain("Private project body");
  expect(JSON.stringify(stored)).not.toContain("Z recent");
  await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((key) =>
      key.startsWith("orivane.atlas.picker-recent.v1:"),
    );
    for (const key of keys) {
      const ids = JSON.parse(localStorage.getItem(key) ?? "[]");
      localStorage.setItem(key, JSON.stringify([...ids, "missing-id"]));
    }
  });
  await page.reload();
  await nav(page, w.desk.tasks);
  await page
    .locator(".project-filter-picker .hierarchy-selected > button")
    .last()
    .click();
  await expect(page.locator(".hierarchy-browser li").first()).toContainText(
    "Z recent",
  );
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(() =>
      Object.entries(localStorage)
        .filter(([key]) => key.startsWith("orivane.atlas.picker-recent.v1:"))
        .every(([, value]) => !value.includes("missing-id")),
    ),
  ).toBe(true);
  await nav(page, w.desk.settings);
  await page.getByRole("button", { name: w.desk.lock, exact: true }).click();
  await unlock(page, workbench.url, workbench.secret, w, false, "second-user");
  await nav(page, w.desk.tasks);
  await page
    .locator(".project-filter-picker .hierarchy-selected > button")
    .last()
    .click();
  await expect(page.locator(".hierarchy-browser")).not.toContainText(
    "Z recent",
  );
  await page.keyboard.press("Escape");
  const second = await mutation(page, "/api/work/create", {
    type: "PROJECT",
    title: "Second account",
  });
  await page.reload();
  await nav(page, w.desk.tasks);
  await chooseProject(
    page.locator(".project-filter-picker .hierarchy-picker"),
    ["Second account"],
  );
  const keys = await page.evaluate(() =>
    Object.entries(localStorage).filter(([key]) =>
      key.startsWith("orivane.atlas.picker-recent.v1:"),
    ),
  );
  expect(
    keys.some(
      ([, value]) =>
        JSON.parse(value).includes(recent.id) &&
        JSON.parse(value).includes(second.id),
    ),
  ).toBe(false);
  const identities = keys.map(
    ([key]) =>
      JSON.parse(
        key.slice("orivane.atlas.picker-recent.v1:".length),
      ) as string[],
  );
  expect(new Set(identities.map((identity) => identity[1])).size).toBe(2);
  expect(new Set(identities.map((identity) => identity[2])).size).toBe(2);
});

test("Library snapshot sync and closed AI Activity have no independent polling", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const libraryRequests: string[] = [];
  const activityRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/library") libraryRequests.push(url.href);
    if (url.pathname === "/api/ai") activityRequests.push(url.href);
  });
  await nav(page, w.spaces.library);
  await page.waitForTimeout(6500);
  expect(libraryRequests).toEqual([]);
  await openAccountApiModels(page, zh);
  await page.waitForTimeout(6500);
  expect(activityRequests).toEqual([]);
  await page.locator(".ai-activity > summary").click();
  await expect.poll(() => activityRequests.length).toBeGreaterThan(0);
  await page.locator(".ai-activity > summary").click();
  const before = activityRequests.length;
  expect(
    activityRequests.some(
      (url) => new URL(url).searchParams.get("includeRuns") !== "false",
    ),
  ).toBe(true);
  await page.waitForTimeout(6500);
  expect(activityRequests).toHaveLength(before);
});

test("hardening completed occurrence drives Today 7 Days and Month statistics", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const today = new Date().toISOString().slice(0, 10);
  await workbench.advanceRecurrenceTime(today + "T00:30:00.000Z");
  const definition = await mutation(page, "/api/recurrences/save", {
    version: 0,
    deleted: false,
    rule: {
      title: "Completed daily",
      descriptionMd: "",
      projectIds: [],
      startDate: today,
      timezone: "UTC",
      frequency: "DAILY",
      interval: 1,
    },
  });
  await mutation(page, "/api/recurrences/generate", {
    id: definition.id,
    version: definition.version,
    from: today,
    to: today,
  });
  let snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  const occurrence = snapshot.workflows.find(
    (record: { payload: { definitionId?: string } }) =>
      record.payload.definitionId === definition.id,
  );
  const task = snapshot.items.find(
    (item: { id: string }) => item.id === occurrence.payload.taskId,
  );
  await mutation(page, "/api/work/update", {
    id: task.id,
    version: task.version,
    input: { status: "DONE" },
  });
  await workbench.advanceRecurrenceTime(today + "T12:00:00.000Z");
  await page.reload();
  await nav(page, w.desk.tasks);
  await page
    .getByRole("button", {
      name: zh ? "查看统计" : "View statistics",
      exact: true,
    })
    .click();
  const board = page.locator(".recurrence-statistics");
  await board.getByRole("combobox").selectOption(definition.id);
  for (const name of [
    zh ? "今天" : "Today",
    zh ? "最近 7 天" : "Last 7 Days",
    zh ? "本月" : "Current Month",
  ]) {
    await expect(
      board
        .getByRole("article")
        .filter({ has: page.getByRole("heading", { name, exact: true }) })
        .locator("dd"),
    ).toHaveText(["1", "1", "0", "100%"]);
  }
  snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    snapshot.workflows.find(
      (record: { id: string }) => record.id === occurrence.id,
    ).payload.status,
  ).toBe("COMPLETED");
});

test("2.1 Sidebar cleanup and localized DateField keyboard clear ISO persistence", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  await expect(page.locator(".workspace-switch,.workspace-avatar")).toHaveCount(
    0,
  );
  await expect(page.locator(".sidebar .section-label")).not.toContainText([
    "Atlas",
    "ATLAS",
  ]);
  await nav(page, "Atlas");
  await expect(page.locator(".atlas-conversation")).toBeVisible();
  await nav(page, w.desk.tasks);
  await page.locator(".page-header .compact-create").click();
  const actualEditor = page.getByRole("dialog").first();
  await actualEditor
    .getByLabel(w.work.title, { exact: true })
    .fill("Localized calendar task");
  const field = actualEditor.getByRole("button", {
    name: w.desk.startDate,
    exact: true,
  });
  await expect(field).toContainText(zh ? "年 / 月 / 日" : "MM / DD / YYYY");
  await chooseDate(page, field, "2026-10-03");
  await expect(field).toContainText(zh ? "2026年10月3日" : "Oct 3, 2026");
  await field.click();
  const popover = page.locator(".calendar-popover");
  await popover
    .getByRole("button", { name: "2026-10-03", exact: true })
    .focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    popover.getByRole("button", { name: "2026-10-04", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(field).toContainText(zh ? "2026年10月4日" : "Oct 4, 2026");
  await field.click();
  await page.keyboard.press("Escape");
  await expect(popover).not.toBeVisible();
  await expect(field).toBeFocused();
  await field.click();
  await popover
    .getByRole("button", { name: zh ? "清除" : "Clear", exact: true })
    .click();
  await expect(field).toContainText(zh ? "年 / 月 / 日" : "MM / DD / YYYY");
  await chooseDate(page, field, "2026-10-03");
  await actualEditor
    .getByRole("button", { name: w.common.create, exact: true })
    .click();
  await expect(actualEditor).not.toBeVisible();
  await expect
    .poll(
      async () => {
        const synced = await (
          await page.request.get(workbench.url + "/api/snapshot")
        ).json();
        return synced.items.find(
          (item: { title: string }) => item.title === "Localized calendar task",
        )?.startDate;
      },
      {
        message:
          "local ISO date reaches the bound workspace through asynchronous replay",
      },
    )
    .toBe("2026-10-03");
  const snapshot = await page.request.get(workbench.url + "/api/snapshot");
  expect(snapshot.ok()).toBeTruthy();
  const data = await snapshot.json();
  expect(
    data.items.find(
      (item: { title: string }) => item.title === "Localized calendar task",
    ).startDate,
  ).toBe("2026-10-03");
  await page.screenshot({
    path: info.outputPath("localized-date-sidebar.png"),
    fullPage: true,
  });
});

test("2.1 Repeat draft conversion and occurrence versus series editing preserve identities", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh"),
    text = (cn: string, en: string) => (zh ? cn : en);
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.tasks);
  await expect(page.locator(".recurrence-manager")).toHaveCount(0);
  await page.locator(".page-header .compact-create").click();
  let editor = page.locator(".task-editor-surface");
  await editor
    .getByLabel(w.work.title, { exact: true })
    .fill("First repeating task");
  await editor
    .getByRole("button", {
      name: /^(\+ 更多设置|\+ More settings)$/,
      exact: true,
    })
    .click();
  await editor.locator(".task-advanced summary").click();
  const repeat = editor.getByLabel(text("重复", "Repeat"), { exact: true });
  await expect(repeat).toHaveValue("NONE");
  await repeat.selectOption("DAILY");
  await editor
    .getByText(text("高级重复设置", "Advanced recurrence settings"), {
      exact: true,
    })
    .click();
  await editor
    .getByRole("button", { name: text("时区", "Timezone"), exact: true })
    .click();
  const utcLabel = await page.evaluate(
    () =>
      new Intl.DateTimeFormat(document.documentElement.lang || "en-US", {
        timeZone: "UTC",
        timeZoneName: "longGeneric",
      })
        .formatToParts(new Date("2026-01-15T12:00:00Z"))
        .find((part) => part.type === "timeZoneName")!.value,
  );
  await page.getByRole("option", { name: utcLabel, exact: true }).click();
  await chooseDate(
    page,
    editor.getByRole("button", {
      name: text("首次日期", "First date"),
      exact: true,
    }),
    new Date().toISOString().slice(0, 10),
  );
  await editor
    .getByRole("button", { name: w.common.create, exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  await waitForLocalReplay(page);
  const load = async () =>
    (await page.request.get(workbench.url + "/api/snapshot")).json();
  let state = await load();
  const task = state.items.find(
    (r: { title: string }) => r.title === "First repeating task",
  );
  expect(
    state.items.filter(
      (r: { title: string }) => r.title === "First repeating task",
    ),
  ).toHaveLength(1);
  const occurrence = state.workflows.find(
    (r: { payload: { taskId?: string } }) => r.payload.taskId === task.id,
  );
  const definition = state.workflows.find(
    (r: { id: string }) => r.id === occurrence.payload.definitionId,
  );
  const historicalSnapshot = occurrence.payload.ruleSnapshot;
  await page
    .locator(".task-card")
    .filter({ hasText: "First repeating task" })
    .locator(".task-title")
    .press("Enter");
  editor = page.locator(".task-editor-surface");
  await editor.locator(".task-advanced summary").click();
  await editor
    .getByRole("button", {
      name: text("编辑本次", "Edit this occurrence"),
      exact: true,
    })
    .click();
  await editor
    .getByLabel(w.work.title, { exact: true })
    .fill("Only this occurrence");
  await editor
    .getByRole("button", { name: w.common.save, exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  await waitForLocalReplay(page);
  state = await load();
  expect(
    state.workflows.find((r: { id: string }) => r.id === definition.id).payload
      .title,
  ).toBe("First repeating task");
  await page
    .locator(".task-card")
    .filter({ hasText: "Only this occurrence" })
    .locator(".task-title")
    .press("Enter");
  await editor.locator(".task-advanced summary").click();
  await editor
    .getByRole("button", {
      name: text("编辑整个系列", "Edit entire series"),
      exact: true,
    })
    .click();
  await editor
    .getByLabel(w.work.title, { exact: true })
    .fill("Future series title");
  await editor
    .getByRole("button", { name: w.common.save, exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  await waitForLocalReplay(page);
  state = await load();
  expect(state.items.find((r: { id: string }) => r.id === task.id).title).toBe(
    "Only this occurrence",
  );
  expect(
    state.workflows.find((r: { id: string }) => r.id === definition.id).payload
      .title,
  ).toBe("Future series title");
  expect(
    state.workflows.find((r: { id: string }) => r.id === occurrence.id).payload
      .ruleSnapshot,
  ).toEqual(historicalSnapshot);
  const normal = await mutation(page, "/api/work/create", {
    title: "Convert ordinary task",
  });
  await page.reload();
  await page
    .locator(".task-card")
    .filter({ hasText: "Convert ordinary task" })
    .locator(".task-title")
    .press("Enter");
  await editor.locator(".task-advanced summary").click();
  await editor
    .getByLabel(text("重复", "Repeat"), { exact: true })
    .selectOption("WEEKLY");
  await editor
    .getByRole("button", { name: w.common.save, exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  await waitForLocalReplay(page);
  state = await load();
  expect(
    state.items.filter(
      (r: { title: string }) => r.title === "Convert ordinary task",
    ),
  ).toHaveLength(1);
  expect(
    state.workflows.filter(
      (r: { payload: { taskId?: string } }) => r.payload.taskId === normal.id,
    ),
  ).toHaveLength(1);
  await page
    .getByRole("button", {
      name: text("查看统计", "View statistics"),
      exact: true,
    })
    .click();
  await expect(page.locator(".recurrence-statistics")).toBeVisible();
  await page.screenshot({
    path: info.outputPath("recurrence-detail.png"),
    fullPage: true,
  });
});

test("2.1 Graph Workspace directed depth dependency hops URL refresh Back and Inspector", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh"),
    text = (cn: string, en: string) => (zh ? cn : en);
  await unlock(page, workbench.url, workbench.secret, w);
  const root = await mutation(page, "/api/work/create", {
    title: "Graph root",
    type: "PROJECT",
  });
  const child = await mutation(page, "/api/work/create", {
    title: "Graph child",
    type: "PROJECT",
    parentProjectId: root.id,
  });
  await mutation(page, "/api/work/create", {
    title: "Graph grandchild",
    type: "PROJECT",
    parentProjectId: child.id,
  });
  const tasks = [];
  for (let i = 0; i < 4; i++)
    tasks.push(
      await mutation(page, "/api/work/create", {
        title: "Hop task " + i,
        projectIds: [root.id],
      }),
    );
  for (let i = 1; i < tasks.length; i++)
    await mutation(page, "/api/edge/create", {
      fromId: tasks[i - 1].id,
      toId: tasks[i].id,
    });
  await page.goto(
    workbench.url +
      "/#graph/project/" +
      root.id +
      "?mode=structure&depth=1&back=" +
      encodeURIComponent("#projects/" + root.id),
  );
  const workspace = page.locator(".graph-workspace");
  await expect(
    workspace.getByRole("button", { name: "Graph child", exact: true }),
  ).toBeVisible();
  await expect(
    workspace.getByRole("button", { name: "Graph grandchild", exact: true }),
  ).toHaveCount(0);
  await workspace
    .getByRole("button", {
      name: text("展开选项", "Expansion options"),
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("menuitem", {
      name: text("展开两层", "Expand two levels"),
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("graph-expansion.png"),
    animations: "disabled",
  });
  await page
    .getByRole("menuitem", {
      name: text("展开两层", "Expand two levels"),
      exact: true,
    })
    .click();
  await expect(
    workspace.getByRole("button", { name: "Graph grandchild", exact: true }),
  ).toBeVisible();
  const expandChild = workspace.getByRole("button", {
    name: text("展开子项目：", "Expand children: ") + "Graph child",
    exact: true,
  });
  await expandChild.click();
  await expect(
    workspace.getByRole("button", { name: "Graph grandchild", exact: true }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(/depth=2/);
  await expect(page).toHaveURL(/manual=1/);
  await page.reload();
  await expect(
    workspace.getByRole("button", { name: "Graph grandchild", exact: true }),
  ).toHaveCount(0);
  await expandChild.click();
  await expect(
    workspace.getByRole("button", { name: "Graph grandchild", exact: true }),
  ).toBeVisible();
  await workspace
    .getByRole("button", { name: "Graph grandchild", exact: true })
    .click();
  await expect(
    workspace.getByRole("complementary", {
      name: text("检查器", "Inspector"),
      exact: true,
    }),
  ).toContainText("Graph grandchild");
  await page.reload();
  await expect(
    workspace.getByRole("button", { name: "Graph grandchild", exact: true }),
  ).toBeVisible();
  await expect(
    workspace.getByRole("complementary", {
      name: text("检查器", "Inspector"),
      exact: true,
    }),
  ).toContainText("Graph grandchild");
  await workspace
    .getByRole("button", { name: text("图形", "Graph"), exact: true })
    .click();
  await expect(workspace.locator(".react-flow__node")).toHaveCount(3);
  await workspace
    .getByRole("button", { name: text("放大", "Zoom in"), exact: true })
    .click();
  await expect(page).toHaveURL(/viewport=/);
  const viewportTransform = await workspace
    .locator(".react-flow__viewport")
    .getAttribute("style");
  await page.reload();
  await expect(workspace.locator(".react-flow__node")).toHaveCount(3);
  await expect(workspace.locator(".react-flow__viewport")).toHaveAttribute(
    "style",
    viewportTransform!,
  );
  await expect(page).toHaveURL(/view=graph/);
  await page.goto(
    workbench.url +
      "/#graph/project/" +
      root.id +
      "?mode=dependencies&focus=" +
      tasks[1].id +
      "&hops=1&back=" +
      encodeURIComponent("#projects/" + root.id),
  );
  await expect(workspace.locator(".react-flow__node")).toHaveCount(3);
  await workspace
    .getByRole("button", {
      name: text("扩展两层", "Expand two levels"),
      exact: true,
    })
    .click();
  await expect(workspace.locator(".react-flow__node")).toHaveCount(4);
  await expect(page).toHaveURL(/hops=2/);
  await workspace
    .getByRole("button", { name: text("适应视图", "Fit View"), exact: true })
    .click();
  await expect
    .poll(() =>
      workspace
        .locator(".react-flow__viewport")
        .evaluate(
          (element) =>
            new DOMMatrixReadOnly(getComputedStyle(element).transform).a,
        ),
    )
    .toBeGreaterThanOrEqual(0.59);
  await workspace
    .locator(".react-flow__node")
    .filter({ hasText: "Hop task 2" })
    .click();
  await expect(
    workspace.getByRole("complementary", {
      name: text("检查器", "Inspector"),
      exact: true,
    }),
  ).toContainText("Hop task 2");
  const viewport = await workspace
    .locator(".react-flow__viewport")
    .getAttribute("style");
  await workspace
    .locator(".react-flow__node")
    .filter({ hasText: "Hop task 1" })
    .click();
  await expect(workspace.locator(".react-flow__viewport")).toHaveAttribute(
    "style",
    viewport!,
  );
  await page.reload();
  await expect(workspace.locator(".react-flow__node")).toHaveCount(4);
  await expect(
    workspace.getByRole("complementary", {
      name: text("检查器", "Inspector"),
      exact: true,
    }),
  ).toContainText("Hop task 1");
  const selectedNode = workspace
    .locator(".react-flow__node")
    .filter({ hasText: "Hop task 1" });
  await selectedNode.click({ button: "right" });
  const nodeMenu = page.getByRole("menu", {
    name: text("节点操作", "Node actions"),
    exact: true,
  });
  await expect(
    nodeMenu.getByRole("menuitem", {
      name: text("打开", "Open"),
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(nodeMenu).toHaveCount(0);
  await expect(
    workspace.getByRole("complementary", {
      name: text("检查器", "Inspector"),
      exact: true,
    }),
  ).toContainText("Hop task 1");
  await expect(page).toHaveURL(/hops=2/);
  // Atlas is not an Inspector tab; it opens as its own floating surface.
  const inspector = workspace.getByRole("complementary", {
    name: text("检查器", "Inspector"),
    exact: true,
  });
  await expect(
    inspector.getByRole("button", { name: "Atlas", exact: true }),
  ).toHaveCount(0);
  await workspace.getByRole("button", { name: "Atlas", exact: true }).click();
  const atlasFloat = page.getByRole("dialog", {
    name: text("Atlas 助手", "Atlas assistant"),
    exact: true,
  });
  await expect(atlasFloat).toBeVisible();
  await atlasFloat
    .getByRole("button", {
      name: text("关闭 Atlas", "Close Atlas"),
      exact: true,
    })
    .click();
  await expect(atlasFloat).toHaveCount(0);
  await expect(inspector).toContainText("Hop task 1");
  await workspace
    .getByRole("button", { name: text("适应视图", "Fit View"), exact: true })
    .click();
  await page.screenshot({
    path: info.outputPath("graph-workspace.png"),
    fullPage: true,
  });
  await workspace
    .getByRole("button", { name: text("返回", "Back"), exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp("#projects/" + root.id));
});

test("2.1 Knowledge Graph workspace local hops excludes isolated universe and restores URL", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh"),
    text = (cn: string, en: string) => (zh ? cn : en);
  await unlock(page, workbench.url, workbench.secret, w);
  const space = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: { kind: "SPACE", title: "Graph sources", bodyMd: "", spaceId: null },
  });
  const c = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "DOCUMENT",
      title: "Graph C",
      bodyMd: "# C",
      spaceId: space.id,
    },
  });
  const b = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "DOCUMENT",
      title: "Graph B",
      bodyMd: "[[Graph C]]",
      spaceId: space.id,
    },
  });
  const a = await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "DOCUMENT",
      title: "Graph A",
      bodyMd: "[[Graph B]]",
      spaceId: space.id,
    },
  });
  await mutation(page, "/api/library/save", {
    id: null,
    version: 0,
    input: {
      kind: "DOCUMENT",
      title: "Isolated graph document",
      bodyMd: "# Isolated",
      spaceId: space.id,
    },
  });
  await page.goto(
    workbench.url + "/#graph/document/" + a.id + "?mode=knowledge&hops=1",
  );
  const workspace = page.locator(".graph-workspace");
  const nodes = workspace.locator(
    '.react-flow__node:not([data-id^="space-cluster:"])',
  );
  await expect(nodes).toHaveCount(2);
  await expect(nodes.filter({ hasText: "Graph C" })).toHaveCount(0);
  await workspace
    .getByRole("button", {
      name: info.project.name.endsWith("zh") ? "直接关系" : "Direct relations",
      exact: true,
    })
    .click();
  await expect(nodes).toHaveCount(3);
  await expect(page).toHaveURL(/hops=2/);
  await page.reload();
  await expect(nodes).toHaveCount(3);
  await workspace
    .getByRole("button", {
      name: text("工作区", "Entire workspace"),
      exact: true,
    })
    .click();
  await expect(nodes).toHaveCount(3);
  await expect(
    nodes.filter({ hasText: "Isolated graph document" }),
  ).toHaveCount(0);
  await workspace
    .locator('header input[type="search"]')
    .fill("Isolated graph document");
  await workspace
    .getByRole("option", { name: "Isolated graph document", exact: true })
    .click();
  await expect(nodes).toHaveCount(1);
  await expect(
    workspace.getByRole("complementary", {
      name: text("检查器", "Inspector"),
      exact: true,
    }),
  ).toContainText("Isolated graph document");
  await page.reload();
  await expect(nodes).toHaveCount(1);
  await expect(
    workspace.getByRole("complementary", {
      name: text("检查器", "Inspector"),
      exact: true,
    }),
  ).toContainText("Isolated graph document");
  expect(b.id).not.toBe(c.id);
  await page.screenshot({
    path: info.outputPath("knowledge-graph-workspace.png"),
    fullPage: true,
  });
});

test("Agent Harness safety boundaries reject unknown invalid tools, enforce steps and writes, reject review and stale task versions", async ({
  page,
  workbench,
}, info) => {
  test.setTimeout(120000);
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const task = await mutation(page, "/api/work/create", {
    title: "Version guarded task",
  });
  await page.keyboard.press("Control+j");
  const assistant = page.getByRole("complementary", {
    name: "Atlas Assistant",
  });
  const approval = assistant.getByRole("region", {
    name: zh ? "工具审批" : "Tool approval",
  });
  const snapshot = async () =>
    (await page.request.get(workbench.url + "/api/snapshot")).json();
  const latest = async () =>
    (
      await (await page.request.get(workbench.url + "/api/ai")).json()
    ).runs.find((run: { parentRunId?: string }) => !run.parentRunId);
  for (const mode of [
    "unknown",
    "invalid",
    "steps",
    "reject",
    "conflict",
    "writes",
  ]) {
    await assistant
      .getByRole("button", {
        name: zh ? "新对话" : "New conversation",
        exact: true,
      })
      .click();
    await assistant
      .getByRole("textbox", { name: /^(Ask Atlas|向 Atlas 提问)$/ })
      .fill(`boundary:${mode} task=${task.id}`);
    await assistant.getByRole("button", { name: /^(Send|发送)$/ }).click();
    await assistant
      .getByRole("button", { name: /Approve request|批准本次请求/ })
      .click();
    if (["reject", "conflict", "writes"].includes(mode)) {
      await expect(approval).toBeVisible();
      if (mode === "conflict")
        await mutation(page, "/api/work/update", {
          id: task.id,
          version: 1,
          input: { title: "Human changed task" },
        });
      const count = mode === "writes" ? 6 : 1;
      for (let index = 0; index < count; index++) {
        if (mode === "writes")
          await expect(approval).toContainText(`Bounded write ${index + 1}`);
        await approval
          .getByRole("button", {
            name:
              mode === "reject"
                ? zh
                  ? "拒绝"
                  : "Reject"
                : zh
                  ? "批准"
                  : "Approve",
            exact: true,
          })
          .click();
      }
    }
    await expect
      .poll(async () => (await latest()).status)
      .toBe(["reject", "conflict"].includes(mode) ? "SUCCEEDED" : "FAILED");
    const run = await latest();
    if (["steps", "writes"].includes(mode))
      expect(run.harness.status).toBe("LIMIT_REACHED");
    if (mode === "steps") expect(run.harness.steps).toBe(8);
    if (mode === "conflict") {
      expect(
        run.harness.messages.some(
          (message: { text: string }) =>
            message.text === '{"error":"VERSION_CONFLICT"}',
        ),
      ).toBe(true);
      expect(
        (await snapshot()).items.find(
          (item: { id: string }) => item.id === task.id,
        ).status,
      ).not.toBe("DONE");
    }
    if (mode === "reject")
      expect(
        run.harness.messages.some(
          (message: { text: string }) =>
            message.text === '{"error":"HUMAN_REJECTED"}',
        ),
      ).toBe(true);
    expect(
      (await snapshot()).items.filter(
        (item: { title: string }) =>
          item.title === "Must not be created" || item.title === "Unsafe",
      ),
    ).toHaveLength(0);
  }
  const tasks = (await snapshot()).items.filter((item: { title: string }) =>
    item.title.startsWith("Bounded write"),
  );
  expect(tasks).toHaveLength(5);
  await page.reload();
  await page.keyboard.press("Control+j");
  await expect(assistant.locator('[data-message-kind="ERROR"]')).toContainText(
    "LIMIT_REACHED",
  );
});

test("Calendar dense Agenda keeps 1500 rows bounded and long titles readable", async ({
  page,
  workbench,
}, info) => {
  test.setTimeout(180000);
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const identity = await (
    await page.request.get(workbench.url + "/api/session")
  ).json();
  await workbench.seedPerformance(identity.context);
  const title = "A long Calendar task title with readable full context "
    .repeat(3)
    .trim();
  await mutation(page, "/api/work/update", {
    id: "perf-task-1",
    version: 1,
    input: { title },
  });
  await page.reload();
  await waitForFixtureReplica(page);
  await nav(page, w.desk.calendar);
  // Seeded dates are UTC dates; explicitly inspect that day even across midnight.
  const fixtureDay = new Date().toISOString().slice(0, 10);
  await page.getByRole("button", { name: fixtureDay, exact: true }).click();
  const due = page.locator('.calendar-agenda-section[data-kind="◇"]');
  const scroll = due.locator(".virtual-task-scroll");
  const dueToday = v22PerformanceFixture(
    identity.context,
    new Date().toISOString().slice(0, 10),
  ).tasks.filter(
    (task) => task.dueDate === new Date().toISOString().slice(0, 10),
  );
  expect(dueToday).toHaveLength(1200);
  await expect(scroll).toHaveAttribute(
    "data-task-count",
    String(dueToday.length),
  );
  await expect(scroll).toHaveAttribute("data-row-height", "fixed");
  await expect(due.locator(".calendar-event-row").first()).toBeVisible();
  expect(await due.locator(".calendar-event-row").count()).toBeLessThan(40);
  await expect
    .poll(() =>
      due.locator(".calendar-event-row").evaluateAll((elements) => {
        const rows = elements.map((element) => element.getBoundingClientRect());
        return {
          multipleRows: rows.length > 1,
          minHeight: Math.round(Math.min(...rows.map((row) => row.height))),
          maxHeight: Math.round(Math.max(...rows.map((row) => row.height))),
          noOverlap: rows
            .slice(1)
            .every((row, index) => row.top >= rows[index]!.bottom - 0.5),
        };
      }),
    )
    .toEqual({
      multipleRows: true,
      minHeight: 44,
      maxHeight: 44,
      noOverlap: true,
    });
  const fullTitle = due
    .locator(".calendar-event-row")
    .filter({ hasText: title });
  await expect(fullTitle).toHaveAttribute("title", title);
  const snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  const lastTask = snapshot.items
    .filter((item: { type: string }) => item.type === "TASK")
    .at(-1);
  expect(lastTask).toBeDefined();
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(due.getByText(lastTask.title, { exact: true })).toBeVisible();
});

test("Calendar collapsed secondary tasks do not mount virtual rows", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  for (let index = 0; index < 110; index++)
    await mutation(page, "/api/work/create", {
      title: `Collapsed overdue ${index}`,
      priority: "LOW",
      dueDate: "1999-01-01",
    });
  await page.reload();
  await nav(page, w.desk.calendar);
  const secondary = page.locator(".calendar-secondary");
  await expect(secondary).toBeVisible();
  await expect(secondary.locator(".virtual-task-scroll")).toHaveCount(0);
  await expect(secondary.locator(".calendar-event-row")).toHaveCount(0);
  await secondary.locator(":scope > summary").click();
  const group = secondary.locator("details").first();
  await expect(group).toBeVisible();
  await expect(group.locator(".virtual-task-scroll")).toHaveCount(0);
  await group.locator(":scope > summary").click();
  await expect(group.locator(".virtual-task-scroll")).toHaveAttribute(
    "data-task-count",
    "110",
  );
  await expect(group.locator(".calendar-event-row").first()).toBeVisible();
  expect(await group.locator(".calendar-event-row").count()).toBeLessThan(40);
  await group.locator(":scope > summary").click();
  await expect(group.locator(".calendar-event-row")).toHaveCount(0);
  await secondary.locator(":scope > summary").click();
  await expect(secondary.locator("details")).toHaveCount(0);
});

test("Reminder editor shows concise defaults and guards its local body draft", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.calendar);
  await page
    .getByRole("button", {
      name: zh ? "添加提醒" : "Add reminder",
      exact: true,
    })
    .click();
  const editor = page.getByRole("dialog", {
    name: zh ? "提醒" : "Reminder",
    exact: true,
  });
  await expect(editor.locator("textarea,.hierarchy-picker")).toHaveCount(0);
  await expect(
    editor.locator(".ui-editor-footer .ui-button-primary"),
  ).toHaveCount(1);
  await editor
    .getByLabel(zh ? "标题" : "Title", { exact: true })
    .fill("Safe reminder draft");
  await editor
    .getByRole("button", {
      name: zh ? "+ 添加内容" : "+ Add body",
      exact: true,
    })
    .click();
  await editor
    .getByLabel(zh ? "内容" : "Body", { exact: true })
    .fill("Keep this Markdown\nSecond line");
  await editor
    .getByRole("button", { name: zh ? "关闭" : "Close", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: zh ? "保留未保存的提醒？" : "Keep the unsaved reminder?",
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("button", {
      name: zh ? "继续编辑" : "Keep editing",
      exact: true,
    })
    .click();
  await expect(
    editor.getByLabel(zh ? "内容" : "Body", { exact: true }),
  ).toHaveValue("Keep this Markdown\nSecond line");
  const before = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    before.reminders.some(
      (entry: { title: string }) => entry.title === "Safe reminder draft",
    ),
  ).toBe(false);
  await editor
    .getByRole("button", { name: zh ? "保存" : "Save", exact: true })
    .click();
  await expect(editor).toBeHidden();
  await waitForLocalReplay(page);
  const saved = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    saved.reminders.find(
      (entry: { title: string }) => entry.title === "Safe reminder draft",
    ),
  ).toMatchObject({
    bodyMd: "Keep this Markdown\nSecond line",
    notifyMode: "NONE",
  });
});

test("2.2 Calendar selects day independently and formal reminders create edit complete dismiss", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.calendar);
  await page.locator(".calendar-day.is-today").click();
  await expect(page.locator(".document-pane")).toHaveCount(0);
  await expect(
    page.locator(".calendar-panel").getByTestId("calendar-timezone"),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: zh ? "添加提醒" : "Add reminder",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", {
    name: zh ? "提醒" : "Reminder",
    exact: true,
  });
  await dialog
    .getByLabel(zh ? "标题" : "Title", { exact: true })
    .fill("Dentist reminder");
  await dialog.getByLabel(zh ? "时间" : "Time", { exact: true }).fill("14:30");
  await dialog
    .getByLabel(zh ? "通知" : "Notification", { exact: true })
    .selectOption("MINUTES_BEFORE");
  await dialog.getByLabel(zh ? "提前分钟" : "Minutes before").fill("30");
  const allDay = dialog.getByLabel(zh ? "全天" : "All day", { exact: true });
  await expect(allDay).not.toBeChecked();
  await allDay.check();
  await expect(
    dialog.getByLabel(zh ? "时间" : "Time", { exact: true }),
  ).toHaveValue("");
  await expect(
    dialog.getByLabel(zh ? "通知" : "Notification", { exact: true }),
  ).toHaveValue("NONE");
  await expect(
    dialog.getByLabel(zh ? "提前分钟" : "Minutes before"),
  ).toHaveCount(0);
  await allDay.uncheck();
  await expect(
    dialog.getByLabel(zh ? "时间" : "Time", { exact: true }),
  ).toHaveValue("09:00");
  await dialog.getByLabel(zh ? "时间" : "Time", { exact: true }).fill("14:30");
  await dialog
    .getByLabel(zh ? "通知" : "Notification", { exact: true })
    .selectOption("MINUTES_BEFORE");
  await dialog.getByLabel(zh ? "提前分钟" : "Minutes before").fill("30");
  await dialog
    .getByRole("button", { name: zh ? "保存" : "Save", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const panel = page.locator(".calendar-reminders");
  await expect(panel).toContainText("Dentist reminder");
  await waitForLocalReplay(page);
  const snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(snapshot.reminders).toHaveLength(1);
  expect(snapshot.items).toHaveLength(0);
  expect(snapshot.reminders[0]).toMatchObject({
    notifyMode: "MINUTES_BEFORE",
    notifyOffsetMinutes: 30,
    time: "14:30",
    state: "ACTIVE",
  });
  await panel
    .getByRole("button", { name: "14:30 Dentist reminder", exact: true })
    .click();
  await dialog
    .getByLabel(zh ? "标题" : "Title", { exact: true })
    .fill("Updated reminder");
  await dialog
    .getByRole("button", { name: zh ? "保存" : "Save", exact: true })
    .click();
  await expect(panel).toContainText("Updated reminder");
  await panel
    .getByRole("button", { name: zh ? "完成" : "Complete", exact: true })
    .click();
  await expect(panel).toContainText(zh ? "已完成" : "Done");
  await waitForLocalReplay(page);
  const entry = (
    await (await page.request.get(workbench.url + "/api/snapshot")).json()
  ).reminders[0];
  const {
    title,
    bodyMd,
    day,
    time,
    timezone,
    notifyMode,
    notifyOffsetMinutes,
    linkedProjectId,
    linkedTaskId,
  } = entry;
  await mutation(page, "/api/reminders/save", {
    id: entry.id,
    version: entry.version,
    input: {
      title,
      bodyMd,
      day,
      time,
      timezone,
      notifyMode,
      notifyOffsetMinutes,
      linkedProjectId,
      linkedTaskId,
      state: "ACTIVE",
    },
  });
  await page.reload();
  await expect(
    page.locator(`.calendar-day[aria-label="${entry.day}"]`),
  ).toHaveAttribute("aria-pressed", "true");
  await panel
    .getByRole("button", { name: zh ? "忽略" : "Dismiss", exact: true })
    .click();
  await expect(panel).toContainText(zh ? "已忽略" : "Dismissed");
  await panel
    .getByRole("button", {
      name: (zh ? "更多操作：" : "More actions: ") + "Updated reminder",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", {
      name: zh ? "删除提醒" : "Delete reminder",
      exact: true,
    })
    .click();
  await expect(
    panel.getByRole("button", { name: "14:30 Updated reminder", exact: true }),
  ).toHaveCount(0);
  await panel
    .getByRole("button", { name: zh ? "撤销" : "Undo", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "14:30 Updated reminder", exact: true }),
  ).toBeVisible();
  await waitForLocalReplay(page);
  const restoredReminder = (
    await (await page.request.get(workbench.url + "/api/snapshot")).json()
  ).reminders[0];
  expect(restoredReminder.deletedAt).toBeNull();
  expect(restoredReminder.state).toBe("DISMISSED");
  await page.screenshot({
    path: info.outputPath("calendar-reminders.png"),
    fullPage: true,
  });
});

for (const [width, height] of [
  [1024, 768],
  [1280, 800],
  [1440, 900],
  [1920, 1080],
] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`v2.3 visual matrix ${width}x${height} ${theme}`, async ({
      page,
      workbench,
    }, info) => {
      test.setTimeout(180000);
      const w = words(info.project.name),
        zh = info.project.name.endsWith("zh");
      await page.setViewportSize({ width, height });
      await page.addInitScript(
        (value) => localStorage.setItem("orivane-atlas.theme", value),
        theme,
      );
      await unlock(page, workbench.url, workbench.secret, w);
      const identity = await (
        await page.request.get(workbench.url + "/api/session")
      ).json();
      await workbench.seedPerformance(identity.context);
      await page.reload();
      await waitForFixtureReplica(page);
      await expect(page.locator(".app-shell")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const directory = info.outputPath(`visual-${width}x${height}-${theme}`);
      mkdirSync(directory, { recursive: true });
      const capture = async (name: string) => {
        await page.evaluate(() => document.fonts.ready);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          name + " page overflow",
        ).toBe(true);
        await page.screenshot({ path: join(directory, name + ".png") });
      };
      const go = async (hash: string) => {
        await page.evaluate((value) => {
          location.hash = value;
        }, hash);
      };
      await go("#overview");
      await expect(page.locator(".overview-grid")).toBeVisible();
      await capture("01-home");
      await go("#focus");
      await expect(page.locator(".page-header h1")).toHaveText(w.desk.focus);
      await capture("02-focus");
      await go("#tasks?tab=all&view=list");
      await expect(
        page.locator(".task-list .virtual-task-scroll"),
      ).toHaveAttribute("data-task-count", "1500");
      await capture("03-tasks-list");
      await go("#tasks?tab=all&view=board");
      await expect(page.locator(".board")).toBeVisible();
      await capture("04-tasks-board");
      await go("#projects");
      await expect(page.locator(".projects-overview")).toBeVisible();
      await capture("05-project-list");
      await go("#projects/perf-project-1?tab=overview&scope=SUBTREE");
      await expect(page.locator(".project-workspace")).toBeVisible();
      await capture("06-project-overview");
      await go("#projects/perf-project-1?tab=tasks&scope=SUBTREE");
      const modes = page.locator(
        ".project-workspace .tasks-workspace .ui-segmented",
      );
      await modes
        .getByRole("button", { name: w.desk.taskWorkspace.board, exact: true })
        .click();
      await expect(page.locator(".project-workspace .board")).toBeVisible();
      await capture("07-project-board");
      await modes
        .getByRole("button", { name: zh ? "甘特图" : "Gantt", exact: true })
        .click();
      await expect(page.locator(".task-gantt")).toBeVisible();
      await capture("08-project-gantt");
      await go("#calendar");
      await expect(page.locator(".calendar-sheet")).toBeVisible();
      await capture("09-calendar");
      await go("#tasks?tab=all&view=list");
      await page
        .locator(".page-header")
        .getByRole("button", { name: w.desk.newTask, exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await capture("10-task-editor");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await go("#library");
      await page.locator(".space-card").first().press("Enter");
      await expect(page.locator(".library-document-row").first()).toBeVisible();
      await capture("12-library");
      await page
        .locator(".library-document-row")
        .filter({
          has: page.getByRole("heading", {
            name: "Perf document 0002",
            exact: true,
          }),
        })
        .press("Enter");
      await expect(page.locator(".document-pane .cm-content")).toBeVisible();
      await page
        .locator(".document-pane .ui-segmented")
        .getByRole("button", { name: w.desk.read, exact: true })
        .click();
      await capture("11-document");
      await page
        .getByRole("button", { name: zh ? "工作台" : "Workspace", exact: true })
        .click();
      await go("#graph/document/perf-document-0?view=graph&hops=1");
      await expect(page.locator(".react-flow__node").first()).toBeVisible();
      await capture("13-graph");
      await go("#ai");
      await expect(page.locator(".conversation-list")).toBeVisible();
      await capture("14-atlas");
      await go("#settings");
      await expect(page.locator(".settings-page")).toBeVisible();
      await capture("16-settings");
      await go("#account");
      await page
        .getByRole("tab", {
          name: zh ? "API 与模型" : "API & models",
          exact: true,
        })
        .click();
      await expect(page.locator(".model-settings").first()).toBeVisible();
      await capture("15-ai-settings");
      await go("#trash");
      await expect(page.locator(".page-header h1")).toHaveText(w.desk.trash);
      await capture("17-trash");
      await info.attach("visual-matrix-directory.txt", {
        body: directory,
        contentType: "text/plain",
      });
    });
  }
}

test("v2.3 note right click opens shared actions and trash undo preserves Markdown", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  await mutation(page, "/api/note/save", {
    id: null,
    version: 0,
    input: {
      kind: "NOTE",
      day: null,
      title: "Context note",
      bodyMd: "First line\nSecond line",
    },
  });
  await page.reload();
  await nav(page, w.desk.notes);
  const row = page.locator(".note-card").filter({
    has: page.getByRole("heading", { name: "Context note", exact: true }),
  });
  await row.getByRole("heading").click({ button: "right" });
  await expect(page.locator(".entity-inspector")).toHaveCount(0);
  await expect(page.locator(".document-pane")).toHaveCount(0);
  const menu = page.getByRole("menu", {
    name: zh ? "更多操作：Context note" : "More actions: Context note",
    exact: true,
  });
  await menu
    .getByRole("menuitem", {
      name: zh ? "移至回收站" : "Move to Trash",
      exact: true,
    })
    .click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: /^(Undo|撤销)$/ }).click();
  await expect(row).toHaveCount(1);
  await waitForLocalReplay(page);
  const snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    snapshot.notes.find(
      (note: { title: string }) => note.title === "Context note",
    ),
  ).toMatchObject({ bodyMd: "First line\nSecond line", deletedAt: null });
});

test("v2.3 Notes search body on the server before lazy hydration", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  for (const [title, bodyMd] of [
    ["Target capture", "Private needle-body-v23 content"],
    ["Other capture", "Other content"],
  ])
    await mutation(page, "/api/note/save", {
      id: null,
      version: 0,
      input: { kind: "NOTE", day: null, title, bodyMd },
    });
  const bodyRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/document/body?"))
      bodyRequests.push(request.url());
  });
  await page.reload();
  await nav(page, w.desk.notes);
  await expect(page.locator(".note-card")).toHaveCount(2);
  expect(bodyRequests).toEqual([]);
  await page.locator(".content .search input").fill("needle-body-v23");
  await expect(page.locator(".note-card")).toHaveCount(1);
  await expect(page.locator(".note-card")).toContainText("Target capture");
  expect(bodyRequests).toEqual([]);
  const loaded = page.waitForResponse(
    (response) =>
      response.url().includes("/api/document/body?") &&
      response.status() === 200,
  );
  await page.locator(".note-card").click();
  await expect(page.locator(".entity-inspector")).toHaveCount(0);
  expect((await (await loaded).json()).bodyMd).toBe(
    "Private needle-body-v23 content",
  );
  await expect(
    pane(page).getByLabel(w.desk.noteTitle, { exact: true }),
  ).toHaveValue("Target capture");
  expect(bodyRequests.length).toBeGreaterThan(0);
});

test("v2.3 local shell paints while session network is blocked", async ({
  page,
  workbench,
}, info) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let waiting = false;
  let networkReleased = false;
  await page.route("**/api/session", async (route) => {
    waiting = true;
    await gate;
    await route.continue();
  });
  try {
    await page.goto(workbench.url, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".app-shell")).toBeVisible();
    await expect(
      page.getByRole("img", { name: "Orivane Atlas", exact: true }),
    ).toBeVisible();
    // FINAL starts a usable local workspace without requesting a session at all.
    expect(waiting).toBe(false);
    await expect
      .poll(() =>
        page.evaluate(() =>
          performance
            .getEntriesByType("paint")
            .some((entry) => entry.name === "first-contentful-paint"),
        ),
      )
      .toBe(true);
    const paint = await page.evaluate(() => ({
      firstContentfulPaintMs: performance
        .getEntriesByType("paint")
        .find((entry) => entry.name === "first-contentful-paint")!.startTime,
      shellObservedMs: performance.now(),
    }));
    expect(networkReleased).toBe(false);
    writeFileSync(
      info.outputPath("final-acceptance-shell.json"),
      JSON.stringify(
        { ...paint, sessionRequestPending: waiting, networkReleased },
        null,
        2,
      ),
    );
    await info.attach("cold-shell-before-network.json", {
      body: JSON.stringify(
        { ...paint, sessionRequestPending: waiting, networkReleased },
        null,
        2,
      ),
      contentType: "application/json",
    });
  } finally {
    networkReleased = true;
    release();
  }
  await expect(page.getByTestId("startup-shell")).toHaveCount(0);
});

for (const latencyMs of [200, 800]) {
  test(`FINAL durable restart metadata readiness with ${latencyMs}ms request latency`, async ({
    page,
    workbench,
  }, info) => {
    test.setTimeout(120000);
    const w = words(info.project.name);
    await unlock(page, workbench.url, workbench.secret, w);
    const identity = await (
      await page.request.get(workbench.url + "/api/session")
    ).json();
    await workbench.seedPerformance(identity.context);
    await waitForFixtureReplica(page);
    const requestedPaths: string[] = [];
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      requestedPaths.push(path);
      // Delay real requests; retain actual host authentication and payloads.
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
      await route.continue();
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await nav(page, w.desk.tasks);
    await expect(page.locator(".tasks-workspace")).toBeVisible();
    await expect(page.locator(".virtual-task-scroll").first()).toBeVisible();
    await taskScope(page, w.desk.taskWorkspace.all);
    await expect(
      page.locator(".task-list .virtual-task-scroll"),
    ).toHaveAttribute("data-task-count", "1500");
    const evidence = await page.evaluate(() => ({
      firstContentfulPaintMs: performance
        .getEntriesByType("paint")
        .find((entry) => entry.name === "first-contentful-paint")?.startTime,
      metadataUsableMs: performance.now(),
    }));
    expect(evidence.firstContentfulPaintMs).toBeGreaterThan(0);
    expect(requestedPaths).not.toContain("/api/snapshot");
    expect(
      requestedPaths.filter((path) => path === "/api/bootstrap"),
    ).toHaveLength(0);
    expect(requestedPaths).not.toContain("/api/document/body");
    const report = {
      ...evidence,
      artificialRequestLatencyMs: latencyMs,
      documents: 2000,
      measurement:
        "durable local replica restart; remote full bootstrap forbidden",
      decodedBootstrapBytes: 0,
      requestedPaths,
    };
    writeFileSync(
      info.outputPath(`final-acceptance-local-restart-${latencyMs}.json`),
      JSON.stringify(report, null, 2),
    );
    await info.attach("cold-metadata-readiness.json", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });
  });
}

test("v2.3 Calendar palette journal inherits the selected day", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.calendar);
  const today = await page
    .locator(".calendar-day.is-today")
    .getAttribute("aria-label");
  const selected = today!.slice(0, 8) + "15";
  await page
    .locator(".calendar-panel")
    .getByRole("button", { name: selected, exact: true })
    .click();
  await page.keyboard.press("Control+k");
  const palette = page.locator(".command-palette");
  await palette
    .getByRole("button", {
      name: zh ? "打开所选日期日记" : "Open selected day's journal",
      exact: true,
    })
    .click();
  await expect(page.locator(".document-pane .document-title")).toHaveValue(
    selected,
  );
});

test("v2.3 Calendar sheet shares day context counts and preserves its month", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh"),
    mobile = info.project.name.startsWith("mobile");
  if (!mobile) await page.setViewportSize({ width: 1024, height: 768 });
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.calendar);
  await expect(page.locator(".agenda-panel h3")).toHaveCount(0);
  const today = await page
    .locator(".calendar-day.is-today")
    .getAttribute("aria-label");
  expect(today).not.toBeNull();
  const selected = today!.slice(0, 8) + "15";
  const cell = page
    .locator(".calendar-panel")
    .getByRole("button", { name: selected, exact: true });
  await cell.click();
  await expect(cell).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".document-pane")).toHaveCount(0);
  await expect(cell).not.toHaveClass(/ui-button/);
  expect(
    await cell.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).minHeight),
    ),
  ).toBeGreaterThanOrEqual(mobile ? 56 : 120);
  expect(
    await page
      .locator(".calendar-grid")
      .evaluate((element) => getComputedStyle(element).gap),
  ).toBe("0px");
  await page
    .getByRole("button", { name: zh ? "+ 任务" : "+ Task", exact: true })
    .click();
  const taskDialog = page.getByRole("dialog");
  await expect(taskDialog.locator(".date-field-validity").first()).toHaveValue(
    selected,
  );
  await taskDialog
    .getByLabel(w.work.title, { exact: true })
    .fill("Selected day action");
  await taskDialog
    .getByRole("button", { name: w.common.create, exact: true })
    .click();
  await expect(taskDialog).toHaveCount(0);
  await expect(cell).toContainText("Selected day action");
  if (mobile) {
    await expect(cell.locator(".calendar-preview")).toBeHidden();
    await expect(cell.locator(".calendar-mobile-count")).toBeVisible();
    await expect(cell.locator(".calendar-mobile-count")).toHaveAttribute(
      "aria-label",
      "1 项任务",
    );
    await expect(page.locator(".agenda-panel")).toContainText(
      "Selected day action",
    );
  }
  await expect(
    page.locator('.calendar-agenda-section[data-kind="→"] [data-count]'),
  ).toHaveAttribute("data-count", "1");
  await page
    .getByRole("button", {
      name: zh ? "添加提醒" : "Add reminder",
      exact: true,
    })
    .click();
  const reminderDialog = page.getByRole("dialog");
  await expect(reminderDialog.locator(".date-field-validity")).toHaveValue(
    selected,
  );
  await reminderDialog
    .getByLabel(zh ? "标题" : "Title", { exact: true })
    .fill("Selected day reminder");
  await reminderDialog
    .getByRole("button", { name: zh ? "保存" : "Save", exact: true })
    .click();
  await expect(
    cell.getByLabel(zh ? "提醒" : "Reminders", { exact: true }),
  ).toHaveCount(1);
  await expect(
    page.locator(".calendar-reminders [data-count]"),
  ).toHaveAttribute("data-count", "1");
  await page
    .locator(".calendar-controls")
    .getByRole("button", { name: w.desk.nextMonth, exact: true })
    .click();
  const nextSelected = await page
    .locator('.calendar-day[aria-pressed="true"]')
    .getAttribute("aria-label");
  expect(nextSelected!.slice(0, 7)).not.toBe(selected.slice(0, 7));
  await expect(page.locator(".agenda-panel h3")).toHaveCount(0);
  await nav(page, w.desk.tasks);
  await nav(page, w.desk.calendar);
  await expect(
    page.locator('.calendar-day[aria-pressed="true"]'),
  ).toHaveAttribute("aria-label", nextSelected!);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect
    .poll(() =>
      page.evaluate(() => {
        const header = document
          .querySelector(".page-header")
          ?.getBoundingClientRect();
        const grid = document
          .querySelector(".calendar-grid")
          ?.getBoundingClientRect();
        return !!header && !!grid && grid.top >= header.bottom;
      }),
    )
    .toBe(true);
  await page.screenshot({
    path: info.outputPath("calendar-sheet-context.png"),
    fullPage: true,
  });
});
test("Atlas conversation summaries support rename archive restore delete undo and project binding", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const project = await mutation(page, "/api/work/create", {
    title: "Conversation project",
    type: "PROJECT",
  });
  const first = await mutation(page, "/api/ai/sessions/create", {
    title: "First conversation",
  });
  await mutation(page, "/api/ai/sessions/update", {
    id: first.id,
    version: first.version,
    projectId: project.id,
  });
  await mutation(page, "/api/ai/sessions/create", {
    title: "Second conversation",
  });
  const summaries = await (
    await page.request.get(workbench.url + "/api/ai/sessions")
  ).json();
  expect(summaries).toHaveLength(2);
  for (const summary of summaries) {
    expect(summary).not.toHaveProperty("messages");
    expect(summary.messageCount).toBe(0);
  }
  expect(
    summaries.find((entry: { id: string }) => entry.id === first.id).projectId,
  ).toBe(project.id);
  const messageRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/ai/sessions/messages")
      messageRequests.push(request.url());
  });
  await page.keyboard.press("Control+j");
  const assistant = page.getByRole("complementary", {
    name: "Atlas Assistant",
  });
  await expect(
    assistant.getByRole("button", { name: "Second conversation", exact: true }),
  ).toBeVisible();
  expect(messageRequests).toHaveLength(0);
  await assistant
    .getByRole("button", { name: "Second conversation", exact: true })
    .click();
  await expect.poll(() => messageRequests.length).toBe(1);
  await assistant
    .getByRole("button", {
      name: zh ? "对话筛选" : "Conversation filters",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitemcheckbox", {
      name: zh ? "项目" : "Projects",
      exact: true,
    })
    .click();
  await expect(
    assistant
      .locator(".conversation-list")
      .getByRole("heading", { name: "Conversation project", exact: true }),
  ).toBeVisible();
  await expect(
    assistant.locator(".conversation-list").getByRole("heading", {
      name: zh ? "未关联项目" : "No project",
      exact: true,
    }),
  ).toBeVisible();
  await assistant.locator(".conversation-options > button").click();
  await page
    .getByRole("menuitem", { name: zh ? "重命名" : "Rename", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: zh ? "重命名对话" : "Rename conversation",
  });
  await dialog.getByRole("textbox").fill("Renamed conversation");
  await dialog
    .getByRole("button", { name: zh ? "保存" : "Save", exact: true })
    .click();
  await expect(
    assistant.getByRole("button", {
      name: "Renamed conversation",
      exact: true,
    }),
  ).toBeVisible();
  await assistant.locator(".conversation-options > button").click();
  await page
    .getByRole("menuitem", { name: zh ? "归档" : "Archive", exact: true })
    .click();
  await expect(
    assistant.getByRole("button", {
      name: "Renamed conversation",
      exact: true,
    }),
  ).toHaveCount(0);
  await assistant
    .getByRole("button", {
      name: zh ? "对话筛选" : "Conversation filters",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitemradio", { name: zh ? "归档" : "Archived", exact: true })
    .click();
  await assistant
    .getByRole("button", { name: "Renamed conversation", exact: true })
    .click();
  await assistant.locator(".conversation-options > button").click();
  await page
    .getByRole("menuitem", { name: zh ? "恢复" : "Restore", exact: true })
    .click();
  await assistant
    .locator(".conversation-list")
    .getByRole("button", { name: zh ? "最近" : "Recent", exact: true })
    .click();
  await assistant.locator(".conversation-options > button").click();
  await page
    .getByRole("menuitem", {
      name: zh ? "删除对话" : "Delete conversation",
      exact: true,
    })
    .click();
  await expect(
    assistant.getByRole("button", {
      name: "Renamed conversation",
      exact: true,
    }),
  ).toHaveCount(0);
  await assistant
    .getByRole("button", { name: zh ? "撤销" : "Undo", exact: true })
    .click();
  await expect(
    assistant.getByRole("button", {
      name: "Renamed conversation",
      exact: true,
    }),
  ).toBeVisible();
  await assistant
    .getByRole("textbox", { name: zh ? "搜索对话" : "Search conversations" })
    .fill("First");
  await expect(
    assistant.getByRole("button", { name: /First conversation/ }),
  ).toBeVisible();
  await expect(
    assistant.getByRole("button", {
      name: "Renamed conversation",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("atlas-conversation-lifecycle.png"),
    fullPage: true,
  });
});
async function chooseBenchmarkProject(picker: Locator, path: string[]) {
  const trigger = picker.locator(".hierarchy-selected > button").last();
  if ((await trigger.getAttribute("aria-expanded")) !== "true")
    await trigger.click();
  const browser = picker.page().locator(".hierarchy-browser");
  await browser.locator("nav > button").click();
  for (const [index, title] of path.entries()) {
    const row = browser
      .locator(".ui-entity-picker-choice,.parent-tree-choice")
      .filter({ hasText: new RegExp("^" + title + "(?:\\s*›)?$") })
      .locator("..");
    await expect(row).toHaveCount(1);
    await row
      .locator(
        index === path.length - 1
          ? ".ui-entity-picker-choice,.ui-button-toggle"
          : ".ui-icon-button,.parent-tree-choice",
      )
      .click();
  }
  await expect(browser).toBeHidden();
}

test("Atlas paged history renders visible Markdown and preserves reading position when loading earlier messages", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const identity = await (
    await page.request.get(workbench.url + "/api/session")
  ).json();
  await workbench.seedPerformance(identity.context);
  await page.reload();
  await nav(page, "Atlas");
  const list = page.locator(".conversation-list .virtual-task-scroll");
  await expect(list).toHaveAttribute("data-task-count", "100");
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page
    .locator(".conversation-list")
    .getByRole("button", { name: /Perf conversation 001/ })
    .click();
  const messages = page.locator(".conversation-messages");
  const rows = messages.locator("[data-message-kind]");
  await expect(rows).toHaveCount(50);
  await expect(rows.last().locator(".markdown strong")).toHaveText("emphasis");
  expect(
    await messages.locator('[data-markdown-ready="true"]').count(),
  ).toBeLessThan(25);
  expect(
    await messages.locator('[data-markdown-ready="false"]').count(),
  ).toBeGreaterThan(0);
  await messages.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(rows.first()).toContainText("Conversation 1, message 950.");
  await expect(rows.first().locator(".markdown strong")).toHaveText("emphasis");
  await expect
    .poll(() => messages.evaluate((element) => element.scrollTop))
    .toBeLessThan(80);
  await messages
    .getByRole("button", {
      name: zh ? "加载更早消息" : "Load earlier messages",
      exact: true,
    })
    .click();
  await expect(rows).toHaveCount(100);
  await expect(rows.first()).toContainText("Conversation 1, message 900.");
  await expect(rows.first().locator(".markdown strong")).toHaveText("emphasis");
  await expect
    .poll(() => messages.evaluate((element) => element.scrollTop))
    .toBeLessThan(80);
  await page.screenshot({
    path: info.outputPath("atlas-paged-history.png"),
    fullPage: true,
  });
  await setTheme(page, "dark");
  await page.screenshot({
    path: info.outputPath("atlas-paged-history-dark.png"),
    fullPage: true,
  });
});

test("v2.2 complete release fixture interaction and editor benchmark", async ({
  page,
  workbench,
}, info) => {
  test.setTimeout(360000);
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const identity = await (
    await page.request.get(workbench.url + "/api/session")
  ).json();
  await workbench.seedPerformance(identity.context);
  await page.reload();
  await waitForFixtureReplica(page);
  const snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    snapshot.items.filter((item: { type: string }) => item.type === "PROJECT"),
  ).toHaveLength(150);
  expect(
    snapshot.items.filter((item: { type: string }) => item.type === "TASK"),
  ).toHaveLength(1500);
  expect(snapshot.edges).toHaveLength(3000);
  expect(
    snapshot.library.filter(
      (entry: { kind: string }) => entry.kind === "DOCUMENT",
    ),
  ).toHaveLength(2000);
  expect(snapshot.wikiLinks).toHaveLength(5000);
  const sessionsResponse = await page.request.get(
    workbench.url + "/api/ai/sessions",
  );
  const summaries = await sessionsResponse.json();
  expect(summaries).toHaveLength(100);
  expect(
    summaries.every(
      (entry: { messageCount: number }) => entry.messageCount === 1000,
    ),
  ).toBe(true);
  expect((await sessionsResponse.body()).length).toBeLessThan(40000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const profileProjection = process.env.ATLAS_PROFILE_PROJECTIONS === "1";
  if (profileProjection) {
    await page.evaluate(() => {
      Object.assign(globalThis, { atlasProjectionDiagnostics: [] });
      const diagnostics: {
        collection: string;
        characters: number;
        rows: number;
      }[] = [];
      Object.assign(globalThis, { atlasWorkerMessageDiagnostics: diagnostics });
      const requests = new WeakMap<Worker, Map<number, string>>();
      const original = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (
        this: Worker,
        message: unknown,
        options?: StructuredSerializeOptions | Transferable[],
      ) {
        let pending = requests.get(this);
        if (!pending) {
          pending = new Map();
          requests.set(this, pending);
          this.addEventListener("message", (event) => {
            const response = event.data as {
              id?: number;
              json?: string;
              rows?: unknown[];
              page?: boolean;
            };
            if (typeof response.id !== "number") return;
            diagnostics.push({
              collection: pending!.get(response.id) ?? "unknown",
              characters: response.json?.length ?? 0,
              rows: response.rows?.length ?? 0,
            });
            if (!response.page) pending!.delete(response.id);
          });
        }
        const request = message as {
          id?: number;
          collection?: string;
          libraryBodyChecks?: unknown;
        };
        if (typeof request.id === "number")
          pending.set(
            request.id,
            (request.collection ?? "unknown") +
              (request.libraryBodyChecks ? ":validated" : ""),
          );
        Reflect.apply(original, this, [message, options]);
      };
    });
    const scripts: { scriptId: string; url: string }[] = [];
    cdp.on("Debugger.scriptParsed", (script) => {
      if (script.url.includes("/assets/src-")) scripts.push(script);
    });
    await cdp.send("Debugger.enable");
    for (const script of scripts) {
      const { scriptSource } = await cdp.send("Debugger.getScriptSource", {
        scriptId: script.scriptId,
      });
      const method = scriptSource.indexOf("detachResult(");
      if (method < 0) continue;
      const position = scriptSource.indexOf("{", method) + 1;
      const prefix = scriptSource.slice(0, position);
      await cdp.send("Debugger.setBreakpoint", {
        location: {
          scriptId: script.scriptId,
          lineNumber: prefix.split("\n").length - 1,
          columnNumber: position - prefix.lastIndexOf("\n") - 1,
        },
        condition: `(function(){const store=this.store;if(!store.atlasReadsWrapped){store.atlasReadsWrapped=true;for(const method of ["list","getMany"]){const read=store[method];if(!read)continue;store[method]=async function(...args){const started=performance.now();const rows=await read.apply(this,args);globalThis.atlasProjectionDiagnostics.push({method,collection:method==="list"?args[1]:args[1]?.[0]?.collection,count:rows.length,startedMs:started,durationMs:performance.now()-started});return rows}}}const prototype=Object.getPrototypeOf(this);if(prototype.atlasProjectionWrapped)return false;const original=prototype.detachResult;prototype.atlasProjectionWrapped=true;prototype.detachResult=function(value){const metadata={projection:this.readProjection,detached:this.store.detachedReads===true,writes:this.writes.size,records:Array.from(this.records.values(),row=>row.entity.collection),sizes:Object.fromEntries(Object.entries(value??{}).map(([key,field])=>[key,Array.isArray(field)?field.length:typeof field==="string"?field.length:typeof field]))};const started=performance.now();try{return original.call(this,value)}finally{globalThis.atlasProjectionDiagnostics.push({...metadata,startedMs:started,durationMs:performance.now()-started})}};return false}).call(this)`,
      });
    }
  }
  if (process.env.ATLAS_PROFILE_WHOLE_GRAPH === "1") {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.start");
  }
  const metrics = async () => {
    const result = await cdp.send("Performance.getMetrics");
    return new Map(
      result.metrics.map((entry: { name: string; value: number }) => [
        entry.name,
        entry.value,
      ]),
    );
  };
  const evidence: Record<string, unknown> = {
    fixture: {
      projects: 150,
      tasks: 1500,
      edges: 3000,
      documents: 2000,
      wikiLinks: 5000,
      sessions: 100,
      messagesPerSession: 1000,
    },
    build: "Vite production release",
    metadataReadWorkers: page.workers().map((worker) => worker.url()),
    measurement:
      "CDP ScriptDuration and TaskDuration deltas; Playwright settled-DOM wall separately",
    sessionSummaryBytes: (await sessionsResponse.body()).length,
  };
  const measure = async (
    name: string,
    action: () => Promise<unknown>,
    settled: () => Promise<unknown>,
  ) => {
    const profileInteraction = process.env.ATLAS_PROFILE_INTERACTIONS === "1";
    if (profileInteraction) {
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.start");
    }
    const before = await metrics(),
      started = performance.now();
    await action();
    await settled();
    const after = await metrics();
    evidence[name] = {
      wallMs: performance.now() - started,
      ...(process.env.ATLAS_PROFILE_WHOLE_GRAPH === "1"
        ? {
            profileStartUs: (before.get("Timestamp") ?? 0) * 1000000,
            profileEndUs: (after.get("Timestamp") ?? 0) * 1000000,
          }
        : {}),
      scriptMs:
        ((after.get("ScriptDuration") ?? 0) -
          (before.get("ScriptDuration") ?? 0)) *
        1000,
      taskMs:
        ((after.get("TaskDuration") ?? 0) - (before.get("TaskDuration") ?? 0)) *
        1000,
    };
    if (profileInteraction) {
      const { profile } = await cdp.send("Profiler.stop");
      writeFileSync(
        resolve(
          ".artifacts",
          `${process.env.ATLAS_BENCHMARK_PREFIX ?? "session107"}-interaction-${name.replace(/[^a-zA-Z0-9]+/g, "-")}-${info.project.name}.cpuprofile`,
        ),
        JSON.stringify(profile),
      );
    }
  };
  await nav(page, w.desk.tasks);
  await measure(
    "Now→Scheduled",
    () =>
      page
        .getByRole("tab", {
          name: w.desk.taskWorkspace.scheduled,
          exact: true,
        })
        .click(),
    () =>
      expect(page.locator(".task-list .virtual-task-scroll")).toHaveAttribute(
        "data-task-count",
        "200",
      ),
  );
  await measure(
    "Task tab switch",
    () => taskScope(page, w.desk.taskWorkspace.all),
    () =>
      expect(page.locator(".task-list .virtual-task-scroll")).toHaveAttribute(
        "data-task-count",
        "1500",
      ),
  );
  evidence.liveListRows = await page.locator(".task-list .task-card").count();
  expect(Number(evidence.liveListRows)).toBeLessThan(100);
  const projectPicker = page.locator(
    ".project-filter-picker .hierarchy-picker",
  );
  await measure(
    "Project filter",
    () =>
      chooseBenchmarkProject(projectPicker, [
        "Perf project 001",
        "Perf project 016",
      ]),
    () => expect(page.locator(".task-list .task-card")).toHaveCount(10),
  );
  await projectPicker
    .getByRole("button", { name: "Perf project 016 ×", exact: true })
    .click();
  await expect(page.locator(".task-list .virtual-task-scroll")).toHaveAttribute(
    "data-task-count",
    "1500",
  );
  await measure(
    "List→Board",
    () =>
      page
        .locator(".ui-segmented")
        .getByRole("button", {
          name: w.desk.taskWorkspace.board,
          exact: true,
        })
        .click(),
    () => expect(page.locator(".board")).toBeVisible(),
  );
  evidence.liveBoardRows = await page.locator(".board .task-card").count();
  expect(Number(evidence.liveBoardRows)).toBeLessThan(150);
  await measure(
    "Calendar open",
    () => nav(page, w.desk.calendar),
    () =>
      expect(page.locator(".calendar-day")).toHaveCount(
        new Date(
          new Date().getFullYear(),
          new Date().getMonth() + 1,
          0,
        ).getDate(),
      ),
  );
  await measure(
    "Calendar month switch",
    () =>
      page.getByRole("button", { name: w.desk.nextMonth, exact: true }).click(),
    () => expect(page.locator(".calendar-month-header h2")).toBeVisible(),
  );
  await measure(
    "Dependency local graph",
    () =>
      page.evaluate(() => {
        location.hash =
          "#graph/project/perf-project-1?mode=dependencies&view=graph&focus=perf-task-1&scope=focus&hops=1&taskScope=PROJECT_TREE";
      }),
    () => expect(page.locator(".react-flow__node").first()).toBeVisible(),
  );
  await expect(page.locator(".task-list")).toHaveCount(0);
  // Resolve the pointer target before sampling: role-selector traversal is
  // automation preparation, not work performed when a user opens this picker.
  const focusPickerButton = page.getByRole("button", {
    name: zh ? "选择焦点任务" : "Choose focus task",
    exact: true,
  });
  await focusPickerButton.scrollIntoViewIfNeeded();
  const focusPickerBounds = await focusPickerButton.boundingBox();
  expect(focusPickerBounds).not.toBeNull();
  await measure(
    "Task picker open",
    () =>
      page.mouse.click(
        focusPickerBounds!.x + focusPickerBounds!.width / 2,
        focusPickerBounds!.y + focusPickerBounds!.height / 2,
      ),
    () => expect(page.locator(".hierarchy-browser")).toBeVisible(),
  );
  await measure(
    "Task picker drill-down",
    () =>
      page
        .locator(".hierarchy-browser")
        .getByRole("button", { name: "Perf project 016 ›", exact: true })
        .click(),
    () =>
      expect(page.locator(".hierarchy-browser")).toContainText(
        "Perf task 0016",
      ),
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".hierarchy-browser")).toHaveCount(0);
  await measure(
    "Knowledge local graph",
    () =>
      page.evaluate(() => {
        location.hash = "#graph/document/perf-document-0?view=graph&hops=1";
      }),
    () =>
      expect(
        page.locator('.react-flow__node[data-id="perf-document-0"]'),
      ).toBeVisible(),
  );
  for (const [id, kb] of [
    ["perf-document-0", 50],
    ["perf-document-1", 100],
  ] as const) {
    if (kb === 50 && process.env.ATLAS_PROFILE_WHOLE_GRAPH === "1") {
      const { profile } = await cdp.send("Profiler.stop");
      writeFileSync(
        info.outputPath("whole-graph.cpuprofile"),
        JSON.stringify(profile),
      );
    }
    await page.evaluate((documentId) => {
      location.hash = "#graph/document/" + documentId + "?view=graph&hops=1";
    }, id);
    await page
      .getByRole("button", {
        name: zh ? "打开详情" : "Open details",
        exact: true,
      })
      .click();
    const editor = page.locator(".document-pane:not([hidden]) .cm-content");
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press("Control+End");
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.start");
    const samples: number[] = [];
    for (let index = 0; index < 30; index++) {
      const before = await metrics();
      // This is the trusted browser input used by Playwright's keyboard API.
      // Calling CDP directly keeps per-action trace DOM snapshots outside the
      // CPU sample. Saved Markdown below still verifies all thirty inputs.
      await cdp.send("Input.insertText", { text: "x" });
      const after = await metrics();
      samples.push(
        ((after.get("TaskDuration") ?? 0) - (before.get("TaskDuration") ?? 0)) *
          1000,
      );
    }
    samples.sort((a, b) => a - b);
    const { profile } = await cdp.send("Profiler.stop");
    writeFileSync(
      resolve(
        ".artifacts",
        `${process.env.ATLAS_BENCHMARK_PREFIX ?? "session107"}-editor-${kb}KB-${info.project.name}${info.repeatEachIndex ? `-repeat${info.repeatEachIndex}` : ""}.cpuprofile`,
      ),
      JSON.stringify(profile),
    );
    await info.attach(`${kb}KB CPU profile`, {
      body: JSON.stringify(profile),
      contentType: "application/json",
    });
    evidence[`${kb}KB typing`] = {
      p95TaskMs: samples[Math.ceil(samples.length * 0.95) - 1],
      samples,
    };
    await page.keyboard.press("Control+s");
    const original = snapshot.library.find(
      (entry: { id: string }) => entry.id === id,
    ).bodyMd;
    await expect
      .poll(async () => {
        const current = await (
          await page.request.get(
            workbench.url +
              "/api/document/body?kind=LIBRARY&id=" +
              encodeURIComponent(id),
          )
        ).json();
        return current.bodyMd;
      })
      .toBe(original + "x".repeat(30));
    await page
      .getByRole("button", { name: zh ? "工作台" : "Workspace", exact: true })
      .click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible();
  }
  await measure(
    "Atlas conversation list",
    () => nav(page, "Atlas"),
    () =>
      expect(
        page.locator(".conversation-list").locator(".virtual-task-scroll"),
      ).toHaveAttribute("data-task-count", "100"),
  );
  evidence.liveSessionRows = await page.locator(".conversation-entry").count();
  expect(Number(evidence.liveSessionRows)).toBeLessThan(40);
  await measure(
    "Atlas conversation open",
    async () => {
      await page
        .locator(".conversation-list .virtual-task-scroll")
        .evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
      await page
        .locator(".conversation-list")
        .getByRole("button", { name: /Perf conversation 001/ })
        .click();
    },
    async () => {
      await expect(
        page.locator(".conversation-messages [data-message-kind]"),
      ).toHaveCount(50);
      await expect(
        page.locator(".conversation-messages [data-message-kind]").last(),
      ).toContainText("Conversation 1, message 999.");
      await expect(
        page
          .locator(".conversation-messages [data-message-kind]")
          .last()
          .locator(".markdown strong"),
      ).toHaveText("emphasis");
    },
  );
  await page
    .getByRole("button", {
      name: zh ? "加载更早消息" : "Load earlier messages",
      exact: true,
    })
    .click();
  await expect(
    page.locator(".conversation-messages [data-message-kind]"),
  ).toHaveCount(100);
  evidence.metadataReadWorkersAtEnd = page
    .workers()
    .map((worker) => worker.url());
  if (profileProjection)
    evidence.projectionCopies = await page.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            atlasProjectionDiagnostics?: unknown;
          }
        ).atlasProjectionDiagnostics,
    );
  if (profileProjection)
    evidence.workerMessages = await page.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            atlasWorkerMessageDiagnostics?: unknown;
          }
        ).atlasWorkerMessageDiagnostics,
    );
  writeFileSync(
    resolve(
      ".artifacts",
      `${process.env.ATLAS_BENCHMARK_PREFIX ?? "session107"}-complete-benchmark-${info.project.name}${info.repeatEachIndex ? `-repeat${info.repeatEachIndex}` : ""}.json`,
    ),
    JSON.stringify(evidence, null, 2),
  );
  await info.attach("release-complete-benchmark.json", {
    body: JSON.stringify(evidence),
    contentType: "application/json",
  });
});

test("AI approval model failure uses friendly error details and real retry", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  await page.keyboard.press("Control+j");
  const assistant = page.getByRole("complementary", {
    name: "Atlas Assistant",
  });
  await assistant
    .getByRole("textbox", { name: /^(Ask Atlas|向 Atlas 提问)$/ })
    .fill("Retry this question");
  await assistant.getByRole("button", { name: /^(Send|发送)$/ }).click();
  await assistant
    .getByRole("button", { name: /Approve request|批准本次请求/ })
    .click();
  const failure = assistant.locator('[data-message-kind="ERROR"]');
  await expect(failure).toContainText(
    zh ? "模型请求失败" : "Model request failed",
  );
  await expect(
    failure.getByText("MODEL_REQUEST_FAILED", { exact: true }),
  ).not.toBeVisible();
  await failure.locator("details > summary").click();
  await expect(failure.locator("code")).toHaveText("MODEL_REQUEST_FAILED");
  await failure
    .getByRole("button", { name: zh ? "重新尝试" : "Retry", exact: true })
    .click();
  await assistant
    .getByRole("button", { name: /Approve request|批准本次请求/ })
    .click();
  await expect(
    assistant.locator('[data-message-kind="ASSISTANT"]'),
  ).toContainText("Reviewed result");
  const summaries = await (
    await page.request.get(workbench.url + "/api/ai/sessions")
  ).json();
  expect(summaries).toHaveLength(1);
  const runs = await (await page.request.get(workbench.url + "/api/ai")).json();
  expect(runs.runs).toHaveLength(2);
  expect(runs.runs.map((run: { status: string }) => run.status).sort()).toEqual(
    ["FAILED", "SUCCEEDED"],
  );
});

test("v2.2 application icons and protected Sidebar logo are served independently", async ({
  page,
  workbench,
}, info) => {
  await unlock(page, workbench.url, workbench.secret, words(info.project.name));
  await expect(page.locator("img.brand-logo")).toHaveAttribute(
    "src",
    "/orivane-atlas.png",
  );
  const logo = await page.request.get(workbench.url + "/orivane-atlas.png");
  expect(logo.status()).toBe(200);
  expect(
    createHash("sha256")
      .update(await logo.body())
      .digest("hex")
      .toUpperCase(),
  ).toBe("12E98E78FD60082975FA0FD655AD1C80C00598186232971AE22CA4971E7BB176");
  await expect(page.locator('head link[rel="icon"]')).toHaveAttribute(
    "href",
    "/favicon.png",
  );
  for (const file of [
    "/favicon.png",
    "/application-icon-192.png",
    "/application-icon-512.png",
  ]) {
    const icon = await page.request.get(workbench.url + file);
    expect(icon.status()).toBe(200);
    expect((await icon.body()).subarray(1, 4).toString()).toBe("PNG");
    expect(
      createHash("sha256")
        .update(await icon.body())
        .digest("hex")
        .toUpperCase(),
    ).not.toBe(
      "12E98E78FD60082975FA0FD655AD1C80C00598186232971AE22CA4971E7BB176",
    );
  }
});

async function openProjectTaskFilters(page: Page) {
  const button = page.getByRole("button", {
    name: /^(任务筛选|Task filters)$/,
  });
  if ((await button.getAttribute("aria-expanded")) !== "true")
    await button.click();
}

// Local restart plus an explicit metadata-service transfer probe. A local
// restart must not be mistaken for a server-first bootstrap request.
for (const latencyMs of [150, 200, 800]) {
  test(`FINAL local restart and metadata service transfer with ${latencyMs}ms request latency`, async ({
    page,
    workbench,
  }, info) => {
    test.setTimeout(120000);
    const w = words(info.project.name);
    await unlock(page, workbench.url, workbench.secret, w);
    const identity = await (
      await page.request.get(workbench.url + "/api/session")
    ).json();
    await workbench.seedPerformance(identity.context);
    await waitForFixtureReplica(page);
    const throttled = latencyMs === 150;
    const network = throttled ? await page.context().newCDPSession(page) : null;
    if (network) {
      await network.send("Network.enable", {
        maxTotalBufferSize: 64 * 1024 * 1024,
        maxResourceBufferSize: 16 * 1024 * 1024,
      });
      await network.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: latencyMs,
        downloadThroughput: 128 * 1024,
        uploadThroughput: 128 * 1024,
        connectionType: "cellular3g",
      });
    }
    const requestedPaths: string[] = [];
    if (throttled) {
      page.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (path.startsWith("/api/")) requestedPaths.push(path);
      });
    } else {
      await page.route("**/api/**", async (route) => {
        requestedPaths.push(new URL(route.request().url()).pathname);
        await new Promise((resolve) => setTimeout(resolve, latencyMs));
        await route.continue();
      });
    }
    const initialResponse = page.waitForResponse(
      (response) =>
        (throttled
          ? ["/api/bootstrap"]
          : ["/api/bootstrap", "/api/sync", "/api/snapshot"]
        ).includes(new URL(response.url()).pathname) && response.ok(),
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".app-shell")).toBeVisible();
    await nav(page, w.desk.tasks);
    await expect(page.locator(".virtual-task-scroll").first()).toBeVisible();
    const localMetadataUsableMs = await page.evaluate(() => performance.now());
    expect(requestedPaths).not.toContain("/api/bootstrap");
    expect(requestedPaths).not.toContain("/api/snapshot");
    await page.evaluate(async () => {
      const response = await fetch("/api/bootstrap");
      if (!response.ok) throw new Error("Explicit metadata probe failed");
      await response.arrayBuffer();
    });
    const response = await initialResponse;
    const payload = await response.json();
    const library = payload.library ?? payload.snapshot?.library;
    expect(
      library.filter((entry: { kind: string }) => entry.kind === "DOCUMENT"),
    ).toHaveLength(2000);
    await nav(page, w.desk.tasks);
    await expect(page.locator(".tasks-workspace")).toBeVisible();
    await expect(page.locator(".virtual-task-scroll").first()).toBeVisible();
    const timing = await page.evaluate(() => ({
      firstContentfulPaintMs: performance
        .getEntriesByType("paint")
        .find((entry) => entry.name === "first-contentful-paint")?.startTime,
      metadataUsableMs: performance.now(),
      bootstrapTransfer: performance
        .getEntriesByType("resource")
        .filter((entry) => entry.name.includes("/api/bootstrap"))
        .map((entry) => {
          const resource = entry as PerformanceResourceTiming;
          return {
            transferSize: resource.transferSize,
            encodedBodySize: resource.encodedBodySize,
            decodedBodySize: resource.decodedBodySize,
            responseEndMs: resource.responseEnd,
          };
        }),
      sessionRestoreMs: performance
        .getEntriesByType("resource")
        .filter((entry) => new URL(entry.name).pathname === "/api/session")
        .map((entry) => {
          const resource = entry as PerformanceResourceTiming;
          return resource.responseEnd - resource.startTime;
        }),
    }));
    expect(timing.firstContentfulPaintMs).toBeGreaterThan(0);
    const evidence = {
      ...timing,
      localMetadataUsableMs,
      measurement:
        "local durable restart followed by explicit metadata transfer probe",
      artificialRequestLatencyMs: latencyMs,
      latencyMethod: throttled
        ? "CDP network latency"
        : "request dispatch delay",
      bandwidthBytesPerSecond: throttled ? 128 * 1024 : null,
      documents: library.filter(
        (entry: { kind: string }) => entry.kind === "DOCUMENT",
      ).length,
      initialPath: new URL(response.url()).pathname,
      decodedInitialBytes: (await response.body()).length,
      eagerBodyCount: library.filter(
        (entry: { bodyMd?: string }) => typeof entry.bodyMd === "string",
      ).length,
      requestedPaths,
    };
    if (throttled) {
      expect(evidence.initialPath).toBe("/api/bootstrap");
      expect(evidence.eagerBodyCount).toBe(0);
      expect(timing.bootstrapTransfer).toHaveLength(1);
      const transfer = timing.bootstrapTransfer[0];
      if (!transfer) throw new Error("Missing bootstrap resource timing");
      expect(transfer.encodedBodySize).toBeGreaterThan(0);
      expect(transfer.encodedBodySize).toBeLessThan(
        evidence.decodedInitialBytes,
      );
    }
    const lazyHydration = throttled
      ? await page.evaluate(async () => {
          const startedMs = performance.now();
          const hydrated = await fetch(
            "/api/document/body?kind=LIBRARY&id=perf-document-0",
          );
          if (!hydrated.ok) throw new Error("Document hydration failed");
          const text = await hydrated.text();
          const body = JSON.parse(text) as { id: string; bodyMd: string };
          if (
            body.id !== "perf-document-0" ||
            !body.bodyMd.includes("First line\nSecond line")
          )
            throw new Error("Document hydration content mismatch");
          return {
            completedMs: performance.now(),
            elapsedMs: performance.now() - startedMs,
            decodedBytes: new TextEncoder().encode(text).length,
          };
        })
      : null;
    let projectSearchMs: number | null = null;
    let librarySearchMs: number | null = null;
    if (throttled) {
      librarySearchMs = await page.evaluate(async () => {
        const startedMs = performance.now();
        const response = await fetch(
          "/api/library/search?q=useful%20sentence&spaceId=perf-space",
        );
        if (!response.ok) throw new Error("Library retrieval failed");
        const results = (await response.json()) as { id: string }[];
        if (
          !results.length ||
          !results.some((item) => item.id === "perf-document-0")
        )
          throw new Error("Library retrieval content mismatch");
        return performance.now() - startedMs;
      });
      await page.keyboard.press("Control+k");
      const search = page.getByPlaceholder(
        /搜索或输入命令|Search or type a command/,
      );
      await expect(search).toBeVisible();
      const startedMs = await page.evaluate(() => performance.now());
      await search.fill("Perf project 001");
      await expect(
        page
          .locator(".command-result")
          .filter({ hasText: /^Perf project 001$/ }),
      ).toBeVisible();
      projectSearchMs =
        (await page.evaluate(() => performance.now())) - startedMs;
      await page.keyboard.press("Escape");
    }
    const report = {
      ...evidence,
      lazyHydration,
      projectSearchMs,
      librarySearchMs,
    };
    const filename = `${process.env.ATLAS_BENCHMARK_PREFIX ?? "session119"}-shared-cold-${latencyMs}-${info.project.name}-${info.repeatEachIndex}.json`;
    writeFileSync(
      resolve(".artifacts", filename),
      JSON.stringify(report, null, 2),
    );
    await info.attach("shared-release-cold.json", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });
    await network?.detach();
  });
}

test("private Memo product autosave remains durable offline through reload", async ({
  page,
  workbench,
}, info) => {
  const zh = info.project.name.endsWith("zh");
  await page.goto(workbench.url + "/#tasks");
  await page
    .getByRole("button", { name: zh ? "新建任务" : "New task", exact: true })
    .first()
    .click();
  const editor = page.getByRole("dialog");
  await editor
    .getByLabel(zh ? "标题" : "Title", { exact: true })
    .fill("Memo durable product target");
  await editor
    .getByRole("button", { name: zh ? "新建任务" : "Create task", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await page
    .locator(".task-title")
    .filter({ hasText: "Memo durable product target" })
    .press("Enter");
  const memo = editor.getByRole("region", {
    name: zh ? "私人备忘" : "Private memo",
  });
  // Section has a named region; no remote endpoint is required for this local save.
  await memo
    .getByRole("button", {
      name: zh ? "+ 添加备忘" : "+ Add memo",
      exact: true,
    })
    .click();
  await page.context().setOffline(true);
  const body = "  本机私人备忘\nsecond line **unchanged**\n";
  await memo.getByRole("textbox").fill(body);
  await memo.getByRole("textbox").press("Control+s");
  await expect(memo.getByRole("status")).toHaveText(
    zh ? "已保存到本机" : "Saved locally",
  );
  await page.screenshot({
    path: info.outputPath("private-memo-offline.png"),
    fullPage: true,
  });
  await page.context().setOffline(false);
  await page.reload();
  await page
    .locator(".task-title")
    .filter({ hasText: "Memo durable product target" })
    .press("Enter");
  const recovered = page
    .getByRole("dialog")
    .getByRole("region", { name: zh ? "私人备忘" : "Private memo" });
  await recovered
    .getByRole("button", { name: zh ? "编辑私人备忘" : "Edit private memo" })
    .click();
  await expect(recovered.getByRole("textbox")).toHaveValue(body);
  const fixtureId = String(5000 + info.workerIndex);
  await promisify(execFile)(
    process.execPath,
    ["scripts/build-local-storage-fixture.mjs", fixtureId],
    { timeout: 30000 },
  );
  const fixtureCode = await readFile(
    `.artifacts/local-storage-fixture-${fixtureId}/storage.js`,
    "utf8",
  );
  await page.route("**/__test/memo-product-storage.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: fixtureCode }),
  );
  await page.addScriptTag({
    url: workbench.url + "/__test/memo-product-storage.js",
  });
  async function secondWriter(bodyMd: string) {
    return page.evaluate(async (bodyMd) => {
      const api = (
        window as unknown as { OrivaneLocalStorageFixture: typeof memoLocalApi }
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
        const task = (await db.metadata.list(owner.workspaceId, "items")).find(
          (row) =>
            (row.value as { title?: string }).title ===
            "Memo durable product target",
        );
        if (!task) throw new Error("MISSING_LOCAL_TARGET");
        const runtime = new api.LocalRuntime(
          new api.LocalWorkspace(
            db.metadata,
            blobs,
            owner,
            { extract: () => [], resolve: (links) => [...links] },
            { now: () => new Date().toISOString() },
            { next: () => crypto.randomUUID() },
          ),
          {
            forTarget: api.deriveEntityMemoId,
            nextChangeId: () => crypto.randomUUID(),
          },
        );
        if (
          !(await db.metadata.list(owner.workspaceId, "library")).some(
            (row) =>
              (row.value as { title?: string }).title ===
              "Memo destination space",
          )
        ) {
          const space = await runtime.saveLibrary(null, 0, {
            kind: "SPACE",
            spaceId: null,
            title: "Memo destination space",
            bodyMd: "",
          });
          await runtime.saveLibrary(null, 0, {
            kind: "DOCUMENT",
            spaceId: space.id,
            title: "Memo append destination",
            bodyMd: "Original destination bytes",
          });
        }
        const target = { targetKind: "TASK" as const, targetId: task.id };
        const memo = await runtime.getEntityMemo(target);
        if (!memo) throw new Error("MISSING_LOCAL_MEMO");
        return await runtime.saveEntityMemo(
          { ...target, bodyMd },
          memo.version,
        );
      } finally {
        db.close();
        blobs.close();
      }
    }, bodyMd);
  }
  expect((await secondWriter("Concurrent saved version"))?.version).toBe(2);
  await recovered.getByRole("textbox").fill("My reviewed local revision");
  await recovered.getByRole("textbox").press("Control+s");
  await recovered
    .getByRole("button", {
      name: zh ? "审核版本" : "Review versions",
      exact: true,
    })
    .click();
  const review = page.getByRole("dialog", {
    name: zh ? "审核备忘版本" : "Review memo versions",
    exact: true,
  });
  await expect(review).toContainText("Concurrent saved version");
  expect((await secondWriter("Changed while reviewing"))?.version).toBe(3);
  await review
    .getByRole("button", {
      name: zh ? "保留本机草稿" : "Keep local draft",
      exact: true,
    })
    .click();
  await expect(review).toContainText("Changed while reviewing");
  await page.screenshot({
    path: info.outputPath("private-memo-stale-review.png"),
    fullPage: true,
  });
  await review
    .getByRole("button", {
      name: zh ? "保留本机草稿" : "Keep local draft",
      exact: true,
    })
    .click();
  await expect(review).toHaveCount(0);
  await expect(recovered.getByRole("textbox")).toHaveValue(
    "My reviewed local revision",
  );
  await expect(recovered.getByRole("status")).toHaveText(
    zh ? "已保存到本机" : "Saved locally",
  );
  await recovered
    .getByRole("button", {
      name: zh ? "整理备忘…" : "Organize memo…",
      exact: true,
    })
    .click();
  const organization = page.getByRole("dialog", {
    name: zh ? "审核备忘整理" : "Review memo organization",
    exact: true,
  });
  const formalTitle = "Reviewed private memo action";
  await organization
    .getByLabel(zh ? "标题" : "Title", { exact: true })
    .fill(formalTitle);
  const apply = organization.getByRole("button", {
    name: zh ? "应用" : "Apply",
    exact: true,
  });
  await expect(apply).toBeDisabled();
  await organization
    .getByRole("button", { name: zh ? "预览" : "Preview", exact: true })
    .click();
  await expect(
    organization.getByRole("region", {
      name: zh ? "整理预览" : "Organization preview",
    }),
  ).toContainText("My reviewed local revision");
  await expect(
    page.locator(".task-title").filter({ hasText: formalTitle }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("memo-organization-preview.png"),
    fullPage: false,
  });
  const geometry = await organization.evaluate((node) => ({
    viewport: { width: innerWidth, height: innerHeight },
    dialog: node.getBoundingClientRect().toJSON(),
    children: Array.from(node.children).map((child) => {
      const style = getComputedStyle(child);
      return {
        tag: child.tagName,
        className: child.className,
        rect: child.getBoundingClientRect().toJSON(),
        height: style.height,
        minHeight: style.minHeight,
        flex: style.flex,
        display: style.display,
      };
    }),
  }));
  await info.attach("memo-organization-geometry", {
    body: JSON.stringify(geometry),
    contentType: "application/json",
  });
  writeFileSync(
    info.outputPath("memo-organization-geometry.json"),
    JSON.stringify(geometry, null, 2),
  );
  expect(geometry.dialog.left).toBeGreaterThanOrEqual(0);
  expect(geometry.dialog.right).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.dialog.top).toBeGreaterThanOrEqual(0);
  expect(geometry.dialog.bottom).toBeLessThanOrEqual(geometry.viewport.height);
  const previewBounds = await organization
    .getByRole("region", { name: zh ? "整理预览" : "Organization preview" })
    .boundingBox();
  expect(previewBounds?.height).toBeLessThan(140);
  await page.context().setOffline(true);
  await apply.click();
  await expect(organization).toHaveCount(0);
  await expect(recovered.getByRole("textbox")).toHaveValue(
    "My reviewed local revision",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: zh ? "关闭" : "Close", exact: true })
    .click();
  await expect(
    page.locator(".task-title").filter({ hasText: formalTitle }),
  ).toHaveCount(1);
  await page
    .locator(".task-title")
    .filter({ hasText: "Memo durable product target" })
    .press("Enter");
  for (const kind of ["CREATE_DOCUMENT", "APPEND_DOCUMENT"] as const) {
    await recovered
      .getByRole("button", {
        name: zh ? "整理备忘…" : "Organize memo…",
        exact: true,
      })
      .click();
    await organization
      .getByLabel(zh ? "整理方式" : "Organization action")
      .selectOption(kind);
    if (kind === "CREATE_DOCUMENT")
      await organization
        .getByLabel(zh ? "标题" : "Title", { exact: true })
        .fill("Memo reviewed document");
    await organization
      .getByRole("button", {
        name: zh ? "选择知识空间" : "Choose knowledge space",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Memo destination space", exact: true })
      .click();
    if (kind === "APPEND_DOCUMENT") {
      await organization
        .getByRole("button", {
          name: zh ? "目标文档" : "Destination document",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: "Memo append destination", exact: true })
        .click();
    }
    await expect(apply).toBeDisabled();
    await organization
      .getByRole("button", { name: zh ? "预览" : "Preview", exact: true })
      .click();
    await expect(apply).toBeEnabled();
    await page.context().setOffline(true);
    await apply.click();
    await expect(organization).toHaveCount(0);
    await expect(recovered.locator(".markdown")).toContainText(
      "My reviewed local revision",
    );
    await page.context().setOffline(false);
  }
  await page.reload();
  await page.addScriptTag({
    url: workbench.url + "/__test/memo-product-storage.js",
  });
  const documents = await page.evaluate(async () => {
    const api = (
      window as unknown as { OrivaneLocalStorageFixture: typeof memoLocalApi }
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
      const workspace = new api.LocalWorkspace(
        db.metadata,
        blobs,
        owner,
        { extract: () => [], resolve: (links) => [...links] },
        { now: () => new Date().toISOString() },
        { next: () => crypto.randomUUID() },
      );
      const rows = await db.metadata.list(owner.workspaceId, "library");
      return await workspace.run(async (services) => {
        const result = [];
        for (const row of rows)
          result.push(await services.library.read(owner, row.id));
        return result;
      });
    } finally {
      db.close();
      blobs.close();
    }
  });
  expect(
    documents.filter((row) => row.title === "Memo reviewed document"),
  ).toEqual([
    expect.objectContaining({ bodyMd: "My reviewed local revision" }),
  ]);
  expect(
    documents.find((row) => row.title === "Memo append destination")?.bodyMd,
  ).toBe("Original destination bytes\n\nMy reviewed local revision");
  await page.screenshot({
    path: info.outputPath("private-memo-reviewed-apply.png"),
    fullPage: true,
  });
  await page.context().setOffline(false);
  await page.reload();
  await expect(
    page.locator(".task-title").filter({ hasText: formalTitle }),
  ).toHaveCount(1);
  let modelRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/ai/propose")) modelRequests++;
  });
  await page.addScriptTag({
    url: workbench.url + "/__test/memo-product-storage.js",
  });
  await page
    .locator(".task-title")
    .filter({ hasText: "Memo durable product target" })
    .press("Enter");
  const permission = page.getByRole("dialog", {
    name: zh ? "备忘 AI 数据许可" : "Memo AI data permission",
    exact: true,
  });
  async function openPermission() {
    await recovered
      .getByRole("button", {
        name: zh ? "备忘 AI 许可…" : "Memo AI permission…",
        exact: true,
      })
      .click();
    await permission.locator("summary").click();
  }
  await openPermission();
  const access = permission.getByRole("combobox", {
    name: zh ? "AI 访问" : "AI access",
    exact: true,
  });
  const boundary = permission.getByRole("combobox", {
    name: zh ? "处理位置" : "Processing boundary",
    exact: true,
  });
  await expect(access).toHaveValue("DENY");
  await expect(boundary).toHaveValue("LOCAL_ONLY");
  await access.selectOption("ASK");
  await boundary.selectOption("ANY");
  // Same text, newer version: granting permission must still obey source CAS.
  await secondWriter("My reviewed local revision");
  await permission
    .getByRole("button", {
      name: zh ? "保存许可" : "Save permission",
      exact: true,
    })
    .click();
  await expect(permission.getByRole("alert")).toBeVisible();
  await permission
    .getByRole("button", { name: zh ? "取消" : "Cancel", exact: true })
    .click();
  await openPermission();
  await expect(access).toHaveValue("DENY");
  await access.selectOption("ASK");
  await boundary.selectOption("ANY");
  await page.context().setOffline(true);
  await permission
    .getByRole("button", {
      name: zh ? "保存许可" : "Save permission",
      exact: true,
    })
    .click();
  await expect(permission).toHaveCount(0);
  await page.context().setOffline(false);
  await page.reload();
  await page
    .locator(".task-title")
    .filter({ hasText: "Memo durable product target" })
    .press("Enter");
  await openPermission();
  await expect(access).toHaveValue("ASK");
  await expect(boundary).toHaveValue("ANY");
  await page.screenshot({
    path: info.outputPath("memo-private-ai-permission.png"),
    fullPage: false,
  });
  expect(modelRequests).toBe(0);
});

test("private Memo AI approval keeps temporary results behind local preview and Apply", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const task = await mutation(page, "/api/work/create", {
    title: "Memo Atlas reviewed target",
  });
  const bodyMd = "Private Memo source for Atlas review";
  await mutation(page, "/api/memo/save", {
    version: 0,
    input: {
      targetKind: "TASK",
      targetId: task.id,
      bodyMd,
      aiPolicy: {
        classification: "PRIVATE",
        processingBoundary: "ANY",
        aiAccess: "ASK",
      },
    },
  });
  await page.reload();
  await nav(page, w.desk.tasks);
  await page
    .locator(".task-title")
    .filter({ hasText: "Memo Atlas reviewed target" })
    .press("Enter");
  const memo = page
    .getByRole("dialog")
    .getByRole("region", { name: zh ? "私人备忘" : "Private memo" });
  await memo
    .getByRole("button", {
      name: zh ? "Atlas 整理备忘…" : "Organize memo with Atlas…",
      exact: true,
    })
    .click();
  const atlas = page.getByRole("dialog", {
    name: zh ? "备忘 Atlas" : "Memo Atlas",
    exact: true,
  });
  await expect(
    atlas.getByRole("region", { name: zh ? "发送审核" : "Send review" }),
  ).toHaveCount(0);
  await atlas
    .getByRole("button", {
      name: zh ? "准备请求" : "Prepare request",
      exact: true,
    })
    .click();
  await expect(
    atlas.getByRole("region", { name: zh ? "发送审核" : "Send review" }),
  ).toBeVisible();
  await expect(
    atlas.getByRole("region", { name: zh ? "Atlas 草案" : "Atlas draft" }),
  ).toHaveCount(0);
  await atlas
    .getByRole("button", {
      name: zh ? "批准并发送" : "Approve and send",
      exact: true,
    })
    .click();
  await expect(
    atlas.getByRole("region", { name: zh ? "Atlas 草案" : "Atlas draft" }),
  ).toContainText("Reviewed result");
  expect(
    await page.evaluate(async () => (await fetch("/api/ai/sessions")).json()),
  ).toEqual([]);
  await atlas
    .getByRole("textbox", {
      name: zh ? "补充要求" : "Additional instructions",
      exact: true,
    })
    .fill("Make the proposed action concise");
  await atlas
    .getByRole("button", {
      name: zh ? "准备请求" : "Prepare request",
      exact: true,
    })
    .click();
  await atlas
    .getByRole("button", {
      name: zh ? "批准并发送" : "Approve and send",
      exact: true,
    })
    .click();
  await expect(
    atlas.getByRole("button", {
      name: zh ? "审核整理草案" : "Review organization draft",
      exact: true,
    }),
  ).toBeVisible();
  await atlas
    .getByRole("button", {
      name: zh ? "保存为对话" : "Save as conversation",
      exact: true,
    })
    .click();
  await expect(
    atlas.getByRole("button", {
      name: zh ? "已保存对话" : "Conversation saved",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    atlas.getByRole("button", {
      name: zh ? "准备请求" : "Prepare request",
      exact: true,
    }),
  ).toBeDisabled();
  await page.screenshot({
    path: info.outputPath("memo-atlas-temporary-draft.png"),
    fullPage: false,
  });
  await atlas
    .getByRole("button", {
      name: zh ? "审核整理草案" : "Review organization draft",
      exact: true,
    })
    .click();
  const organization = page.getByRole("dialog", {
    name: zh ? "审核备忘整理" : "Review memo organization",
    exact: true,
  });
  await organization
    .getByLabel(zh ? "标题" : "Title", { exact: true })
    .fill("Memo Atlas explicitly reviewed action");
  const apply = organization.getByRole("button", {
    name: zh ? "应用" : "Apply",
    exact: true,
  });
  await expect(apply).toBeDisabled();
  await organization
    .getByRole("button", { name: zh ? "预览" : "Preview", exact: true })
    .click();
  await expect(
    page
      .locator(".task-title")
      .filter({ hasText: "Memo Atlas explicitly reviewed action" }),
  ).toHaveCount(0);
  await apply.click();
  await expect(organization).toHaveCount(0);
  await expect(memo.locator(".markdown")).toHaveText(bodyMd);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: zh ? "关闭" : "Close", exact: true })
    .click();
  await expect(
    page
      .locator(".task-title")
      .filter({ hasText: "Memo Atlas explicitly reviewed action" }),
  ).toHaveCount(1);
  const summaries = await page.evaluate(async () =>
    (await fetch("/api/ai/sessions")).json(),
  );
  expect(summaries).toHaveLength(1);
  const conversation = await page.evaluate(
    async (id: string) =>
      (
        await fetch("/api/ai/sessions/messages?id=" + encodeURIComponent(id))
      ).json(),
    summaries[0].id,
  );
  expect(conversation.session.messages).toHaveLength(4);
  expect(conversation.session.messages[3].evidence[0].ref).toMatchObject({
    kind: "MEMO",
    target: { targetKind: "TASK", targetId: task.id },
  });
});

test("private Memo target purge requires explicit review and retains device evidence", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const task = await mutation(page, "/api/work/create", {
    title: "Memo purged target",
  });
  await mutation(page, "/api/memo/save", {
    version: 0,
    input: {
      targetKind: "TASK",
      targetId: task.id,
      bodyMd: "Original private text",
    },
  });
  await page.reload();
  await nav(page, w.desk.tasks);
  await page
    .locator(".task-title")
    .filter({ hasText: "Memo purged target" })
    .press("Enter");
  const memo = page
    .getByRole("dialog")
    .getByRole("region", { name: zh ? "私人备忘" : "Private memo" });
  await memo
    .getByRole("button", { name: zh ? "编辑私人备忘" : "Edit private memo" })
    .click();
  let release!: () => void, observed!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const intercepted = new Promise<void>((resolve) => {
    observed = resolve;
  });
  let first = true;
  await page.route("**/api/v1/memo/save", async (route) => {
    if (first) {
      first = false;
      observed();
      await gate;
    }
    await route.continue();
  });
  const local = "Device intent before permanent purge";
  await memo.getByRole("textbox").fill(local);
  await memo.getByRole("textbox").press("Control+s");
  await intercepted;
  await page
    .getByRole("dialog")
    .getByRole("button", { name: zh ? "关闭" : "Close", exact: true })
    .click();
  try {
    await mutation(page, "/api/work/delete", {
      id: task.id,
      version: 1,
      deleted: true,
    });
    await mutation(page, "/api/work/purge", { id: task.id, version: 2 });
  } finally {
    release();
  }
  await page.goto(workbench.url + "/#account");
  await page
    .getByRole("button", { name: /Compare changes|比较修改/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog", {
    name: zh ? "比较同步修改" : "Compare synced changes",
  });
  await expect(dialog).toContainText(local);
  await expect(dialog).toContainText(
    zh ? "远端已永久删除" : "permanently removed remotely",
  );
  await expect(
    dialog.getByRole("radio", {
      name: zh ? "保留本机修改" : "Keep device changes",
      exact: true,
    }),
  ).toBeDisabled();
  await dialog
    .getByRole("radio", {
      name: zh ? "接受远端删除" : "Accept remote deletion",
      exact: true,
    })
    .check();
  await page.screenshot({
    path: info.outputPath("memo-purge-review.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", {
      name: zh ? "应用选择" : "Apply choice",
      exact: true,
    })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Compare changes|比较修改/ }),
  ).toHaveCount(0);
});

for (const choice of ["LOCAL", "REMOTE"] as const) {
  test(`private Memo import re-review preserves owner and original Markdown with ${choice}`, async ({
    page,
    workbench,
  }, info) => {
    const zh = info.project.name.endsWith("zh"),
      body = "  原始私人备忘\nTODO\n[[literal source]]\n";
    await page.goto(workbench.url + "/#tasks");
    await page
      .getByRole("button", { name: zh ? "新建任务" : "New task", exact: true })
      .first()
      .click();
    const editor = page.getByRole("dialog");
    await editor
      .getByLabel(zh ? "标题" : "Title", { exact: true })
      .fill("Memo import target");
    await editor
      .getByRole("button", {
        name: zh ? "新建任务" : "Create task",
        exact: true,
      })
      .click();
    await expect(editor).toHaveCount(0);
    const fixtureId = String(4000 + info.workerIndex);
    await promisify(execFile)(
      process.execPath,
      ["scripts/build-local-storage-fixture.mjs", fixtureId],
      { timeout: 30000 },
    );
    const fixtureCode = await readFile(
      `.artifacts/local-storage-fixture-${fixtureId}/storage.js`,
      "utf8",
    );
    await page.route("**/__test/private-memo-storage.js", (route) =>
      route.fulfill({ contentType: "text/javascript", body: fixtureCode }),
    );
    await page.addScriptTag({
      url: workbench.url + "/__test/private-memo-storage.js",
    });
    const original = await page.evaluate(async (bodyMd) => {
      const api = (
        window as unknown as { OrivaneLocalStorageFixture: typeof memoLocalApi }
      ).OrivaneLocalStorageFixture;
      const db = await api.IndexedDbLocalStore.open(
          "orivane-atlas.local-workspace",
        ),
        blobs = await api.IndexedDbLocalBlobStore.open(
          "orivane-atlas.local-workspace",
        );
      try {
        const own = await db.identity.get();
        if (!own) throw new Error("MISSING_LOCAL_OWNER");
        const task = (await db.metadata.list(own.workspaceId, "items")).find(
          (row) =>
            (row.value as { title?: string }).title === "Memo import target",
        );
        if (!task) throw new Error("MISSING_LOCAL_TARGET");
        const runtime = new api.LocalRuntime(
          new api.LocalWorkspace(
            db.metadata,
            blobs,
            own,
            { extract: () => [], resolve: (links) => [...links] },
            { now: () => new Date().toISOString() },
            { next: () => crypto.randomUUID() },
          ),
          {
            forTarget: api.deriveEntityMemoId,
            nextChangeId: () => crypto.randomUUID(),
          },
        );
        const memo = await runtime.saveEntityMemo(
          { targetKind: "TASK", targetId: task.id, bodyMd },
          0,
        );
        if (!memo) throw new Error("MISSING_SAVED_MEMO");
        return memo;
      } finally {
        db.close();
        blobs.close();
      }
    }, body);
    await page.reload();
    await unlock(
      page,
      workbench.url,
      workbench.secret,
      words(info.project.name),
      "prepare",
    );
    const choices = page.getByRole("region", {
      name: zh ? "选择合并内容" : "Choose content to merge",
      exact: true,
    });
    await expect(choices).toContainText(zh ? "私人备忘" : "Private memos");
    await choices
      .getByRole("button", {
        name: zh ? "全部选择复制" : "Choose copy for all",
        exact: true,
      })
      .click();
    await choices
      .getByRole("button", {
        name: zh ? "生成导入预览" : "Prepare import preview",
        exact: true,
      })
      .click();
    let attempted = 0;
    await page.route("**/api/memo/save", (route) => {
      attempted++;
      return route.abort("connectionreset");
    });
    await choices
      .getByRole("button", {
        name: zh ? "确认并导入" : "Confirm and import",
        exact: true,
      })
      .click();
    await expect(choices.getByRole("alert")).toBeVisible();
    expect(attempted).toBe(1);
    const snapshot = await (
      await page.request.get(workbench.url + "/api/snapshot")
    ).json();
    expect(snapshot.items).toHaveLength(1);
    const target = snapshot.items[0];
    await mutation(page, "/api/memo/save", {
      version: 0,
      deleted: false,
      input: {
        targetKind: "TASK",
        targetId: target.id,
        bodyMd: "Remote private text\n",
      },
    });
    await page.unroute("**/api/memo/save");
    await page.reload();
    const recovery = page.getByRole("region", {
      name: zh ? "导入恢复" : "Import recovery",
      exact: true,
    });
    await recovery
      .getByRole("button", {
        name: zh ? "检查目标变化" : "Review destination changes",
        exact: true,
      })
      .click();
    const review = recovery.getByRole("region", {
      name: zh ? "重新审查导入" : "Review import changes",
      exact: true,
    });
    await expect(review.getByRole("alert")).toBeVisible();
    await expect(
      review.getByRole("heading", {
        name: zh ? "备忘正文" : "Memo text",
        exact: true,
      }),
    ).toBeVisible();
    expect(await review.locator("dd").first().textContent()).toBe(body);
    await page.screenshot({
      path: info.outputPath("private-memo-import-review.png"),
      fullPage: true,
    });
    await review
      .getByRole("button", {
        name:
          choice === "LOCAL"
            ? zh
              ? "保留本机正文"
              : "Keep device text"
            : zh
              ? "保留目标正文"
              : "Keep destination text",
        exact: true,
      })
      .click();
    await review
      .getByRole("button", {
        name: zh
          ? "确认新预览并准备剩余操作"
          : "Accept review and prepare remaining operations",
        exact: true,
      })
      .click();
    await expect(review).toHaveCount(0);
    await recovery
      .getByRole("button", {
        name: zh ? "继续此导入" : "Resume this import",
        exact: true,
      })
      .last()
      .click();
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(
                workbench.url +
                  `/api/memo?targetKind=TASK&targetId=${target.id}`,
              )
            ).json()
          )?.version,
      )
      .toBe(2);
    const remote = await (
      await page.request.get(
        workbench.url + `/api/memo?targetKind=TASK&targetId=${target.id}`,
      )
    ).json();
    expect(remote).toMatchObject({
      targetId: target.id,
      ownerPrincipalId: target.createdBy,
      version: 2,
      bodyMd: choice === "LOCAL" ? body : "Remote private text\n",
    });
    expect(remote.id).not.toBe(original.id);
    await page.addScriptTag({
      url: workbench.url + "/__test/private-memo-storage.js",
    });
    expect(
      await page.evaluate(async ({ id, workspaceId }) => {
        const api = (
          window as unknown as {
            OrivaneLocalStorageFixture: typeof memoLocalApi;
          }
        ).OrivaneLocalStorageFixture;
        const db = await api.IndexedDbLocalStore.open(
          "orivane-atlas.local-workspace",
        );
        try {
          return await db.metadata.get(workspaceId, "entityMemos", id);
        } finally {
          db.close();
        }
      }, original),
    ).toMatchObject({ value: original });
  });
}

for (const resolution of ["LOCAL", "REMOTE"] as const) {
  test(`explicit Work conflict review preserves both originals and applies the chosen canonical values ${resolution}`, async ({
    page,
    workbench,
  }, info) => {
    const w = words(info.project.name),
      zh = info.project.name.endsWith("zh");
    await unlock(page, workbench.url, workbench.secret, w);
    const task = await mutation(page, "/api/work/create", {
      title: "Conflict review base",
    });
    await page.goto(workbench.url + "/#tasks");
    const row = page.locator(".task-title", {
      hasText: "Conflict review base",
    });
    await expect(row).toBeVisible();
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let observed: () => void = () => {};
    const intercepted = new Promise<void>((resolve) => {
      observed = resolve;
    });
    let first = true;
    await page.route("**/api/v1/work/update", async (route) => {
      if (first) {
        first = false;
        observed();
        await blocked;
      }
      await route.continue();
    });
    await row.press("Enter");
    await page
      .getByRole("dialog")
      .getByLabel(w.work.title, { exact: true })
      .fill("Device reviewed title");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: w.common.save, exact: true })
      .click();
    await intercepted;
    try {
      await mutation(page, "/api/work/update", {
        id: task.id,
        version: 1,
        input: { title: "Remote reviewed title" },
      });
    } finally {
      release();
    }
    await page.goto(workbench.url + "/#account");
    const compare = page.getByRole("button", {
      name: /Device reviewed title.*(Compare changes|比较修改)/,
    });
    await expect(compare).toBeVisible();
    await compare.click();
    let dialog = page.getByRole("dialog", {
      name: zh ? "比较同步修改" : "Compare synced changes",
    });
    await expect(dialog).toContainText("Conflict review base");
    await expect(dialog).toContainText("Device reviewed title");
    await expect(dialog).toContainText("Remote reviewed title");
    const apply = dialog.getByRole("button", {
      name: zh ? "应用选择" : "Apply choice",
      exact: true,
    });
    await expect(apply).toBeDisabled();
    await dialog.press("Escape");
    await expect(dialog).toHaveCount(0);
    await compare.click();
    dialog = page.getByRole("dialog", {
      name: zh ? "比较同步修改" : "Compare synced changes",
    });
    await dialog
      .getByRole("radio", {
        name:
          resolution === "LOCAL"
            ? zh
              ? "保留本机修改"
              : "Keep device changes"
            : zh
              ? "使用远端内容"
              : "Use remote values",
      })
      .check();
    await page.screenshot({
      path: info.outputPath("work-conflict-review.png"),
      fullPage: true,
    });
    await dialog
      .getByRole("button", {
        name: zh ? "应用选择" : "Apply choice",
        exact: true,
      })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(async () => {
        const snapshot = await (
          await page.request.get(workbench.url + "/api/snapshot")
        ).json();
        return snapshot.items.find(
          (item: { id: string }) => item.id === task.id,
        );
      })
      .toMatchObject({
        version: 3,
        title:
          resolution === "LOCAL"
            ? "Device reviewed title"
            : "Remote reviewed title",
      });
    await page.reload();
    await expect(
      page.getByRole("button", {
        name: /Device reviewed title.*(Compare changes|比较修改)/,
      }),
    ).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath("resolved-work-conflict.png"),
      fullPage: true,
    });
  });
}

test("owned workspace selection hydrates a separate replica without redirecting another tab", async ({
  page,
  workbench,
}, info) => {
  const zh = info.project.name.endsWith("zh"),
    w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const defaultIdentity = await (
    await page.request.get(workbench.url + "/api/session")
  ).json();
  await page.goto(workbench.url + "/#account");
  await page.locator(".workspace-connection > details > summary").click();
  await page
    .getByLabel(zh ? "新工作区名称" : "New workspace name", { exact: true })
    .fill("Separate owned workspace");
  const createKeys: string[] = [];
  let interrupted = false;
  await page.route("**/api/v1/workspaces/create", async (route) => {
    createKeys.push(route.request().headers()["idempotency-key"]!);
    if (!interrupted) {
      interrupted = true;
      const committed = await route.fetch();
      expect(committed.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", {
      name: zh ? "创建空工作区" : "Create empty workspace",
      exact: true,
    })
    .click();
  const retry = page.getByRole("button", {
    name: zh ? "重试创建" : "Retry creation",
    exact: true,
  });
  await expect(retry).toBeEnabled();
  const creationResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/workspaces/create") &&
      response.status() === 200,
  );
  await retry.click();
  const created = await (await creationResponse).json();
  expect(createKeys).toHaveLength(2);
  expect(createKeys[0]).toBe(createKeys[1]);
  expect(
    await (await page.request.get(workbench.url + "/api/v1/workspaces")).json(),
  ).toHaveLength(2);
  expect(
    (await (await page.request.get(workbench.url + "/api/session")).json())
      .context.workspaceId,
  ).toBe(defaultIdentity.context.workspaceId);
  const response = await page.request.post(workbench.url + "/api/work/create", {
    data: { title: "Only selected workspace task" },
    headers: {
      Origin: workbench.url,
      "X-CSRF-Token": defaultIdentity.csrf,
      "Idempotency-Key": randomUUID(),
      "X-Workspace-Id": created.id,
    },
  });
  expect(response.status()).toBe(200);
  const other = await page.context().newPage();
  await other.goto(workbench.url + "/#tasks");
  await page.goto(workbench.url + "/#account");
  await page
    .getByRole("button", {
      name: zh ? "查看同步选项" : "Review sync options",
      exact: true,
    })
    .click();
  await page
    .getByRole("navigation", {
      name: zh ? "账户中的工作区" : "Workspaces in this account",
    })
    .getByRole("button", { name: created.name, exact: true })
    .click();
  const preview = page.getByRole("region", {
    name: zh ? "工作区连接预览" : "Workspace connection preview",
  });
  await expect(preview).toContainText(zh ? "任务 1" : "Tasks 1");
  await Promise.all([
    page.waitForEvent("load"),
    preview
      .getByRole("button", {
        name: zh ? "打开账户工作区" : "Open account workspace",
        exact: true,
      })
      .click(),
  ]);
  await page.goto(workbench.url + "/#tasks");
  await expect(
    page.locator(".task-title", { hasText: "Only selected workspace task" }),
  ).toBeVisible();
  await expect(
    other.locator(".task-title", { hasText: "Only selected workspace task" }),
  ).toHaveCount(0);
  const defaultSnapshot = await (
    await other.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(defaultSnapshot.items).toHaveLength(0);
  expect(
    (await (await other.request.get(workbench.url + "/api/session")).json())
      .context.workspaceId,
  ).toBe(defaultIdentity.context.workspaceId);
  await page.reload();
  await expect(
    page.locator(".task-title", { hasText: "Only selected workspace task" }),
  ).toBeVisible();
  await other.close();
});

for (const choice of ["LOCAL", "REMOTE"] as const)
  test(`File rename conflict review keeps original bytes and applies explicit ${choice} choice`, async ({
    page,
    workbench,
  }, info) => {
    const zh = info.project.name.endsWith("zh");
    await unlock(
      page,
      workbench.url,
      workbench.secret,
      words(info.project.name),
    );
    await page.goto(workbench.url + "/#library");
    const bytes = Buffer.from("Immutable conflict original\n原始字节");
    await page
      .getByLabel(zh ? "上传文件" : "Upload file", { exact: true })
      .setInputFiles({
        name: "conflict-original.txt",
        mimeType: "text/plain",
        buffer: bytes,
      });
    let file: { id: string; version: number; contentHash: string } | undefined;
    await expect
      .poll(async () => {
        const snapshot = await (
          await page.request.get(workbench.url + "/api/snapshot")
        ).json();
        file = snapshot.files.find(
          (entry: { name: string }) => entry.name === "conflict-original.txt",
        );
        return file?.version;
      })
      .toBe(1);
    if (!file) throw new Error("MISSING_CANONICAL_FILE");
    const original = file;
    let release: () => void = () => {},
      observed: () => void = () => {};
    const held = new Promise<void>((resolve) => {
        release = resolve;
      }),
      intercepted = new Promise<void>((resolve) => {
        observed = resolve;
      });
    let first = true;
    await page.route("**/api/v1/files/rename", async (route) => {
      if (first) {
        first = false;
        observed();
        await held;
      }
      await route.continue();
    });
    const detail = page.getByRole("region", {
      name: "conflict-original.txt",
      exact: true,
    });
    await detail
      .getByLabel(zh ? "文件名称" : "File name", { exact: true })
      .fill("device-conflict.txt");
    await detail
      .getByRole("button", { name: zh ? "保存名称" : "Save name", exact: true })
      .click();
    await intercepted;
    try {
      await mutation(page, "/api/v1/files/rename", {
        id: original.id,
        version: 1,
        name: "remote-conflict.txt",
      });
    } finally {
      release();
    }
    await page.goto(workbench.url + "/#account");
    const compare = page.getByRole("button", {
      name: /device-conflict.txt.*(Compare changes|比较修改)/,
    });
    await compare.click();
    const dialog = page.getByRole("dialog", {
      name: zh ? "比较同步修改" : "Compare synced changes",
    });
    for (const name of [
      "conflict-original.txt",
      "device-conflict.txt",
      "remote-conflict.txt",
    ])
      await expect(dialog).toContainText(name);
    const apply = dialog.getByRole("button", {
      name: zh ? "应用选择" : "Apply choice",
      exact: true,
    });
    await expect(apply).toBeDisabled();
    await dialog
      .getByRole("radio", {
        name:
          choice === "LOCAL"
            ? zh
              ? "保留本机修改"
              : "Keep device changes"
            : zh
              ? "使用远端内容"
              : "Use remote values",
        exact: true,
      })
      .check();
    await apply.click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(
        async () =>
          await (
            await page.request.get(
              workbench.url + "/api/v1/files/metadata?id=" + original.id,
            )
          ).json(),
      )
      .toMatchObject({
        version: 3,
        name:
          choice === "LOCAL" ? "device-conflict.txt" : "remote-conflict.txt",
        originalName: "conflict-original.txt",
        contentHash: original.contentHash,
      });
    const downloaded = await page.request.get(
      workbench.url + "/api/v1/files/bytes?id=" + original.id,
    );
    expect(downloaded.status()).toBe(200);
    expect(await downloaded.body()).toEqual(bytes);
    await page.reload();
    await expect(compare).toHaveCount(0);
  });

for (const recoveryMode of ["RETRY", "REVIEW"] as const) {
  test(`explicit merge imports original File bytes and resumes a lost accepted response after reload without switching the source ${recoveryMode}`, async ({
    page,
    workbench,
  }, info) => {
    const zh = info.project.name.endsWith("zh");
    await page.goto(workbench.url + "/#tasks");
    await page
      .getByRole("button", { name: zh ? "新建任务" : "New task", exact: true })
      .first()
      .click();
    const editor = page.getByRole("dialog");
    await editor
      .getByLabel(zh ? "标题" : "Title", { exact: true })
      .fill("Merge original task");
    await editor
      .getByRole("button", {
        name: zh ? "新建任务" : "Create task",
        exact: true,
      })
      .click();
    await expect(editor).toHaveCount(0);
    await page
      .getByRole("button", { name: zh ? "新建任务" : "New task", exact: true })
      .first()
      .click();
    await editor
      .getByLabel(zh ? "标题" : "Title", { exact: true })
      .fill("Merge ordered second");
    await editor
      .getByRole("button", {
        name: zh ? "新建任务" : "Create task",
        exact: true,
      })
      .click();
    await expect(editor).toHaveCount(0);
    await page
      .getByRole("combobox", { name: zh ? "排序" : "Sort", exact: true })
      .selectOption("manual");
    await page
      .getByRole("button", {
        name: (zh ? "调整顺序：" : "Reorder: ") + "Merge ordered second",
        exact: true,
      })
      .press("Alt+ArrowUp");
    await expect(page.locator(".task-list .task-title")).toHaveText([
      "Merge ordered second",
      "Merge original task",
    ]);
    await page.goto(workbench.url + "/#library");
    const bytes = Buffer.from("Merge original binary\n完整原件", "utf8");
    await page
      .getByLabel(zh ? "上传文件" : "Upload file", { exact: true })
      .setInputFiles({
        name: "merge-original.txt",
        mimeType: "text/plain",
        buffer: bytes,
      });
    await expect(page.locator(".file-text-preview")).toHaveText(
      bytes.toString("utf8"),
    );
    await unlock(
      page,
      workbench.url,
      workbench.secret,
      words(info.project.name),
      "prepare",
    );
    const choices = page.getByRole("region", {
      name: zh ? "选择合并内容" : "Choose content to merge",
      exact: true,
    });
    const prepare = choices.getByRole("button", {
      name: zh ? "生成导入预览" : "Prepare import preview",
      exact: true,
    });
    await expect(prepare).toBeDisabled();
    await choices
      .getByRole("button", {
        name: zh ? "全部选择复制" : "Choose copy for all",
        exact: true,
      })
      .click();
    await prepare.click();
    const apply = choices.getByRole("button", {
      name: zh ? "确认并导入" : "Confirm and import",
      exact: true,
    });
    await expect(apply).toBeVisible();
    await page.screenshot({
      path: info.outputPath("merge-command-preview.png"),
      fullPage: true,
    });
    const before = await (
      await page.request.get(workbench.url + "/api/snapshot")
    ).json();
    expect(before.files).toHaveLength(0);
    expect(
      before.items.some(
        (item: { title: string }) => item.title === "Merge original task",
      ),
    ).toBe(false);
    let dropped = false;
    const requestIds: string[] = [];
    await page.route("**/api/files/register", async (route) => {
      requestIds.push(route.request().headers()["idempotency-key"]!);
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      if (!dropped) {
        dropped = true;
        await route.abort("connectionreset");
      } else await route.fulfill({ response });
    });
    await apply.click();
    await expect(choices.getByRole("alert")).toBeVisible();
    expect(dropped).toBe(true);
    if (recoveryMode === "REVIEW")
      await mutation(page, "/api/work/create", {
        title: "Independent change during import",
      });
    await page.reload();
    const recovery = page.getByRole("region", {
      name: zh ? "导入恢复" : "Import recovery",
      exact: true,
    });
    if (recoveryMode === "REVIEW") {
      const reviewButton = recovery.getByRole("button", {
        name: zh ? "检查目标变化" : "Review destination changes",
        exact: true,
      });
      await reviewButton.click();
      const changes = recovery.getByRole("region", {
        name: zh ? "重新审查导入" : "Review import changes",
        exact: true,
      });
      const accept = changes.getByRole("button", {
        name: zh
          ? "确认新预览并准备剩余操作"
          : "Accept review and prepare remaining operations",
        exact: true,
      });
      await expect(accept).toBeEnabled();
      expect(requestIds).toHaveLength(1);
      await mutation(page, "/api/work/create", { title: "Race after review" });
      await accept.click();
      await expect(recovery.getByRole("alert").first()).toBeVisible();
      expect(requestIds).toHaveLength(1);
      await reviewButton.click();
      await expect(accept).toBeEnabled();
      await accept.click();
      await expect(recovery).toContainText(
        zh ? "已由新的审查记录继续" : "Continued by a new review",
      );
    }
    await recovery
      .getByRole("button", {
        name: zh ? "继续此导入" : "Resume this import",
        exact: true,
      })
      .click();
    await expect(recovery).toContainText(
      zh ? "内容已导入" : "Content imported",
    );
    expect(requestIds).toHaveLength(recoveryMode === "RETRY" ? 2 : 1);
    expect(new Set(requestIds).size).toBe(1);
    const after = await (
      await page.request.get(workbench.url + "/api/snapshot")
    ).json();
    expect(
      after.items.filter(
        (item: { title: string }) => item.title === "Merge original task",
      ),
    ).toHaveLength(1);
    expect(after.manualOrders).toHaveLength(1);
    expect(
      after.manualOrders[0].entries.map(
        (entry: { entityId: string }) =>
          after.items.find((item: { id: string }) => item.id === entry.entityId)
            .title,
      ),
    ).toEqual([
      ...(recoveryMode === "REVIEW"
        ? ["Independent change during import", "Race after review"]
        : []),
      "Merge ordered second",
      "Merge original task",
    ]);
    expect(after.files).toHaveLength(1);
    const file = after.files[0];
    const downloaded = await page.request.get(
      workbench.url + "/api/v1/files/bytes?id=" + file.id,
    );
    expect(downloaded.status()).toBe(200);
    expect(await downloaded.body()).toEqual(bytes);
    await page.goto(workbench.url + "/#tasks");
    await expect(
      page.locator(".task-title", { hasText: "Merge original task" }),
    ).toBeVisible();
    await mutation(page, "/api/work/create", {
      title: "Later destination update",
    });
    await page.goto(workbench.url + "/#account");
    await recovery
      .getByRole("button", {
        name: zh ? "查看导入后的工作区" : "Review imported workspace",
        exact: true,
      })
      .click();
    const completion = recovery.getByRole("region", {
      name: zh ? "导入后工作区预览" : "Imported workspace preview",
      exact: true,
    });
    await expect(completion).toContainText(
      zh ? "导入完成后目标还有更新" : "The destination changed after import",
    );
    await Promise.all([
      page.waitForEvent("load"),
      completion
        .getByRole("button", {
          name: zh ? "打开导入后的工作区" : "Open imported workspace",
          exact: true,
        })
        .click(),
    ]);
    await page.goto(workbench.url + "/#tasks");
    await expect(
      page.locator(".task-title", { hasText: "Later destination update" }),
    ).toBeVisible();
    await expect(
      page.locator(".task-title", { hasText: "Merge original task" }),
    ).toBeVisible();
    await page.route("**/api/**", (route) =>
      route.abort("internetdisconnected"),
    );
    await page.goto(workbench.url + "/#account");
    const devices = page.getByRole("navigation", {
      name: zh ? "本机工作区" : "Device workspaces",
      exact: true,
    });
    await Promise.all([
      page.waitForEvent("load"),
      devices
        .getByRole("button", {
          name: zh ? "本机原工作区" : "Original device workspace",
          exact: true,
        })
        .click(),
    ]);
    await page.goto(workbench.url + "/#tasks");
    await expect(
      page.locator(".task-title", { hasText: "Later destination update" }),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      page.locator(".task-title", { hasText: "Merge original task" }),
    ).toBeVisible();
    await page.goto(workbench.url + "/#library");
    await page
      .locator(".library-file-row", { hasText: "merge-original.txt" })
      .click();
    await expect(page.locator(".file-text-preview")).toHaveText(
      bytes.toString("utf8"),
    );
    await page.screenshot({
      path: info.outputPath("merge-source-offline.png"),
      fullPage: true,
    });
  });
}

test("local content imports into a newly created owned workspace before explicit replica activation", async ({
  page,
  workbench,
}, info) => {
  const zh = info.project.name.endsWith("zh");
  await page.goto(workbench.url + "/#tasks");
  await page
    .getByRole("button", { name: zh ? "新建任务" : "New task", exact: true })
    .first()
    .click();
  const editor = page.getByRole("dialog");
  await editor
    .getByLabel(zh ? "标题" : "Title", { exact: true })
    .fill("New workspace original");
  await editor
    .getByRole("button", { name: zh ? "新建任务" : "Create task", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  const w = words(info.project.name);
  // A nested folder, a filed note and presentation icons must survive the merge copy.
  await nav(page, w.desk.files);
  const sourceTree = page.locator(".folder-tree");
  await sourceTree
    .getByRole("button", { name: w.desk.newFolder, exact: true })
    .click();
  await sourceTree.getByLabel(w.desk.folderName).fill("Imported folder");
  await sourceTree
    .getByRole("button", { name: w.desk.createFolder, exact: true })
    .click();
  const sourceFolderRow = () =>
    sourceTree
      .locator(".folder-tree-row")
      .filter({ hasText: "Imported folder" });
  await sourceFolderRow()
    .getByRole("button", { name: w.desk.chooseIcon, exact: true })
    .click();
  await page.getByRole("button", { name: "🧪", exact: true }).click();
  await sourceFolderRow()
    .getByRole("button", {
      name: new RegExp(`^(Folder actions|文件夹操作): Imported folder$`),
    })
    .click();
  await page
    .getByRole("menuitem", { name: w.desk.newDocumentInFolder, exact: true })
    .click();
  await expect(
    pane(page).getByLabel(w.desk.noteTitle, { exact: true }),
  ).toHaveValue(w.desk.untitledNote);
  await page
    .getByRole("button", { name: /^(Workspace|工作台)$/, exact: true })
    .click();
  await nav(page, w.desk.files);
  const sourceNote = () =>
    page.locator(".note-card").filter({ hasText: w.desk.untitledNote });
  await sourceNote()
    .getByRole("button", { name: w.desk.chooseIcon, exact: true })
    .click();
  await page.getByRole("button", { name: "🔬", exact: true }).click();
  await unlock(page, workbench.url, workbench.secret, w, "prepare");
  await page
    .getByText(zh ? "新建空的远程工作区" : "Create an empty remote workspace", {
      exact: true,
    })
    .click();
  await page
    .getByLabel(zh ? "新工作区名称" : "New workspace name", { exact: true })
    .fill("Imported device workspace");
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/workspaces/create",
  );
  await page
    .getByRole("button", {
      name: zh ? "创建空工作区" : "Create empty workspace",
      exact: true,
    })
    .click();
  expect((await created).ok()).toBe(true);
  const response = await page.request.get(workbench.url + "/api/v1/workspaces");
  const owned: { id: string; name: string }[] = await response.json();
  const destination = owned.find(
    (entry) => entry.name === "Imported device workspace",
  );
  expect(destination).toBeDefined();
  if (!destination) throw new Error("MISSING_OWNED_DESTINATION");
  const defaultBefore = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(defaultBefore.items).toHaveLength(0);
  const preview = page.getByRole("region", {
    name: zh ? "工作区连接预览" : "Workspace connection preview",
    exact: true,
  });
  await preview
    .getByRole("button", {
      name: zh ? "查看合并预览" : "Review merge preview",
      exact: true,
    })
    .click();
  const report = preview.getByRole("region", {
    name: zh ? "合并预览" : "Merge preview",
    exact: true,
  });
  await report
    .getByRole("button", {
      name: zh ? "保存合并前备份" : "Save a backup before merging",
      exact: true,
    })
    .click();
  const choices = report.getByRole("region", {
    name: zh ? "选择合并内容" : "Choose content to merge",
    exact: true,
  });
  await choices
    .getByRole("button", {
      name: zh ? "全部选择复制" : "Choose copy for all",
      exact: true,
    })
    .click();
  await choices
    .getByRole("button", {
      name: zh ? "生成导入预览" : "Prepare import preview",
      exact: true,
    })
    .click();
  await choices
    .getByRole("button", {
      name: zh ? "确认并导入" : "Confirm and import",
      exact: true,
    })
    .click();
  await expect(choices.getByRole("status")).toContainText(
    zh ? "所选内容已导入" : "Selected content imported",
  );
  const target = await (
    await page.request.get(workbench.url + "/api/snapshot", {
      headers: { "X-Workspace-Id": destination.id },
    })
  ).json();
  expect(target.items.map((item: { title: string }) => item.title)).toEqual([
    "New workspace original",
  ]);
  const importedFolder = target.organization.find(
    (entry: { kind: string; name?: string }) =>
      entry.kind === "FOLDER" && entry.name === "Imported folder",
  );
  expect(importedFolder).toMatchObject({ icon: "🧪", parentId: "" });
  const importedNote = target.organization.find(
    (entry: { kind: string; id: string }) =>
      entry.kind === "NOTE" &&
      target.notes.some(
        (note: { id: string; title: string }) =>
          note.id === entry.id && note.title === w.desk.untitledNote,
      ),
  );
  expect(importedNote).toMatchObject({
    folderId: importedFolder.id,
    icon: "🔬",
  });
  expect(
    (await (await page.request.get(workbench.url + "/api/snapshot")).json())
      .items,
  ).toHaveLength(0);
  const recovery = page.getByRole("region", {
    name: zh ? "导入恢复" : "Import recovery",
    exact: true,
  });
  await recovery
    .getByRole("button", {
      name: zh ? "查看导入后的工作区" : "Review imported workspace",
      exact: true,
    })
    .click();
  await Promise.all([
    page.waitForEvent("load"),
    recovery
      .getByRole("button", {
        name: zh ? "打开导入后的工作区" : "Open imported workspace",
        exact: true,
      })
      .click(),
  ]);
  await page.goto(workbench.url + "/#tasks");
  await expect(
    page.locator(".task-title", { hasText: "New workspace original" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.locator(".task-title", { hasText: "New workspace original" }),
  ).toBeVisible();
  await page.goto(workbench.url + "/#account");
  await expect(
    page
      .getByRole("navigation", {
        name: zh ? "本机工作区" : "Device workspaces",
        exact: true,
      })
      .getByRole("button", {
        name: zh ? "账户工作区" : "Account workspace",
        exact: true,
      }),
  ).toHaveAttribute("aria-current", "page");
});

for (const resolution of ["LOCAL", "REMOTE"] as const) {
  test(`import re-review resolves changed task settings explicitly with ${resolution}`, async ({
    page,
    workbench,
  }, info) => {
    const zh = info.project.name.endsWith("zh");
    await page.goto(workbench.url + "/#tasks");
    await page
      .getByRole("button", { name: zh ? "新建任务" : "New task", exact: true })
      .first()
      .click();
    const editor = page.getByRole("dialog");
    await editor
      .getByLabel(zh ? "标题" : "Title", { exact: true })
      .fill("Source stays intact");
    await editor
      .getByRole("button", {
        name: zh ? "新建任务" : "Create task",
        exact: true,
      })
      .click();
    await expect(editor).toHaveCount(0);
    await unlock(
      page,
      workbench.url,
      workbench.secret,
      words(info.project.name),
      "prepare",
    );
    const choices = page.getByRole("region", {
      name: zh ? "选择合并内容" : "Choose content to merge",
      exact: true,
    });
    await choices
      .getByRole("button", {
        name: zh ? "全部选择复制" : "Choose copy for all",
        exact: true,
      })
      .click();
    await choices
      .getByRole("button", {
        name: zh ? "生成导入预览" : "Prepare import preview",
        exact: true,
      })
      .click();
    let attempted = 0;
    await page.route("**/api/work/update", (route) => {
      attempted++;
      return route.abort("connectionreset");
    });
    await choices
      .getByRole("button", {
        name: zh ? "确认并导入" : "Confirm and import",
        exact: true,
      })
      .click();
    await expect(choices.getByRole("alert")).toBeVisible();
    expect(attempted).toBe(1);
    const target = await (
      await page.request.get(workbench.url + "/api/snapshot")
    ).json();
    expect(target.items).toHaveLength(1);
    const current = target.items[0];
    await mutation(page, "/api/work/update", {
      id: current.id,
      version: current.version,
      input: {
        title: "Remote keeps its edit",
        activationState: "ACTIVE",
        status: "IN_PROGRESS",
      },
    });
    await page.reload();
    const recovery = page.getByRole("region", {
      name: zh ? "导入恢复" : "Import recovery",
      exact: true,
    });
    await recovery
      .getByRole("button", {
        name: zh ? "检查目标变化" : "Review destination changes",
        exact: true,
      })
      .click();
    const review = recovery.getByRole("region", {
      name: zh ? "重新审查导入" : "Review import changes",
      exact: true,
    });
    await expect(review.getByRole("alert")).toContainText(
      zh ? "相关内容也有修改" : "Related content also changed",
    );
    await expect(
      review.getByRole("button", {
        name: zh
          ? "确认新预览并准备剩余操作"
          : "Accept review and prepare remaining operations",
        exact: true,
      }),
    ).toBeDisabled();
    expect(attempted).toBe(1);
    const unchanged = await (
      await page.request.get(workbench.url + "/api/snapshot")
    ).json();
    expect(unchanged.items).toHaveLength(1);
    expect(unchanged.items[0]).toMatchObject({
      id: current.id,
      title: "Remote keeps its edit",
      status: "IN_PROGRESS",
      version: 2,
    });
    await page.screenshot({
      path: info.outputPath("work-import-resolution.png"),
      fullPage: true,
    });
    await review
      .getByRole("button", {
        name:
          resolution === "LOCAL"
            ? zh
              ? "使用本机设置"
              : "Use local settings"
            : zh
              ? "保留目标设置"
              : "Keep destination settings",
        exact: true,
      })
      .click();
    await expect(
      review.getByRole("button", {
        name: zh
          ? "确认新预览并准备剩余操作"
          : "Accept review and prepare remaining operations",
        exact: true,
      }),
    ).toBeEnabled();
    await review
      .getByRole("button", {
        name: zh
          ? "确认新预览并准备剩余操作"
          : "Accept review and prepare remaining operations",
        exact: true,
      })
      .click();
    await expect(review).toHaveCount(0);
    await expect(
      recovery.getByText(
        zh
          ? "已由新的审查记录继续，原记录仍保留。"
          : "Continued by a new review; this original record is retained.",
        { exact: true },
      ),
    ).toBeVisible();
    // Preparing the reviewed fork must not apply it or clear the original local task.
    const prepared = await (
      await page.request.get(workbench.url + "/api/snapshot")
    ).json();
    expect(prepared.items[0].version).toBe(2);
    await page.unroute("**/api/work/update");
    await recovery
      .getByRole("button", {
        name: zh ? "继续此导入" : "Resume this import",
        exact: true,
      })
      .click();
    await expect(
      recovery.getByText(zh ? "内容已导入" : "Content imported", {
        exact: false,
      }),
    ).toBeVisible();
    const finished = await (
      await page.request.get(workbench.url + "/api/snapshot")
    ).json();
    expect(finished.items).toHaveLength(1);
    expect(finished.items[0]).toMatchObject({
      id: current.id,
      title: "Remote keeps its edit",
      status: resolution === "LOCAL" ? "TODO" : "IN_PROGRESS",
      version: 3,
    });
    await page.route("**/api/**", (route) =>
      route.abort("internetdisconnected"),
    );
    await page.goto(workbench.url + "/#tasks");
    await expect(
      page.locator(".task-title", { hasText: "Source stays intact" }),
    ).toBeVisible();
    await expect(
      page.locator(".task-title", { hasText: "Remote keeps its edit" }),
    ).toHaveCount(0);
  });
}
for (const choice of ["LOCAL", "REMOTE"] as const) {
  test(`import File rename re-review preserves original bytes with ${choice}`, async ({
    page,
    workbench,
  }, info) => {
    const zh = info.project.name.endsWith("zh");
    const bytes = Buffer.from("Original import conflict bytes\n不可变原件");
    await page.goto(workbench.url + "/#library");
    await page
      .getByLabel(zh ? "上传文件" : "Upload file", { exact: true })
      .setInputFiles({
        name: "import-conflict-original.txt",
        mimeType: "text/plain",
        buffer: bytes,
      });
    await expect(page.locator(".file-text-preview")).toHaveText(
      bytes.toString("utf8"),
    );
    const detail = page.getByRole("region", {
      name: "import-conflict-original.txt",
      exact: true,
    });
    await detail
      .getByLabel(zh ? "文件名称" : "File name", { exact: true })
      .fill("local-import-name.txt");
    await detail
      .getByRole("button", { name: zh ? "保存名称" : "Save name", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "local-import-name.txt", exact: true }),
    ).toBeVisible();
    await unlock(
      page,
      workbench.url,
      workbench.secret,
      words(info.project.name),
      "prepare",
    );
    const choices = page.getByRole("region", {
      name: zh ? "选择合并内容" : "Choose content to merge",
      exact: true,
    });
    await choices
      .getByRole("button", {
        name: zh ? "全部选择复制" : "Choose copy for all",
        exact: true,
      })
      .click();
    await choices
      .getByRole("button", {
        name: zh ? "生成导入预览" : "Prepare import preview",
        exact: true,
      })
      .click();
    let renameAttempts = 0;
    await page.route("**/api/files/rename", (route) => {
      renameAttempts++;
      return route.abort("connectionreset");
    });
    await choices
      .getByRole("button", {
        name: zh ? "确认并导入" : "Confirm and import",
        exact: true,
      })
      .click();
    await expect(choices.getByRole("alert")).toBeVisible();
    expect(renameAttempts).toBe(1);
    const target = await (
      await page.request.get(workbench.url + "/api/snapshot")
    ).json();
    expect(target.files).toHaveLength(1);
    const original = target.files[0];
    expect(original).toMatchObject({
      name: "import-conflict-original.txt",
      version: 1,
    });
    await mutation(page, "/api/v1/files/rename", {
      id: original.id,
      version: 1,
      name: "remote-import-name.txt",
    });
    await page.reload();
    const recovery = page.getByRole("region", {
      name: zh ? "导入恢复" : "Import recovery",
      exact: true,
    });
    await recovery
      .getByRole("button", {
        name: zh ? "检查目标变化" : "Review destination changes",
        exact: true,
      })
      .click();
    const review = recovery.getByRole("region", {
      name: zh ? "重新审查导入" : "Review import changes",
      exact: true,
    });
    await expect(review).toContainText("local-import-name.txt");
    await expect(review).toContainText("remote-import-name.txt");
    const accept = review.getByRole("button", {
      name: zh
        ? "确认新预览并准备剩余操作"
        : "Accept review and prepare remaining operations",
      exact: true,
    });
    await expect(accept).toBeDisabled();
    await review
      .getByRole("button", {
        name:
          choice === "LOCAL"
            ? zh
              ? "使用本机设置"
              : "Use local settings"
            : zh
              ? "保留目标设置"
              : "Keep destination settings",
        exact: true,
      })
      .click();
    await page.screenshot({
      path: info.outputPath("file-import-resolution.png"),
      fullPage: true,
    });
    await accept.click();
    await expect(review).toHaveCount(0);
    // Restore the app: the selected decision must survive reload without executing itself.
    await page.reload();
    expect(
      (await (await page.request.get(workbench.url + "/api/snapshot")).json())
        .files[0].version,
    ).toBe(2);
    await page.unroute("**/api/files/rename");
    await recovery
      .getByRole("button", {
        name: zh ? "继续此导入" : "Resume this import",
        exact: true,
      })
      .click();
    await expect(
      recovery.getByText(zh ? "内容已导入" : "Content imported", {
        exact: false,
      }),
    ).toBeVisible();
    const imported = await (
      await page.request.get(
        workbench.url + "/api/v1/files/metadata?id=" + original.id,
      )
    ).json();
    expect(imported).toMatchObject({
      name:
        choice === "LOCAL" ? "local-import-name.txt" : "remote-import-name.txt",
      originalName: "import-conflict-original.txt",
      contentHash: original.contentHash,
      version: 3,
    });
    const downloaded = await page.request.get(
      workbench.url + "/api/v1/files/bytes?id=" + original.id,
    );
    expect(downloaded.status()).toBe(200);
    expect(await downloaded.body()).toEqual(bytes);
    await page.route("**/api/**", (route) =>
      route.abort("internetdisconnected"),
    );
    await page.goto(workbench.url + "/#library");
    await expect(
      page.getByText("local-import-name.txt", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("remote-import-name.txt", { exact: true }),
    ).toHaveCount(0);
  });
}
for (const choice of ["LOCAL", "REMOTE"] as const) {
  test(`import manual order review respects explicit ${choice} sequence`, async ({
    page,
    workbench,
  }, info) => {
    const zh = info.project.name.endsWith("zh");
    await page.goto(workbench.url + "/#tasks");
    for (const title of ["Import order first", "Import order second"]) {
      await page
        .getByRole("button", {
          name: zh ? "新建任务" : "New task",
          exact: true,
        })
        .first()
        .click();
      const editor = page.getByRole("dialog");
      await editor
        .getByLabel(zh ? "标题" : "Title", { exact: true })
        .fill(title);
      await editor
        .getByRole("button", {
          name: zh ? "新建任务" : "Create task",
          exact: true,
        })
        .click();
      await expect(editor).toHaveCount(0);
    }
    await page
      .getByRole("combobox", { name: zh ? "排序" : "Sort", exact: true })
      .selectOption("manual");
    await page
      .getByRole("button", {
        name: (zh ? "调整顺序：" : "Reorder: ") + "Import order second",
        exact: true,
      })
      .press("Alt+ArrowUp");
    await expect(page.locator(".task-list .task-title")).toHaveText([
      "Import order second",
      "Import order first",
    ]);
    await unlock(
      page,
      workbench.url,
      workbench.secret,
      words(info.project.name),
      "prepare",
    );
    const choices = page.getByRole("region", {
      name: zh ? "选择合并内容" : "Choose content to merge",
      exact: true,
    });
    await choices
      .getByRole("button", {
        name: zh ? "全部选择复制" : "Choose copy for all",
        exact: true,
      })
      .click();
    await choices
      .getByRole("button", {
        name: zh ? "生成导入预览" : "Prepare import preview",
        exact: true,
      })
      .click();
    await page.route("**/api/manual-orders/sequence", (route) =>
      route.abort("connectionreset"),
    );
    await choices
      .getByRole("button", {
        name: zh ? "确认并导入" : "Confirm and import",
        exact: true,
      })
      .click();
    await expect(choices.getByRole("alert")).toBeVisible();
    const target = await (
      await page.request.get(workbench.url + "/api/snapshot")
    ).json();
    expect(target.items).toHaveLength(2);
    expect(target.manualOrders).toHaveLength(0);
    const first = target.items.find(
      (item: { title: string }) => item.title === "Import order first",
    );
    const second = target.items.find(
      (item: { title: string }) => item.title === "Import order second",
    );
    await mutation(page, "/api/manual-orders/sequence", {
      scope: { kind: "WORKSPACE_TASKS" },
      version: 0,
      orderedEntityIds: [first.id, second.id],
    });
    await page.reload();
    const recovery = page.getByRole("region", {
      name: zh ? "导入恢复" : "Import recovery",
      exact: true,
    });
    await recovery
      .getByRole("button", {
        name: zh ? "检查目标变化" : "Review destination changes",
        exact: true,
      })
      .click();
    const review = recovery.getByRole("region", {
      name: zh ? "重新审查导入" : "Review import changes",
      exact: true,
    });
    await expect(review).toContainText(zh ? "手动排序" : "Manual order");
    await expect(review).toContainText(
      "Import order first → Import order second",
    );
    await expect(review).toContainText(
      "Import order second → Import order first",
    );
    const prepare = review.getByRole("button", {
      name: zh
        ? "确认新预览并准备剩余操作"
        : "Accept review and prepare remaining operations",
      exact: true,
    });
    await expect(prepare).toBeDisabled();
    await review
      .getByRole("button", {
        name:
          choice === "LOCAL"
            ? zh
              ? "使用本机设置"
              : "Use local settings"
            : zh
              ? "保留目标设置"
              : "Keep destination settings",
        exact: true,
      })
      .click();
    await page.screenshot({
      path: info.outputPath("order-import-resolution.png"),
      fullPage: true,
    });
    await prepare.click();
    await expect(review).toHaveCount(0);
    await page.unroute("**/api/manual-orders/sequence");
    await recovery
      .getByRole("button", {
        name: zh ? "继续此导入" : "Resume this import",
        exact: true,
      })
      .click();
    await expect(
      recovery.getByText(zh ? "内容已导入" : "Content imported", {
        exact: false,
      }),
    ).toBeVisible();
    const snapshot = await (
      await page.request.get(workbench.url + "/api/snapshot")
    ).json();
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.manualOrders).toHaveLength(1);
    const order = [...snapshot.manualOrders[0].entries]
      .sort(
        (a: { position: number }, b: { position: number }) =>
          a.position - b.position,
      )
      .map((entry: { entityId: string }) => entry.entityId);
    expect(order).toEqual(
      choice === "LOCAL" ? [second.id, first.id] : [first.id, second.id],
    );
    await page.route("**/api/**", (route) =>
      route.abort("internetdisconnected"),
    );
    await page.goto(workbench.url + "/#tasks");
    await page
      .getByRole("combobox", { name: zh ? "排序" : "Sort", exact: true })
      .selectOption("manual");
    await expect(page.locator(".task-list .task-title")).toHaveText([
      "Import order second",
      "Import order first",
    ]);
  });
}
test("local owned project knowledge imports ownership and original Markdown before replica activation", async ({
  page,
  workbench,
}, info) => {
  const zh = info.project.name.endsWith("zh"),
    w = words(info.project.name);
  await page.goto(workbench.url + "/#projects");
  await page
    .getByRole("button", { name: w.desk.newProject, exact: true })
    .first()
    .click();
  const editor = page.getByRole("dialog");
  await editor
    .getByLabel(w.work.title, { exact: true })
    .fill("Local owned import project");
  await editor
    .getByRole("button", { name: w.desk.createProject, exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await page
    .getByRole("button", { name: "Local owned import project", exact: true })
    .press("Enter");
  await page
    .getByRole("tab", { name: w.desk.projectHub.knowledge, exact: true })
    .click();
  await page
    .getByLabel(zh ? "知识空间名称" : "Wiki space title", { exact: true })
    .fill("Local owned import space");
  await page.getByRole("button", { name: /创建 Wiki|Create Wiki/ }).click();
  await expect(
    page.getByRole("button", { name: /★ Local owned import space/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: zh ? "新建页面" : "Create page", exact: true })
    .click();
  await pane(page)
    .getByLabel(w.spaces.title, { exact: true })
    .fill("Local owned import document");
  await documentMode(page, zh ? "源码" : "Source");
  const original =
    "# Original owned document\n第一行\n第二行\n- [ ] remains prose";
  await pane(page).getByLabel(w.spaces.body, { exact: true }).fill(original);
  await saveDocument(page, w);
  await browseDocuments(page);
  await unlock(page, workbench.url, workbench.secret, w, "prepare");
  const choices = page.getByRole("region", {
    name: zh ? "选择合并内容" : "Choose content to merge",
    exact: true,
  });
  await choices
    .getByRole("button", {
      name: zh ? "全部选择复制" : "Choose copy for all",
      exact: true,
    })
    .click();
  await choices
    .getByRole("button", {
      name: zh ? "生成导入预览" : "Prepare import preview",
      exact: true,
    })
    .click();
  await choices
    .getByRole("button", {
      name: zh ? "确认并导入" : "Confirm and import",
      exact: true,
    })
    .click();
  const recovery = page.getByRole("region", {
    name: zh ? "导入恢复" : "Import recovery",
    exact: true,
  });
  await expect(
    recovery.getByText(zh ? "内容已导入" : "Content imported", {
      exact: false,
    }),
  ).toBeVisible();
  const snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(snapshot.items).toHaveLength(1);
  const project = snapshot.items[0];
  expect(project).toMatchObject({
    title: "Local owned import project",
    type: "PROJECT",
    lifecycle: "PLANNED",
  });
  expect(snapshot.projectMaterials).toHaveLength(2);
  expect(
    snapshot.projectMaterials.every(
      (entry: { projectId: string; ownership: string }) =>
        entry.projectId === project.id && entry.ownership === "OWNED",
    ),
  ).toBe(true);
  const library = await (
    await page.request.get(workbench.url + "/api/library")
  ).json();
  const space = library.find(
    (entry: { title: string }) => entry.title === "Local owned import space",
  );
  const doc = library.find(
    (entry: { title: string }) => entry.title === "Local owned import document",
  );
  expect(doc).toMatchObject({
    bodyMd: original,
    spaceId: space.id,
    version: 2,
  });
  expect(snapshot.projectMaterials).toContainEqual(
    expect.objectContaining({ kind: "SPACE", targetId: space.id }),
  );
  expect(snapshot.projectMaterials).toContainEqual(
    expect.objectContaining({ kind: "DOCUMENT", targetId: doc.id }),
  );
  // Import completion has not activated another replica or erased the source project.
  await page.route("**/api/**", (route) => route.abort("internetdisconnected"));
  await page.goto(workbench.url + "/#projects");
  await page
    .getByRole("button", { name: "Local owned import project", exact: true })
    .press("Enter");
  await page
    .getByRole("tab", { name: w.desk.projectHub.knowledge, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /★ Local owned import space/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Local owned import document", exact: true })
    .first()
    .click();
  await documentMode(page, zh ? "源码" : "Source");
  await expect(
    pane(page).getByLabel(w.spaces.body, { exact: true }),
  ).toHaveJSProperty("innerText", original);
});

for (const choice of ["LOCAL", "REMOTE"] as const) {
  test(`Markdown conflict review preserves original text and applies explicit ${choice} choice`, async ({
    page,
    workbench,
  }, info) => {
    const w = words(info.project.name),
      zh = info.project.name.endsWith("zh");
    await unlock(page, workbench.url, workbench.secret, w);
    const original = "original first\nunchanged middle\noriginal last";
    const local = "device first\nunchanged middle\noriginal last";
    const remote = "server first\nunchanged middle\noriginal last";
    const note = await mutation(page, "/api/note/save", {
      id: null,
      version: 0,
      input: {
        title: "Markdown conflict note",
        kind: "NOTE",
        day: null,
        bodyMd: original,
      },
    });
    await page.reload();
    await nav(page, w.desk.notes);
    await page
      .locator(".note-card")
      .filter({ hasText: "Markdown conflict note" })
      .press("Enter");
    await documentMode(page, zh ? "源码" : "Source");
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let observed: () => void = () => {};
    const intercepted = new Promise<void>((resolve) => {
      observed = resolve;
    });
    let first = true;
    await page.route("**/api/v1/note/save", async (route) => {
      if (first) {
        first = false;
        observed();
        await blocked;
      }
      await route.continue();
    });
    const bodyEditor = pane(page).getByLabel(w.desk.noteBody, { exact: true });
    await bodyEditor.click();
    await bodyEditor.press("ControlOrMeta+A");
    await bodyEditor.press("Backspace");
    await bodyEditor.fill(local);
    await saveDocument(page, w);
    await intercepted;
    try {
      await mutation(page, "/api/note/save", {
        id: note.id,
        version: 1,
        input: {
          title: "Markdown conflict note",
          kind: "NOTE",
          day: null,
          bodyMd: remote,
        },
      });
    } finally {
      release();
    }
    await browseDocuments(page);
    await page.goto(workbench.url + "/#account");
    await page
      .getByRole("button", {
        name: /Markdown conflict note.*(Compare changes|比较修改)/,
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: zh ? "比较同步修改" : "Compare synced changes",
    });
    await expect(dialog).toContainText(original);
    await expect(dialog).toContainText(local);
    await expect(dialog).toContainText(remote);
    await dialog
      .getByRole("radio", {
        name:
          choice === "LOCAL"
            ? zh
              ? "保留本机修改"
              : "Keep device changes"
            : zh
              ? "使用远端内容"
              : "Use remote values",
      })
      .check();
    await dialog
      .getByRole("button", {
        name: zh ? "应用选择" : "Apply choice",
        exact: true,
      })
      .click();
    await expect(dialog).toHaveCount(0);
    const expected = choice === "LOCAL" ? local : remote;
    await expect
      .poll(
        async () =>
          await (
            await page.request.get(
              workbench.url + "/api/document/body?kind=NOTE&id=" + note.id,
            )
          ).json(),
      )
      .toMatchObject({ version: 3, bodyMd: expected });
    await page.reload();
    await page.route("**/api/**", (route) =>
      route.abort("internetdisconnected"),
    );
    await nav(page, w.desk.notes);
    await page
      .locator(".note-card")
      .filter({ hasText: "Markdown conflict note" })
      .press("Enter");
    await documentMode(page, zh ? "源码" : "Source");
    await expect(
      pane(page).getByLabel(w.desk.noteBody, { exact: true }),
    ).toHaveJSProperty("innerText", expected);
  });
}

for (const choice of ["RESTORE", "REMOTE", "COPY"] as const) {
  test(`remote deleted Markdown review preserves device evidence and applies ${choice}`, async ({
    page,
    workbench,
  }, info) => {
    const w = words(info.project.name),
      zh = info.project.name.endsWith("zh");
    await unlock(page, workbench.url, workbench.secret, w);
    const original = "original body";
    const local = "device edit that must survive review";
    const note = await mutation(page, "/api/note/save", {
      id: null,
      version: 0,
      input: {
        title: "Remote deleted Markdown",
        kind: "NOTE",
        day: null,
        bodyMd: original,
      },
    });
    await page.reload();
    await nav(page, w.desk.notes);
    await page
      .locator(".note-card")
      .filter({ hasText: "Remote deleted Markdown" })
      .press("Enter");
    await documentMode(page, zh ? "源码" : "Source");
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let observed: () => void = () => {};
    const intercepted = new Promise<void>((resolve) => {
      observed = resolve;
    });
    let first = true;
    await page.route("**/api/v1/note/save", async (route) => {
      if (first) {
        first = false;
        observed();
        await blocked;
      }
      await route.continue();
    });
    const bodyEditor = pane(page).getByLabel(w.desk.noteBody, { exact: true });
    await bodyEditor.click();
    await bodyEditor.press("ControlOrMeta+A");
    await bodyEditor.press("Backspace");
    await bodyEditor.fill(local);
    await saveDocument(page, w);
    await browseDocuments(page);
    await intercepted;
    try {
      await mutation(page, "/api/note/delete", {
        id: note.id,
        version: 1,
        deleted: true,
      });
    } finally {
      release();
    }
    await page.goto(workbench.url + "/#account");
    const reviewButton = page.getByRole("button", {
      name: /Remote deleted Markdown.*(Compare changes|比较修改)/,
    });
    await expect(reviewButton).toBeVisible();
    await reviewButton.click();
    const dialog = page.getByRole("dialog", {
      name: zh ? "比较同步修改" : "Compare synced changes",
    });
    await expect(dialog).toContainText(local);
    await expect(dialog).toContainText(zh ? "远端已删除" : "deleted remotely");
    await dialog
      .getByRole("radio", {
        name:
          choice === "RESTORE"
            ? zh
              ? "恢复并保留本机版本"
              : "Restore and keep device version"
            : choice === "REMOTE"
              ? zh
                ? "接受远端删除"
                : "Accept remote deletion"
              : zh
                ? "另存为新文档"
                : "Save as a new document",
      })
      .check();
    await dialog
      .getByRole("button", {
        name: zh ? "应用选择" : "Apply choice",
        exact: true,
      })
      .click();
    await expect(dialog).toHaveCount(0);
    if (choice === "RESTORE") {
      await expect
        .poll(
          async () =>
            (
              await (
                await page.request.get(
                  workbench.url + "/api/document/body?kind=NOTE&id=" + note.id,
                )
              ).json()
            ).bodyMd,
        )
        .toBe(local);
    }
    await page.reload();
    await page.route("**/api/**", (route) =>
      route.abort("internetdisconnected"),
    );
    await page.goto(workbench.url + "#account");
    await expect(
      page.getByText(zh ? "原始修改仍保留" : "Original records are retained"),
    ).toHaveCount(0);
  });
}

test("Markdown reconnect automatically merges disjoint lines without discarding the local draft", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name),
    zh = info.project.name.endsWith("zh");
  await unlock(page, workbench.url, workbench.secret, w);
  const note = await mutation(page, "/api/note/save", {
    id: null,
    version: 0,
    input: {
      title: "Disjoint Markdown",
      kind: "NOTE",
      day: null,
      bodyMd: "first\nmiddle\nlast",
    },
  });
  await page.reload();
  await nav(page, w.desk.notes);
  await page
    .locator(".note-card")
    .filter({ hasText: "Disjoint Markdown" })
    .press("Enter");
  await documentMode(page, zh ? "源码" : "Source");
  await expect(
    pane(page).getByLabel(w.desk.noteBody, { exact: true }),
  ).toHaveJSProperty("innerText", "first\nmiddle\nlast");
  await page.route("**/api/**", (route) => route.abort("internetdisconnected"));
  // Session304 established that Playwright fill can append on an emulated touch
  // CodeMirror surface. Exercise the same editor input contract deterministically
  // so a test-harness duplication cannot masquerade as a body-merge defect.
  const body = pane(page).getByLabel(w.desk.noteBody, { exact: true });
  await body.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText("device first\nmiddle\nlast");
  await expect(
    pane(page).getByLabel(w.desk.noteBody, { exact: true }),
  ).toHaveJSProperty("innerText", "device first\nmiddle\nlast");
  await saveDocument(page, w);
  await browseDocuments(page);
  await mutation(page, "/api/note/save", {
    id: note.id,
    version: 1,
    input: {
      title: "Remote disjoint title",
      kind: "NOTE",
      day: null,
      bodyMd: "first\nmiddle\nserver last",
    },
  });
  await page.unroute("**/api/**");
  await page.reload();
  const expected = "device first\nmiddle\nserver last";
  await expect
    .poll(
      async () =>
        await (
          await page.request.get(
            workbench.url + "/api/document/body?kind=NOTE&id=" + note.id,
          )
        ).json(),
    )
    .toMatchObject({
      version: 3,
      title: "Remote disjoint title",
      bodyMd: expected,
    });
  await page.route("**/api/**", (route) => route.abort("internetdisconnected"));
  await nav(page, w.desk.notes);
  await page
    .locator(".note-card")
    .filter({ hasText: "Remote disjoint title" })
    .press("Enter");
  await documentMode(page, zh ? "源码" : "Source");
  await expect(
    pane(page).getByLabel(w.desk.noteBody, { exact: true }),
  ).toHaveJSProperty("innerText", expected);
});

test("conflicting predecessor keeps later local edits unsent while unrelated tasks continue", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const task = await mutation(page, "/api/work/create", {
    title: "Predecessor original",
  });
  await page.goto(workbench.url + "/#tasks");
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let observed: () => void = () => {};
  const intercepted = new Promise<void>((resolve) => {
    observed = resolve;
  });
  const sent: string[] = [];
  await page.route("**/api/v1/work/update", async (route) => {
    sent.push(route.request().postDataJSON().input.title);
    if (sent.length === 1) {
      observed();
      await blocked;
    }
    await route.continue();
  });
  const edit = async (from: string, to: string) => {
    await page.locator(".task-title").filter({ hasText: from }).press("Enter");
    const editor = page.getByRole("dialog");
    await editor.getByLabel(w.work.title, { exact: true }).fill(to);
    await editor
      .getByRole("button", { name: w.common.save, exact: true })
      .click();
    await expect(editor).toHaveCount(0);
  };
  await edit("Predecessor original", "Device first pending");
  await intercepted;
  try {
    await mutation(page, "/api/work/update", {
      id: task.id,
      version: 1,
      input: { title: "Remote canonical title" },
    });
  } finally {
    release();
  }
  await page.goto(workbench.url + "/#account");
  await expect(
    page.getByRole("button", {
      name: /Device first pending.*(Compare changes|比较修改)/,
    }),
  ).toBeVisible();
  await page.goto(workbench.url + "/#tasks");
  await edit("Device first pending", "Device second pending");
  await page
    .getByRole("button", { name: w.desk.newTask, exact: true })
    .first()
    .click();
  const editor = page.getByRole("dialog");
  await editor
    .getByLabel(w.work.title, { exact: true })
    .fill("Unrelated synchronized task");
  await editor
    .getByRole("button", { name: w.common.create, exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(workbench.url + "/api/snapshot")).json())
          .items,
    )
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: task.id,
          version: 2,
          title: "Remote canonical title",
        }),
        expect.objectContaining({ title: "Unrelated synchronized task" }),
      ]),
    );
  expect(sent).toEqual(["Device first pending"]);
  await page.reload();
  await expect(
    page.locator(".task-title").filter({ hasText: "Device second pending" }),
  ).toBeVisible();
  expect(sent).toEqual(["Device first pending"]);
  const zh = info.project.name.endsWith("zh");
  await page.goto(workbench.url + "/#account");
  const compare = page.getByRole("button", {
    name: /Device second pending.*(Compare changes|比较修改)/,
  });
  await compare.click();
  let review = page.getByRole("dialog", {
    name: zh ? "比较同步修改" : "Compare synced changes",
  });
  await expect(review).toContainText("Device first pending");
  await expect(review).toContainText(
    zh ? "先处理较早的冲突" : "Resolve the earlier conflict first",
  );
  await review
    .getByRole("radio", { name: zh ? "保留本机修改" : "Keep device changes" })
    .check();
  await review
    .getByRole("button", {
      name: zh ? "应用选择" : "Apply choice",
      exact: true,
    })
    .click();
  await expect(review).toHaveCount(0);
  await expect
    .poll(async () =>
      (
        await (await page.request.get(workbench.url + "/api/snapshot")).json()
      ).items.find((item: { id: string }) => item.id === task.id),
    )
    .toMatchObject({ title: "Device second pending", version: 4 });
  await expect(compare).toHaveCount(0);
  expect(sent).toEqual([
    "Device first pending",
    "Device first pending",
    "Device second pending",
  ]);
});

test("FINAL project destination single click opens without an intermediate Inspector", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  const project = await mutation(page, "/api/work/create", {
    title: "FINAL direct destination",
    type: "PROJECT",
  });
  await page.reload();
  await nav(page, w.desk.projects);
  const row = page.locator(".project-card").filter({ hasText: project.title });
  await expect(row).toBeVisible();
  await row.locator(".project-title").click();
  await expect(page.locator(".project-workspace h1")).toHaveText(project.title);
  await expect(page.locator(".context-pane")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp("#projects/" + project.id));
});
