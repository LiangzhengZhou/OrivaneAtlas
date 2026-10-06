import type { Reminder } from "@arclattice/domain";
import type {
  DocumentWikiLink,
  KnowledgeLink,
  Organization,
  ProjectCategory,
  ProjectMaterial,
  WorkflowRecord,
  WorkSnapshot,
} from "./index";
import type { LibraryEntry } from "./library";
import type { Note } from "./notebook";
import type { WorkspaceChanges } from "./workspace-changes";

export type BodyManifest<T extends Note | LibraryEntry> = Omit<T, "bodyMd"> & {
  bodyState: "UNLOADED";
  bodyMd?: never;
  bodyCharacterCount: number;
};
export type WorkspaceNote = Note | BodyManifest<Note>;
export type WorkspaceLibraryEntry = LibraryEntry | BodyManifest<LibraryEntry>;
export function bodyLoaded<T extends Note | LibraryEntry>(
  entry: T | BodyManifest<T>,
): entry is T {
  return typeof entry.bodyMd === "string";
}

export interface WorkspaceManifest {
  schemaVersion: 1;
  cursor: number;
  epoch: string;
  notes: BodyManifest<Note>[];
  library: BodyManifest<LibraryEntry>[];
}
export interface WorkspaceBootstrap extends WorkspaceManifest {
  workspace: WorkSnapshot & {
    projectMaterials: ProjectMaterial[];
    organization: Organization[];
    links: KnowledgeLink[];
    categories?: ProjectCategory[];
    workflows?: WorkflowRecord[];
    reminders?: Reminder[];
    wikiLinks?: DocumentWikiLink[];
  };
}

/** An unloaded body has no Markdown property; it can never masquerade as empty. */
export function bodyManifest<T extends Note | LibraryEntry>(
  entry: T,
): BodyManifest<T> {
  const { bodyMd: _body, ...metadata } = entry;
  return {
    ...metadata,
    bodyState: "UNLOADED",
    bodyCharacterCount: countCharacters(_body),
  };
}
export function bodyCharacterCount(
  entry: WorkspaceNote | WorkspaceLibraryEntry,
): number {
  return entry.bodyMd === undefined
    ? entry.bodyCharacterCount
    : countCharacters(entry.bodyMd);
}
function countCharacters(text: string): number {
  return (
    text.length - (text.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g)?.length ?? 0)
  );
}

export function metadataWorkspaceChanges(
  changes: WorkspaceChanges,
): WorkspaceChanges {
  const collections = { ...changes.collections };
  for (const name of ["notes", "library"]) {
    const collection = collections[name];
    if (!collection) continue;
    collections[name] = {
      ...collection,
      upserts: collection.upserts.map((entry) => {
        if (
          !entry ||
          typeof entry !== "object" ||
          !("bodyMd" in entry) ||
          typeof entry.bodyMd !== "string"
        )
          throw new Error("INVALID_SYNC_BODY");
        const { bodyMd, ...metadata } = entry;
        return {
          ...metadata,
          bodyState: "UNLOADED",
          bodyCharacterCount: countCharacters(bodyMd),
        };
      }),
    };
  }
  return { ...changes, collections };
}
export function workspaceManifest(
  cursor: number,
  epoch: string,
  notes: WorkspaceNote[],
  library: WorkspaceLibraryEntry[],
): WorkspaceManifest {
  return {
    schemaVersion: 1,
    cursor,
    epoch,
    notes: notes.map((entry) =>
      bodyLoaded(entry) ? bodyManifest(entry) : entry,
    ),
    library: library.map((entry) =>
      bodyLoaded(entry) ? bodyManifest(entry) : entry,
    ),
  };
}
