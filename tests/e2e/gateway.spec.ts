import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { expect, test } from "@playwright/test";
import { passwordHash } from "../../packages/host/src/password";
import { openPersonalVault } from "../../packages/host/src/personal-model";
import { createHost } from "../../packages/host/src/server";

test("Gateway registry policy persists and approved alternatives are visible before sending", async ({
  page,
}, info) => {
  const directory = mkdtempSync(join(tmpdir(), "arclattice-gateway-e2e-"));
  const port =
      Number(process.env.ATLAS_E2E_BASE_PORT ?? 1420) + info.parallelIndex,
    origin = `http://127.0.0.1:${port}`;
  const host = await createHost({
    database: join(directory, "data.sqlite"),
    secret: randomBytes(32).toString("hex"),
    origin,
    webRoot: resolve("apps/web/dist"),
    vault: openPersonalVault(join(directory, "vault")),
  });
  try {
    const verifier = await passwordHash("Gateway-test-password-123");
    await host.db.accounts((store) =>
      store.register("gateway", verifier, true),
    );
    await new Promise<void>((done) =>
      host.server.listen(port, "127.0.0.1", done),
    );
    const login = await page.request.post(origin + "/api/session", {
      data: { username: "gateway", password: "Gateway-test-password-123" },
      headers: { Origin: origin },
    });
    expect(login.status()).toBe(200);
    const { csrf } = await login.json();
    const post = (path: string, data: unknown) =>
      page.request.post(origin + path, {
        data,
        headers: {
          Origin: origin,
          "X-CSRF-Token": csrf,
          "Idempotency-Key": randomUUID(),
        },
      });
    const gateway = {
      providerId: "provider",
      enabled: true,
      capabilities: ["TEXT"],
      capability: "TEXT",
      dailyRequests: "UNLIMITED",
      dailyBudgetMicros: 1000000,
      currency: "USD",
      inputMicrosPerMillion: 1000000,
      outputMicrosPerMillion: 2000000,
      fallbackProfileIds: [],
    };
    const input = {
      scope: "personal",
      endpoint: "https://provider.example/v1",
      protocol: "chat",
      model: "test",
      key: "TEST-ONLY-E2E-KEY",
      maxRunsPerDay: 1,
      gateway,
    };
    expect(
      (
        await post("/api/ai/providers/save", {
          version: 0,
          input: { ...input, model: "backup-test", profileId: "backup" },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await post("/api/ai/providers/save", {
          version: 0,
          input: {
            ...input,
            gateway: { ...gateway, fallbackProfileIds: ["backup"] },
          },
        })
      ).status(),
    ).toBe(200);
    await page.goto(origin);
    const zh = info.project.name.endsWith("zh");
    await page.goto(origin + "/#settings");
    const defaultRow = page
      .locator(".model-settings-row")
      .filter({ has: page.locator("strong", { hasText: "Default profile" }) });
    await defaultRow
      .getByRole("button", {
        name: zh ? "编辑配置" : "Edit profile",
        exact: true,
      })
      .click();
    const editor = page.getByRole("form", {
      name: zh ? "配置编辑" : "Profile editor",
    });
    await expect(
      editor.getByRole("radio", {
        name: zh ? "不限" : "Unlimited",
        exact: true,
      }),
    ).toBeChecked();
    const budget = editor.getByLabel(
      zh ? "每日美元预算" : "Daily budget in dollars",
      { exact: true },
    );
    await budget.fill("2");
    await editor
      .getByRole("button", {
        name: zh ? "保存模型配置" : "Save model profile",
        exact: true,
      })
      .click();
    await expect(page.locator(".model-settings [role=status]")).toContainText(
      zh ? "模型设置已保存" : "Model settings saved",
    );
    await page.reload();
    await defaultRow
      .getByRole("button", {
        name: zh ? "编辑配置" : "Edit profile",
        exact: true,
      })
      .click();
    await expect(budget).toHaveValue("2");
    await expect(
      editor.getByRole("radio", {
        name: zh ? "不限" : "Unlimited",
        exact: true,
      }),
    ).toBeChecked();
    await expect(
      editor.getByLabel(zh ? "备用模型 1" : "Fallback model 1"),
    ).not.toHaveValue("");
    await expect(
      page.locator(".model-settings input[type=password]"),
    ).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath("gateway-settings.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByText(zh ? "模型测试请求" : "Model test request", { exact: true })
      .click();
    await page
      .getByLabel(zh ? "将要发送的内容" : "Text to send", { exact: true })
      .fill("Review without sending anything");
    await page
      .getByRole("button", {
        name: zh ? "先审核发送内容" : "Review before sending",
        exact: true,
      })
      .click();
    await expect(page.locator(".ai-run")).toContainText(
      zh ? "本次审批包含备用路线" : "This approval includes fallback routes",
    );
    const state = await (await page.request.get(origin + "/api/ai")).json();
    expect(state.runs[0].status).toBe("WAITING_APPROVAL");
    expect(state.runs[0].attempt).toBeUndefined();
    expect(state.runs[0].route.gateway.dailyBudgetMicros).toBe(2000000);
    expect(JSON.stringify(state)).not.toContain(input.key);
    await page.screenshot({
      path: info.outputPath("gateway-approval.png"),
      fullPage: true,
    });
  } finally {
    const closing = host.close();
    host.server.closeAllConnections();
    await closing;
    if (
      !resolve(directory).startsWith(
        resolve(tmpdir()) + sep + "arclattice-gateway-e2e-",
      )
    )
      throw new Error("Unsafe cleanup");
    rmSync(directory, { recursive: true });
  }
});
