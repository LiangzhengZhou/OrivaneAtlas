import type { EntityMemo } from "@arclattice/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Draft } from "../../localDrafts";
import { MemoController, type MemoPorts } from "./memo-controller";

function fixture(initial: EntityMemo | null = null) {
  let row = initial;
  let draft: Draft | null = null;
  const ports: MemoPorts = {
    read: vi.fn(async () => row),
    save: vi.fn(async (input, version) => {
      row = {
        id: "memo",
        workspaceId: "workspace",
        ownerPrincipalId: "owner",
        createdBy: "owner",
        updatedBy: "owner",
        createdAt: "2026-10-18T00:00:00Z",
        updatedAt: `2026-10-18T00:00:0${version + 1}Z`,
        deletedAt: null,
        ...input,
        version: version + 1,
      };
      return row;
    }),
    drafts: {
      load: async () => draft,
      save: vi.fn(async (_key, value) => {
        draft = structuredClone(value);
        return true;
      }),
      clear: vi.fn(async () => {
        draft = null;
      }),
    },
  };
  const controller = () =>
    new MemoController({ targetKind: "TASK", targetId: "task" }, "key", ports);
  return { ports, controller, draft: () => draft, row: () => row };
}

afterEach(() => vi.useRealTimers());
describe("Memo local durable editor", () => {
  it("retains the opening CAS base while an editor is active, even before typing", async () => {
    const f = fixture();
    const editor = f.controller();
    await editor.load();
    const release = editor.retainEditing();
    await f.ports.save(
      { targetKind: "TASK", targetId: "task", bodyMd: "remote" },
      0,
    );
    await editor.refresh();
    expect(editor.snapshot().body).toBe("");
    editor.edit("local from opening base");
    vi.mocked(f.ports.save).mockRejectedValueOnce({ code: "VERSION_CONFLICT" });
    await editor.flush();
    expect(f.ports.save).toHaveBeenLastCalledWith(
      {
        targetKind: "TASK",
        targetId: "task",
        bodyMd: "local from opening base",
      },
      0,
    );
    expect(editor.snapshot().failure).toBe("CONFLICT");
    release();
    release();
    await editor.refresh();
    expect(editor.snapshot().body).toBe("local from opening base");
  });
  it("refreshes clean cached surfaces without replacing an edit made during the read", async () => {
    const f = fixture();
    const editor = f.controller();
    await editor.load();
    await f.ports.save(
      { targetKind: "TASK", targetId: "task", bodyMd: "remote" },
      0,
    );
    await editor.refresh();
    expect(editor.snapshot()).toMatchObject({ body: "remote", dirty: false });
    let release!: (memo: EntityMemo | null) => void;
    vi.mocked(f.ports.read).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const refresh = editor.refresh();
    editor.edit("local during read");
    release({ ...f.row()!, bodyMd: "new remote", version: 2 });
    await refresh;
    expect(editor.snapshot()).toMatchObject({
      body: "local during read",
      dirty: true,
    });
    await editor.flush();
    expect(f.ports.save).toHaveBeenLastCalledWith(
      { targetKind: "TASK", targetId: "task", bodyMd: "local during read" },
      1,
    );
  });
  it("does not refresh a conflicted draft or clear its captured base", async () => {
    const f = fixture();
    const editor = f.controller();
    await editor.load();
    vi.mocked(f.ports.save).mockRejectedValueOnce({ code: "VERSION_CONFLICT" });
    editor.edit("retained draft");
    await editor.flush();
    const reads = vi.mocked(f.ports.read).mock.calls.length;
    await editor.refresh();
    expect(f.ports.read).toHaveBeenCalledTimes(reads);
    expect(editor.snapshot()).toMatchObject({
      body: "retained draft",
      failure: "CONFLICT",
    });
    expect(f.draft()).toMatchObject({ body: "retained draft", baseVersion: 0 });
  });
  for (const choice of ["LOCAL", "REMOTE"] as const) {
    it(`requires captured review and a fresh CAS check before choosing ${choice}`, async () => {
      const f = fixture();
      const editor = f.controller();
      await editor.load();
      vi.mocked(f.ports.save).mockRejectedValueOnce({
        code: "VERSION_CONFLICT",
      });
      editor.edit("original local intent");
      await editor.flush();
      const review = await editor.reviewConflict();
      expect(review).not.toBeNull();
      editor.edit("edited during review");
      expect(await editor.resolveConflict(review!, choice)).toBe(false);
      expect(f.ports.save).toHaveBeenCalledTimes(1);
      expect(editor.snapshot().body).toBe("edited during review");
      const fresh = await editor.reviewConflict();
      expect(await editor.resolveConflict(fresh!, choice)).toBe(true);
      expect(editor.snapshot()).toMatchObject({
        body: choice === "LOCAL" ? "edited during review" : "",
        dirty: false,
        failure: null,
      });
      expect(f.draft()).toBeNull();
      expect(f.ports.save).toHaveBeenCalledTimes(choice === "LOCAL" ? 2 : 1);
    });
  }
  it("flushes locally without network and restores the exact body after restart", async () => {
    const f = fixture();
    const editor = f.controller();
    await editor.load();
    editor.edit("第一行\nsecond line");
    await editor.flush();
    expect(f.row()?.bodyMd).toBe("第一行\nsecond line");
    expect(f.draft()).toBeNull();
    const restarted = f.controller();
    await restarted.load();
    expect(restarted.snapshot()).toMatchObject({
      body: "第一行\nsecond line",
      dirty: false,
      failure: null,
    });
  });
  it("does not write the business entity when durable draft persistence fails", async () => {
    const f = fixture();
    vi.mocked(f.ports.drafts.save).mockResolvedValue(false);
    const editor = f.controller();
    await editor.load();
    editor.edit("retain me");
    await editor.flush();
    expect(f.ports.save).not.toHaveBeenCalled();
    expect(editor.snapshot()).toMatchObject({
      body: "retain me",
      dirty: true,
      failure: "DRAFT",
    });
  });
  it("preserves the original CAS base through conflict, further edits and restart", async () => {
    const f = fixture();
    const editor = f.controller();
    await editor.load();
    vi.mocked(f.ports.save).mockRejectedValue({ code: "VERSION_CONFLICT" });
    editor.edit("first intent");
    await editor.flush();
    editor.edit("latest intent");
    await editor.flush();
    expect(f.ports.save).toHaveBeenCalledTimes(1);
    expect(f.draft()).toMatchObject({
      body: "latest intent",
      baseVersion: 0,
      baseUpdatedAt: null,
    });
    const restarted = f.controller();
    await restarted.load();
    expect(restarted.snapshot().body).toBe("latest intent");
    // No durable canonical row was accepted: the original version remains zero.
    expect(f.row()).toBeNull();
    await restarted.flush();
    expect(
      vi.mocked(f.ports.save).mock.calls.every((call) => call[1] === 0),
    ).toBe(true);
  });
  it("serializes a newer edit arriving during an outstanding save", async () => {
    const f = fixture();
    const normal = f.ports.save;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    f.ports.save = vi.fn(async (input, version) => {
      if (first) {
        first = false;
        await gate;
      }
      return normal(input, version);
    });
    const editor = f.controller();
    await editor.load();
    editor.edit("first");
    const pending = editor.flush();
    await vi.waitFor(() => expect(f.ports.save).toHaveBeenCalledTimes(1));
    editor.edit("newest");
    release();
    await pending;
    expect(f.row()).toMatchObject({ bodyMd: "newest", version: 2 });
    expect(editor.snapshot()).toMatchObject({ dirty: false, saving: false });
    expect(f.draft()).toBeNull();
    await editor.flush();
  });
  it("never rebases a recovered draft onto a newer canonical version implicitly", async () => {
    const f = fixture();
    const first = f.controller();
    await first.load();
    vi.mocked(f.ports.save).mockRejectedValueOnce({ code: "VERSION_CONFLICT" });
    first.edit("private local intent");
    await first.flush();
    const canonical: EntityMemo = {
      id: "memo",
      workspaceId: "workspace",
      ownerPrincipalId: "owner",
      createdBy: "owner",
      updatedBy: "owner",
      createdAt: "2026-10-18T00:00:00Z",
      updatedAt: "2026-10-18T00:00:05Z",
      deletedAt: null,
      targetKind: "TASK",
      targetId: "task",
      bodyMd: "remote edit",
      version: 5,
    };
    vi.mocked(f.ports.read).mockResolvedValue(canonical);
    const restarted = f.controller();
    await restarted.load();
    expect(restarted.snapshot()).toMatchObject({
      body: "private local intent",
      failure: "CONFLICT",
    });
    restarted.edit("local revision after restart");
    await restarted.flush();
    expect(f.ports.save).toHaveBeenCalledTimes(1);
    expect(f.draft()).toMatchObject({
      body: "local revision after restart",
      baseVersion: 0,
    });
    expect(canonical.bodyMd).toBe("remote edit");
  });
});
