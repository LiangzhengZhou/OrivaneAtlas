import {
  type ActorContext,
  DomainError,
  requireTitle,
} from "@arclattice/domain";
import type {
  AuthorizationService,
  Clock,
  IdGenerator,
  UnitOfWork,
} from "./index";
import { LibraryService, type LibraryStore } from "./library";

export interface ProjectMaterial {
  id: string;
  workspaceId: string;
  projectId: string;
  kind: "SPACE" | "DOCUMENT" | "FILE";
  ownership: "OWNED" | "LINKED";
  targetId: string | null;
  title: string;
  mime: string | null;
  size: number;
  version: number;
  updatedBy: string;
  updatedAt: string;
  deletedAt: string | null;
}
export interface ProjectActivity {
  id: string;
  projectId: string;
  materialId: string;
  principalId: string;
  type: string;
  occurredAt: string;
}
export interface ProjectStore {
  list(): Promise<ProjectMaterial[]>;
  get(id: string): Promise<ProjectMaterial>;
  save(
    material: ProjectMaterial,
    expected: number,
    base64?: string,
  ): Promise<void>;
  file(id: string): Promise<string>;
  activity(projectId: string): Promise<ProjectActivity[]>;
}
export class ProjectService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly store: ProjectStore,
    private readonly library: LibraryStore,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}
  private async project(context: ActorContext, id: string) {
    return this.uow.run(context.workspaceId, async (tx) => {
      const item = await tx.get(id);
      if (item.type !== "PROJECT" || item.deletedAt)
        throw new DomainError("NOT_FOUND");
      return item;
    });
  }
  private material(
    context: ActorContext,
    projectId: string,
    kind: ProjectMaterial["kind"],
    title: string,
    targetId: string | null,
  ): ProjectMaterial {
    return {
      id: this.ids.next(),
      workspaceId: context.workspaceId,
      projectId,
      kind,
      ownership: "OWNED",
      targetId,
      title: requireTitle(title),
      mime: null,
      size: 0,
      version: 1,
      updatedBy: context.principalId,
      updatedAt: this.clock.now(),
      deletedAt: null,
    };
  }
  async createDocument(
    context: ActorContext,
    input: {
      projectId: string;
      title: string;
      bodyMd: string;
      provenance?: "HUMAN" | "EXTERNAL_AI";
    },
  ) {
    await this.authorization.require(context, "work:create");
    const project = await this.project(context, input.projectId);
    const library = new LibraryService(
      this.library,
      this.authorization,
      this.clock,
      this.ids,
      input.provenance ?? "HUMAN",
    );
    let space = (await this.store.list()).find(
      (entry) =>
        entry.projectId === project.id &&
        entry.kind === "SPACE" &&
        entry.ownership === "OWNED" &&
        !entry.deletedAt,
    );
    if (!space) {
      const entry = await library.save(context, null, 0, {
        kind: "SPACE",
        spaceId: null,
        title: project.title,
        bodyMd: "",
      });
      space = this.material(
        context,
        project.id,
        "SPACE",
        entry.title,
        entry.id,
      );
      await this.store.save(space, 0);
    }
    const document = await library.save(context, null, 0, {
      kind: "DOCUMENT",
      spaceId: space.targetId,
      title: input.title,
      bodyMd: input.bodyMd,
    });
    await this.store.save(
      this.material(
        context,
        project.id,
        "DOCUMENT",
        document.title,
        document.id,
      ),
      0,
    );
    return document;
  }
  async link(context: ActorContext, projectId: string, targetId: string) {
    await this.authorization.require(context, "work:create");
    await this.project(context, projectId);
    const target = await this.library.get(targetId);
    if (target.deletedAt) throw new DomainError("NOT_FOUND");
    if (
      (await this.store.list()).some(
        (entry) =>
          !entry.deletedAt &&
          entry.projectId === projectId &&
          entry.targetId === targetId,
      )
    )
      throw new DomainError("VALIDATION_ERROR");
    const material = {
      ...this.material(
        context,
        projectId,
        target.kind,
        target.title,
        target.id,
      ),
      ownership: "LINKED" as const,
    };
    await this.store.save(material, 0);
    return material;
  }
  async upload(
    context: ActorContext,
    input: { projectId: string; name: string; mime: string; base64: string },
  ) {
    await this.authorization.require(context, "work:create");
    await this.project(context, input.projectId);
    if (
      !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64) ||
      input.base64.length % 4 !== 0 ||
      input.base64.length > 2796204 ||
      !input.base64.length ||
      /[\x00-\x1f/\\]/.test(input.name) ||
      input.name.length > 120 ||
      !/^[\w.+-]+\/[\w.+-]+$/.test(input.mime)
    )
      throw new DomainError("VALIDATION_ERROR");
    const size =
      (input.base64.length * 3) / 4 -
      (input.base64.endsWith("==") ? 2 : input.base64.endsWith("=") ? 1 : 0);
    if (size > 2097152) throw new DomainError("VALIDATION_ERROR");
    const material = {
      ...this.material(context, input.projectId, "FILE", input.name, null),
      mime: input.mime,
      size,
    };
    await this.store.save(material, 0, input.base64);
    return material;
  }
  async setDeleted(
    context: ActorContext,
    id: string,
    version: number,
    deleted: boolean,
  ) {
    await this.authorization.require(
      context,
      deleted ? "work:delete" : "work:update",
    );
    const old = await this.store.get(id);
    if (!Number.isSafeInteger(version) || old.version !== version)
      throw new DomainError("VERSION_CONFLICT");
    if (typeof deleted !== "boolean") throw new DomainError("VALIDATION_ERROR");
    await this.project(context, old.projectId);
    if (old.kind === "SPACE" && old.ownership === "OWNED")
      throw new DomainError("FORBIDDEN");
    if (old.ownership === "OWNED" && old.kind === "DOCUMENT" && old.targetId) {
      const entry = await this.library.get(old.targetId);
      await new LibraryService(
        this.library,
        this.authorization,
        this.clock,
        this.ids,
      ).setDeleted(context, entry.id, entry.version, deleted);
    }
    const material = {
      ...old,
      version: version + 1,
      updatedBy: context.principalId,
      updatedAt: this.clock.now(),
      deletedAt: deleted ? this.clock.now() : null,
    };
    await this.store.save(material, version);
    return material;
  }
}
