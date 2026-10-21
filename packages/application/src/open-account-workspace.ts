import { type ActorContext, DomainError } from "@arclattice/domain";
import type { previewWorkspaceBinding } from "./workspace-binding-preview";
import {
  defaultWorkspaceDatabase,
  type WorkspaceCatalog,
  type WorkspaceCatalogEntry,
} from "./workspace-catalog";

export type WorkspaceConnectionPreview = ReturnType<
  typeof previewWorkspaceBinding
> & {
  remotePrincipalId: string;
  serverOrigin: string;
  epoch: string;
};
export interface OpenAccountWorkspacePorts {
  catalog: WorkspaceCatalog;
  ids: { next(): string };
  preview(): Promise<WorkspaceConnectionPreview>;
  assertScope(): void;
  open(
    entry: WorkspaceCatalogEntry,
    preview: WorkspaceConnectionPreview,
  ): Promise<{
    synchronize(): Promise<void>;
    close(): void;
  }>;
}

/** Opens a separate local replica. The original database is never replaced or merged. */
export class OpenAccountWorkspaceService {
  constructor(private readonly ports: OpenAccountWorkspacePorts) {}
  async open(
    actorInput: ActorContext,
    expectedInput: WorkspaceConnectionPreview,
  ) {
    const actor = Object.freeze({ ...actorInput }),
      expected = structuredClone(expectedInput);
    if (actor.workspaceId !== expected.localWorkspaceId)
      throw new DomainError("FORBIDDEN");
    const active = await this.ports.catalog.active(),
      fresh = await this.ports.preview();
    this.ports.assertScope();
    for (const key of [
      "localWorkspaceId",
      "remoteWorkspaceId",
      "localRevision",
      "remoteRevision",
      "remotePrincipalId",
      "serverOrigin",
      "epoch",
    ] as const)
      if (expected[key] !== fresh[key])
        throw new DomainError("VERSION_CONFLICT");
    const id = this.ports.ids.next();
    const entry = await this.ports.catalog.reserveRemote({
      id,
      databaseName: `${defaultWorkspaceDatabase}.${id}`,
      title: "Account workspace",
      remote: {
        serverOrigin: fresh.serverOrigin,
        workspaceId: fresh.remoteWorkspaceId,
        principalId: fresh.remotePrincipalId,
      },
    });
    this.ports.assertScope();
    if (
      entry.remote?.serverOrigin !== fresh.serverOrigin ||
      entry.remote.workspaceId !== fresh.remoteWorkspaceId ||
      entry.remote.principalId !== fresh.remotePrincipalId
    )
      throw new DomainError("FORBIDDEN");
    const target = await this.ports.open(entry, fresh);
    try {
      this.ports.assertScope();
      await target.synchronize();
      this.ports.assertScope();
      await this.ports.catalog.select(entry.id, active.databaseName);
      return entry;
    } finally {
      target.close();
    }
  }
}
