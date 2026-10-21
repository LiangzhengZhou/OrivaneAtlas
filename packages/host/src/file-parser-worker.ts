import { parentPort } from "node:worker_threads";
import { FileExtractionError } from "@arclattice/application";
import { BoundedFileParser } from "@arclattice/file-parsers";

parentPort?.once("message", async (input: unknown) => {
  try {
    if (
      !input ||
      typeof input !== "object" ||
      !("extension" in input) ||
      typeof input.extension !== "string" ||
      !("bytes" in input) ||
      !(input.bytes instanceof Uint8Array)
    )
      throw new FileExtractionError("MALFORMED");
    const sections = await new BoundedFileParser().parse(
      input.extension,
      input.bytes,
    );
    parentPort?.postMessage({ ok: true, sections });
  } catch (error) {
    parentPort?.postMessage({
      ok: false,
      code: error instanceof FileExtractionError ? error.code : "MALFORMED",
    });
  }
});
