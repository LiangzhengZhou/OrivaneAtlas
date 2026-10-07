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
    .click();
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

import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  test as base,
  expect,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";
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
                maxInputChars: info.title.includes("project scope")
                  ? 16000
                  : 1000,
                maxOutputTokens: 100,
                timeoutMs: info.title.includes("streaming") ? 6000 : 2000,
                maxRunsPerDay: 2,
              },
              complete: async (prompt: string) => {
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
  const scroll = page.locator(".task-list .virtual-task-scroll");
  await expect(scroll).toHaveAttribute("data-task-count", "1500");
  await expect
    .poll(() => page.locator(".task-list .task-card").count())
    .toBeGreaterThan(0);
  const listRows = await page.locator(".task-list .task-card").count();
  expect(listRows).toBeLessThan(100);
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
  await expect(
    page.locator(".sidebar [draggable=true],.sidebar .nav-drag-handle"),
  ).toHaveCount(0);
  await expect(page.locator(".topbar .mode-badge")).toHaveCount(0);
  await expect(
    page
      .locator(".topbar")
      .getByRole("button", { name: w.desk.refresh, exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".topbar .breadcrumb")).not.toContainText(
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
  await expect(row).toHaveCount(0);
  await taskScope(page, w.desk.taskWorkspace.completed);
  await page.getByLabel(w.desk.status, { exact: true }).selectOption("DONE");
  await expect(
    row.getByRole("button", {
      name: (zh ? "重新打开：" : "Reopen: ") + "Quiet action",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  const snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    snapshot.items.find((item: { id: string }) => item.id === task.id).status,
  ).toBe("DONE");
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
  await expect(page.locator(".context-pane")).toContainText("Gantt project");
  await expect(page.locator(".project-workspace")).toHaveCount(0);
  if (info.project.name.startsWith("mobile"))
    await page
      .locator(".context-pane")
      .getByRole("button", { name: zh ? "打开" : "Open", exact: true })
      .click();
  else
    await page
      .getByRole("button", { name: "Gantt project", exact: true })
      .press("Enter");
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
  await page.goto(
    workbench.url + `/#projects/${project.id}?tab=tasks&scope=SUBTREE`,
  );
  await expect(page.locator(".project-workspace h1")).toHaveText(
    "Gantt portfolio",
  );
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
  await expect(page.locator(".task-dialog")).toHaveCount(0);
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
  await expect(page.locator(".task-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".task-dialog")).toHaveCount(0);
  await context.getByRole("button", { name: "Atlas", exact: true }).click();
  await expect(context.locator(".assistant-pane")).toBeVisible();
  await expect(page.locator(".context-pane")).toHaveCount(1);
  await context
    .getByRole("button", { name: zh ? "详情" : "Details", exact: true })
    .click();
  await expect(
    context.getByRole("heading", { name: "Selected task" }),
  ).toBeVisible();
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
  await pane(page)
    .getByLabel(w.spaces.spaceTitle, { exact: true })
    .fill("Wiki integration");
  await saveDocument(page, w);
  await browseDocuments(page);
  await page
    .locator(".library-view")
    .getByRole("button")
    .filter({
      has: page.getByRole("heading", { name: "Wiki integration", exact: true }),
    })
    .press("Enter");
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
  await unlock(page, workbench.url, workbench.secret, w);
  const project = await mutation(page, "/api/work/create", {
    title: "Paper",
    type: "PROJECT",
    lifecycle: "ACTIVE",
  });
  for (const title of ["Draft", "Submission", "Revision"])
    await mutation(page, "/api/work/create", {
      title,
      type: "MILESTONE",
      parentProjectId: project.id,
      dueDate: "2026-10-01",
    });
  await page.reload();
  await page.evaluate((id) => {
    location.hash = `projects/${id}`;
  }, project.id);
  const workspace = page.locator(".project-workspace");
  await expect(workspace).toBeVisible();
  await workspace
    .getByRole("button", { name: w.desk.newMilestone, exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel(w.work.title, { exact: true })
    .fill("Accepted");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: w.common.create, exact: true })
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
  await detail.getByLabel(w.work.status, { exact: true }).selectOption("DONE");
  await detail
    .getByRole("button", { name: w.common.save, exact: true })
    .click();
  await expect(detail).toHaveCount(0);
  await expect(
    workspace.getByRole("button", { name: /✓ Draft/ }).first(),
  ).toBeVisible();
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
    .getByRole("button", { name: "experiment.csv", exact: true })
    .click();
  expect((await downloaded).suggestedFilename()).toBe("experiment.csv");
  await fileRow
    .getByRole("button", { name: zh ? "删除" : "Delete", exact: true })
    .click();
  await expect(fileRow).toHaveCount(0);
  await page
    .getByLabel(zh ? "包含已删除资料" : "Include deleted materials")
    .check();
  await fileRow
    .getByRole("button", { name: zh ? "恢复" : "Restore", exact: true })
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
  const snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(snapshot.projectMaterials).toHaveLength(3);
  expect(snapshot.items).toHaveLength(2);
  expect(
    snapshot.library.find(
      (entry: { title: string }) => entry.title === "Owned research note",
    ).bodyMd,
  ).toBe("# Original\n- [ ] preserve as prose");
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
  await nav(page, w.desk.settings);
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
  await nav(page, w.desk.settings);
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
  await nav(page, w.desk.settings);
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
  await nav(page, w.desk.settings);
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
    .locator(".space-picker")
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
  state = await page.evaluate(async () =>
    (await fetch("/api/snapshot")).json(),
  );
  expect(state.items).toHaveLength(3);
  expect(state.edges).toHaveLength(1);
  await nav(page, w.desk.tasks);
  await expect(page.locator(".recurrence-manager")).toHaveCount(0);
  await page.locator(".topbar .compact-create").click();
  const repeatEditor = page.getByRole("dialog").first();
  await repeatEditor
    .getByLabel(w.work.title, { exact: true })
    .fill("Daily review");
  await repeatEditor.locator(".task-advanced summary").click();
  await repeatEditor
    .getByLabel(info.project.name.endsWith("zh") ? "重复" : "Repeat", {
      exact: true,
    })
    .selectOption("DAILY");
  await repeatEditor
    .getByLabel(info.project.name.endsWith("zh") ? "时区" : "Timezone", {
      exact: true,
    })
    .fill("UTC");
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
    .getByText(zh ? "AI 数据许可 · DENY" : "AI data permission · DENY", {
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
  await expect(pane(page).getByText(/AI.*ASK/)).toBeVisible();
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
  await page.getByLabel(positionLabel, { exact: true }).fill("9");
  await page
    .getByRole("button", { name: w.desk.categories.save, exact: true })
    .click();
  await expect(
    page.getByLabel(w.desk.categories.name, { exact: true }),
  ).toHaveValue("");
  const snapshot = await page.evaluate(async () =>
    (await fetch("/api/snapshot")).json(),
  );
  expect(snapshot.categories[0]).toMatchObject({
    icon: "🔬",
    color: "#123456",
    position: 9,
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
  await page.getByLabel(positionLabel, { exact: true }).fill("2");
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
  await page.reload();
  const restored = await page.evaluate(async () =>
    (await fetch("/api/snapshot")).json(),
  );
  expect(restored.categories[0]).toMatchObject({
    version: 4,
    icon: "📚",
    color: "#abcdef",
    position: 2,
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
  await expect(page.locator(".category-manager li").first()).toContainText(
    "First category",
  );
  await expect(page.locator(".category-manager li").nth(1)).toContainText("📚");
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
  const confirmation1 = answerConfirmation(page, true);
  await page
    .getByRole("button", { name: w.spaces.revokeAllSessions, exact: true })
    .click();
  await confirmation1;
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
          if (
            command === "notification_permission" ||
            command === "notification_request_permission"
          )
            return "prompt";
          if (
            command === "notification_reconcile" ||
            command === "notification_cancel"
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
  await page.locator(".topbar .compact-create").click();
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
        ((await editor.textContent())?.match(/api\/library\/asset/g) ?? [])
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
  await page.getByLabel(w.desk.selectVisible).check();
  await page.getByLabel(w.desk.destinationFolder).fill("量子场论");
  await page
    .getByRole("button", { name: w.desk.moveSelected, exact: true })
    .click();
  await expect(page.locator(".note-selection span").first()).toHaveText(
    "量子场论",
  );
  await page.getByLabel(w.desk.folderFilter).selectOption("folder:");
  await expect(
    page.locator(".note-card, .library-document-row, .space-card"),
  ).toHaveCount(0);
  await page.getByLabel(w.desk.folderFilter).selectOption("folder:量子场论");
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
test("inline and block math render while editing without changing source", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.notes);
  await page.locator(".topbar .compact-create").click();
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
for (const nativeImages of [false, true]) {
  test(`accounts admin review and lecture Markdown images PDF work end to end ${nativeImages ? "native bridge" : "web"}`, async ({
    page,
    workbench,
  }, info) => {
    test.setTimeout(90_000);
    const w = words(info.project.name),
      a = w.spaces;
    const imageResponses: {
      status: number;
      contentType: string;
      bytes: number;
    }[] = [];
    const imageReads: Promise<void>[] = [];
    const captureImageResponse = (response: Response) => {
      if (new URL(response.url()).pathname !== "/api/library/asset") return;
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
              args: {
                path: string;
                payload?: string;
                csrf?: string;
                idempotencyKey?: string;
              },
            ) => {
              if (
                command === "notification_permission" ||
                command === "notification_request_permission"
              )
                return "prompt";
              if (
                command === "notification_reconcile" ||
                command === "notification_cancel"
              )
                return;
              if (command === "configure_server") return;
              if (command === "saved_accounts") return [];
              if (command !== "server_request")
                throw new Error(`unexpected native command: ${command}`);
              const response = await fetch(args.path, {
                method: args.payload ? "POST" : "GET",
                credentials: "same-origin",
                ...(args.payload
                  ? {
                      body: args.payload,
                      headers: {
                        "Content-Type": "application/json",
                        "X-CSRF-Token": args.csrf ?? "",
                        "Idempotency-Key": args.idempotencyKey ?? "",
                      },
                    }
                  : {}),
              });
              const bytes = new Uint8Array(await response.arrayBuffer());
              return {
                status: response.status,
                contentType: response.headers.get("Content-Type"),
                body: btoa(
                  Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
                    "",
                  ),
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
    await page.getByLabel(a.username, { exact: true }).fill("image-editor");
    await page.getByLabel(a.password, { exact: true }).fill(workbench.secret);
    await page.getByRole("button", { name: w.desk.enter, exact: true }).click();
    await nav(page, a.account);
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
    await page
      .getByLabel(a.spaceTitle, { exact: true })
      .fill("量子场论 / Quantum Field Theory");
    await page
      .getByLabel(a.body, { exact: true })
      .fill("A dedicated space for lecture notes and illustrations.");
    await saveDocument(page, w);
    await browseDocuments(page);
    await page
      .locator(".note-card, .library-document-row, .space-card")
      .filter({ hasText: "Quantum Field Theory" })
      .press("Enter");
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
    await pane(page)
      .getByLabel(a.image, { exact: true })
      .setInputFiles({
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
      });
    await expect(pane(page).getByLabel(a.body, { exact: true })).toContainText(
      /api\/library\/asset/,
    );
    // Fill raw Markdown, not the live DOM containing replacement widgets.
    await documentMode(page, /^(Source|源码)$/);
    const editor = pane(page).getByLabel(a.body, { exact: true });
    const uploadedText = await editor.innerText();
    const assetPath = uploadedText.match(
      /\/api\/library\/asset\?id=[a-zA-Z0-9-]+/,
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
    expect(imageResponses.length).toBeGreaterThan(0);
    expect(
      imageResponses.every(
        (r) => r.status === 200 && r.contentType === "image/png" && r.bytes > 0,
      ),
    ).toBe(true);
    expect(imageResponses[0]?.bytes).toBeGreaterThan(1895651);
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
    const persistedBody = await page.evaluate(async () => {
      const snapshot = await (await fetch("/api/snapshot")).json();
      return snapshot.library.find(
        (entry: { title: string; bodyMd: string }) =>
          entry.title === "第一讲：场与对称性 / Fields and symmetry",
      )?.bodyMd as string;
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
    for (const fault of ["denied", "html", "empty", "corrupt"] as const) {
      const assetRoute = `**${assetPath}`;
      await page.route(assetRoute, (route) =>
        route.fulfill({
          status: fault === "denied" ? 401 : 200,
          contentType: fault === "html" ? "text/html" : "image/png",
          body: fault === "empty" ? "" : "not an image",
        }),
      );
      // Read and live panes stay mounted when changing modes. Reopen the saved
      // document so this fault tests a new load, not an already decoded image.
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
        nativeImages && fault === "denied"
          ? a.imageAccessFailed
          : a.imageLoadFailed,
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
    await assistant.getByRole("button", { name: /^(Send|发送)$/ }).click();
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
  await expect(pane(page).getByRole("status")).toContainText(/Saved|已保存/);
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
  await chooseProject(parentPicker, ["Backend"]);
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
    await page.route("**/api/sync?*", (route) => route.abort("failed"));
    // A committed external change invalidates the snapshot; idle SSE does not poll.
    await mutation(second, "/api/work/create", {
      title: "Trigger offline snapshot pull",
    });
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
  await page.locator(".topbar .compact-create").click();
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
  await page.locator(".topbar .compact-create").click();
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
  await page.locator(".topbar .compact-create").click();
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
  await page.locator(".topbar .compact-create").click();
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
  await expect(page.locator("article.task-card")).toHaveCount(1);
  await page.route("**/api/sync?*", (route) => route.abort("failed"));
  await page.locator(".topbar .compact-create").click();
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
    .locator(".sync-status")
    .getByRole("button", { name: /^(重试|Retry)$/ })
    .click();
  await expect(page.locator("article.task-card")).toHaveCount(2);
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
async function nav(page: Page, name: string) {
  await expect(page.locator(".app-shell")).toBeVisible();
  for (const locale of ["en-US", "zh-CN"] as const) {
    const desk = resources[locale].desk;
    if (name === desk.knowledge) {
      await nav(page, desk.settings);
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
async function chooseProject(picker: Locator, path: string[]) {
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
      await row.locator(".ui-button-toggle").click();
    else await row.locator(".parent-tree-choice").click();
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
  ).toHaveText(/^(Saved|已保存)$/);
}
async function createTask(
  page: Page,
  w: ReturnType<typeof words>,
  title: string,
) {
  await page.locator(".topbar .compact-create").click();
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
    .getByRole("button", { name: "Move to trash", exact: true })
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

test("notes, safe reading, revision restore, journal and export", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.notes);
  await page.locator(".topbar .compact-create").click();
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
      response.url().endsWith("/api/note/delete") &&
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
  await page.locator(".topbar .compact-create").click();
  await page
    .getByLabel(w.desk.noteBody, { exact: true })
    .fill("Today's reflection");
  await saveDocument(page, w);
  await browseDocuments(page);
  await page.locator(".topbar .compact-create").click();
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
  await expect(row).toHaveAttribute("data-selected", "true");
  await expect(page.locator(".library-document-row")).toHaveCount(0);
  await row.press("Enter");
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
  await expect(pane(page)).toHaveCount(0);
  await document.press("Enter");
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
  await page.locator(".topbar .compact-create").click();
  await pane(page).getByLabel(w.desk.noteTitle).fill("Close flush note");
  await pane(page)
    .getByLabel(w.desk.noteBody)
    .fill("Close before debounce\nSecond line");
  await page
    .locator(".document-tab")
    .getByRole("button", { name: /^(Close|关闭) / })
    .click();
  await expect(pane(page)).toHaveCount(0);
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
  await page.route("**/api/note/save", (route) => route.abort("failed"));
  await pane(page).getByLabel(w.desk.noteBody).fill("Offline final text");
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
  await page.unroute("**/api/note/save");
  await saveDocument(page, w);
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
  await page.locator(".topbar .compact-create").click();
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
  const primary = page.locator(".topbar .compact-create");
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
    await expect(page.locator(".topbar .breadcrumb strong")).toBeVisible();
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
  await page.route("**/api/note/save", (route) => route.abort("failed"));
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
  await expect(page.getByLabel(w.spaces.username)).toBeVisible();
  await page.reload();
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
    const session = await (
      await page.request.get(workbench.url + "/api/session")
    ).json();
    const key = JSON.stringify([
      workbench.url,
      session.context.workspaceId,
      session.context.principalId,
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
  const settings = () => projectAction(page, w.desk.projectSettings);
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
  const snapshot = await (
    await page.request.get(workbench.url + "/api/snapshot")
  ).json();
  expect(
    snapshot.items.filter(
      (i: { title: string }) => i.title === "After explicit reopen",
    ),
  ).toHaveLength(1);
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
    .locator(".topbar")
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
  await page.locator(".topbar .compact-create").click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel(w.work.title, { exact: true })
    .fill("Inline dependent");
  await dialog.locator(".task-advanced > summary").click();
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
    .getByRole("button", { name: /^Prerequisite source / })
    .click();
  await expect(prerequisites.locator("p")).toContainText(w.work.blocked);
  await dialog
    .getByRole("button", { name: w.common.create, exact: true })
    .click();
  await expect(dialog).toBeHidden();
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
  await dialog.locator(".task-advanced > summary").click();
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
  await dialog.locator(".task-advanced > summary").click();
  await prerequisites
    .getByRole("button", { name: "Concurrent source ×", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: w.common.save, exact: true })
    .click();
  await expect(dialog).toBeHidden();
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
  ).toEqual(["#fff", "#6454ce"]);
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
      .locator(".ui-button-toggle"),
  ).toBeDisabled();
  await browser
    .locator("li")
    .filter({ hasText: "Tree root" })
    .locator(".parent-tree-choice")
    .click();
  await expect(
    browser
      .locator("li")
      .filter({ hasText: "Tree child" })
      .locator(".ui-button-toggle"),
  ).toBeDisabled();
  await browser.locator("nav > button").click();
  await browser.getByRole("searchbox").fill("target");
  await browser
    .locator("li")
    .filter({ hasText: "Tree target" })
    .locator(".ui-button-toggle")
    .click();
  await dialog
    .getByRole("button", { name: w.common.save, exact: true })
    .click();
  await expect(dialog).toBeHidden();
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

test("navigation preferences persist ordered mobile shortcuts and desktop visibility", async ({
  page,
  workbench,
}, info) => {
  const w = words(info.project.name);
  await unlock(page, workbench.url, workbench.secret, w);
  await nav(page, w.desk.settings);
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
    expect(initial.calendarTimezone).toBe("America/Adak");
    await mutation(page, "/api/work/calendar-settings", {
      version: initial.calendarSettings.version,
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
  await assistant
    .getByRole("button", { name: zh ? "关闭助手" : "Close assistant" })
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
      name: zh ? "链接到知识空间" : "Link to knowledge space",
      exact: true,
    })
    .click();
  await actions
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
      name: zh ? "整理到知识库" : "Organize in Library",
      exact: true,
    })
    .click();
  await actions
    .getByRole("button", { name: "Capture Wiki", exact: true })
    .click();
  await actions
    .getByRole("button", { name: zh ? "创建页面" : "Create page", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Capture source", exact: true }),
  ).toHaveCount(2);
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
    .getByRole("button", { name: "Hierarchy root ›", exact: true })
    .click();
  await browser.getByRole("searchbox").fill("Deep target");
  await expect(browser.locator("li")).toHaveCount(1);
  await browser.locator("li .ui-button-toggle").click();
  await expect(page.locator(".task-card")).toHaveCount(1);
  await expect(page.locator(".task-card")).toContainText("Scoped child task");
  await nav(page, w.desk.settings);
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
  await expect(atlas.locator(".hierarchy-selected")).not.toContainText(
    "Context project ×",
  );
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
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/work/update", async (route) => {
    if (route.request().postDataJSON().id !== first.id) {
      await route.continue();
      return;
    }
    await hold;
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "VERSION_CONFLICT" }),
    });
  });
  const row = page.locator(".task-card").filter({ hasText: "Pending A" });
  const menu = await taskMenu(page, "Pending A");
  const status = menu.getByRole("combobox");
  await status.selectOption("IN_PROGRESS");
  await expect(status).toHaveValue("IN_PROGRESS");
  await expect(status).toBeDisabled();
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
  await expect(
    row.getByRole("button", { name: /More actions: |更多操作：/ }),
  ).toBeEnabled();
  await taskMenu(page, "Pending A");
  await expect(status).toHaveValue("TODO");
  await expect(status).toBeEnabled();
  await expect(page.locator(".toast")).toBeVisible();
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
    await page.locator(".topbar").click({ position: { x: 400, y: 10 } });
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
  await page.locator(".topbar .compact-create").click();
  const project = page.locator(".project-settings-dialog");
  await expect(
    project.getByRole("button", { name: w.desk.createProject, exact: true }),
  ).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(project).toHaveCount(0);
  await page.locator(".topbar .compact-create").click();
  await project
    .getByLabel(w.work.title, { exact: true })
    .fill("Unsaved project");
  await page.mouse.click(2, 2);
  await expect(project).toBeVisible();
  await expect(project.locator(".error")).toBeVisible();
  await expect(project.getByLabel(w.work.title, { exact: true })).toHaveValue(
    "Unsaved project",
  );
  await project
    .getByRole("button", { name: w.desk.discard, exact: true })
    .click();
  await nav(page, w.desk.tasks);
  await page.locator(".topbar .compact-create").click();
  const task = page.locator(".task-inspector");
  await page.mouse.click(2, 2);
  await expect(task).toHaveCount(0);
  await page.locator(".topbar .compact-create").click();
  await task.getByLabel(w.work.title, { exact: true }).fill("Unsaved task");
  await page.mouse.click(2, 2);
  await expect(task).toBeVisible();
  await expect(task.locator(".error")).toBeVisible();
  await expect(task.getByLabel(w.work.title, { exact: true })).toHaveValue(
    "Unsaved task",
  );
  await task.getByRole("button", { name: w.desk.discard, exact: true }).click();
  await nav(page, w.desk.settings);
  expect(
    await page
      .locator(".settings-panel:visible")
      .last()
      .evaluate((node) => getComputedStyle(node).borderLeftWidth),
  ).toBe("0px");
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
  await expect(page.locator(".login-form")).toBeVisible();
  await page.getByLabel(w.spaces.username, { exact: true }).fill("second-user");
  await page
    .getByLabel(w.spaces.password, { exact: true })
    .fill(workbench.secret);
  await page.getByRole("button", { name: w.desk.enter, exact: true }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
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
  const w = words(info.project.name);
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
  await nav(page, w.desk.settings);
  await expect(page.locator(".settings-panel:visible")).toBeVisible();
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
  await page.locator(".topbar .compact-create").click();
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
  await page.locator(".topbar .compact-create").click();
  let editor = page.locator(".task-dialog");
  await editor
    .getByLabel(w.work.title, { exact: true })
    .fill("First repeating task");
  await editor.locator(".task-advanced summary").click();
  const repeat = editor.getByLabel(text("重复", "Repeat"), { exact: true });
  await expect(repeat).toHaveValue("NONE");
  await repeat.selectOption("DAILY");
  await editor
    .getByLabel(text("时区", "Timezone"), { exact: true })
    .fill("UTC");
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
  editor = page.locator(".task-dialog");
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
  await workspace
    .getByRole("complementary", {
      name: text("检查器", "Inspector"),
      exact: true,
    })
    .getByRole("button", { name: "Atlas", exact: true })
    .click();
  await expect(workspace.locator(".context-pane")).toHaveCount(0);
  const atlasContext = page.getByRole("complementary", {
    name: text("上下文", "Context"),
    exact: true,
  });
  await expect(atlasContext).toBeVisible();
  await atlasContext
    .getByRole("button", {
      name: text("详情", "Details"),
      exact: true,
    })
    .click();
  await expect(atlasContext).toHaveCount(0);
  await expect(
    workspace.getByRole("complementary", {
      name: text("检查器", "Inspector"),
      exact: true,
    }),
  ).toContainText("Hop task 1");
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
  await panel.getByRole("button", { name: /Dentist reminder/ }).click();
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
      name: zh ? "删除提醒" : "Delete reminder",
      exact: true,
    })
    .click();
  await expect(
    panel.getByRole("button", { name: /Updated reminder/ }),
  ).toHaveCount(0);
  await panel
    .getByRole("button", { name: zh ? "撤销" : "Undo", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: /Updated reminder/ }),
  ).toBeVisible();
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
      await expect(page.locator(".app-shell")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const directory = resolve(
        ".artifacts/v24-visual",
        info.project.name,
        `${width}x${height}-${theme}`,
      );
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
      await expect(page.locator(".topbar strong")).toHaveText(w.desk.focus);
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
        .locator(".topbar")
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
      await page.locator(".model-settings").scrollIntoViewIfNeeded();
      await capture("15-ai-settings");
      await go("#trash");
      await expect(page.locator(".topbar strong")).toHaveText(w.desk.trash);
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
  await expect(row).toHaveAttribute("data-selected", "true");
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
  await page.locator(".note-card").click();
  await expect(page.locator(".note-card")).toHaveAttribute(
    "data-selected",
    "true",
  );
  await expect(page.locator(".document-pane")).toHaveCount(0);
  expect(bodyRequests).toEqual([]);
  const loaded = page.waitForResponse(
    (response) =>
      response.url().includes("/api/document/body?") &&
      response.status() === 200,
  );
  await page.locator(".note-card").press("Enter");
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
    await expect(page.getByTestId("startup-shell")).toBeVisible();
    await expect.poll(() => waiting).toBe(true);
    await expect(
      page
        .getByTestId("startup-shell")
        .getByRole("img", { name: "Orivane Atlas" }),
    ).toBeVisible();
    await expect(
      page.getByTestId("startup-shell").getByRole("status"),
    ).toHaveText(
      info.project.name.endsWith("zh")
        ? "正在连接工作空间…"
        : "Connecting to your workspace…",
    );
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
      resolve(".artifacts", `session116-shell-${info.project.name}.json`),
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
  test(`v2.3 cold metadata readiness with ${latencyMs}ms request latency`, async ({
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
    const requestedPaths: string[] = [];
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      requestedPaths.push(path);
      // Delay real requests; retain actual host authentication and payloads.
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
      await route.continue();
    });
    const bootstrapResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/bootstrap" && response.ok(),
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    const response = await bootstrapResponse;
    const bootstrap = await response.json();
    expect(
      bootstrap.library.filter(
        (entry: { kind: string }) => entry.kind === "DOCUMENT",
      ),
    ).toHaveLength(2000);
    for (const entry of [...bootstrap.library, ...bootstrap.notes]) {
      expect(entry).not.toHaveProperty("bodyMd");
      expect(entry.bodyState).toBe("UNLOADED");
    }
    await nav(page, w.desk.tasks);
    await expect(page.locator(".tasks-workspace")).toBeVisible();
    await expect(page.locator(".virtual-task-scroll").first()).toBeVisible();
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
    ).toHaveLength(1);
    expect(requestedPaths).not.toContain("/api/document/body");
    const report = {
      ...evidence,
      artificialRequestLatencyMs: latencyMs,
      documents: 2000,
      decodedBootstrapBytes: (await response.body()).length,
      requestedPaths,
    };
    writeFileSync(
      resolve(
        ".artifacts",
        `session117-cold-${latencyMs}-${info.project.name}.json`,
      ),
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
  ).toBeGreaterThanOrEqual(mobile ? 96 : 120);
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
          .querySelector(".topbar")
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
  await page.keyboard.press("Control+j");
  const assistant = page.getByRole("complementary", {
    name: "Atlas Assistant",
  });
  await assistant
    .getByRole("button", { name: "Second conversation", exact: true })
    .click();
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
      chooseProject(projectPicker, ["Perf project 001", "Perf project 016"]),
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
      await page.keyboard.insertText("x");
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
    () =>
      expect(
        page.locator(".conversation-messages [data-message-kind]"),
      ).toHaveCount(50),
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

// Identical probe also runs against the isolated 389 release archive.
for (const latencyMs of [150, 200, 800]) {
  test(`v2.3 cold shared release comparison with ${latencyMs}ms request latency`, async ({
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
