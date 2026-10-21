import { describe, expect, test } from "vitest";
import {
  imageFailureReason,
  imageLoadFailure,
  imageResponseBlob,
} from "./imageResponse";

test("image diagnostics never disclose arbitrary private exception content", () => {
  expect(imageFailureReason(new Error("private URL and credential"))).toBe(
    "UNCLASSIFIED",
  );
  expect(imageFailureReason(new Error("VERSION_CONFLICT"))).toBe(
    "VERSION_CONFLICT",
  );
});

test.each([
  ["UNAUTHORIZED", "access", 401],
  ["FORBIDDEN", "access", 403],
  ["NOT_FOUND", "missing", 404],
  ["FILE_DOWNLOAD_401", "access", 401],
  ["FILE_DOWNLOAD_403", "access", 403],
  ["FILE_DOWNLOAD_404", "missing", 404],
])("maps File/native image failure %s safely", (code, kind, status) => {
  expect(imageLoadFailure(new Error(code))).toMatchObject({
    code: kind,
    status,
  });
  expect(imageLoadFailure(code)).toMatchObject({ code: kind, status });
});

test("keeps unrelated transport and validation errors intact", () => {
  const error = new Error("VALIDATION_ERROR");
  expect(imageLoadFailure(error)).toBe(error);
});

describe("private image response", () => {
  test("preserves every binary byte and MIME after a native Base64 round trip", async () => {
    const bytes = new Uint8Array(1895651);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    const reply = Buffer.from(bytes).toString("base64");
    const decoded = Uint8Array.from(atob(reply), (c) => c.charCodeAt(0));
    const blob = await imageResponseBlob(
      new Response(decoded, { headers: { "Content-Type": "image/png" } }),
    );
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(bytes.length);
    expect(
      Buffer.from(await blob.arrayBuffer()).equals(Buffer.from(bytes)),
    ).toBe(true);
  });

  test.each([
    [401, "application/json", "private response", "access"],
    [403, "application/json", "private response", "access"],
    [404, "application/json", "private response", "missing"],
    [200, "text/html", "private login page", "response"],
    [200, "application/json", "private response", "response"],
    [200, "image/png", "", "empty"],
  ])(
    "rejects status %i / %s without exposing response content",
    async (status, mime, body, code) => {
      await expect(
        imageResponseBlob(
          new Response(body, { status, headers: { "Content-Type": mime } }),
        ),
      ).rejects.toMatchObject({
        code,
        status,
        message: `IMAGE_${code.toUpperCase()}`,
      });
    },
  );
});
