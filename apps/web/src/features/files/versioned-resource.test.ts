import { expect, it } from "vitest";
import {
  orderResourceTrashEntries,
  type VersionedResource,
} from "./versioned-resource";

it("trashes descendants first, restores ancestors first and keeps typed identities separate", () => {
  const root: VersionedResource = { id: "a", kind: "DOCUMENT", version: 2 };
  const child: VersionedResource = {
    id: "b",
    kind: "DOCUMENT",
    parentDocumentId: "a",
    version: 3,
  };
  const file: VersionedResource = {
    id: "a",
    kind: "FILE",
    parentDocumentId: "b",
    version: 8,
  };
  expect(orderResourceTrashEntries([root, child, file], true)).toEqual([
    file,
    child,
    root,
  ]);
  expect(orderResourceTrashEntries([file, child, root], false)).toEqual([
    root,
    child,
    file,
  ]);
  expect(() =>
    orderResourceTrashEntries(
      [{ ...root, parentDocumentId: "b" }, child],
      true,
    ),
  ).toThrow("RESOURCE_HIERARCHY_CYCLE");
});
