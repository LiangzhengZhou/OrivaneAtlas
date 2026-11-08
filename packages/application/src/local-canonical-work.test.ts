import { expect, it } from "vitest";
import { work } from "../../../tests/fixtures";
import { validateLocalCanonicalWorkValue } from "./local-canonical-work";
import { localDto } from "./local-dto";

it.each([undefined, null, 0, 50, 100])(
  "accepts canonical project cover focus %s",
  (projectCoverFocus) => {
    const value = { ...work("project"), type: "PROJECT", projectCoverFocus };
    expect(() =>
      validateLocalCanonicalWorkValue(
        "items",
        value.id,
        value.workspaceId,
        value.version,
        localDto(value),
      ),
    ).not.toThrow();
  },
);

it.each(["50", -1, 101, 0.5, false])(
  "rejects malformed canonical project cover focus %s",
  (projectCoverFocus) => {
    const value = { ...work("project"), type: "PROJECT", projectCoverFocus };
    expect(() =>
      validateLocalCanonicalWorkValue(
        "items",
        value.id,
        value.workspaceId,
        value.version,
        localDto(value),
      ),
    ).toThrow();
  },
);
