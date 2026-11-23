import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { passwordHash } from "../../../../packages/host/src/password";
import { openPersonalVault } from "../../../../packages/host/src/personal-model";
import { createHost } from "../../../../packages/host/src/server";

test("measure a complete workspace graph with 1000 connected documents", async ({
  page,
  browser,
  request,
}, info) => {
  test.setTimeout(300000);
  const dist = process.env.ATLAS_GRAPH_DIST;
  if (!dist) throw Error("Set ATLAS_GRAPH_DIST to the Web build to measure");
  await mkdir(info.outputDir, { recursive: true });
  const probe = createServer();
  await new Promise<void>((ok) => probe.listen(0, "127.0.0.1", ok));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((ok) => probe.close(() => ok()));
  const origin = "http://127.0.0.1:" + port,
    secret = randomBytes(24).toString("hex");
  const host = await createHost({
    origin,
    secret,
    database: info.outputPath("synthetic.sqlite"),
    vault: openPersonalVault(info.outputPath("fixture-vault")),
    webRoot: resolve(dist),
  });
  try {
    const verifier = await passwordHash(secret);
    const { workspaceId, principalId } = await host.db.accounts((store) =>
      store.register("graphreader", verifier, true),
    );
    await new Promise<void>((ok) => host.server.listen(port, "127.0.0.1", ok));
    const session = await request.post(origin + "/api/session", {
      headers: { Origin: origin },
      data: { username: "graphreader", password: secret },
    });
    expect(session.status()).toBe(200);
    const { csrf } = await session.json();
    const save = async (input: {
      kind: "SPACE" | "DOCUMENT";
      title: string;
      bodyMd: string;
      spaceId: string | null;
    }) => {
      const response = await request.post(origin + "/api/library/save", {
        headers: {
          Origin: origin,
          "X-CSRF-Token": csrf,
          "Idempotency-Key": randomUUID(),
        },
        data: { id: null, version: 0, input },
      });
      expect(response.status()).toBe(200);
      const result = await response.json();
      await response.dispose();
      return result.id as string;
    };
    const title = (i: number) =>
      "Synthetic folio " + String(i).padStart(4, "0");
    const spaceId = await save({
      kind: "SPACE",
      title: "Fixture library",
      bodyMd: "",
      spaceId: null,
    });
    for (let first = 0; first < 1000; first += 10) {
      await Promise.all(
        Array.from({ length: 10 }, (_, offset) => {
          const i = first + offset;
          return save({
            kind: "DOCUMENT",
            title: title(i),
            bodyMd: "[[" + title((i + 1) % 1000) + "]]",
            spaceId,
          });
        }),
      );
    }
    await host.db.request(
      { workspaceId, principalId },
      null,
      async (_work, _notes, _connected, library) => {
        await library.ensureWikiIndex?.();
        expect((await library.wikiLinks?.())?.length).toBe(1000);
      },
    );
    await page.goto(origin + "/#account");
    const connection = page.getByRole("region", {
      name: "Account and workspace connection",
    });
    await connection
      .getByLabel("Username", { exact: true })
      .fill("graphreader");
    await connection.getByLabel("Password", { exact: true }).fill(secret);
    await connection
      .getByRole("button", { name: "Sign in and review options" })
      .click();
    await connection
      .getByRole("button", { name: "Open account workspace" })
      .click({ timeout: 120000 });
    await expect(
      page
        .getByRole("navigation", { name: "Device workspaces" })
        .locator('[aria-current="page"]'),
    ).toContainText("Account workspace", { timeout: 30000 });
    await page.goto(origin + "/#knowledge");
    await page
      .getByRole("button", { name: "Knowledge graph", exact: true })
      .click();
    const graph = page.locator(".graph-section");
    const workspace = graph.getByRole("button", { name: "Entire workspace" });
    const local = graph.getByRole("button", { name: "Connected documents" });
    const count = graph.locator(".react-flow__node-default");
    const samples = [];
    for (let trial = 0; trial < 3; trial++) {
      const start = performance.now();
      await workspace.click();
      await expect(count).toHaveCount(1000, { timeout: 90000 });
      await page.evaluate(
        () =>
          new Promise<void>((ok) =>
            requestAnimationFrame(() => requestAnimationFrame(() => ok())),
          ),
      );
      const ready = performance.now();
      const search = graph.getByLabel("Graph search", { exact: true });
      await search.fill("Synthetic folio 0999");
      await expect(
        graph
          .getByRole("option")
          .or(
            graph.getByRole("button", {
              name: /Fixture library.*Synthetic folio 0999/,
            }),
          )
          .first(),
      ).toBeVisible();
      samples.push({
        scopeToPaintMs: Math.round(ready - start),
        queryToVisibleMs: Math.round(performance.now() - ready),
      });
      await search.fill("");
      await local.click();
      await expect(count).toHaveCount(3);
    }
    await writeFile(
      info.outputPath("samples.json"),
      JSON.stringify(
        {
          browser: browser.version(),
          viewport: page.viewportSize(),
          documents: 1000,
          edges: 1000,
          samples,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    const closing = host.close();
    host.server.closeAllConnections();
    await closing;
  }
});
