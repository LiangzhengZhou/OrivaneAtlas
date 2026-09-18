import {
  type AuthorizationService,
  type Clock,
  type IdGenerator,
  LibraryService,
  type LibraryStore,
  type PlanDocumentPublisher,
  ProjectService,
  type ProjectStore,
  type UnitOfWork,
} from "@arclattice/application";
import { DomainError } from "@arclattice/domain";

export function planDocumentPublisher(
  uow: UnitOfWork,
  projects: ProjectStore,
  library: LibraryStore,
  authorization: AuthorizationService,
  clock: Clock,
  ids: IdGenerator,
): PlanDocumentPublisher {
  const projectService = new ProjectService(
    uow,
    projects,
    library,
    authorization,
    clock,
    ids,
  );
  const service = (origin: "HUMAN" | "EXTERNAL_AI" = "HUMAN") =>
    new LibraryService(library, authorization, clock, ids, origin);
  return {
    revision: async (actor, plan) => {
      await authorization.require(actor, "work:read");
      const entries = await library.list();
      for (const document of plan.documents)
        if (
          document.spaceId &&
          !entries.some(
            (entry) =>
              entry.id === document.spaceId &&
              entry.kind === "SPACE" &&
              !entry.deletedAt,
          )
        )
          throw new DomainError("NOT_FOUND");
      return JSON.stringify({
        library: entries
          .map((entry) => [entry.id, entry.version])
          .sort((left, right) =>
            String(left[0]).localeCompare(String(right[0])),
          ),
        materials: (await projects.list())
          .map((entry) => [entry.id, entry.version])
          .sort((left, right) =>
            String(left[0]).localeCompare(String(right[0])),
          ),
      });
    },
    publish: async (actor, input) => {
      if (input.ownership === "LINKED") {
        const libraryService = service(input.provenance?.origin);
        const space = await libraryService.save(actor, null, 0, {
          kind: "SPACE",
          spaceId: null,
          title: input.title,
          bodyMd: "",
        });
        const document = await libraryService.save(actor, null, 0, {
          kind: "DOCUMENT",
          spaceId: space.id,
          title: input.title,
          bodyMd: input.bodyMd,
        });
        await projectService.link(actor, input.projectId, document.id);
        return document;
      }
      const document = await projectService.createDocument(actor, {
        projectId: input.projectId,
        title: input.title,
        bodyMd: input.bodyMd,
        provenance: input.provenance?.origin ?? "HUMAN",
      });
      return document;
    },
    createSpace: (actor, input) =>
      service(input.origin).save(actor, null, 0, {
        kind: "SPACE",
        spaceId: null,
        title: input.title,
        bodyMd: input.descriptionMd,
      }),
    publishKnowledgeDocument: async (actor, input) => {
      const document = await service(input.provenance.origin).save(
        actor,
        null,
        0,
        {
          kind: "DOCUMENT",
          spaceId: input.spaceId,
          title: input.title,
          bodyMd: input.bodyMd,
        },
      );
      if (input.projectId) {
        const material = await projectService.link(
          actor,
          input.projectId,
          document.id,
        );
        if (input.ownership === "OWNED")
          await projects.save(
            { ...material, ownership: "OWNED", version: material.version + 1 },
            material.version,
          );
      }
      return document;
    },
  };
}
