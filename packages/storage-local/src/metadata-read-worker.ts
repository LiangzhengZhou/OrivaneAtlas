import type { LocalEntity } from "./contracts";

export interface MetadataReadRequest {
  database: string;
  workspaceId: string;
  collection: string;
  ids?: readonly string[];
  wikiSourceIds?: readonly string[];
  libraryBodyChecks?: readonly {
    readonly manifest: LocalEntity;
    readonly availability: LocalEntity | null;
  }[];
}

export interface MetadataReadPort {
  read(request: MetadataReadRequest): Promise<readonly (LocalEntity | null)[]>;
  close(): void;
}

export class WorkerMetadataReader implements MetadataReadPort {
  private worker: Worker | undefined;
  private failed = false;
  private sequence = 0;
  private queuedMessages = 0;
  private readonly pending = new Map<
    number,
    {
      resolve(value: readonly (LocalEntity | null)[]): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
      rows: (LocalEntity | null)[];
    }
  >();

  constructor(
    private readonly factory: () => Worker = () =>
      new Worker(new URL("./metadata-read-worker-entry.ts", import.meta.url), {
        type: "module",
      }),
    private readonly shouldDefer: () => boolean = () => true,
  ) {}

  private stop() {
    this.failed = true;
    this.worker?.terminate();
    this.worker = undefined;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("LOCAL_READ_WORKER_UNAVAILABLE"));
    }
    this.pending.clear();
  }

  close() {
    this.stop();
  }

  read(request: MetadataReadRequest): Promise<readonly (LocalEntity | null)[]> {
    if (this.failed)
      return Promise.reject(new Error("LOCAL_READ_WORKER_UNAVAILABLE"));
    try {
      if (!this.worker) {
        this.worker = this.factory();
        this.worker.onerror = (event) => {
          event.preventDefault();
          this.stop();
        };
        this.worker.onmessageerror = () => this.stop();
        const processMessage = (data: unknown) => {
          const message = data as {
            id?: number;
            json?: string;
            rows?: unknown;
            page?: boolean;
            done?: boolean;
          } | null;
          if (!message || typeof message.id !== "number") {
            this.stop();
            return;
          }
          const pending = this.pending.get(message.id);
          if (!pending) return;
          try {
            if (message.done === true) {
              clearTimeout(pending.timer);
              this.pending.delete(message.id);
              pending.resolve(pending.rows);
              return;
            }
            const rows: unknown =
              typeof message.json === "string"
                ? JSON.parse(message.json)
                : message.rows;
            if (!Array.isArray(rows))
              throw new Error("INVALID_READ_WORKER_RESPONSE");
            if (message.page === true) {
              if (rows.length > 128)
                throw new Error("INVALID_READ_WORKER_PAGE");
              pending.rows.push(...(rows as (LocalEntity | null)[]));
              return;
            }
            clearTimeout(pending.timer);
            this.pending.delete(message.id);
            pending.resolve(rows as (LocalEntity | null)[]);
          } catch {
            this.stop();
          }
        };
        this.worker.onmessage = (event: MessageEvent<unknown>) => {
          const scheduler = (
            globalThis as unknown as {
              scheduler?: {
                postTask?: (
                  operation: () => void,
                  options: { priority: "background" },
                ) => Promise<void>;
              };
            }
          ).scheduler;
          if (
            !scheduler?.postTask ||
            (!this.queuedMessages && !this.shouldDefer())
          ) {
            processMessage(event.data);
            return;
          }
          this.queuedMessages++;
          let finished = false;
          const finish = () => {
            if (finished) return;
            finished = true;
            this.queuedMessages--;
          };
          try {
            void scheduler
              .postTask(
                () => {
                  try {
                    processMessage(event.data);
                  } finally {
                    finish();
                  }
                },
                {
                  priority: "background",
                },
              )
              .catch(() => {
                finish();
                this.stop();
              });
          } catch {
            finish();
            this.stop();
          }
        };
      }
      const worker = this.worker;
      const id = ++this.sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => this.stop(), 5000);
        this.pending.set(id, { resolve, reject, timer, rows: [] });
        try {
          worker.postMessage({ id, ...request });
        } catch {
          this.stop();
        }
      });
    } catch {
      this.stop();
      return Promise.reject(new Error("LOCAL_READ_WORKER_UNAVAILABLE"));
    }
  }
}
