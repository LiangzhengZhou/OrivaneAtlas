import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import {
  serveWebFixture,
  workspaceEntryRoutes,
} from "./serve-ux-web-fixture.mjs";

const [dist, output] = process.argv.slice(2);
if (!dist || !output)
  throw new Error("Expected a built Web directory and a new result directory");
await mkdir(output);
const server = await serveWebFixture(dist);
const browser = await chromium.launch();
const roles = new Set([
  "button",
  "checkbox",
  "switch",
  "radio",
  "link",
  "menuitem",
  "tab",
  "slider",
  "combobox",
  "DisclosureTriangle",
  "DisclosureTriangleGrouped",
  "menuitemcheckbox",
  "menuitemradio",
  "treeitem",
  "textbox",
  "searchbox",
  "spinbutton",
]);
const records = [];
try {
  for (const [locale, width, height] of [
    ["en-US", 1280, 800],
    ["zh-CN", 390, 844],
  ]) {
    const ctx = await browser.newContext({
      locale,
      viewport: { width, height },
      hasTouch: width === 390,
      colorScheme: width === 390 ? "dark" : "light",
      serviceWorkers: "block",
    });
    const page = await ctx.newPage();
    await ctx.route(/^https?:/, (r) =>
      new URL(r.request().url()).origin === server.origin
        ? r.continue()
        : r.abort(),
    );
    const cdp = await ctx.newCDPSession(page);
    for (const route of workspaceEntryRoutes) {
      await page.goto(server.origin + "/?audit=" + route + "#" + route);
      await page.locator("main.workspace-main > .content:visible").waitFor();
      await page
        .locator("main.workspace-main > .content :is(h1,h2):visible")
        .first()
        .waitFor();
      // Lazy route modules and the local workspace hydrate after the shell heading appears.
      await page.waitForLoadState("networkidle");
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        );
      });
      const { nodes } = await cdp.send("Accessibility.getFullAXTree");
      const actionable = nodes.filter(
        (n) => !n.ignored && roles.has(n.role?.value),
      );
      const missing = [];
      for (const n of actionable.filter((n) => !n.name?.value?.trim())) {
        const { node } = await cdp.send("DOM.describeNode", {
          backendNodeId: n.backendDOMNodeId,
        });
        const attrs = {};
        const attributes = node.attributes ?? [];
        for (let i = 0; i < attributes.length; i += 2)
          attrs[attributes[i]] = attributes[i + 1];
        missing.push({
          role: n.role.value,
          tag: node.localName,
          id: attrs.id ?? "",
          class: attrs.class ?? "",
          type: attrs.type ?? "",
        });
      }
      records.push({
        route,
        locale,
        width,
        controls: actionable.length,
        main: nodes.filter((n) => !n.ignored && n.role?.value === "main")
          .length,
        unnamed: missing,
      });
    }
    await ctx.close();
  }
  await writeFile(
    resolve(output, "accessibility.json"),
    JSON.stringify(
      {
        engine: browser.version(),
        fixture: "offline empty workspace",
        records,
      },
      null,
      2,
    ) + "\n",
  );
  const failed = records.filter((r) => r.main !== 1 || r.unnamed.length);
  console.log(
    records.length +
      " routes checked, " +
      failed.length +
      " with unnamed controls or incorrect main landmarks",
  );
  if (failed.length) {
    console.log(JSON.stringify(failed));
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  server.close();
}
