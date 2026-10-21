import type { EntityMemo, EntityMemoInput } from "@arclattice/domain";
import { type Draft, draftMatchesBase } from "../../localDrafts";

export type MemoTarget = Pick<EntityMemoInput, "targetKind" | "targetId">;
export interface MemoPorts {
  read(target: MemoTarget): Promise<EntityMemo | null>;
  save(input: EntityMemoInput, version: number): Promise<EntityMemo | null>;
  drafts: {
    load(key: string): Promise<Draft | null>;
    save(key: string, draft: Draft): Promise<boolean>;
    clear(key: string): Promise<void>;
  };
}
export interface MemoState {
  ready: boolean;
  body: string;
  dirty: boolean;
  saving: boolean;
  failure: "READ" | "SAVE" | "CONFLICT" | "DRAFT" | null;
}
export interface MemoConflictReview {
  readonly localBody: string;
  readonly remote: EntityMemo | null;
}

/** Shared by surfaces for the same owner/target. The durable Application row is
 * authoritative; this controller only serializes editor intent and local drafts. */
export class MemoController {
  private state: MemoState = {
    ready: false,
    body: "",
    dirty: false,
    saving: false,
    failure: null,
  };
  private memo: EntityMemo | null = null;
  private conflicted = false;
  private draftBase: Pick<Draft, "baseVersion" | "baseUpdatedAt"> | null = null;
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private loading: Promise<void> | null = null;
  private saving: Promise<void> | null = null;
  private review: MemoConflictReview | null = null;
  private refreshing: Promise<void> | null = null;
  private editRevision = 0;
  private editors = 0;
  constructor(
    private readonly target: MemoTarget,
    private readonly key: string,
    private readonly ports: MemoPorts,
  ) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<MemoState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  load() {
    if (this.state.ready) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = this.read().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }
  retainEditing() {
    this.editors++;
    this.editRevision++;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.editors--;
      if (!this.editors) void this.refresh();
    };
  }
  /** Refresh only a clean view; an edit made during the read retains its CAS base. */
  refresh(): Promise<void> {
    if (!this.state.ready) return this.load();
    if (this.state.dirty || this.saving || this.conflicted || this.editors)
      return Promise.resolve();
    if (this.refreshing) return this.refreshing;
    const revision = this.editRevision;
    this.refreshing = this.ports
      .read(this.target)
      .then((memo) => {
        if (
          revision !== this.editRevision ||
          this.state.dirty ||
          this.saving ||
          this.conflicted ||
          this.editors
        )
          return;
        this.memo = memo;
        this.update({ body: memo?.bodyMd ?? "", failure: null });
      })
      .catch(() => {
        if (revision === this.editRevision && !this.state.dirty)
          this.update({ failure: "READ" });
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }
  private async read() {
    try {
      const [memo, draft] = await Promise.all([
        this.ports.read(this.target),
        this.ports.drafts.load(this.key),
      ]);
      this.memo = memo;
      const same =
        !draft || draftMatchesBase(draft, this.key, memo ?? undefined);
      this.conflicted = !same;
      this.draftBase =
        !same && draft
          ? {
              ...(draft.baseVersion === undefined
                ? {}
                : { baseVersion: draft.baseVersion }),
              ...(draft.baseUpdatedAt === undefined
                ? {}
                : { baseUpdatedAt: draft.baseUpdatedAt }),
            }
          : null;
      const body = draft?.body ?? memo?.bodyMd ?? "";
      this.update({
        ready: true,
        body,
        dirty: body !== (memo?.bodyMd ?? ""),
        failure: same ? null : "CONFLICT",
      });
      if (same && this.state.dirty) this.schedule();
    } catch {
      this.update({ failure: "READ" });
    }
  }
  edit(body: string) {
    if (!this.state.ready || body.length > 100000) return;
    this.editRevision++;
    this.update({ body, dirty: body !== (this.memo?.bodyMd ?? "") });
    this.schedule();
  }
  private schedule() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 250);
  }
  private draft(body: string): Draft {
    return {
      title: "",
      body,
      entityId: this.key,
      baseVersion: this.memo?.version ?? 0,
      baseUpdatedAt: this.memo?.updatedAt ?? null,
      ...this.draftBase,
      updatedAt: Date.now(),
    };
  }
  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.saving) return this.saving;
    if (!this.state.ready) return Promise.resolve();
    this.saving = this.persist()
      .catch(() => {
        this.update({ failure: "DRAFT" });
      })
      .finally(() => {
        this.saving = null;
      });
    return this.saving;
  }
  private async persist() {
    if (this.conflicted) {
      // A second surface may edit while the first draft transaction is pending.
      // Serialize those writes too, retaining the original conflict base.
      let body: string;
      do {
        body = this.state.body;
        if (!(await this.ports.drafts.save(this.key, this.draft(body)))) {
          this.update({ failure: "DRAFT" });
          return;
        }
      } while (body !== this.state.body);
      this.update({ failure: "CONFLICT" });
      return;
    }
    if (!this.state.dirty) {
      await this.ports.drafts.clear(this.key);
      this.update({ failure: null });
      if (!this.state.dirty) return;
    }
    await this.write();
  }
  async reviewConflict(): Promise<MemoConflictReview | null> {
    if (this.saving) await this.saving;
    if (!this.conflicted) return null;
    try {
      const remote = await this.ports.read(this.target);
      const review = Object.freeze({
        localBody: this.state.body,
        remote: remote ? Object.freeze({ ...remote }) : null,
      });
      this.review = review;
      return review;
    } catch {
      this.update({ failure: "READ" });
      return null;
    }
  }
  async resolveConflict(
    review: MemoConflictReview,
    choice: "LOCAL" | "REMOTE",
  ) {
    if (!this.conflicted || this.review !== review || this.saving) return false;
    const task = this.applyConflict(review, choice).catch(() => {
      this.update({ failure: "READ" });
      return false;
    });
    this.saving = task
      .then(() => undefined)
      .finally(() => {
        this.saving = null;
      });
    return task;
  }
  private async applyConflict(
    review: MemoConflictReview,
    choice: "LOCAL" | "REMOTE",
  ) {
    const localBody = this.state.body;
    const remote = await this.ports.read(this.target);
    // Review is captured intent, not permission to overwrite subsequent edits.
    if (
      this.review !== review ||
      localBody !== review.localBody ||
      this.state.body !== localBody ||
      JSON.stringify(remote) !== JSON.stringify(review.remote)
    ) {
      this.review = null;
      this.update({ failure: "CONFLICT" });
      return false;
    }
    if (choice === "REMOTE") {
      await this.ports.drafts.clear(this.key);
      if ((await this.ports.drafts.load(this.key)) !== null) {
        this.update({ failure: "DRAFT" });
        return false;
      }
      if (this.state.body !== localBody) {
        await this.ports.drafts.save(this.key, this.draft(this.state.body));
        this.update({ failure: "CONFLICT" });
        return false;
      }
    }
    this.memo = remote;
    this.conflicted = false;
    this.draftBase = null;
    this.review = null;
    const body = choice === "REMOTE" ? (remote?.bodyMd ?? "") : localBody;
    this.update({
      body,
      dirty: body !== (remote?.bodyMd ?? ""),
      failure: null,
    });
    if (choice === "LOCAL") await this.persist();
    return this.state.failure === null;
  }
  private async write() {
    this.update({ saving: true });
    try {
      while (this.state.dirty) {
        const body = this.state.body;
        if (!(await this.ports.drafts.save(this.key, this.draft(body)))) {
          this.update({ failure: "DRAFT" });
          return;
        }
        try {
          const memo = await this.ports.save(
            { ...this.target, bodyMd: body },
            this.memo?.version ?? 0,
          );
          if (
            memo &&
            (memo.targetKind !== this.target.targetKind ||
              memo.targetId !== this.target.targetId ||
              memo.bodyMd !== body ||
              memo.version !== (this.memo?.version ?? 0) + 1)
          )
            throw new Error("INVALID_MEMO_SAVE_RESULT");
          if (!memo && (this.memo !== null || body.trim()))
            throw new Error("INVALID_MEMO_SAVE_RESULT");
          this.memo = memo;
          const dirty = this.state.body !== body;
          this.update({ dirty, failure: null });
          if (!dirty) await this.ports.drafts.clear(this.key);
        } catch (error) {
          const conflict =
            !!error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "VERSION_CONFLICT";
          if (conflict) {
            this.conflicted = true;
            this.draftBase = {
              baseVersion: this.memo?.version ?? 0,
              baseUpdatedAt: this.memo?.updatedAt ?? null,
            };
          }
          // Preserve newer editor text too; never reload and silently retry CAS.
          await this.ports.drafts.save(this.key, this.draft(this.state.body));
          this.update({ failure: conflict ? "CONFLICT" : "SAVE" });
          return;
        }
      }
    } finally {
      this.update({ saving: false });
    }
  }
}
