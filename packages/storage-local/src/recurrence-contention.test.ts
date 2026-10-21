import { LocalRuntime, LocalWorkspace } from "@arclattice/application";
import { IDBFactory } from "fake-indexeddb";
import { expect, it } from "vitest";
import { IndexedDbLocalStore } from "./indexed-db";

it.each(["UNRELATED", "SAME_DEFINITION", "CONTINUOUS"])(
  "recurrence end preserves original CAS under %s contention",
  async (mode) => {
    const factory = new IDBFactory();
    const first = await IndexedDbLocalStore.open(
      "recurrence-contention",
      factory,
    );
    const second = await IndexedDbLocalStore.open(
      "recurrence-contention",
      factory,
    );
    const identity = {
      schemaVersion: 1 as const,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      principalId: "22222222-2222-4222-8222-222222222222",
      deviceId: "33333333-3333-4333-8333-333333333333",
    };
    const clock = { now: () => "2026-10-20T00:00:00.000Z" };
    const ids = { next: () => crypto.randomUUID() };
    const blobs = {
      get: async () => null,
      put: async () => {
        throw new Error("unexpected Blob write");
      },
    };
    const wiki = { extract: () => [], resolve: () => [] };
    let interfere: (() => Promise<void>) | null = null;
    let attempts = 0;
    const other = new LocalRuntime(
      new LocalWorkspace(second.metadata, blobs, identity, wiki, clock, ids),
    );
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
      const rule = {
        title: "Original",
        descriptionMd: "Exact recurrence Markdown\r\n中文 🧭\n",
        startDate: "2026-10-20",
        timezone: "UTC",
        frequency: "DAILY" as const,
        interval: 1,
        state: "ACTIVE" as const,
        closePolicy: "DURATION" as const,
        durationValue: 1,
        durationUnit: "HOUR" as const,
        closeIncomplete: true,
      };
      const original = await runtime.saveRecurrence({
        version: 0,
        deleted: false,
        rule,
      });
      const concurrent = async () => {
        if (mode === "SAME_DEFINITION")
          await other.saveRecurrence({
            id: original.id,
            version: original.version,
            deleted: false,
            rule: {
              ...rule,
              title: "Other writer",
            },
          });
        else
          await other.service.create(other.context, {
            title: "Unrelated",
            type: "TASK",
          });
        if (mode === "CONTINUOUS") interfere = concurrent;
      };
      interfere = concurrent;
      const completion = runtime.saveRecurrence({
        id: original.id,
        version: original.version,
        deleted: false,
        rule: { ...rule, state: "ENDED" },
      });
      if (mode === "UNRELATED")
        await expect(completion).resolves.toMatchObject({
          version: 2,
          payload: { state: "ENDED" },
        });
      else
        await expect(completion).rejects.toMatchObject({
          code: "VERSION_CONFLICT",
        });
      const row = await first.metadata.get(
        identity.workspaceId,
        "workflows",
        original.id,
      );
      expect(row?.version).toBe(mode === "CONTINUOUS" ? 1 : 2);
      expect(row?.value).toMatchObject({
        payload: {
          descriptionMd: rule.descriptionMd,
          frequency: "DAILY",
          interval: 1,
          state: mode === "UNRELATED" ? "ENDED" : "ACTIVE",
          title: mode === "SAME_DEFINITION" ? "Other writer" : "Original",
        },
      });
      expect(attempts).toBe(mode === "CONTINUOUS" ? 3 : 1);
      expect(await first.outbox.list(identity.workspaceId)).toHaveLength(
        mode === "CONTINUOUS" ? 4 : mode === "SAME_DEFINITION" ? 2 : 3,
      );
    } finally {
      first.close();
      second.close();
    }
  },
);
