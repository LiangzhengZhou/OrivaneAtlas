import {
  bodyManifest,
  type ConnectedStore,
  type EntityMemoTarget,
  type EntityMemoTransaction,
  type LibraryStore,
  localDto,
  localObject,
  type NotebookStore,
  type OrganizationStore,
  type ProjectStore,
  type PurgeSnapshotRow,
  type UnitOfWork,
} from "@arclattice/application";
import { type ActorContext, DomainError } from "@arclattice/domain";

/** Metadata only; called twice within the same authenticated receipt transaction. */
export function purgeReplaySnapshot(
  context: ActorContext,
  workId: string | null,
  ports: {
    uow: UnitOfWork;
    notes: NotebookStore;
    library: LibraryStore;
    connected: ConnectedStore;
    organization: OrganizationStore;
    projects: ProjectStore;
    memos: EntityMemoTransaction;
  },
) {
  let target: EntityMemoTarget | null = null;
  return async (): Promise<PurgeSnapshotRow[]> => {
    const work = await ports.uow.run(context.workspaceId, async (tx) => ({
      items: await tx.list(true),
      edges: await tx.edges(),
      workflows: await tx.workflows(),
    }));
    const [notes, library, links, organization, projects] = await Promise.all([
      ports.notes.listMetadata
        ? ports.notes.listMetadata()
        : ports.notes.list().then((rows) => rows.map(bodyManifest)),
      ports.library.listMetadata
        ? ports.library.listMetadata()
        : ports.library.list().then((rows) => rows.map(bodyManifest)),
      ports.connected.links(),
      ports.organization.list(),
      ports.projects.list(),
    ]);
    const groups: [PurgeSnapshotRow["collection"], readonly unknown[]][] = [
      ["items", work.items],
      ["edges", work.edges],
      ["workflows", work.workflows],
      ["notes", notes],
      ["library", library],
      ["links", links],
      ["organization", organization],
      ["projectMaterials", projects],
    ];
    const rows = groups.flatMap(([collection, entries]) =>
      entries.map((raw) => {
        const value = localDto(raw),
          entity = localObject(value);
        if (
          entity.workspaceId !== context.workspaceId ||
          typeof entity.id !== "string"
        )
          throw new DomainError("FORBIDDEN");
        return {
          collection,
          id:
            collection === "organization"
              ? String(entity.kind) + ":" + entity.id
              : entity.id,
          version: collection === "edges" ? 1 : Number(entity.version),
          value,
        };
      }),
    );
    if (workId) {
      const entity = work.items.find((row) => row.id === workId);
      if (
        entity &&
        (entity.type === "PROJECT" ||
          entity.type === "TASK" ||
          entity.type === "MILESTONE")
      )
        target = { targetKind: entity.type, targetId: entity.id };
      if (target) {
        const memo = await ports.memos.find(context.principalId, target);
        if (memo)
          rows.push({
            collection: "entityMemos",
            id: memo.id,
            version: memo.version,
            value: localDto({
              id: memo.id,
              workspaceId: memo.workspaceId,
              ownerPrincipalId: memo.ownerPrincipalId,
              targetKind: memo.targetKind,
              targetId: memo.targetId,
              version: memo.version,
            }),
          });
      }
    }
    return rows;
  };
}
