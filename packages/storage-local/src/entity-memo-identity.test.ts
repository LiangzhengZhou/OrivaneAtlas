import { createHash } from "node:crypto";
import { entityMemoOwnerKey } from "@arclattice/domain";
import { expect, it } from "vitest";
import { deriveEntityMemoId } from "./entity-memo-identity";

it("derives UUIDv5 from canonical owner identity independently of installation", async () => {
  const actor = { workspaceId: "remote-workspace", principalId: "owner" };
  const target = { targetKind: "TASK" as const, targetId: "stable-task" };
  const name = entityMemoOwnerKey(
    actor.workspaceId,
    actor.principalId,
    target.targetKind,
    target.targetId,
  );
  const digest = createHash("sha1")
    .update(Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex"))
    .update(name)
    .digest();
  const actual = await deriveEntityMemoId(actor, target);
  const bytes = Buffer.from(actual.replaceAll("-", ""), "hex");
  expect(bytes.subarray(0, 6)).toEqual(digest.subarray(0, 6));
  expect(bytes.subarray(9)).toEqual(digest.subarray(9, 16));
  expect(actual).toMatch(
    /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  );
  expect(await deriveEntityMemoId({ ...actor }, { ...target })).toBe(actual);
  expect(
    await deriveEntityMemoId({ ...actor, principalId: "other" }, target),
  ).not.toBe(actual);
  expect(
    await deriveEntityMemoId({ ...actor, workspaceId: "other" }, target),
  ).not.toBe(actual);
  expect(
    await deriveEntityMemoId(actor, { ...target, targetKind: "PROJECT" }),
  ).not.toBe(actual);
});
