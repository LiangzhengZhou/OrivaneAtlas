import { createServer, get } from "node:http";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { expect, test } from "vitest";
import { jsonEncoding, jsonResponse } from "./json-response";

test("JSON compression respects weights and explicit exclusions", () => {
  expect(jsonEncoding("gzip, br")).toBe("br");
  expect(jsonEncoding("br;q=0.3, gzip;q=0.8")).toBe("gzip");
  expect(jsonEncoding("br;q=0, gzip;q=0, *;q=1")).toBeUndefined();
  expect(jsonEncoding("br;q=garbage, gzip;q=2")).toBeUndefined();
  expect(jsonEncoding("identity;q=1, br;q=0.5")).toBeUndefined();
  expect(jsonEncoding(undefined)).toBeUndefined();
});

test("HTTP JSON negotiates smaller compressed bytes with identical content", async () => {
  const value = { body: "中文 Markdown\n".repeat(4000) };
  const server = createServer((_req, res) => jsonResponse(res, 200, value));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing address");
  try {
    for (const encoding of ["br", "gzip", "identity"]) {
      const response = await new Promise<{
        bytes: Buffer;
        encoding: string | undefined;
        vary: string | undefined;
      }>((resolve, reject) => {
        get(
          {
            hostname: "127.0.0.1",
            port: address.port,
            headers: { "Accept-Encoding": encoding },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("error", reject);
            res.on("end", () =>
              resolve({
                bytes: Buffer.concat(chunks),
                encoding: res.headers["content-encoding"],
                vary: res.headers.vary,
              }),
            );
          },
        ).on("error", reject);
      });
      expect(response.vary).toBe("Accept-Encoding");
      const decoded =
        encoding === "br"
          ? brotliDecompressSync(response.bytes)
          : encoding === "gzip"
            ? gunzipSync(response.bytes)
            : response.bytes;
      expect(JSON.parse(decoded.toString())).toEqual(value);
      expect(response.encoding).toBe(
        encoding === "identity" ? undefined : encoding,
      );
      if (encoding !== "identity")
        expect(response.bytes.length).toBeLessThan(decoded.length / 10);
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
