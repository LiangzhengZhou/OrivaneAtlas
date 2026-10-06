import type { ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { constants, createBrotliCompress, createGzip } from "node:zlib";

export function jsonEncoding(
  header: string | undefined,
): "br" | "gzip" | undefined {
  const qualities = new Map<string, number>();
  for (const part of (header ?? "").split(",")) {
    const [name, ...parameters] = part.trim().toLowerCase().split(";");
    if (!name) continue;
    const parameter = parameters.find((value) => value.trim().startsWith("q="));
    const quality = parameter ? Number(parameter.trim().slice(2)) : 1;
    qualities.set(
      name,
      Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0,
    );
  }
  const br = qualities.get("br") ?? qualities.get("*") ?? 0;
  const gzip = qualities.get("gzip") ?? qualities.get("*") ?? 0;
  const identity = qualities.get("identity") ?? 0;
  if (br > 0 && br >= gzip && br >= identity) return "br";
  if (gzip > 0 && gzip >= identity) return "gzip";
  return undefined;
}

export function jsonResponse(
  res: ServerResponse,
  status: number,
  value: unknown,
) {
  const body = Buffer.from(JSON.stringify(value));
  const encoding =
    body.length >= 1024
      ? jsonEncoding(res.req.headers["accept-encoding"])
      : undefined;
  res.setHeader("Vary", "Accept-Encoding");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (!encoding) {
    res.setHeader("Content-Length", body.length);
    res.writeHead(status);
    res.end(body);
    return;
  }
  res.setHeader("Content-Encoding", encoding);
  res.writeHead(status);
  const compressor =
    encoding === "br"
      ? createBrotliCompress({
          params: { [constants.BROTLI_PARAM_QUALITY]: 4 },
        })
      : createGzip();
  // Only finite JSON responses use this path; SSE remains an unbuffered stream.
  void pipeline(Readable.from([body]), compressor, res).catch(
    (error: unknown) => {
      res.destroy(
        error instanceof Error ? error : new Error("JSON transport failed"),
      );
    },
  );
}
