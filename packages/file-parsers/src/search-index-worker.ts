import { FileExtractionError, fileSearchRows } from "@arclattice/application";
import type { FileExtractionDocument } from "@arclattice/domain";

self.onmessage = (event: MessageEvent<unknown>) => {
  try {
    if (
      !event.data ||
      typeof event.data !== "object" ||
      Array.isArray(event.data)
    )
      throw new FileExtractionError("MALFORMED");
    const rows = fileSearchRows(event.data as FileExtractionDocument);
    self.postMessage({ ok: true, rows });
  } catch (error) {
    self.postMessage({
      ok: false,
      code: error instanceof FileExtractionError ? error.code : "MALFORMED",
    });
  }
};
