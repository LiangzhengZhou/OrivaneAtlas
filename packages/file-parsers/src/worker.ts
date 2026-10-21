import {
  FileExtractionError,
  fileExtractionLimits,
} from "@arclattice/application";
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { BoundedFileParser } from "./index";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
const parser = new BoundedFileParser();
self.onmessage = async (event: MessageEvent<unknown>) => {
  let pdfWorker: Worker | undefined;
  try {
    const data = event.data;
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new FileExtractionError("MALFORMED");
    const value = data as Record<string, unknown>;
    if (
      typeof value.extension !== "string" ||
      !(value.bytes instanceof Uint8Array)
    )
      throw new FileExtractionError("MALFORMED");
    // PDF.js assumes a window when creating its own worker. An explicit port
    // keeps its message protocol out of this extraction worker's parent port.
    if (value.extension === "pdf") {
      pdfWorker = new Worker(pdfWorkerUrl, { type: "module" });
      GlobalWorkerOptions.workerPort = pdfWorker;
    }
    const sections = await parser.parse(value.extension, value.bytes);
    if (
      sections.length > fileExtractionLimits.sections ||
      sections.reduce((n, section) => n + section.text.length, 0) >
        fileExtractionLimits.characters
    )
      throw new FileExtractionError("RESOURCE_LIMIT");
    self.postMessage({ ok: true, sections });
  } catch (error) {
    self.postMessage({
      ok: false,
      code: error instanceof FileExtractionError ? error.code : "MALFORMED",
    });
  } finally {
    GlobalWorkerOptions.workerPort = null;
    pdfWorker?.terminate();
  }
};
