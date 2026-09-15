import type {
  Account,
  ActivityEvent,
  AgentRun,
  ApiCredential,
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

const localeKey = "arclattice.ui.locale";
const serverOriginKey = "orivane.atlas.server-origin";
function initialServerOrigin() {
  try {
    const saved = localStorage.getItem(serverOriginKey)?.trim();
    if (saved) return new URL(saved).origin;
  } catch {}
  return location.protocol === "http:" || location.protocol === "https:"
    ? location.origin
    : "";
}
function normalizeServerOrigin(value: string) {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1"))
    throw new Error("HTTPS server origin required");
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password)
    throw new Error("Exact server origin required");
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
  notes: Note[];
  links: KnowledgeLink[];
  library: LibraryEntry[];
  organization: Organization[];
}
export async function bootstrap() {
  const i18n = await createI18n(
    resolveLocale(readPreference(), navigator.language),
  );
  document.documentElement.lang = i18n.resolvedLanguage ?? "en-US";
  let csrf = "";
  let serverOrigin = initialServerOrigin();
  // Retain the SAME key for an uncertain network retry. Never auto-repeat with a new key.
  const pending = new Map<string, string>();
  async function request<T>(path: string, value?: unknown): Promise<T> {
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
    const response = await fetch(serverOrigin + path, {
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
      signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json();
    if (response.status < 500) pending.delete(signature);
    if (!response.ok)
      throw new DomainError((data.error ?? "UNAVAILABLE") as ErrorCode);
    return data as T;
  }
  let account: Account | null = null;
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
    csrf = value.csrf;
    account = value.account;
    cursor = "";
    current = null;
    return value.context;
  }
  let cursor = "";
  let current: Snapshot | null = null;
  let context: ActorContext | null = null;
  let unavailable = false;
  if (serverOrigin) {
    try {
      context = await session();
    } catch (error) {
      unavailable = !(
        error instanceof DomainError && String(error.code) === "UNAUTHORIZED"
      );
    }
  }
  const service: Pick<
    WorkService,
    "snapshot" | "create" | "update" | "setDeleted" | "addEdge" | "removeEdge"
  > = {
    snapshot: () => request<Snapshot>("/api/snapshot"),
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
    const job = syncQueue.then(async () => {
      const data = await request<{ cursor: string; snapshot: Snapshot | null }>(
        "/api/sync?cursor=" + encodeURIComponent(cursor),
      );
      if (data.snapshot) current = data.snapshot;
      if (!current) throw new Error("Invalid sync response");
      cursor = data.cursor;
      return current;
    });
    syncQueue = job.catch(() => undefined);
    return job;
  }
  return {
    i18n,
    context,
    unavailable,
    get serverOrigin() {
      return serverOrigin;
    },
    setServerOrigin(value: string) {
      serverOrigin = normalizeServerOrigin(value);
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
      return Promise.resolve();
    },
    session,
    get account() {
      return account;
    },
    register: (username: string, password: string) =>
      request("/api/register", { username, password }),
    claim: (username: string, password: string) =>
      request<Account>("/api/account/claim", { username, password }),
    changePassword: (current: string, password: string) =>
      request("/api/account/password", { current, password }),
    admin: () =>
      request<{ accounts: Account[]; databaseBytes: number }>("/api/admin"),
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
    saveLibrary: (id: string | null, version: number, input: LibraryInput) =>
      request<LibraryEntry>("/api/library/save", { id, version, input }),
    deleteLibrary: (id: string, version: number, deleted: boolean) =>
      request<LibraryEntry>("/api/library/delete", { id, version, deleted }),
    libraryRevisions: (id: string) =>
      request<LibraryEntry[]>(
        "/api/library/revisions?id=" + encodeURIComponent(id),
      ),
    async uploadImage(spaceId: string, file: File) {
      if (
        file.size > 500000 ||
        !["image/png", "image/jpeg", "image/webp"].includes(file.type)
      )
        throw new DomainError("VALIDATION_ERROR");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      return request<{ id: string; url: string }>("/api/library/upload", {
        spaceId,
        name: file.name,
        mime: file.type,
        base64: btoa(binary),
      });
    },
    service,
    snapshot: sync,
    providers: () => request<PersonalModelSummary[]>("/api/ai/providers"),
    saveProvider: (version: number, input: PersonalModelInput) =>
      request<PersonalModelSummary>("/api/ai/providers/save", {
        version,
        input,
      }),
    removeProvider: (scope: string, version: number) =>
      request("/api/ai/providers/remove", { scope, version }),
    ai: (scope = "personal") =>
      request<{ route: ModelRoute | null; runs: AgentRun[] }>(
        "/api/ai?scope=" + encodeURIComponent(scope),
      ),
    propose: (
      prompt: string,
      scope = "personal",
      sources: { kind: EntityRef["kind"]; id: string; version: number }[] = [],
    ) => request<AgentRun>("/api/ai/propose", { prompt, scope, sources }),
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
      const response = await fetch(serverOrigin + "/api/backup", {
        method: "POST",
        credentials: "same-origin",
        body: "{}",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new DomainError((data.error ?? "UNAVAILABLE") as ErrorCode);
      }
      return response.blob();
    },
    revisions: (id: string) =>
      request<Note[]>("/api/revisions?id=" + encodeURIComponent(id)),
    organize: (input: OrganizeInput) =>
      request<{ changed: number }>("/api/organize", input),
    saveNote: (id: string | null, version: number, input: NoteInput) =>
      request<Note>("/api/note/save", { id, version, input }),
    deleteNote: (id: string, version: number, deleted: boolean) =>
      request<Note>("/api/note/delete", { id, version, deleted }),
    logout: () => request("/api/logout", {}),
  };
}
export type Runtime = Awaited<ReturnType<typeof bootstrap>>;
