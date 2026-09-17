import { type ActorContext, DomainError } from "@arclattice/domain";
import type {
  AuthorizationService,
  Clock,
  NotebookService,
  WorkService,
} from "./index";

export interface Organization {
  kind: "WORK" | "NOTE";
  id: string;
  workspaceId: string;
  version: number;
  archived: boolean;
  folder: string;
  updatedAt: string;
  updatedBy: string;
}
export interface OrganizationStore {
  list(): Promise<Organization[]>;
  save(value: Organization, expectedVersion: number): Promise<void>;
}
export interface OrganizeInput {
  kind: "WORK" | "NOTE";
  action: "archive" | "unarchive" | "move" | "delete";
  folder?: string;
  entries: { id: string; version: number; organizationVersion: number }[];
}
/** Must run within a host request transaction, including its idempotency receipt. */
export class OrganizationService {
  constructor(
    private readonly store: OrganizationStore,
    private readonly work: WorkService,
    private readonly notes: NotebookService,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
  ) {}
  async apply(context: ActorContext, input: OrganizeInput) {
    await this.authorization.require(
      context,
      input.action === "delete" ? "work:delete" : "work:update",
    );
    if (
      !["WORK", "NOTE"].includes(input.kind) ||
      !["archive", "unarchive", "move", "delete"].includes(input.action) ||
      !Array.isArray(input.entries) ||
      input.entries.length < 1 ||
      input.entries.length > 100 ||
      input.entries.some(
        (e) =>
          !e ||
          typeof e !== "object" ||
          typeof e.id !== "string" ||
          !e.id ||
          !Number.isSafeInteger(e.version) ||
          e.version < 1 ||
          !Number.isSafeInteger(e.organizationVersion) ||
          e.organizationVersion < 0,
      ) ||
      new Set(input.entries.map((e) => e.id)).size !== input.entries.length ||
      (input.action === "move" &&
        (input.kind !== "NOTE" ||
          typeof input.folder !== "string" ||
          input.folder.length > 80 ||
          /[\x00-\x1f]/.test(input.folder))) ||
      (["archive", "unarchive"].includes(input.action) && input.kind !== "WORK")
    )
      throw new DomainError("VALIDATION_ERROR");
    const entities =
      input.kind === "NOTE"
        ? await this.notes.list(context)
        : (await this.work.snapshot(context, true)).items;
    const metadata = await this.store.list();
    // Preflight all entries before any mutation. The enclosing transaction handles races.
    for (const entry of input.entries) {
      const entity = entities.find(
        (e) => e.id === entry.id && e.workspaceId === context.workspaceId,
      );
      if (
        !entity ||
        entity.deletedAt ||
        ("type" in entity &&
          entity.type === "PROJECT" &&
          input.action === "delete")
      )
        throw new DomainError("NOT_FOUND");
      const old = metadata.find(
        (e) => e.kind === input.kind && e.id === entry.id,
      );
      if (
        entity.version !== entry.version ||
        (old?.version ?? 0) !== entry.organizationVersion
      )
        throw new DomainError("VERSION_CONFLICT");
    }
    for (const entry of input.entries) {
      if (input.action === "delete") {
        if (input.kind === "NOTE")
          await this.notes.setDeleted(context, entry.id, entry.version, true);
        else await this.work.setDeleted(context, entry.id, entry.version, true);
      } else {
        const old = metadata.find(
          (e) => e.kind === input.kind && e.id === entry.id,
        );
        await this.store.save(
          {
            kind: input.kind,
            id: entry.id,
            workspaceId: context.workspaceId,
            version: entry.organizationVersion + 1,
            archived:
              input.action === "archive"
                ? true
                : input.action === "unarchive"
                  ? false
                  : (old?.archived ?? false),
            folder:
              input.action === "move"
                ? (input.folder ?? "").trim()
                : (old?.folder ?? ""),
            updatedAt: this.clock.now(),
            updatedBy: context.principalId,
          },
          entry.organizationVersion,
        );
      }
    }
    return { changed: input.entries.length };
  }
}
