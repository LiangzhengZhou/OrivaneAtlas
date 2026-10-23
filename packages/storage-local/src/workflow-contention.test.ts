import { createHash } from "node:crypto";
import { LocalRuntime, LocalWorkspace } from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";

it.each(
  (
    [
      "CREATE",
      "RESTORE_CATEGORY",
      "PUBLISH",
      "FILE_UPLOAD",
      "CALENDAR",
    ] as const
  ).flatMap((operation) =>
    ([false, true] as const).map((continuous) => ({ operation, continuous })),
  ),
)(
  "$operation keeps atomic effects under contention (continuous=$continuous)",
  async ({ operation, continuous }) => {
    const factory = new IDBFactory();
    const first = await IndexedDbLocalStore.open(
      "workflow-contention",
      factory,
    );
    const second = await IndexedDbLocalStore.open(
      "workflow-contention",
      factory,
    );
    const identity = {
      schemaVersion: 1 as const,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      principalId: "22222222-2222-4222-8222-222222222222",
      deviceId: "33333333-3333-4333-8333-333333333333",
    };
    const clock = { now: () => "2026-10-22T00:00:00Z" };
    const ids = { next: () => crypto.randomUUID() };
    const content = new Map<string, Blob>();
    const blobs = {
      get: async (_workspace: string, hash: string) =>
        content.get(hash) ?? null,
      put: async (_workspace: string, hash: string, bytes: Blob) => {
        content.set(hash, bytes);
      },
      digest: async (bytes: Blob) =>
        createHash("sha256")
          .update(Buffer.from(await bytes.arrayBuffer()))
          .digest("hex"),
    };
    const wiki = { extract: () => [], resolve: () => [] };
    const other = new LocalRuntime(
      new LocalWorkspace(second.metadata, blobs, identity, wiki, clock, ids),
    );
    let interfere = false;
    let collisions = 0;
    const runtime = new LocalRuntime(
      new LocalWorkspace(
        {
          ...first.metadata,
          commit: async (...args) => {
            if (interfere) {
              interfere = false;
              collisions++;
              await other.saveNote(null, 0, {
                title: "Unrelated note",
                bodyMd: "Original unrelated Markdown",
                kind: "NOTE",
                day: null,
              });
              if (continuous) interfere = true;
            }
            return first.metadata.commit(...args);
          },
        },
        blobs,
        identity,
        wiki,
        clock,
        ids,
      ),
    );
    try {
      const category = await runtime.saveCategory({
        version: 0,
        name: "Original category",
        deleted: false,
      });
      const deleted = await runtime.saveCategory({
        id: category.id,
        version: category.version,
        name: category.name,
        deleted: true,
      });
      const plan = await runtime.previewPlan(null, {
        version: 1,
        tasks: [{ tempId: "first", title: "Published once" }],
      });
      const bytes = new Blob([new Uint8Array([0, 128, 255, 10])]);
      interfere = true;
      const result =
        operation === "FILE_UPLOAD"
          ? runtime.uploadFile(
              {
                name: "Preserved.bin",
                mime: "application/octet-stream",
                spaceId: null,
              },
              bytes,
            )
          : operation === "CALENDAR"
            ? runtime.service.setCalendarSettings(
                runtime.context,
                0,
                "Asia/Tokyo",
              )
            : operation === "CREATE"
              ? runtime.service.create(runtime.context, {
                  title: "Created once",
                })
              : operation === "RESTORE_CATEGORY"
                ? runtime.saveCategory({
                    id: deleted.id,
                    version: deleted.version,
                    name: deleted.name,
                    deleted: false,
                  })
                : runtime.publishPlan(plan.id, plan.version);
      if (continuous)
        await expect(result).rejects.toMatchObject({
          code: "VERSION_CONFLICT",
        });
      else if (operation === "FILE_UPLOAD") {
        const file = (await result) as Awaited<
          ReturnType<LocalRuntime["uploadFile"]>
        >;
        expect(file).toMatchObject({
          originalName: "Preserved.bin",
          version: 1,
        });
        expect(
          new Uint8Array(
            await (await runtime.readFileBytes(file.id)).arrayBuffer(),
          ),
        ).toEqual(new Uint8Array(await bytes.arrayBuffer()));
        expect(content.size).toBe(1);
      } else if (operation === "CALENDAR") {
        await expect(result).resolves.toMatchObject({
          version: 1,
          timezone: "Asia/Tokyo",
        });
        await expect(
          runtime.service.setCalendarSettings(runtime.context, 0, "UTC"),
        ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
      } else if (operation === "CREATE")
        await expect(result).resolves.toMatchObject({
          title: "Created once",
          version: 1,
        });
      else if (operation === "RESTORE_CATEGORY") {
        await expect(result).resolves.toMatchObject({
          id: deleted.id,
          version: 3,
          deletedAt: null,
        });
        await expect(
          runtime.saveCategory({
            id: deleted.id,
            version: deleted.version,
            name: "Stale update",
            deleted: false,
          }),
        ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
      } else {
        await expect(result).resolves.toBeDefined();
        await runtime.publishPlan(plan.id, plan.version);
      }
      const snapshot = await runtime.service.snapshot(runtime.context, true);
      expect(
        snapshot.items.filter((item) => item.title === "Created once"),
      ).toHaveLength(operation === "CREATE" && !continuous ? 1 : 0);
      expect(
        snapshot.items.filter((item) => item.title === "Published once"),
      ).toHaveLength(operation === "PUBLISH" && !continuous ? 1 : 0);
      expect(collisions).toBe(continuous ? 3 : 1);
      const outbox = await first.outbox.list(identity.workspaceId);
      expect(outbox.filter((item) => item.entityType === "files")).toHaveLength(
        operation === "FILE_UPLOAD" && !continuous ? 1 : 0,
      );
      expect(snapshot.calendarTimezone).toBe(
        operation === "CALENDAR" && !continuous ? "Asia/Tokyo" : "UTC",
      );
      expect(snapshot.calendarSettings?.version).toBe(
        operation === "CALENDAR" && !continuous ? 1 : 0,
      );
      expect(outbox.filter((item) => item.entityType === "notes")).toHaveLength(
        continuous ? 3 : 1,
      );
    } finally {
      first.close();
      second.close();
    }
  },
);
