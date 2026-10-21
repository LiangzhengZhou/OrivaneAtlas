import { expect, it } from "vitest";
import { localDto } from "./local-dto";

it("omits optional object fields while preserving exact Markdown and explicit nulls", () => {
  const bodyMd = "# 原文\n第二行\n\n![](private-image)\n";
  expect(
    localDto({
      id: "document",
      bodyMd,
      optional: undefined,
      parent: null,
      nested: { optional: undefined },
    }),
  ).toEqual({ id: "document", bodyMd, parent: null, nested: {} });
});

it("rejects binary, accessors, sparse or decorated arrays and invalid numeric values", () => {
  const sparse = new Array(2);
  const decorated = Object.assign([1], { extra: 2 });
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  for (const invalid of [
    new Blob(["bytes"]),
    new Uint8Array([1]),
    new Date(),
    [undefined],
    sparse,
    decorated,
    NaN,
    Infinity,
    cyclic,
    {
      get secret() {
        throw new Error("GETTER_EXECUTED");
      },
    },
  ])
    expect(() => localDto(invalid)).toThrow("INVALID_WRITE");
});
