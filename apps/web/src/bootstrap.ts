import type {
  Account,
  AccountSession,
  ActivityEvent,
  AgentRun,
  ApiCredential,
  AppUpdateProgress,
  AppUpdates,
  CategoryService,
  EntityRef,
  KnowledgeLink,
  LibraryEntry,
  LibraryInput,
  ModelRoute,
  Note,
  NoteInput,
  Organization,
  OrganizeInput,
  PersonalModelInput,
  PersonalModelSummary,
  ProjectActivity,
  ProjectCategory,
  ProjectMaterial,
  WorkflowRecord,
  WorkflowService,
  WorkService,
  WorkSnapshot,
} from "@arclattice/application";
import {
  type ActorContext,
  DomainError,
  type ErrorCode,
} from "@arclattice/domain";
import {
  createI18n,
  type LocalePreference,
  resolveLocale,
} from "@arclattice/i18n";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

const localeKey = "arclattice.ui.locale";
const serverOriginKey = "orivane.atlas.server-origin";
const savedAccountsKey = "orivane.atlas.saved-accounts";
export interface SavedAccount {
  id: string;
  serverUrl: string;
  userId: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  credentialReference: string;
  lastWorkspaceId?: string;
  lastUsedAt?: string;
}
function readSavedAccounts(): SavedAccount[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(savedAccountsKey) ?? "[]",
    );
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is SavedAccount => {
        if (
          !item ||
          typeof item !== "object" ||
          typeof item.id !== "string" ||
          typeof item.userId !== "string" ||
          typeof item.displayName !== "string" ||
          typeof item.serverUrl !== "string"
        )
          return false;
        try {
          return (
            normalizeServerOrigin(item.serverUrl) === item.serverUrl &&
            item.id === item.serverUrl + "|" + item.userId
          );
        } catch {
          return false;
        }
      })
      .slice(0, 20);
  } catch {
    return [];
  }
}
function saveAccountMetadata(account: Account, origin: string) {
  const id = origin + "|" + account.id;
  const current = readSavedAccounts().filter((item) => item.id !== id);
  current.unshift({
    id,
    serverUrl: origin,
    userId: account.id,
    displayName: account.username,
    credentialReference: "web-cookie:" + id,
    lastUsedAt: new Date().toISOString(),
  });
  try {
    localStorage.setItem(
      savedAccountsKey,
      JSON.stringify(current.slice(0, 20)),
    );
  } catch {
    /* metadata only */
  }
}
function initialServerOrigin() {
  if (!isTauri()) return location.origin;
  try {
    const saved = localStorage.getItem(serverOriginKey)?.trim();
    if (saved) return new URL(saved).origin;
  } catch {}
  return !isTauri() &&
    (location.protocol === "http:" || location.protocol === "https:")
    ? location.origin
    : "";
}
function normalizeServerOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("INVALID_SERVER");
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && url.hostname === "127.0.0.1")
  )
    throw new Error("INVALID_SERVER");
  if (
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("INVALID_SERVER");
  return url.origin;
}
export function readPreference(): LocalePreference {
  try {
    const value = localStorage.getItem(localeKey);
    return value === "zh-CN" || value === "en-US" ? value : "system";
  } catch {
    return "system";
  }
}
export function savePreference(value: LocalePreference) {
  try {
    localStorage.setItem(localeKey, value);
  } catch {
    /* Device preference only. */
  }
}
export interface Snapshot extends WorkSnapshot {
  projectMaterials: ProjectMaterial[];
  categories?: ProjectCategory[];
  workflows?: WorkflowRecord[];
  notes: Note[];
  links: KnowledgeLink[];
  library: LibraryEntry[];
  organization: Organization[];
}
function normalizeSnapshot(snapshot: Snapshot): Snapshot {
  return { ...snapshot, projectMaterials: snapshot.projectMaterials ?? [] };
}
export async function bootstrap() {
  const i18n = await createI18n(
    resolveLocale(readPreference(), navigator.language),
  );
  document.documentElement.lang = i18n.resolvedLanguage ?? "en-US";
  let csrf = "";
  let serverOrigin = initialServerOrigin();
  const native = isTauri();
  let nativeAccounts: SavedAccount[] = [];
  async function refreshSavedAccounts() {
    if (native) {
      const entries = await invoke<SavedAccount[]>("saved_accounts");
      nativeAccounts = Array.isArray(entries) ? entries : [];
    }
    return native ? nativeAccounts : readSavedAccounts();
  }
  let serverGeneration = 0;
  let requestController = new AbortController();
  async function transport(path: string, payload?: string, key = "") {
    const origin = serverOrigin;
    const generation = serverGeneration;
    let response: Response;
    try {
      if (native) {
        const reply = await invoke<{
          status: number;
          contentType: string;
          body: string;
        }>("server_request", {
          origin,
          path,
          payload: payload ?? null,
          csrf,
          idempotencyKey: key,
        });
        const bytes = Uint8Array.from(atob(reply.body), (c) => c.charCodeAt(0));
        response = new Response(bytes, {
          status: reply.status,
          headers: { "Content-Type": reply.contentType },
        });
      } else {
        response = await fetch(origin + path, {
          credentials: "same-origin",
          ...(payload === undefined
            ? {}
            : {
                method: "POST",
                body: payload,
                headers: {
                  "Content-Type": "application/json",
                  "X-CSRF-Token": csrf,
                  "Idempotency-Key": key,
                },
              }),
          signal: (() => {
            const timeout = AbortSignal.timeout(
              path === "/api/session"
                ? 8_000
                : path === "/api/backup"
                  ? 60_000
                  : 15_000,
            );
            return AbortSignal.any([requestController.signal, timeout]);
          })(),
        });
      }
    } catch (error) {
      if (
        error instanceof Error &&
        ["TimeoutError", "AbortError"].includes(error.name)
      )
        throw new Error("LOGIN_TIMEOUT");
      if (typeof error === "string") throw new Error(error);
      throw new Error("NETWORK_ERROR");
    }
    if (generation !== serverGeneration) throw new Error("SERVER_CHANGED");
    return response;
  }
  // Retain the SAME key for an uncertain network retry. Never auto-repeat with a new key.
  const pending = new Map<string, string>();
  async function request<T>(path: string, value?: unknown): Promise<T> {
    const generation = serverGeneration;
    const payload = value === undefined ? undefined : JSON.stringify(value);
    const signature = path + "\n" + payload;
    const key = pending.get(signature) ?? crypto.randomUUID();
    if (
      payload !== undefined &&
      ![
        "/api/session",
        "/api/register",
        "/api/account/password",
        "/api/account/claim",
        "/api/ai/providers/save",
      ].includes(path)
    )
      pending.set(signature, key);
    if (!serverOrigin) throw new DomainError("VALIDATION_ERROR");
    const response = await transport(path, payload, key);
    let data: { error?: string };
    try {
      data = await response.json();
    } catch (error) {
      if (
        error instanceof Error &&
        ["TimeoutError", "AbortError"].includes(error.name)
      )
        throw new Error("LOGIN_TIMEOUT");
      throw new Error("INVALID_RESPONSE");
    }
    if (generation !== serverGeneration) throw new Error("SERVER_CHANGED");
    if (!data || typeof data !== "object") throw new Error("INVALID_RESPONSE");
    if (response.status < 500) pending.delete(signature);
    if (!response.ok)
      throw new DomainError(
        ((
          {
            401: "UNAUTHORIZED",
            403: "FORBIDDEN",
            429: "RATE_LIMITED",
          } as Record<number, string>
        )[response.status] ??
          data.error ??
          "UNAVAILABLE") as ErrorCode,
      );
    return data as T;
  }
  let account: Account | null = null;
  let logoutWarning = false;
  async function session(
    credentials?: string | { username: string; password: string },
    expectedContext?: ActorContext,
  ) {
    const value = await request<{
      context: ActorContext;
      csrf: string;
      account: Account | null;
    }>(
      "/api/session",
      credentials === undefined
        ? undefined
        : {
            ...(typeof credentials === "string"
              ? { secret: credentials }
              : credentials),
            ...(expectedContext ? { expectedContext } : {}),
          },
    );
    if (
      !value.context ||
      typeof value.context.workspaceId !== "string" ||
      typeof value.context.principalId !== "string" ||
      typeof value.csrf !== "string" ||
      !value.csrf
    )
      throw new Error("INVALID_RESPONSE");
    resetIdentity();
    csrf = value.csrf;
    account = value.account;
    context = value.context;
    const identityGeneration = serverGeneration;
    if (native) await refreshSavedAccounts();
    else if (account) saveAccountMetadata(account, serverOrigin);
    if (identityGeneration !== serverGeneration)
      throw new Error("SERVER_CHANGED");
    cursor = "";
    current = null;
    return value.context;
  }
  let cursor = "";
  let current: Snapshot | null = null;
  let context: ActorContext | null = null;
  let unavailable = false;
  function resetIdentity() {
    serverGeneration += 1;
    requestController.abort();
    requestController = new AbortController();
    pending.clear();
    csrf = "";
    account = null;
    context = null;
    cursor = "";
    current = null;
  }
  async function removeCurrentCredential() {
    if (!native || !account) return;
    const selected = nativeAccounts.find(
      (entry) =>
        entry.serverUrl === serverOrigin && entry.userId === account?.id,
    );
    if (selected)
      await invoke("forget_account", {
        reference: selected.credentialReference,
      });
    await refreshSavedAccounts();
  }
  if (serverOrigin) {
    try {
      if (native) await invoke("configure_server", { origin: serverOrigin });
      context = await session();
    } catch (error) {
      unavailable = !(
        error instanceof DomainError && String(error.code) === "UNAUTHORIZED"
      );
    }
  }
  if (native) {
    try {
      await refreshSavedAccounts();
    } catch {
      unavailable = true;
    }
  }
  const service: Pick<
    WorkService,
    | "snapshot"
    | "create"
    | "update"
    | "setDeleted"
    | "addEdge"
    | "removeEdge"
    | "setCalendarSettings"
  > = {
    snapshot: async () =>
      normalizeSnapshot(await request<Snapshot>("/api/snapshot")),
    setCalendarSettings: async (_context, version, timezone) =>
      request("/api/work/calendar-settings", { version, timezone }),
    create: (_actor, input) => request("/api/work/create", input),
    update: (_actor, id, version, input) =>
      request("/api/work/update", { id, version, input }),
    setDeleted: (_actor, id, version, deleted) =>
      request("/api/work/delete", { id, version, deleted }),
    addEdge: (_actor, fromId, toId, type = "BLOCKS") =>
      request("/api/edge/create", { fromId, toId, type }),
    removeEdge: (_actor, id) => request("/api/edge/delete", { id }),
  };
  let syncQueue: Promise<unknown> = Promise.resolve();
  function sync(): Promise<Snapshot> {
    const generation = serverGeneration;
    const job = syncQueue.then(async () => {
      if (generation !== serverGeneration) throw new Error("SERVER_CHANGED");
      const data = await request<{ cursor: string; snapshot: Snapshot | null }>(
        "/api/sync?cursor=" + encodeURIComponent(cursor),
      );
      if (data.snapshot) current = normalizeSnapshot(data.snapshot);
      if (!current) throw new Error("Invalid sync response");
      cursor = data.cursor;
      return current;
    });
    syncQueue = job.catch(() => undefined);
    return job;
  }
  return {
    i18n,
    native,
    updates: {
      available: isTauri(),
      check: () => invoke("check_app_update"),
      install: async (version, onProgress) => {
        const progress = new Channel<AppUpdateProgress>();
        progress.onmessage = onProgress;
        await invoke("install_app_update", { version, progress });
      },
    } satisfies AppUpdates,
    get context() {
      return context;
    },
    set context(value: ActorContext | null) {
      context = value;
    },
    unavailable,
    get logoutWarning() {
      return logoutWarning;
    },
    get serverOrigin() {
      return serverOrigin;
    },
    async setServerOrigin(value: string) {
      const normalized = normalizeServerOrigin(value);
      if (!native && normalized !== location.origin)
        throw new Error("INVALID_SERVER");
      resetIdentity();
      if (native) await invoke("configure_server", { origin: normalized });
      serverOrigin = normalized;
      try {
        localStorage.setItem(serverOriginKey, serverOrigin);
      } catch {
        // Native WebViews may deny storage; the current session can still use the value.
      }
      csrf = "";
      context = null;
      account = null;
      cursor = "";
      current = null;
    },
    session,
    get account() {
      return account;
    },
    savedAccounts: () => (native ? nativeAccounts : readSavedAccounts()),
    refreshSavedAccounts,
    async beginAccountSwitch() {
      resetIdentity();
      if (native) await invoke("detach_account");
    },
    async switchAccount(id: string) {
      if (!native) throw new Error("UNAUTHORIZED");
      const selected = nativeAccounts.find((entry) => entry.id === id);
      if (!selected) throw new Error("UNAUTHORIZED");
      resetIdentity();
      const generation = serverGeneration;
      try {
        await invoke("select_account", {
          reference: selected.credentialReference,
        });
        if (generation !== serverGeneration) throw new Error("SERVER_CHANGED");
        serverOrigin = normalizeServerOrigin(selected.serverUrl);
        const identity = await session();
        if (account?.id !== selected.userId) {
          resetIdentity();
          await invoke("detach_account");
          throw new Error("ACCOUNT_MISMATCH");
        }
        try {
          localStorage.setItem(serverOriginKey, serverOrigin);
        } catch {}
        return identity;
      } catch (error) {
        if (generation === serverGeneration) resetIdentity();
        await refreshSavedAccounts();
        throw error;
      }
    },
    forgetAccount: async (id: string) => {
      if (native) {
        const selected = nativeAccounts.find((entry) => entry.id === id);
        if (!selected) return;
        await invoke("forget_account", {
          reference: selected.credentialReference,
        });
        if (
          selected.serverUrl === serverOrigin &&
          selected.userId === account?.id
        )
          resetIdentity();
        await refreshSavedAccounts();
        return;
      }
      localStorage.setItem(
        savedAccountsKey,
        JSON.stringify(readSavedAccounts().filter((item) => item.id !== id)),
      );
    },
    sessions: () => request<AccountSession[]>("/api/account/sessions"),
    revokeSession: async (
      target: { id: string; current: boolean } | { all: true },
    ) => {
      await request(
        "/api/account/sessions/revoke",
        "all" in target ? { all: true } : { id: target.id },
      );
      if ("all" in target || target.current) {
        try {
          await removeCurrentCredential();
        } finally {
          resetIdentity();
        }
      }
    },
    register: (username: string, password: string) =>
      request("/api/register", { username, password }),
    claim: (username: string, password: string) =>
      request<Account>("/api/account/claim", { username, password }),
    changePassword: async (current: string, password: string) => {
      await request("/api/account/password", { current, password });
      try {
        await removeCurrentCredential();
      } finally {
        resetIdentity();
      }
    },
    admin: () =>
      request<{
        accounts: Account[];
        databaseBytes: number;
        sessionLifetimePolicy: string;
      }>("/api/admin"),
    setSessionLifetimePolicy: (policy: string) =>
      request("/api/admin/session-policy", { policy }),
    accountStatus: (
      id: string,
      version: number,
      status: "ACTIVE" | "DISABLED",
    ) => request("/api/admin/status", { id, version, status }),
    tokens: () => request<ApiCredential[]>("/api/tokens"),
    issueToken: (
      name: string,
      scope: ApiCredential["scope"],
      days: 30 | 90 | 365 | null = 30,
    ) =>
      request<ApiCredential & { secret: string }>("/api/tokens/create", {
        name,
        scope,
        days,
      }),
    revokeToken: (id: string) => request("/api/tokens/revoke", { id }),
    library: () => request<LibraryEntry[]>("/api/library"),
    projectDocument: (input: {
      projectId: string;
      title: string;
      bodyMd: string;
    }) => request<LibraryEntry>("/api/projects/document", input),
    projectUpload: (input: {
      projectId: string;
      name: string;
      mime: string;
      base64: string;
    }) => request<ProjectMaterial>("/api/projects/upload", input),
    projectDelete: (id: string, version: number, deleted: boolean) =>
      request("/api/projects/delete", { id, version, deleted }),
    projectActivity: (projectId: string) =>
      request<ProjectActivity[]>(
        "/api/projects/activity?projectId=" + encodeURIComponent(projectId),
      ),
    projectFile: (id: string) =>
      request<{ material: ProjectMaterial; base64: string }>(
        "/api/projects/file?id=" + encodeURIComponent(id),
      ),
    saveLibrary: (id: string | null, version: number, input: LibraryInput) =>
      request<LibraryEntry>("/api/library/save", { id, version, input }),
    deleteLibrary: (id: string, version: number, deleted: boolean) =>
      request<LibraryEntry>("/api/library/delete", { id, version, deleted }),
    libraryRevisions: (id: string) =>
      request<LibraryEntry[]>(
        "/api/library/revisions?id=" + encodeURIComponent(id),
      ),
    async uploadImage(spaceId: string | null, file: File) {
      if (
        file.size === 0 ||
        !["image/png", "image/jpeg", "image/webp"].includes(file.type)
      )
        throw new DomainError("VALIDATION_ERROR");
      const uploadId = crypto.randomUUID();
      const origin = serverOrigin,
        session = csrf;
      let result: { id: string; url: string | null } | undefined;
      for (
        let offset = 0, index = 0;
        offset < file.size;
        offset += 262144, index++
      ) {
        const bytes = new Uint8Array(
          await file.slice(offset, offset + 262144).arrayBuffer(),
        );
        let binary = "";
        for (const b of bytes) binary += String.fromCharCode(b);
        if (serverOrigin !== origin || csrf !== session)
          throw new DomainError("FORBIDDEN");
        result = await request<{ id: string; url: string | null }>(
          "/api/library/upload-chunk",
          {
            uploadId,
            spaceId,
            name: file.name,
            mime: file.type,
            base64: btoa(binary),
            index,
            final: offset + bytes.length === file.size,
          },
        );
      }
      if (!result?.url || serverOrigin !== origin || csrf !== session)
        throw new DomainError("FORBIDDEN");
      return { id: result.id, url: result.url };
    },
    service,
    snapshot: sync,
    providers: () => request<PersonalModelSummary[]>("/api/ai/providers"),
    saveProvider: (version: number, input: PersonalModelInput) =>
      request<PersonalModelSummary>("/api/ai/providers/save", {
        version,
        input,
      }),
    removeProvider: (scope: string, version: number, profileId = "default") =>
      request("/api/ai/providers/remove", { scope, version, profileId }),
    ai: (scope = "personal", profileId = "default") =>
      request<{
        route: ModelRoute | null;
        routes: ModelRoute[];
        runs: AgentRun[];
      }>(
        "/api/ai?scope=" +
          encodeURIComponent(scope) +
          "&profileId=" +
          encodeURIComponent(profileId),
      ),
    propose: (
      prompt: string,
      scope = "personal",
      sources: { kind: EntityRef["kind"]; id: string; version: number }[] = [],
      profileId = "default",
    ) =>
      request<AgentRun>("/api/ai/propose", {
        prompt,
        scope,
        sources,
        profileId,
      }),
    applyAi: (id: string, version: number, indices: number[]) =>
      request("/api/ai/apply", { id, version, indices }),
    decide: (id: string, version: number, approve: boolean) =>
      request<AgentRun>("/api/ai/decide", { id, version, approve }),
    link: (
      from: EntityRef,
      to: EntityRef,
      relation: KnowledgeLink["relation"],
    ) => request<KnowledgeLink>("/api/link/create", { from, to, relation }),
    unlink: (id: string, version: number) =>
      request("/api/link/delete", { id, version }),
    activity: () => request<ActivityEvent[]>("/api/activity"),
    async backup() {
      const response = await transport("/api/backup", "{}");
      if (!response.ok) {
        const data = await response.json();
        throw new DomainError((data.error ?? "UNAVAILABLE") as ErrorCode);
      }
      return response.blob();
    },
    async loadImage(path: string) {
      if (!/^\/api\/library\/asset\?id=[a-zA-Z0-9-]+$/.test(path))
        throw new Error("INVALID_RESPONSE");
      const response = await transport(path);
      if (
        !response.ok ||
        !["image/png", "image/jpeg", "image/webp"].includes(
          response.headers.get("Content-Type")?.split(";")[0] ?? "",
        )
      )
        throw new Error("INVALID_RESPONSE");
      return response.blob();
    },
    revisions: (id: string) =>
      request<Note[]>("/api/revisions?id=" + encodeURIComponent(id)),
    organize: (input: OrganizeInput) =>
      request<{ changed: number }>("/api/organize", input),
    saveCategory: (input: Parameters<CategoryService["save"]>[1]) =>
      request<ProjectCategory>("/api/categories/save", input),
    previewPlan: (projectId: string | null, manifest: unknown) =>
      request<WorkflowRecord>("/api/plans/preview", { projectId, manifest }),
    publishPlan: (id: string, version: number) =>
      request<WorkflowRecord>("/api/plans/publish", { id, version }),
    saveRecurrence: (input: Parameters<WorkflowService["saveRecurrence"]>[1]) =>
      request<WorkflowRecord>("/api/recurrences/save", input),
    generateRecurrence: (
      id: string,
      version: number,
      from: string,
      to: string,
    ) =>
      request<WorkflowRecord[]>("/api/recurrences/generate", {
        id,
        version,
        from,
        to,
      }),
    backfillOccurrence: (
      id: string,
      version: number,
      completedAt: string | null,
    ) =>
      request<WorkflowRecord>("/api/recurrences/backfill", {
        id,
        version,
        completedAt,
      }),
    saveNote: (id: string | null, version: number, input: NoteInput) =>
      request<Note>("/api/note/save", { id, version, input }),
    deleteNote: (id: string, version: number, deleted: boolean) =>
      request<Note>("/api/note/delete", { id, version, deleted }),
    logout: async () => {
      logoutWarning = false;
      try {
        await request("/api/logout", {});
      } catch (error) {
        // Native logout erases the secure local credential before networking.
        // Never leave an apparently signed-in UI after that irreversible boundary.
        if (!native) throw error;
        logoutWarning = true;
      }
      resetIdentity();
      if (native) {
        try {
          await refreshSavedAccounts();
        } catch {
          nativeAccounts = [];
        }
      }
    },
  };
}
export type Runtime = Awaited<ReturnType<typeof bootstrap>>;
