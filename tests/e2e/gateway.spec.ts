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
  const port = 1420 + info.parallelIndex,
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
          input: { ...input, profileId: "backup" },
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
    await page
      .locator(".sidebar")
      .getByRole("button", {
        name: zh ? "AI 请求" : "AI requests",
        exact: true,
      })
      .click();
    await page.locator(".personal-ai-settings > summary").click();
    await expect(
      page.getByLabel(
        zh ? "启用显式 Gateway 策略" : "Enable explicit Gateway policies",
      ),
    ).toBeChecked();
    await expect(
      page.getByLabel(
        zh
          ? "每日请求不限量（仍须审批）"
          : "Unlimited daily requests (approval still required)",
      ),
    ).toBeChecked();
    const budget = page.getByLabel(
      zh
        ? "每日美元预算（同范围全部模型合计）"
        : "Daily USD budget (all models in this scope)",
    );
    await budget.fill("2");
    await page
      .getByRole("button", {
        name: zh ? "保存个人配置" : "Save personal configuration",
        exact: true,
      })
      .click();
    await expect(
      page.locator(".personal-ai-settings [role=status]"),
    ).toContainText("v2");
    await page.reload();
    await page
      .locator(".sidebar")
      .getByRole("button", {
        name: zh ? "AI 请求" : "AI requests",
        exact: true,
      })
      .click();
    await page.locator(".personal-ai-settings > summary").click();
    await expect(budget).toHaveValue("2");
    await expect(
      page.locator(".personal-ai-settings input[type=password]"),
    ).toHaveValue("");
    await page.screenshot({
      path: info.outputPath("gateway-settings.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.locator(".personal-ai-settings > summary").click();
    await page
      .locator(".ai-layout textarea")
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
