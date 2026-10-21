import { expect, test } from "vitest";
import type { LibraryFileStore } from "../../packages/application/src/files";
import type { LibraryFile } from "../../packages/domain/src/library-file";

export interface FileContractHarness {
  run<T>(
    workspaceId: string,
    action: (files: LibraryFileStore) => Promise<T>,
  ): Promise<T>;
  evidence(): Promise<unknown>;
  entity(): Promise<unknown>;
}
export function fileContract(
  label: string,
  create: () => Promise<FileContractHarness>,
) {
  test(`${label}: File CAS, scope, immutable originals and atomic rollback`, async () => {
    const h = await create();
    const file: LibraryFile = {
      id: "original-file",
      workspaceId: "workspace-a",
      spaceId: null,
      parentDocumentId: null,
      name: "原始.bin",
      originalName: "原始.bin",
      extension: "bin",
      mime: "application/octet-stream",
      size: 3,
      contentHash: "a".repeat(64),
      blobId: "a".repeat(64),
      version: 1,
      provenance: "HUMAN",
      aiPolicy: {
        classification: "PRIVATE",
        processingBoundary: "LOCAL_ONLY",
        aiAccess: "DENY",
      },
      extractionStatus: "NOT_APPLICABLE",
      indexStatus: "PENDING",
      createdBy: "human",
      updatedBy: "human",
      createdAt: "2026-10-13T00:00:00Z",
      updatedAt: "2026-10-13T00:00:00Z",
      deletedAt: null,
    };
    const run = <T>(action: (store: LibraryFileStore) => Promise<T>) =>
      h.run("workspace-a", action);
    await run((s) => s.save(file, 0));
    expect(await run((s) => s.get(file.id))).toEqual(file);
    expect(await h.entity()).toEqual(file);
    const evidence = await h.evidence();
    await expect(run((s) => s.save(file, 0))).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
    await expect(
      h.run("workspace-b", (s) => s.get(file.id)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await h.run("workspace-b", (s) => s.list())).toEqual([]);
    await expect(
      h.run("workspace-b", (s) => s.save(file, 0)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      run((s) =>
        s.save({ ...file, version: 2, originalName: "replacement" }, 1),
      ),
    ).rejects.toThrow();
    await expect(
      run(async (s) => {
        await s.save({ ...file, version: 2, name: "renamed" }, 1);
        throw new Error("rollback-file");
      }),
    ).rejects.toThrow("rollback-file");
    expect(await run((s) => s.get(file.id))).toEqual(file);
    expect(await h.evidence()).toEqual(evidence);
    let escaped: LibraryFileStore | undefined;
    await run(async (s) => {
      escaped = s;
    });
    await expect(escaped!.get(file.id)).rejects.toThrow("TRANSACTION_CLOSED");
    const policy = {
      ...file,
      version: 2,
      aiPolicy: { ...file.aiPolicy, aiAccess: "ASK" as const },
    };
    await run((s) => s.save(policy, 1));
    expect(await h.entity()).toEqual(policy);
    const policyEvidence = await h.evidence();
    await expect(
      run(async (s) => {
        await s.save(
          {
            ...policy,
            version: 3,
            aiPolicy: { ...policy.aiPolicy, aiAccess: "ALLOW" },
          },
          2,
        );
        throw new Error("rollback-policy");
      }),
    ).rejects.toThrow("rollback-policy");
    expect(await run((s) => s.get(file.id))).toEqual(policy);
    expect(await h.evidence()).toEqual(policyEvidence);
    await run((s) =>
      s.save(
        {
          ...policy,
          version: 3,
          name: "renamed",
          deletedAt: "2026-10-13T01:00:00Z",
        },
        2,
      ),
    );
    const deleted = await run((s) => s.get(file.id));
    expect(deleted.originalName).toBe(file.originalName);
    expect(deleted.contentHash).toBe(file.contentHash);
    expect(deleted.deletedAt).not.toBeNull();
    await run((s) => s.save({ ...deleted, version: 4, deletedAt: null }, 3));
    expect(await h.entity()).toEqual({
      ...deleted,
      version: 4,
      deletedAt: null,
    });
  });
}
