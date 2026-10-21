import {
  type AccountStore,
  type AuthorizationService,
  type Clock,
  FileExtractionService,
  type FileParser,
  FileService,
  type IdGenerator,
} from "@arclattice/application";
import type { ActorContext } from "@arclattice/domain";
import type { SqliteUnitOfWork } from "@arclattice/storage-sqlite";

/** Private reads/publication reauthorize separately; parsing holds no DB lock. */
export function hostFileExtraction(
  db: SqliteUnitOfWork,
  actor: ActorContext,
  authorize: (store: AccountStore) => void,
  authorization: AuthorizationService,
  clock: Clock,
  ids: IdGenerator,
  parser: FileParser,
) {
  const service = new FileExtractionService(
    {
      read: (context, id) =>
        db.request(
          context,
          null,
          async (
            _uow,
            _notes,
            _connected,
            library,
            _organization,
            _projects,
            _sessions,
            files,
            blobs,
          ) =>
            new FileService(
              files,
              library,
              blobs,
              authorization,
              clock,
              ids,
            ).read(context, id),
          authorize,
        ),
      bytes: (context, id) =>
        db.request(
          context,
          null,
          async (
            _uow,
            _notes,
            _connected,
            library,
            _organization,
            _projects,
            _sessions,
            files,
            blobs,
          ) =>
            new FileService(
              files,
              library,
              blobs,
              authorization,
              clock,
              ids,
            ).originalBytes(context, id),
          authorize,
        ),
    },
    {
      get: (context, id) =>
        db.request(
          context,
          null,
          async (
            _uow,
            _notes,
            _connected,
            _library,
            _organization,
            _projects,
            _sessions,
            files,
          ) => {
            if (!files.extractions)
              throw new Error("FILE_EXTRACTION_STORE_UNAVAILABLE");
            return files.extractions.get(context, id);
          },
          authorize,
        ),
      publish: (context, document) =>
        db.request(
          context,
          null,
          async (
            _uow,
            _notes,
            _connected,
            _library,
            _organization,
            _projects,
            _sessions,
            files,
          ) => {
            if (!files.extractions)
              throw new Error("FILE_EXTRACTION_STORE_UNAVAILABLE");
            await files.extractions.publish(context, document);
          },
          authorize,
        ),
    },
    parser,
    authorization,
  );
  return (id: string, version: number, signal?: AbortSignal) =>
    service.extract(actor, id, version, signal);
}
