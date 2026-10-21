import type { ActorContext, FileExtractionDocument } from "@arclattice/domain";
import {
  FileExtractionError,
  type FileExtractionService,
} from "./file-extraction";

interface PendingExtraction {
  readonly controller: AbortController;
  readonly promise: Promise<FileExtractionDocument>;
  users: number;
  settled: boolean;
}
/** Preview and background processing share work; each observer owns its cancellation. */
export class FileExtractionCoordinator {
  private readonly pending = new Map<string, PendingExtraction>();
  constructor(
    private readonly service: Pick<FileExtractionService, "extract">,
  ) {}
  extract(
    actorInput: ActorContext,
    id: string,
    version: number,
    signal?: AbortSignal,
  ): Promise<FileExtractionDocument> {
    if (signal?.aborted)
      return Promise.reject(new FileExtractionError("CANCELED"));
    const actor = Object.freeze({ ...actorInput });
    const key = JSON.stringify([
      actor.workspaceId,
      actor.principalId,
      id,
      version,
    ]);
    let job = this.pending.get(key);
    if (!job) {
      const controller = new AbortController();
      job = {
        controller,
        promise: this.service.extract(actor, id, version, controller.signal),
        users: 0,
        settled: false,
      };
      this.pending.set(key, job);
      const current = job;
      const complete = () => {
        current.settled = true;
        if (this.pending.get(key) === current) this.pending.delete(key);
      };
      void current.promise.then(complete, complete);
    }
    const current = job;
    current.users++;
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (operation: () => void) => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener("abort", cancel);
        current.users--;
        if (!current.users && !current.settled) {
          current.controller.abort();
          if (this.pending.get(key) === current) this.pending.delete(key);
        }
        operation();
      };
      const cancel = () =>
        finish(() => reject(new FileExtractionError("CANCELED")));
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
      void current.promise.then(
        (document) => finish(() => resolve(document)),
        (error: unknown) => finish(() => reject(error)),
      );
    });
  }
}
