import { describe, expect, it } from "vitest";
import type {
  UnitOfWork,
  WorkTransaction,
} from "../../packages/application/src/index";
import { edge, work } from "../fixtures";

/** Reuse unchanged for SQLite and PostgreSQL adapters in M1. */
export function repositoryContract(
  name: string,
  create: () => UnitOfWork | Promise<UnitOfWork>,
) {
  describe(`${name} repository contract`, () => {
    it("isolates reads by workspace", async () => {
      const uow = await create();
      await uow.run("workspace-a", async (tx) => tx.insert(work("a")));
      expect(await uow.run("workspace-b", async (tx) => tx.list())).toEqual([]);
      await expect(
        uow.run("workspace-b", async (tx) => tx.get("a")),
      ).rejects.toThrow("NOT_FOUND");
    });
    it("rejects cross-workspace writes", async () => {
      const uow = await create();
      await expect(
        uow.run("workspace-b", async (tx) => tx.insert(work("a"))),
      ).rejects.toThrow("FORBIDDEN");
    });
    it("rolls back all work after a failed transaction", async () => {
      const uow = await create();
      await expect(
        uow.run("workspace-a", async (tx) => {
          await tx.insert(work("a"));
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect(await uow.run("workspace-a", async (tx) => tx.list())).toEqual([]);
      await uow.run("workspace-a", async (tx) => tx.insert(work("b")));
      expect(
        await uow.run("workspace-a", async (tx) => tx.list()),
      ).toHaveLength(1);
    });
    it("enforces compare-and-swap version increments", async () => {
      const uow = await create();
      await uow.run("workspace-a", async (tx) => tx.insert(work("a")));
      await uow.run("workspace-a", async (tx) =>
        tx.replace({ ...(await tx.get("a")), title: "new", version: 2 }, 1),
      );
      await expect(
        uow.run("workspace-a", async (tx) =>
          tx.replace({ ...work("a"), version: 2 }, 1),
        ),
      ).rejects.toThrow("VERSION_CONFLICT");
      await expect(
        uow.run("workspace-a", async (tx) =>
          tx.replace({ ...work("a"), version: 9 }, 2),
        ),
      ).rejects.toThrow("VERSION_CONFLICT");
    });
    it("only one racing writer succeeds", async () => {
      const uow = await create();
      await uow.run("workspace-a", async (tx) => tx.insert(work("a")));
      const results = await Promise.allSettled(
        ["one", "two"].map((title) =>
          uow.run("workspace-a", async (tx) =>
            tx.replace({ ...(await tx.get("a")), title, version: 2 }, 1),
          ),
        ),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
    });
    it("soft deletion preserves Markdown and supports restoration", async () => {
      const uow = await create();
      await uow.run("workspace-a", async (tx) => tx.insert(work("a")));
      await uow.run("workspace-a", async (tx) =>
        tx.replace(
          {
            ...(await tx.get("a")),
            deletedAt: "2026-09-13T00:00:00Z",
            version: 2,
          },
          1,
        ),
      );
      expect(await uow.run("workspace-a", async (tx) => tx.list())).toEqual([]);
      expect(
        await uow.run("workspace-a", async (tx) => tx.list(true)),
      ).toHaveLength(1);
      await uow.run("workspace-a", async (tx) =>
        tx.replace({ ...(await tx.get("a")), deletedAt: null, version: 3 }, 2),
      );
      expect(
        await uow.run(
          "workspace-a",
          async (tx) => (await tx.get("a")).descriptionMd,
        ),
      ).toBe(work("a").descriptionMd);
    });
    it("does not leak mutable entity references", async () => {
      const uow = await create();
      const input = { ...work("a") };
      await uow.run("workspace-a", async (tx) => tx.insert(input));
      input.title = "mutated outside";
      const output = await uow.run("workspace-a", async (tx) => tx.get("a"));
      Object.assign(output, { title: "also mutated" });
      expect(
        await uow.run("workspace-a", async (tx) => (await tx.get("a")).title),
      ).toBe("a");
    });
    it("rejects missing graph endpoints and isolates edge reads", async () => {
      const uow = await create();
      await expect(
        uow.run("workspace-a", async (tx) => tx.addEdge(edge("a", "b"))),
      ).rejects.toThrow("NOT_FOUND");
      await uow.run("workspace-a", async (tx) => {
        await tx.insert(work("a"));
        await tx.insert(work("b"));
        await tx.addEdge(edge("a", "b"));
      });
      expect(await uow.run("workspace-b", async (tx) => tx.edges())).toEqual(
        [],
      );
      await expect(
        uow.run("workspace-b", async (tx) => tx.removeEdge("a-b-BLOCKS")),
      ).rejects.toThrow("NOT_FOUND");
    });
    it("closes transaction handles after commit", async () => {
      const uow = await create();
      let escaped: WorkTransaction | undefined;
      await uow.run("workspace-a", async (tx) => {
        escaped = tx;
        await tx.insert(work("a"));
      });
      await expect(
        Promise.resolve().then(() => escaped?.insert(work("b"))),
      ).rejects.toThrow();
    });
    it("closes transaction handles after rollback", async () => {
      const uow = await create();
      let escaped: WorkTransaction | undefined;
      await expect(
        uow.run("workspace-a", async (tx) => {
          escaped = tx;
          await tx.insert(work("a"));
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      await expect(
        Promise.resolve().then(() => escaped?.insert(work("b"))),
      ).rejects.toThrow();
      expect(await uow.run("workspace-a", (tx) => tx.list())).toEqual([]);
    });
  });
}
