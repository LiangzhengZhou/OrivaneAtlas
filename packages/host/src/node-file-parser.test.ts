import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, expect, it } from "vitest";
import { actualFileParserFixture } from "../test-fixtures/file-parser";
import type { NodeFileParser } from "./node-file-parser";

let parser: NodeFileParser;
beforeAll(async () => {
  parser = await actualFileParserFixture("file-worker-test");
});

it("compiled Host parser resolves its adjacent worker with the production default constructor", async () => {
  const compiled = (await import(
    pathToFileURL(
      resolve("packages/host/.artifacts/file-worker-test/node-file-parser.js"),
    ).href
  )) as typeof import("./node-file-parser");
  const production = new compiled.NodeFileParser();
  expect(
    await production.parse(
      "txt",
      new TextEncoder().encode("release default worker"),
    ),
  ).toEqual([
    { kind: "TEXT", locator: "text:1", text: "release default worker" },
  ]);
});

it("the actual compiled Node worker extracts exact text and does not detach original bytes", async () => {
  const bytes = new TextEncoder().encode("原始正文\nSecond line\n");
  const original = bytes.slice();
  expect(await parser.parse("txt", bytes)).toEqual([
    { kind: "TEXT", locator: "text:1", text: "原始正文\nSecond line\n" },
  ]);
  expect(bytes).toEqual(original);
});
it("Node parsing rejects malformed originals, cancellation and oversized input with bounded codes", async () => {
  for (const extension of ["json", "docx", "pdf"])
    await expect(
      parser.parse(extension, new TextEncoder().encode("malformed original")),
    ).rejects.toThrow("FILE_EXTRACTION_MALFORMED");
  await expect(
    parser.parse("txt", new Uint8Array(16 * 1024 * 1024 + 1)),
  ).rejects.toThrow("RESOURCE_LIMIT");
  const controller = new AbortController();
  const pending = parser.parse(
    "txt",
    new Uint8Array(100000),
    controller.signal,
  );
  controller.abort();
  await expect(pending).rejects.toThrow("CANCELED");
});
it("parallel extraction is bounded and does not create one worker per request", async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      parser.parse("txt", new TextEncoder().encode("source")),
    ),
  );
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(6);
  const failures = results.filter((result) => result.status === "rejected");
  expect(failures).toHaveLength(2);
  for (const failure of failures)
    if (failure.status === "rejected")
      expect(failure.reason).toMatchObject({ code: "RESOURCE_LIMIT" });
});
it("the Node PDF worker extracts a real page with its locator", async () => {
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
  const sections = await parser.parse("pdf", new TextEncoder().encode(text));
  expect(sections).toHaveLength(1);
  expect(sections[0]).toMatchObject({ kind: "PAGE", locator: "page:1" });
  expect(sections[0]?.text).toContain("Original PDF text");
});

it("canceling queued work frees its slot and preserves running extraction", async () => {
  const bytes = new TextEncoder().encode("original source");
  const running = [parser.parse("txt", bytes), parser.parse("txt", bytes)];
  const controller = new AbortController();
  const canceled = parser.parse("txt", bytes, controller.signal);
  controller.abort();
  await expect(canceled).rejects.toThrow("CANCELED");
  const queued = Array.from({ length: 4 }, () => parser.parse("txt", bytes));
  await expect(Promise.all([...running, ...queued])).resolves.toHaveLength(6);
  expect(await parser.parse("txt", bytes)).toEqual([
    { kind: "TEXT", locator: "text:1", text: "original source" },
  ]);
});
