import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { EditorProposalService, type EditorSource } from "./editor-proposals";

const actor = { workspaceId: "workspace", principalId: "human" };
const source: EditorSource = {
  workspaceId: "workspace",
  documentId: "document",
  version: 4,
  from: 2,
  to: 7,
  sourceText: "Hello",
};
const service = new EditorProposalService(async (text) =>
  createHash("sha256").update(text).digest("hex"),
);
it("reviews the exact selected source and returns a range transaction without writing", async () => {
  const proposal = await service.propose(actor, source, "proposal", "你好");
  expect(await service.review(actor, proposal, source)).toEqual({
    from: 2,
    to: 7,
    insert: "你好",
  });
  expect(source.sourceText).toBe("Hello");
});
it("rejects changed identity, version, range, text or hash", async () => {
  const proposal = await service.propose(actor, source, "proposal", "new");
  for (const current of [
    { ...source, documentId: "other" },
    { ...source, version: 5 },
    { ...source, from: 3, to: 8 },
    { ...source, sourceText: "Other" },
  ])
    await expect(service.review(actor, proposal, current)).rejects.toThrow(
      "VERSION_CONFLICT",
    );
  await expect(
    service.review(actor, { ...proposal, sourceHash: "0".repeat(64) }, source),
  ).rejects.toThrow("VERSION_CONFLICT");
  await expect(
    service.review(actor, proposal, { ...source, workspaceId: "foreign" }),
  ).rejects.toThrow("FORBIDDEN");
});
it("captures caller source before the asynchronous digest and bounds malformed proposals", async () => {
  let release: (() => void) | undefined;
  const delayed = new EditorProposalService(async (text) => {
    await new Promise<void>((done) => {
      release = done;
    });
    return createHash("sha256").update(text).digest("hex");
  });
  const input = { ...source },
    pending = delayed.propose(actor, input, "proposal", "new");
  input.sourceText = "Other";
  release!();
  expect((await pending).sourceText).toBe("Hello");
  await expect(
    service.propose(actor, { ...source, from: -1 }, "proposal", "new"),
  ).rejects.toThrow("VALIDATION_ERROR");
  await expect(
    service.propose(actor, source, "proposal", "x".repeat(100001)),
  ).rejects.toThrow("VALIDATION_ERROR");
});
