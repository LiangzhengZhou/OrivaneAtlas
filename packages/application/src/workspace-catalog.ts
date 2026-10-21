export interface WorkspaceCatalogEntry {
  readonly id: string;
  readonly databaseName: string;
  readonly title: string;
  readonly remote?: {
    readonly serverOrigin: string;
    readonly workspaceId: string;
    readonly principalId: string;
  };
}

/** Installation-local metadata, never credentials or remote authorization. */
export interface WorkspaceCatalog {
  active(): Promise<WorkspaceCatalogEntry>;
  list(): Promise<readonly WorkspaceCatalogEntry[]>;
  reserveRemote(entry: WorkspaceCatalogEntry): Promise<WorkspaceCatalogEntry>;
  select(id: string, expectedActiveDatabase: string): Promise<void>;
  close(): void;
}

export const defaultWorkspaceDatabase = "orivane-atlas.local-workspace";
export const defaultWorkspaceEntry: WorkspaceCatalogEntry = {
  id: "default",
  databaseName: defaultWorkspaceDatabase,
  title: "Local workspace",
};

export function requireWorkspaceCatalogEntry(
  input: WorkspaceCatalogEntry,
): WorkspaceCatalogEntry {
  const entry = structuredClone(input);
  if (
    !entry ||
    typeof entry.id !== "string" ||
    !entry.id ||
    typeof entry.title !== "string" ||
    !entry.title ||
    Object.keys(entry).some(
      (key) => !["id", "databaseName", "title", "remote"].includes(key),
    ) ||
    entry.title.length > 240 ||
    (entry.id === "default"
      ? entry.databaseName !== defaultWorkspaceDatabase || !!entry.remote
      : !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          entry.id,
        ) || entry.databaseName !== `${defaultWorkspaceDatabase}.${entry.id}`)
  )
    throw new Error("MALFORMED_WORKSPACE_CATALOG");
  if (entry.remote) {
    const remote = entry.remote;
    if (
      Object.keys(remote).some(
        (key) => !["serverOrigin", "workspaceId", "principalId"].includes(key),
      )
    )
      throw new Error("MALFORMED_WORKSPACE_CATALOG");
    let origin: URL;
    try {
      origin = new URL(remote.serverOrigin);
    } catch {
      throw new Error("MALFORMED_WORKSPACE_CATALOG");
    }
    if (
      !["http:", "https:"].includes(origin.protocol) ||
      origin.origin !== remote.serverOrigin ||
      origin.username ||
      origin.password ||
      typeof remote.workspaceId !== "string" ||
      !remote.workspaceId ||
      typeof remote.principalId !== "string" ||
      !remote.principalId ||
      remote.workspaceId.length > 240 ||
      remote.principalId.length > 240
    )
      throw new Error("MALFORMED_WORKSPACE_CATALOG");
  }
  return entry;
}
