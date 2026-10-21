import { Worker } from "node:worker_threads";
import {
  FileExtractionError,
  type FileExtractionFailure,
  type FileParser,
  type FileParserSection,
  fileExtractionLimits,
} from "@arclattice/application";

/** Native worker adapter only; Application owns policy, source and publication rules. */
export class NodeFileParser implements FileParser {
  private active = 0;
  private readonly waiting: {
    resolve(release: () => void): void;
    cancel(): void;
  }[] = [];
  private grant(): () => void {
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.waiting.shift()?.resolve(this.grant());
    };
  }
  private acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted)
      return Promise.reject(new FileExtractionError("CANCELED"));
    if (this.active < 2) return Promise.resolve(this.grant());
    if (this.waiting.length >= 4)
      return Promise.reject(new FileExtractionError("RESOURCE_LIMIT"));
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
      };
      const remove = () => {
        const index = this.waiting.indexOf(entry);
        if (index >= 0) this.waiting.splice(index, 1);
        cleanup();
      };
      const cancel = () => {
        remove();
        reject(new FileExtractionError("CANCELED"));
      };
      const timer = setTimeout(() => {
        remove();
        reject(new FileExtractionError("TIMEOUT"));
      }, fileExtractionLimits.milliseconds);
      const entry = {
        resolve: (release: () => void) => {
          cleanup();
          resolve(release);
        },
        cancel,
      };
      this.waiting.push(entry);
      signal?.addEventListener("abort", cancel, { once: true });
    });
  }
  constructor(
    private readonly workerUrl = new URL(
      "./file-parser-worker.js",
      import.meta.url,
    ),
  ) {}
  async parse(
    extension: string,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<readonly FileParserSection[]> {
    if (signal?.aborted)
      return Promise.reject(new FileExtractionError("CANCELED"));
    if (bytes.byteLength > fileExtractionLimits.inputBytes)
      return Promise.reject(new FileExtractionError("RESOURCE_LIMIT"));
    const release = await this.acquire(signal);
    try {
      if (signal?.aborted) throw new FileExtractionError("CANCELED");
      return await new Promise<readonly FileParserSection[]>(
        (resolve, reject) => {
          const worker = new Worker(this.workerUrl, {
            resourceLimits: {
              maxOldGenerationSizeMb: 128,
              maxYoungGenerationSizeMb: 32,
            },
          });
          let settled = false;
          const finish = (action: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener("abort", cancel);
            void worker.terminate();
            action();
          };
          const cancel = () =>
            finish(() => reject(new FileExtractionError("CANCELED")));
          const timer = setTimeout(
            () => finish(() => reject(new FileExtractionError("TIMEOUT"))),
            fileExtractionLimits.milliseconds,
          );
          signal?.addEventListener("abort", cancel, { once: true });
          worker.once("error", (error) =>
            finish(() =>
              reject(
                new FileExtractionError(
                  "code" in error && error.code === "ERR_WORKER_OUT_OF_MEMORY"
                    ? "RESOURCE_LIMIT"
                    : "MALFORMED",
                ),
              ),
            ),
          );
          worker.once("exit", () =>
            finish(() => reject(new FileExtractionError("MALFORMED"))),
          );
          worker.once("message", (message: unknown) => {
            if (
              message &&
              typeof message === "object" &&
              "ok" in message &&
              message.ok === true &&
              "sections" in message &&
              Array.isArray(message.sections)
            ) {
              finish(() => resolve(message.sections as FileParserSection[]));
              return;
            }
            const code =
              message &&
              typeof message === "object" &&
              "code" in message &&
              [
                "UNSUPPORTED",
                "MALFORMED",
                "RESOURCE_LIMIT",
                "ENCRYPTED",
                "UNSAFE_CONTENT",
                "TIMEOUT",
                "CANCELED",
              ].includes(String(message.code))
                ? (message.code as FileExtractionFailure)
                : "MALFORMED";
            finish(() => reject(new FileExtractionError(code)));
          });
          try {
            const copy = bytes.slice();
            worker.postMessage({ extension, bytes: copy }, [copy.buffer]);
          } catch {
            finish(() => reject(new FileExtractionError("MALFORMED")));
          }
        },
      );
    } finally {
      release();
    }
  }
}
