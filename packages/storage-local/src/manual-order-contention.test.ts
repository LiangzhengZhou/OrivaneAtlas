import { LocalRuntime, LocalWorkspace } from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";

it.each(["UNRELATED", "SAME_ORDER", "CONTINUOUS"])(
  "manual order retains original CAS under %s contention",
  async (mode) => {
    const factory = new IDBFactory();
    const first = await IndexedDbLocalStore.open("order-contention", factory);
    const second = await IndexedDbLocalStore.open("order-contention", factory);
    const identity = {
      schemaVersion: 1 as const,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      principalId: "22222222-2222-4222-8222-222222222222",
      deviceId: "33333333-3333-4333-8333-333333333333",
    };
    const blobs = {
      get: async () => null,
      put: async () => {
        throw new Error("unexpected Blob write");
      },
    };
    const wiki = { extract: () => [], resolve: () => [] };
    const clock = { now: () => "2026-10-20T00:00:00.000Z" };
    const ids = { next: () => crypto.randomUUID() };
    const other = new LocalRuntime(
      new LocalWorkspace(second.metadata, blobs, identity, wiki, clock, ids),
    );
    let interfere: (() => Promise<void>) | null = null;
    let attempts = 0;
    const runtime = new LocalRuntime(
      new LocalWorkspace(
        {
          ...first.metadata,
          commit: async (...args) => {
            const callback = interfere;
            interfere = null;
            if (callback) {
              attempts++;
              await callback();
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
      const alpha = await runtime.service.create(runtime.context, {
        title: "Alpha",
        type: "TASK",
      });
      const bravo = await runtime.service.create(runtime.context, {
        title: "Bravo",
        type: "TASK",
      });
      const input = {
        scope: { kind: "WORKSPACE_TASKS" as const },
        version: 0,
        entityId: bravo.id,
        anchorId: alpha.id,
        placement: "BEFORE" as const,
      };
      const concurrent = async () => {
        if (mode === "SAME_ORDER") await other.moveManualOrder(input);
        else
          await other.service.create(other.context, {
            title: "Unrelated",
            type: "TASK",
          });
        if (mode === "CONTINUOUS") interfere = concurrent;
      };
      interfere = concurrent;
      const saving = runtime.moveManualOrder(input);
      if (mode === "UNRELATED")
        await expect(saving).resolves.toMatchObject({ version: 1 });
      else
        await expect(saving).rejects.toMatchObject({
          code: "VERSION_CONFLICT",
        });
      const rows = await first.metadata.list(
        identity.workspaceId,
        "manualOrders",
      );
      expect(rows).toHaveLength(mode === "CONTINUOUS" ? 0 : 1);
      if (mode !== "CONTINUOUS") expect(rows[0]?.version).toBe(1);
      expect(attempts).toBe(mode === "CONTINUOUS" ? 3 : 1);
      expect(await first.outbox.list(identity.workspaceId)).toHaveLength(
        mode === "CONTINUOUS" ? 5 : mode === "SAME_ORDER" ? 3 : 4,
      );
    } finally {
      first.close();
      second.close();
    }
  },
);
