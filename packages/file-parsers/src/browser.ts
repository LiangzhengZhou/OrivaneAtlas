import {
  FileExtractionError,
  type FileParser,
  type FileParserSection,
  type FileSearchIndexBuilder,
  type FileSearchRow,
  fileExtractionLimits,
} from "@arclattice/application";
import type { FileExtractionDocument } from "@arclattice/domain";

/** Normalization and n-gram generation never run in the editor's input thread. */
export class WorkerFileSearchIndex implements FileSearchIndexBuilder {
  constructor(
    private readonly factory: () => Worker = () =>
      new Worker(new URL("./search-index-worker.ts", import.meta.url), {
        type: "module",
      }),
  ) {}
  build(document: FileExtractionDocument): Promise<readonly FileSearchRow[]> {
    return new Promise((resolve, reject) => {
      const worker = this.factory();
      let settled = false;
      const finish = (operation: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        operation();
      };
      const timer = setTimeout(
        () => finish(() => reject(new FileExtractionError("TIMEOUT"))),
        fileExtractionLimits.milliseconds,
      );
      worker.onerror = () =>
        finish(() => reject(new FileExtractionError("MALFORMED")));
      worker.onmessage = (event: MessageEvent<unknown>) => {
        const data = event.data;
        if (
          data &&
          typeof data === "object" &&
          !Array.isArray(data) &&
          "ok" in data &&
          data.ok === true &&
          "rows" in data &&
          Array.isArray(data.rows)
        ) {
          finish(() => resolve(data.rows as FileSearchRow[]));
        } else {
          const code =
            data &&
            typeof data === "object" &&
            "code" in data &&
            data.code === "RESOURCE_LIMIT"
              ? "RESOURCE_LIMIT"
              : "MALFORMED";
          finish(() => reject(new FileExtractionError(code)));
        }
      };
      try {
        worker.postMessage(document);
      } catch (error) {
        finish(() => reject(error));
      }
    });
  }
}

/** Each operation is isolated and terminated on cancellation or the hard deadline. */
export class WorkerFileParser implements FileParser {
  constructor(
    private readonly factory: () => Worker = () =>
      new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
  ) {}
  parse(
    extension: string,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<readonly FileParserSection[]> {
    if (signal?.aborted)
      return Promise.reject(new FileExtractionError("CANCELED"));
    if (bytes.length > fileExtractionLimits.inputBytes)
      return Promise.reject(new FileExtractionError("RESOURCE_LIMIT"));
    return new Promise((resolve, reject) => {
      const worker = this.factory();
      let settled = false;
      const finish = (operation: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        worker.terminate();
        operation();
      };
      const cancel = () =>
        finish(() => reject(new FileExtractionError("CANCELED")));
      const timer = setTimeout(
        () => finish(() => reject(new FileExtractionError("TIMEOUT"))),
        fileExtractionLimits.milliseconds,
      );
      signal?.addEventListener("abort", cancel, { once: true });
      worker.onerror = () =>
        finish(() => reject(new FileExtractionError("MALFORMED")));
      worker.onmessage = (event) => {
        const data: unknown = event.data;
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          finish(() => reject(new FileExtractionError("MALFORMED")));
          return;
        }
        const value = data as Record<string, unknown>;
        if (value.ok === true && Array.isArray(value.sections)) {
          finish(() => resolve(value.sections as FileParserSection[]));
          return;
        }
        const code = value.code;
        const known = [
          "UNSUPPORTED",
          "MALFORMED",
          "RESOURCE_LIMIT",
          "ENCRYPTED",
          "UNSAFE_CONTENT",
          "TIMEOUT",
          "CANCELED",
        ] as const;
        finish(() =>
          reject(
            new FileExtractionError(
              known.find((v) => v === code) ?? "MALFORMED",
            ),
          ),
        );
      };
      try {
        const copy = bytes.slice();
        worker.postMessage({ extension, bytes: copy }, [copy.buffer]);
      } catch (error) {
        finish(() => reject(error));
      }
    });
  }
}
