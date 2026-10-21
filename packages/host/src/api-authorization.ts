import type { ApiCredential, ApiScope } from "@arclattice/application";
import { requireApiGrants } from "@arclattice/application";
import { DomainError } from "@arclattice/domain";

export const granularRouteGrants: Readonly<
  Record<string, readonly ApiScope[]>
> = {
  "/api/snapshot": [
    "workspace:read",
    "tasks:read",
    "projects:read",
    "knowledge:read",
    "files:read",
    "files:content",
  ],
  "/api/bootstrap": [
    "workspace:read",
    "tasks:read",
    "projects:read",
    "knowledge:read",
    "files:read",
  ],
  "/api/library": ["knowledge:read"],
  "/api/library/search": ["knowledge:read"],
  "/api/library/revisions": ["knowledge:read"],
  "/api/document/body": ["knowledge:read"],
  "/api/document/note-backlinks": ["knowledge:read"],
  "/api/notes/search": ["knowledge:read"],
  "/api/revisions": ["knowledge:read"],
  "/api/library/asset": ["knowledge:read", "files:content"],
  "/api/projects/file": ["projects:read", "files:content"],
  "/api/projects/activity": ["projects:read"],
  "/api/library/save": ["knowledge:write"],
  "/api/library/delete": ["knowledge:write"],
  "/api/library/upload": ["knowledge:write", "files:write"],
  "/api/library/upload-chunk": ["knowledge:write", "files:write"],
  "/api/note/save": ["knowledge:write"],
  "/api/note/delete": ["knowledge:write"],
  "/api/link/create": ["knowledge:write"],
  "/api/link/delete": ["knowledge:write"],
  "/api/work/create": ["tasks:write", "projects:write"],
  "/api/work/update": ["tasks:write", "projects:write"],
  "/api/work/delete": ["tasks:write", "projects:write"],
  "/api/edge/create": ["tasks:write"],
  "/api/edge/delete": ["tasks:write"],
  "/api/organize": ["tasks:write", "projects:write", "knowledge:write"],
  "/api/projects/document": ["projects:write", "knowledge:write"],
  "/api/projects/link": ["projects:write", "knowledge:write"],
  "/api/projects/delete": ["projects:write", "knowledge:write"],
  "/api/projects/upload": ["projects:write", "files:write"],
  "/api/files/metadata": ["files:read"],
  "/api/files/bytes": ["files:read", "files:content"],
  "/api/files/extraction": ["files:read", "files:content"],
  "/api/files/binary/status": ["files:read"],
  "/api/mcp": ["capabilities:execute"],
};

export function requireCredentialGrants(
  credential: ApiCredential,
  required: readonly ApiScope[] | undefined,
) {
  if (credential.grants === undefined) return;
  if (!required) throw new DomainError("FORBIDDEN");
  requireApiGrants(credential.grants, required);
}
