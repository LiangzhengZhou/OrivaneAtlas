import type {
  Account,
  AccountSession,
  AgentRun,
  AgentSession,
  AiContextItem,
  ApiCredential,
  AppUpdateProgress,
  AppUpdates,
  CategoryService,
  DocumentWikiLink,
  EntityRef,
  KnowledgeLink,
  LibraryEntry,
  LibraryInput,
  LocalSyncState,
  LocalWorkSyncTransport,
  ManualOrderService,
  ModelEvent,
  ModelRoute,
  Note,
  NoteInput,
  NotificationDeliveryPort,
  NotificationPermission,
  NotificationPort,
  Organization,
  OrganizeInput,
  PersonalModelInput,
  PersonalModelSummary,
  ProjectCategory,
  ProjectMaterial,
  WorkflowRecord,
  WorkflowService,
  WorkService,
  WorkSnapshot,
} from "@arclattice/application";
import {
  applyWorkspaceChanges,
  bindingManifestRecords,
  continueWorkspaceImport,
  createWorkspaceImportFork,
  createWorkspaceImportJournal,
  EditorProposalService,
  equalLocalJson,
  FileExtractionCoordinator,
  FileExtractionService,
  FileProcessingService,
  hydrateLocalConflictBody,
  initializeLocalEntityMemoHistory,
  LocalBodyUnavailableError,
  LocalRuntime,
  LocalWorkSyncCoordinator,
  LocalWorkspace,
  listLocalWorkConflictReviews,
  localDto,
  localObject,
  MemoProposalService,
  materializeWorkspaceMemoCopies,
  mutationReceiptDigest,
  NotificationCenterService,
  OpenAccountWorkspaceService,
  type ProviderFailure,
  ProviderRequestError,
  planLocalCommands,
  planWorkspaceImportSteps,
  planWorkspaceMergeSelection,
  prepareLocalDeletedKnowledge,
  prepareLocalKnowledgeHydration,
  prepareLocalPendingWorkRebase,
  prepareLocalPurgedMemo,
  prepareLocalWorkPull,
  prepareWorkspaceMergeBackup,
  preserveReplicaBootstrapBackup,
  previewWorkspaceBinding,
  readLegacyImage,
  readWorkspacePrivateMemoReview,
  recoverLocalWorkReceipts,
  recoverWorkspaceImportReceipts,
  remoteUnhydratedSearchIds,
  requireCanonicalFile,
  requireRasterImage,
  resolveWorkspaceImportSteps,
  reviewWorkspaceImportSuffix,
  syncVerifiedLocalFileBinary,
  type WorkspaceChanges,
  workspaceImportResolutionCandidates,
} from "@arclattice/application";
import {
  type ActorContext,
  DomainError,
  type ErrorCode,
} from "@arclattice/domain";
import {
  WorkerFileParser,
  WorkerFileSearchIndex,
} from "@arclattice/file-parsers/browser";
import {
  createI18n,
  type LocalePreference,
  resolveLocale,
} from "@arclattice/i18n";
import {
  deriveEntityMemoId,
  IndexedDbLocalBlobStore,
  IndexedDbLocalStore,
  IndexedDbWorkspaceCatalog,
  IndexedDbWorkspaceImports,
  IndexedDbWorkspaceMergeBackups,
  WorkerMetadataReader,
} from "@arclattice/storage-local";
import {
  indexDocument,
  parseWikiLinks,
  resolveOwnedWikiLinks,
  resolveWikiLinks,
} from "@arclattice/wiki-core";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import {
  ImageLoadError,
  imageLoadFailure,
  imageResponseBlob,
} from "./imageResponse";
import { scopedImageLoader } from "./scoped-image-loader";
import { WorkspaceEventDecoder } from "./utils/workspace-event-decoder";

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
  files?: import("@arclattice/domain").LibraryFile[];
  reminders?: import("@arclattice/domain").Reminder[];
  wikiLinks?: DocumentWikiLink[];
  projectMaterials: ProjectMaterial[];
  categories?: ProjectCategory[];
  workflows?: WorkflowRecord[];
  notes: import("@arclattice/application").WorkspaceNote[];
  links: KnowledgeLink[];
  library: import("@arclattice/application").WorkspaceLibraryEntry[];
  organization: Organization[];
}
function normalizeSnapshot(snapshot: Snapshot): Snapshot {
  return {
    ...snapshot,
    projectMaterials: snapshot.projectMaterials ?? [],
    manualOrders: snapshot.manualOrders ?? [],
  };
}
interface SyncResponse {
  cursor: number;
  epoch: string;
  snapshot: Snapshot | null;
  changes?: WorkspaceChanges;
  hasMore: boolean;
}
export interface ServerProbeResult {
  kind:
    | "OK"
    | "AUTH_REQUIRED"
    | "NETWORK_FAILURE"
    | "TIMEOUT"
    | "SERVER_ERROR"
    | "LOCAL_ONLY";
  latencyMs: number | null;
  status: number | null;
  checkedAt: string;
}
export async function bootstrap() {
  const workspaceCatalog = await IndexedDbWorkspaceCatalog.open();
  const activeWorkspace = await workspaceCatalog.active();
  const localStore = await IndexedDbLocalStore.open(
    activeWorkspace.databaseName,
    indexedDB,
    new WorkerFileSearchIndex(),
    new WorkerMetadataReader(undefined, () => {
      const target = document.activeElement;
      return (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA")
      );
    }),
  );
  const localBlobs = await IndexedDbLocalBlobStore.open(
    activeWorkspace.databaseName,
  );
  const localIdentity = await localStore.identity.ensure({
    schemaVersion: 1,
    workspaceId: crypto.randomUUID(),
    principalId: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
  });
  const localWiki: import("@arclattice/application").LocalWikiIndexer = {
    yieldRead: () => {
      const scheduler = (
        globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } }
      ).scheduler;
      return (
        scheduler?.yield?.() ?? new Promise((resolve) => setTimeout(resolve, 0))
      );
    },
    extract: (id, markdown) => indexDocument(id, markdown, []),
    resolve: resolveOwnedWikiLinks,
  };
  const local = new LocalRuntime(
    new LocalWorkspace(
      localStore.metadata,
      localBlobs,
      localIdentity,
      localWiki,
      {
        now: () => new Date().toISOString(),
        calendarTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      { next: () => crypto.randomUUID() },
    ),
    { forTarget: deriveEntityMemoId, nextChangeId: () => crypto.randomUUID() },
  );
  const i18n = await createI18n(
    resolveLocale(readPreference(), navigator.language),
  );
  const memoProposals = new MemoProposalService(
    async (text) => {
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(text),
      );
      return Array.from(new Uint8Array(hash), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    },
    () => crypto.randomUUID(),
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
  function workspaceRequestScope() {
    const remote = activeWorkspace.remote;
    return remote?.serverOrigin === serverOrigin &&
      (!context || remote.principalId === context.principalId)
      ? remote.workspaceId
      : undefined;
  }
  function workspaceRequestHeaders(): Record<string, string> {
    const workspaceId = workspaceRequestScope();
    return workspaceId ? { "X-Workspace-Id": workspaceId } : {};
  }
  async function transport(
    path: string,
    payload?: string,
    key = "",
    scope?: string,
    workspacePrecondition?: { readonly epoch: string; readonly cursor: number },
  ) {
    const origin = serverOrigin;
    const generation = serverGeneration;
    const workspaceId =
      path === "/api/session" &&
      payload !== undefined &&
      !JSON.parse(payload).expectedContext
        ? undefined
        : (scope ?? workspaceRequestScope());
    let response: Response;
    try {
      if (native && /^\/api\/(?:v1\/)?files\/bytes(?:\?|$)/.test(path)) {
        if (payload !== undefined) throw new Error("INVALID_FILE_METHOD");
        const bytes = await invoke<ArrayBuffer>("server_download_file", {
          origin,
          path,
          workspaceId,
        });
        response = new Response(bytes, {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" },
        });
      } else if (native) {
        const reply = await invoke<{
          status: number;
          contentType: string;
          body: string;
          encoding: "utf8" | "base64";
        }>("server_request", {
          origin,
          path,
          payload: payload ?? null,
          csrf,
          idempotencyKey: key,
          workspaceId,
          workspacePrecondition: workspacePrecondition
            ? JSON.stringify(workspacePrecondition)
            : null,
        });
        const bytes =
          reply.encoding === "utf8"
            ? reply.body
            : Uint8Array.from(atob(reply.body), (c) => c.charCodeAt(0));
        response = new Response(bytes, {
          status: reply.status,
          headers: { "Content-Type": reply.contentType },
        });
      } else {
        response = await fetch(origin + path, {
          credentials: "same-origin",
          headers: workspaceId ? { "X-Workspace-Id": workspaceId } : {},
          ...(payload === undefined
            ? {}
            : {
                method: "POST",
                body: payload,
                headers: {
                  "Content-Type": "application/json",
                  "X-CSRF-Token": csrf,
                  "Idempotency-Key": key,
                  ...(workspacePrecondition
                    ? {
                        "X-Workspace-Precondition": JSON.stringify(
                          workspacePrecondition,
                        ),
                      }
                    : {}),
                  ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
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
  function requireRemoteBindingScope(
    binding: LocalSyncState,
    generation: number,
  ) {
    if (
      generation !== serverGeneration ||
      !context ||
      context.workspaceId !== binding.remoteWorkspaceId ||
      context.principalId !== binding.remotePrincipalId ||
      new URL(serverOrigin).origin !== binding.serverOrigin
    )
      throw new DomainError("FORBIDDEN");
  }
  function localWorkTransport(
    generation: number,
    preparation?: import("@arclattice/application").WorkspaceConnectionPreview,
  ): LocalWorkSyncTransport {
    const assertBinding = (binding: LocalSyncState) => {
      if (!preparation) return requireRemoteBindingScope(binding, generation);
      if (
        generation !== serverGeneration ||
        context?.principalId !== preparation.remotePrincipalId ||
        serverOrigin !== preparation.serverOrigin ||
        binding.remoteWorkspaceId !== preparation.remoteWorkspaceId ||
        binding.remotePrincipalId !== preparation.remotePrincipalId ||
        binding.serverOrigin !== preparation.serverOrigin ||
        binding.epoch !== preparation.epoch
      )
        throw new DomainError("FORBIDDEN");
    };
    const read = async (
      binding: LocalSyncState,
      path: string,
      payload?: string,
      key = "",
      missing = false,
    ): Promise<unknown | null> => {
      assertBinding(binding);
      if (!binding.remoteWorkspaceId) throw new DomainError("FORBIDDEN");
      const response = await transport(
        path,
        payload,
        key,
        binding.remoteWorkspaceId,
      );
      assertBinding(binding);
      if (missing && response.status === 404) return null;
      if (response.status === 409) throw new DomainError("VERSION_CONFLICT");
      if (response.status === 404) throw new DomainError("NOT_FOUND");
      if (!response.ok) throw new Error(`SYNC_REQUEST_${response.status}`);
      const value: unknown = await response.json();
      assertBinding(binding);
      return value;
    };
    return {
      bootstrap: (binding) =>
        read(binding, "/api/bootstrap?relationMode=canonical"),
      readKnowledge: (binding, collection, id) =>
        read(
          binding,
          `/api/document/body?${new URLSearchParams({ id, kind: collection === "notes" ? "NOTE" : "LIBRARY", deleted: "include" })}`,
        ),
      lookup: (binding, commandId, deviceId) =>
        read(
          binding,
          `/api/v1/sync/receipt?commandId=${encodeURIComponent(commandId)}&deviceId=${encodeURIComponent(deviceId)}`,
          undefined,
          "",
          true,
        ),
      pull: (binding) =>
        read(
          binding,
          `/api/v1/sync?after=${binding.cursor}&epoch=${encodeURIComponent(binding.epoch ?? "")}&bodyMode=metadata&relationMode=canonical&privateMemos=include`,
        ),
      pullPrivateMemos: (binding, after) =>
        read(
          binding,
          `/api/v1/sync?after=${after}&epoch=${encodeURIComponent(binding.epoch ?? "")}&bodyMode=metadata&privateMemos=only`,
        ),
      send: (binding, request) =>
        read(
          binding,
          request.path,
          JSON.stringify(request.body),
          request.idempotencyKey,
        ),
    };
  }
  function localFileBinaryTransport(
    generation: number,
    preparation?: Pick<
      import("@arclattice/application").WorkspaceConnectionPreview,
      "remoteWorkspaceId" | "remotePrincipalId" | "serverOrigin" | "epoch"
    >,
  ): import("@arclattice/application").LocalFileBinaryTransport {
    const assertBinding = (binding: LocalSyncState) => {
      if (!preparation) return requireRemoteBindingScope(binding, generation);
      if (
        generation !== serverGeneration ||
        context?.principalId !== preparation.remotePrincipalId ||
        serverOrigin !== preparation.serverOrigin ||
        binding.remoteWorkspaceId !== preparation.remoteWorkspaceId ||
        binding.remotePrincipalId !== preparation.remotePrincipalId ||
        binding.serverOrigin !== preparation.serverOrigin ||
        binding.epoch !== preparation.epoch
      )
        throw new DomainError("FORBIDDEN");
    };
    const json = async (
      binding: LocalSyncState,
      path: string,
      value: unknown,
    ) => {
      assertBinding(binding);
      const response = await transport(
        path,
        JSON.stringify(value),
        "",
        preparation?.remoteWorkspaceId,
      );
      assertBinding(binding);
      if (response.status === 409) throw new DomainError("VERSION_CONFLICT");
      if (!response.ok) throw new Error(`FILE_TRANSFER_${response.status}`);
      const result: unknown = await response.json();
      assertBinding(binding);
      return result;
    };
    return {
      begin: (binding, input) =>
        json(binding, "/api/v1/files/binary/begin", input),
      complete: (binding, contentHash) =>
        json(binding, "/api/v1/files/binary/complete", { contentHash }),
      putChunk: async (binding, hash, index, chunkHash, bytes) => {
        assertBinding(binding);
        const path = `/api/v1/files/binary/chunk?hash=${encodeURIComponent(hash)}&index=${index}`;
        let response: Response;
        if (native) {
          const reply = await invoke<{
            status: number;
            contentType: string;
            body: string;
            encoding: "utf8";
          }>("server_upload_chunk", new Uint8Array(await bytes.arrayBuffer()), {
            headers: {
              "X-Atlas-Origin": serverOrigin,
              "X-Atlas-Path": path,
              "X-Atlas-Chunk-Hash": chunkHash,
              "X-Atlas-CSRF": csrf,
              ...(binding.remoteWorkspaceId
                ? { "X-Atlas-Workspace-Id": binding.remoteWorkspaceId }
                : {}),
            },
          });
          if (reply.encoding !== "utf8")
            throw new Error("INVALID_FILE_TRANSFER_RESPONSE");
          response = new Response(reply.body, {
            status: reply.status,
            headers: { "Content-Type": reply.contentType },
          });
        } else {
          response = await fetch(serverOrigin + path, {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "Content-Type": "application/octet-stream",
              "X-File-Chunk-Hash": chunkHash,
              "X-CSRF-Token": csrf,
              ...(preparation
                ? { "X-Workspace-Id": preparation.remoteWorkspaceId }
                : workspaceRequestHeaders()),
            },
            body: bytes,
            signal: AbortSignal.any([
              requestController.signal,
              AbortSignal.timeout(30000),
            ]),
          });
        }
        assertBinding(binding);
        if (response.status === 409) throw new DomainError("VERSION_CONFLICT");
        if (!response.ok) throw new Error(`FILE_CHUNK_${response.status}`);
        const result: unknown = await response.json();
        assertBinding(binding);
        return result;
      },
    };
  }
  let localCoordinator: LocalWorkSyncCoordinator | null = null;
  let localCoordinatorGeneration = -1;
  // Retain the SAME key for an uncertain network retry. Never auto-repeat with a new key.
  const pending = new Map<string, string>();
  async function request<T>(
    path: string,
    value?: unknown,
    scope?: string,
    idempotencyKey?: string,
    workspacePrecondition?: { readonly epoch: string; readonly cursor: number },
  ): Promise<T> {
    // Local-first shell does not wait for the remote account. Initialize its
    // session only when a remote operation is actually requested; the session
    // request itself must not await its own initialization promise.
    if (path !== "/api/session" && !remoteInitialized) await initialize();
    const generation = serverGeneration;
    const payload = value === undefined ? undefined : JSON.stringify(value);
    const signature =
      (scope ?? workspaceRequestScope() ?? "") +
      "\n" +
      path +
      "\n" +
      payload +
      "\n" +
      JSON.stringify(workspacePrecondition);
    const key = idempotencyKey ?? pending.get(signature) ?? crypto.randomUUID();
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
    const response = await transport(
      path,
      payload,
      key,
      scope,
      workspacePrecondition,
    );
    let data: { error?: string; providerError?: ProviderFailure };
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
    if (!response.ok && data.providerError)
      throw new ProviderRequestError(data.providerError);
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
  let cursor = "",
    syncEpoch = "";
  let current: Snapshot | null = null;
  const documentBodies = new Map<string, Note | LibraryEntry>();
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
    documentBodies.clear();
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
  let initialization: Promise<void> | undefined;
  let remoteInitialized = false;
  function initialize(): Promise<void> {
    initialization ??= initializeSession();
    return initialization;
  }
  async function initializeSession() {
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
    remoteInitialized = true;
  }
  const service: Pick<
    WorkService,
    | "snapshot"
    | "create"
    | "update"
    | "setDeleted"
    | "purge"
    | "addEdge"
    | "removeEdge"
    | "setCalendarSettings"
    | "setNavigationPreference"
    | "moveNavigationPreference"
  > = {
    moveNavigationPreference: async (_context, input) =>
      request("/api/work/navigation-move", input),
    setNavigationPreference: async (_context, preference) =>
      request("/api/work/navigation-preference", preference),
    snapshot: async () =>
      normalizeSnapshot(await request<Snapshot>("/api/snapshot")),
    setCalendarSettings: async (_context, version, timezone) =>
      request("/api/work/calendar-settings", { version, timezone }),
    create: (_actor, input) => request("/api/work/create", input),
    update: (_actor, id, version, input) =>
      request("/api/work/update", { id, version, input }),
    purge: (_actor, id, version) =>
      request<void>("/api/work/purge", { id, version }),
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
      let more = true;
      if (!current || !cursor) {
        const manifest = await request<
          import("@arclattice/application").WorkspaceBootstrap
        >("/api/bootstrap?relationMode=canonical");
        if (generation !== serverGeneration) throw new Error("SERVER_CHANGED");
        if (manifest.schemaVersion !== 1)
          throw new Error("INVALID_BOOTSTRAP_VERSION");
        current = normalizeSnapshot({
          ...manifest.workspace,
          notes: manifest.notes,
          library: manifest.library,
        });
        cursor = String(manifest.cursor);
        syncEpoch = manifest.epoch;
        more = false;
      }
      while (more) {
        const data: SyncResponse = await request<SyncResponse>(
          current && cursor
            ? "/api/sync?after=" +
                encodeURIComponent(cursor) +
                "&epoch=" +
                encodeURIComponent(syncEpoch) +
                "&bodyMode=metadata&relationMode=canonical"
            : "/api/sync?relationMode=canonical",
        );
        if (data.epoch !== syncEpoch || data.snapshot) documentBodies.clear();
        if (data.snapshot) current = normalizeSnapshot(data.snapshot);
        else if (data.changes && current)
          current = applyWorkspaceChanges(current, data.changes);
        if (!current) throw new Error("Invalid sync response");
        cursor = String(data.cursor);
        syncEpoch = data.epoch;
        more = data.hasMore;
      }
      if (!current) throw new Error("Invalid sync response");
      if (context && current.calendarSettings?.version === 0) {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (timezone) {
          try {
            const settings = await service.setCalendarSettings(
              context,
              0,
              timezone,
            );
            if (generation !== serverGeneration)
              throw new Error("SERVER_CHANGED");
            current = {
              ...current,
              calendarSettings: settings,
              calendarTimezone:
                settings.timezone ?? current.calendarTimezone ?? timezone,
            };
          } catch (cause) {
            if (
              !(cause instanceof DomainError) ||
              cause.code !== "VERSION_CONFLICT"
            )
              throw cause;
            const correction = await request<{
              cursor: number;
              epoch: string;
              snapshot: Snapshot | null;
              changes?: WorkspaceChanges;
              hasMore: boolean;
            }>(
              "/api/sync?after=" +
                encodeURIComponent(cursor) +
                "&epoch=" +
                encodeURIComponent(syncEpoch) +
                "&bodyMode=metadata&relationMode=canonical",
            );
            if (generation !== serverGeneration)
              throw new Error("SERVER_CHANGED");
            if (correction.snapshot || correction.epoch !== syncEpoch)
              documentBodies.clear();
            if (correction.snapshot)
              current = normalizeSnapshot(correction.snapshot);
            else if (correction.changes && current)
              current = applyWorkspaceChanges(current, correction.changes);
            // Keep the cursor when a page remains, so the next refresh consumes it.
            if (!correction.hasMore) cursor = String(correction.cursor);
            syncEpoch = correction.epoch;
          }
          if (generation !== serverGeneration)
            throw new Error("SERVER_CHANGED");
        }
      }
      if (!current) throw new Error("Invalid sync response");
      return current;
    });
    syncQueue = job.catch(() => undefined);
    return job;
  }
  let notificationQueue: Promise<unknown> = Promise.resolve();
  const notificationJob = <T>(action: () => Promise<T>): Promise<T> => {
    const job = notificationQueue.then(action, action);
    notificationQueue = job;
    return job;
  };
  const notifications: NotificationPort = {
    permission: () =>
      native
        ? invoke<NotificationPermission>("notification_permission")
        : Promise.resolve("unavailable"),
    requestPermission: () =>
      native
        ? invoke<NotificationPermission>("notification_request_permission")
        : Promise.resolve("unavailable"),
    reconcile: (intents) => {
      const generation = serverGeneration;
      return notificationJob(async () => {
        if (intents.length && generation !== serverGeneration) return;
        if (!native) {
          if (intents.length) throw new Error("notification_unsupported");
          return;
        }
        await invoke("notification_reconcile", {
          intents: intents.map((intent) => ({
            id: intent.id,
            scope: intent.scope,
            title: intent.title,
            deliverAtMs: Date.parse(intent.scheduledAt),
          })),
        });
      });
    },
    cancel: (ids) =>
      notificationJob(async () => {
        if (native) await invoke("notification_cancel", { ids });
      }),
  };
  // Durable, device-local NotificationRecord store. Native scheduling above is
  // only one delivery channel; the record is the user-visible source of truth.
  const notificationCenter = new NotificationCenterService(
    localStore.notifications,
    local.context.workspaceId,
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const notificationDelivery: NotificationDeliveryPort = {
    reconcile: async (intents) => {
      if (native)
        return notificationJob(() =>
          invoke<import("@arclattice/application").NativeScheduleReceipt[]>(
            "notification_reconcile",
            { intents },
          ),
        );
      return [];
    },
    permission: () => notifications.permission(),
    present: async (payload) => {
      if (!native) throw new Error("notification_unsupported");
      await invoke("notification_present", { payload });
    },
  };
  const extractionAuth = {
    require: async (actor: import("@arclattice/domain").ActorContext) => {
      if (
        actor.workspaceId !== local.context.workspaceId ||
        actor.principalId !== local.context.principalId
      )
        throw new DomainError("FORBIDDEN");
    },
  };
  const extractionStore = localStore.metadata.fileExtractions;
  const processingStore = localStore.metadata.fileProcessing;
  if (!extractionStore || !processingStore)
    throw new Error("FILE_PROCESSING_STORE_INCOMPLETE");
  const localExtraction = new FileExtractionService(
    {
      read: (actor, id) => local.readFile(actor, id),
      bytes: (_actor, id) => local.readFileBytes(id),
    },
    extractionStore,
    new WorkerFileParser(),
    extractionAuth,
  );
  const extractionCoordinator = new FileExtractionCoordinator(localExtraction);
  const fileProcessor = new FileProcessingService(
    {
      list: async (actor) =>
        (await localStore.metadata.list(actor.workspaceId, "files"))
          .filter((row) => {
            const value = row.value;
            return (
              !!value &&
              typeof value === "object" &&
              !Array.isArray(value) &&
              !("localTombstone" in value && value.localTombstone === true)
            );
          })
          .map((row) =>
            requireCanonicalFile(
              row.value,
              row.id,
              actor.workspaceId,
              row.version,
            ),
          ),
      available: async (actor, file) =>
        (await localBlobs.get(actor.workspaceId, file.contentHash)) !== null,
      extract: async (actor, file, signal) => {
        await extractionCoordinator.extract(
          actor,
          file.id,
          file.version,
          signal,
        );
      },
    },
    processingStore,
    extractionAuth,
    { now: () => new Date().toISOString() },
    { next: () => crypto.randomUUID() },
  );
  let processingJob: Promise<void> | null = null;
  let processingRequested = false;
  let processingRecovery: ReturnType<typeof setTimeout> | null = null;
  let processingFailure: string | null = null;
  function wakeFileProcessing() {
    processingRequested = true;
    if (processingRecovery) {
      clearTimeout(processingRecovery);
      processingRecovery = null;
    }
    if (processingJob) return;
    processingJob = (async () => {
      do {
        processingRequested = false;
        const processed = await fileProcessor.drain(local.context);
        if (processed >= 8) {
          processingRequested = true;
          await new Promise<void>((resolve) => setTimeout(resolve, 50));
        }
      } while (processingRequested);
      processingFailure = null;
      const next = await fileProcessor.nextRecovery(local.context);
      if (next)
        processingRecovery = setTimeout(
          wakeFileProcessing,
          Math.max(1, Date.parse(next) - Date.now() + 1),
        );
    })()
      .catch(() => {
        // Surface infrastructure failure explicitly; leases remain durable for recovery.
        processingFailure = "FILE_PROCESSING_UNAVAILABLE";
      })
      .finally(() => {
        processingJob = null;
      });
  }
  async function workspaceConnectionPreview(targetWorkspaceId?: string) {
    await initialize();
    if (!context || !account) throw new Error("UNAUTHORIZED");
    const generation = serverGeneration,
      remoteActor = {
        ...context,
        workspaceId: targetWorkspaceId ?? context.workspaceId,
      };
    const sourceWorkspaceId = context.workspaceId;
    const revision = () =>
      localStore.metadata.get(
        local.context.workspaceId,
        "$local.workspace",
        "revision",
      );
    const before = await revision();
    const localRecords = (
      await Promise.all(
        [
          "items",
          "edges",
          "categories",
          "organization",
          "projectMaterials",
          "links",
          "reminders",
          "workflows",
          "manualOrders",
          "notes",
          "library",
          "files",
          "entityMemos",
        ].map((collection) =>
          localStore.metadata.list(local.context.workspaceId, collection),
        ),
      )
    ).flat();
    const manifest = await request<
      import("@arclattice/application").WorkspaceBootstrap
    >(
      "/api/bootstrap?relationMode=canonical",
      undefined,
      remoteActor.workspaceId,
    );
    const after = await revision();
    if ((before?.version ?? 0) !== (after?.version ?? 0))
      throw new DomainError("VERSION_CONFLICT");
    if (
      generation !== serverGeneration ||
      context?.workspaceId !== sourceWorkspaceId ||
      context?.principalId !== remoteActor.principalId
    )
      throw new Error("SERVER_CHANGED");
    return {
      ...previewWorkspaceBinding(
        local.context,
        {
          workspaceId: local.context.workspaceId,
          revision: before?.version ?? 0,
          records: localRecords,
        },
        {
          workspaceId: remoteActor.workspaceId,
          revision: manifest.cursor,
          records: bindingManifestRecords(remoteActor.workspaceId, manifest),
        },
      ),
      remotePrincipalId: remoteActor.principalId,
      serverOrigin,
      epoch: manifest.epoch,
    };
  }
  async function openWorkspaceImportStores() {
    const backups = await IndexedDbWorkspaceMergeBackups.open();
    try {
      return { backups, imports: await IndexedDbWorkspaceImports.open() };
    } catch (error) {
      backups.close();
      throw error;
    }
  }
  async function assertWorkspaceImportScope(
    journal: import("@arclattice/application").WorkspaceImportJournal,
    generation: number,
  ) {
    if (
      generation !== serverGeneration ||
      serverOrigin !== journal.targetOrigin ||
      context?.principalId !== journal.targetPrincipalId ||
      local.context.workspaceId !== journal.sourceWorkspaceId ||
      local.context.principalId !== journal.sourcePrincipalId
    )
      throw new DomainError("FORBIDDEN");
    const revision = await localStore.metadata.get(
      local.context.workspaceId,
      "$local.workspace",
      "revision",
    );
    if ((revision?.version ?? 0) !== journal.sourceRevision)
      throw new DomainError("VERSION_CONFLICT");
    if (
      generation !== serverGeneration ||
      context?.principalId !== journal.targetPrincipalId
    )
      throw new DomainError("FORBIDDEN");
  }
  async function verifyWorkspaceImportBackup(
    journal: import("@arclattice/application").WorkspaceImportJournal,
    backup: import("@arclattice/application").WorkspaceMergeBackup | null,
  ) {
    if (
      !backup ||
      backup.id !== journal.backupId ||
      backup.sha256 !== journal.backupSha256 ||
      backup.sourceWorkspaceId !== journal.sourceWorkspaceId ||
      backup.sourcePrincipalId !== journal.sourcePrincipalId ||
      backup.sourceRevision !== journal.sourceRevision ||
      backup.targetWorkspaceId !== journal.targetWorkspaceId ||
      backup.targetPrincipalId !== journal.targetPrincipalId ||
      backup.targetOrigin !== journal.targetOrigin ||
      backup.targetEpoch !== journal.initialRevision.epoch ||
      backup.targetRevision !== journal.initialRevision.cursor ||
      !localBlobs.digest ||
      (await localBlobs.digest(backup.bytes)) !== journal.backupSha256
    )
      throw new DomainError("VERSION_CONFLICT", { field: "mergeBackup" });
  }
  async function workspaceImportReviewRecords(
    journal: import("@arclattice/application").WorkspaceImportJournal,
    manifest: import("@arclattice/application").WorkspaceBootstrap,
    generation: number,
  ) {
    const records = bindingManifestRecords(journal.targetWorkspaceId, manifest);
    if (
      !journal.steps
        .slice(journal.accepted.length)
        .some((step) => step.path === "/api/memo/save")
    )
      return records;
    const privateRecords = await readWorkspacePrivateMemoReview(
      {
        workspaceId: journal.targetWorkspaceId,
        principalId: journal.targetPrincipalId,
      },
      { epoch: manifest.epoch, cursor: manifest.cursor },
      async (after) => {
        await assertWorkspaceImportScope(journal, generation);
        const result = await request<unknown>(
          `/api/v1/sync?after=${after}&epoch=${encodeURIComponent(manifest.epoch)}&bodyMode=metadata&privateMemos=only`,
          undefined,
          journal.targetWorkspaceId,
        );
        await assertWorkspaceImportScope(journal, generation);
        return result;
      },
      { forTarget: deriveEntityMemoId },
    );
    const fresh = await request<
      import("@arclattice/application").WorkspaceBootstrap
    >(
      "/api/bootstrap?relationMode=canonical",
      undefined,
      journal.targetWorkspaceId,
    );
    await assertWorkspaceImportScope(journal, generation);
    if (fresh.epoch !== manifest.epoch || fresh.cursor !== manifest.cursor)
      throw new DomainError("VERSION_CONFLICT");
    return [...records, ...privateRecords];
  }
  let localSyncUnavailable = false;
  function syncLocalWork() {
    if (!localCoordinator || localCoordinatorGeneration !== serverGeneration) {
      const generation = serverGeneration;
      localCoordinatorGeneration = serverGeneration;
      localCoordinator = new LocalWorkSyncCoordinator(local.context, {
        beforeBootstrap: async (scope, revision, cursor) => {
          const store = await IndexedDbWorkspaceMergeBackups.open();
          try {
            await preserveReplicaBootstrapBackup(
              local.context,
              scope,
              revision,
              cursor,
              {
                metadata: localStore.metadata,
                blobs: localBlobs,
                store,
                assertScope: () => requireRemoteBindingScope(scope, generation),
                id: () => crypto.randomUUID(),
                now: () => new Date().toISOString(),
              },
            );
          } finally {
            store.close();
          }
        },
        memoIdentity: { forTarget: deriveEntityMemoId },
        pendingRebase: {
          store: localStore.pendingWorkRebase,
          ids: { next: () => crypto.randomUUID() },
        },
        fileBinary: {
          blobs: localBlobs,
          transport: localFileBinaryTransport(serverGeneration),
        },
        metadata: localStore.metadata,
        outbox: localStore.outbox,
        syncState: localStore.syncState,
        replica: localStore.replica,
        transport: localWorkTransport(serverGeneration),
        knowledgeWiki: localWiki,
        clock: { now: () => new Date().toISOString() },
      });
    }
    return localCoordinator.run().then(
      (result) => {
        localSyncUnavailable = false;
        return result;
      },
      (error: unknown) => {
        localSyncUnavailable = true;
        throw error;
      },
    );
  }
  async function saveWorkspaceMergeBackup(
    previewInput: import("@arclattice/application").WorkspaceConnectionPreview,
  ) {
    const preview = structuredClone(previewInput),
      generation = serverGeneration;
    const store = await IndexedDbWorkspaceMergeBackups.open();
    try {
      return await prepareWorkspaceMergeBackup(local.context, preview, {
        revision: async () =>
          (
            await localStore.metadata.get(
              local.context.workspaceId,
              "$local.workspace",
              "revision",
            )
          )?.version ?? 0,
        archive: () => local.backup(),
        digest: async (bytes) => {
          if (!localBlobs.digest) throw new Error("MISSING_BACKUP_DIGEST");
          return localBlobs.digest(bytes);
        },
        store,
        assertScope: () => {
          if (
            generation !== serverGeneration ||
            context?.principalId !== preview.remotePrincipalId ||
            serverOrigin !== preview.serverOrigin
          )
            throw new DomainError("FORBIDDEN");
        },
        id: () => crypto.randomUUID(),
        now: () => new Date().toISOString(),
      });
    } finally {
      store.close();
    }
  }

  async function lookupWorkspaceImportReceipt(
    step: import("@arclattice/application").WorkspaceImportStep,
    journal: import("@arclattice/application").WorkspaceImportJournal,
  ) {
    if (!localBlobs.digest) throw new Error("MISSING_BACKUP_DIGEST");
    const digest = await localBlobs.digest(
      new Blob([step.path + "\n" + JSON.stringify(step.payload)]),
    );
    const proof = mutationReceiptDigest({
      key: step.id,
      digest,
      workspacePrecondition: journal.revision,
    });
    try {
      return await request<{
        result: import("@arclattice/application").LocalJson;
        workspaceRevision: import("@arclattice/application").WorkspaceMutationPrecondition;
      }>(
        "/api/workspace-import/receipt?commandId=" +
          step.id +
          "&proof=" +
          encodeURIComponent(proof),
        undefined,
        journal.targetWorkspaceId,
      );
    } catch (error) {
      if (error instanceof DomainError && error.code === "NOT_FOUND")
        return null;
      throw error;
    }
  }
  setTimeout(wakeFileProcessing, 0);
  async function readFileBytes(id: string) {
    try {
      wakeFileProcessing();
      return await local.readFileBytes(id);
    } catch (error) {
      const api = await import("@arclattice/application");
      if (!(error instanceof api.FileBytesUnavailableError)) throw error;
      const generation = serverGeneration;
      const binding = async () => {
        const scope = await localStore.syncState.get(local.context.workspaceId);
        if (!scope) throw error;
        requireRemoteBindingScope(scope, generation);
        return scope;
      };
      const hasBase = await localStore.metadata.get(
        local.context.workspaceId,
        "$local.remoteBase",
        JSON.stringify(["files", id]),
      );
      if (!hasBase) throw error;
      await api.hydrateLocalFileBytes(
        local.context,
        id,
        localStore.metadata,
        localBlobs,
        binding,
        async (scope, fileId) => {
          requireRemoteBindingScope(scope, generation);
          const response = await transport(
            `/api/v1/files/bytes?id=${encodeURIComponent(fileId)}`,
          );
          requireRemoteBindingScope(scope, generation);
          if (!response.ok) throw new Error(`FILE_DOWNLOAD_${response.status}`);
          return response.blob();
        },
      );
      return local.readFileBytes(id);
    }
  }
  function assertLocalSearchScope(actor: ActorContext, generation: number) {
    if (
      generation !== serverGeneration ||
      local.context.workspaceId !== actor.workspaceId ||
      local.context.principalId !== actor.principalId
    )
      throw new DomainError("FORBIDDEN");
  }
  async function searchRemoteKnowledge(
    collection: "notes" | "library",
    query: string,
    spaceId = "",
  ): Promise<readonly string[]> {
    if (!query.trim() || navigator.onLine === false) return [];
    const actor = { ...local.context };
    const generation = serverGeneration;
    const binding = await localStore.syncState.get(actor.workspaceId);
    if (
      !binding?.remotePrincipalId ||
      !context ||
      context.workspaceId !== binding.remoteWorkspaceId ||
      context.principalId !== binding.remotePrincipalId ||
      new URL(serverOrigin).origin !== binding.serverOrigin
    )
      return [];
    const assertScope = async () => {
      requireRemoteBindingScope(binding, generation);
      const current = await localStore.syncState.get(actor.workspaceId);
      if (
        local.context.workspaceId !== actor.workspaceId ||
        local.context.principalId !== actor.principalId ||
        current?.serverOrigin !== binding.serverOrigin ||
        current?.remoteWorkspaceId !== binding.remoteWorkspaceId ||
        current?.remotePrincipalId !== binding.remotePrincipalId ||
        current?.epoch !== binding.epoch
      )
        throw new DomainError("FORBIDDEN");
    };
    await assertScope();
    const response = await request<unknown>(
      `/api/${collection === "notes" ? "notes" : "library"}/search?q=${encodeURIComponent(query)}${collection === "library" ? `&spaceId=${encodeURIComponent(spaceId)}` : ""}`,
      undefined,
      binding.remoteWorkspaceId!,
    );
    await assertScope();
    if (!Array.isArray(response)) throw new Error("INVALID_RESPONSE");
    const ids = response.map((entry: unknown) => {
      const id =
        collection === "notes"
          ? entry
          : entry && typeof entry === "object" && "id" in entry
            ? entry.id
            : null;
      if (typeof id !== "string") throw new Error("INVALID_RESPONSE");
      return id;
    });
    const accepted = await remoteUnhydratedSearchIds(
      actor,
      binding,
      collection,
      ids,
      localStore.metadata,
    );
    await assertScope();
    return accepted;
  }
  async function readDocumentBody(
    entry:
      | import("@arclattice/application").WorkspaceNote
      | import("@arclattice/application").WorkspaceLibraryEntry,
  ): Promise<Note | LibraryEntry> {
    const generation = serverGeneration;
    try {
      return await local.readDocumentBody(entry);
    } catch (error) {
      if (!(error instanceof LocalBodyUnavailableError)) throw error;
      const binding = await localStore.syncState.get(local.context.workspaceId);
      if (!binding) throw error;
      requireRemoteBindingScope(binding, generation);
      const prefix = error.collection === "notes" ? "note" : "library";
      const availability = await localStore.metadata.get(
        local.context.workspaceId,
        `$local.${prefix}BodyAvailability`,
        error.entityId,
      );
      const state = availability?.value;
      if (
        !state ||
        typeof state !== "object" ||
        Array.isArray(state) ||
        !("remoteWorkspaceId" in state) ||
        state.remoteWorkspaceId !== binding.remoteWorkspaceId ||
        !("remotePrincipalId" in state) ||
        state.remotePrincipalId !== binding.remotePrincipalId ||
        !("serverOrigin" in state) ||
        state.serverOrigin !== binding.serverOrigin ||
        !("epoch" in state) ||
        state.epoch !== binding.epoch
      )
        throw new DomainError("FORBIDDEN");
      requireRemoteBindingScope(binding, generation);
      const response = await transport(
        `/api/document/body?id=${encodeURIComponent(error.entityId)}&kind=${error.collection === "notes" ? "NOTE" : "LIBRARY"}${entry.deletedAt ? "&deleted=include" : ""}`,
      );
      requireRemoteBindingScope(binding, generation);
      if (!response.ok) throw new Error(`BODY_REQUEST_${response.status}`);
      const body: unknown = await response.json();
      requireRemoteBindingScope(binding, generation);
      const commit = await prepareLocalKnowledgeHydration(
        local.context,
        binding,
        error.collection,
        error.entityId,
        error.version,
        body,
        await localStore.outbox.list(local.context.workspaceId),
        localStore.metadata,
        localWiki,
      );
      requireRemoteBindingScope(binding, generation);
      await localStore.replica.commit(commit);
      return local.readDocumentBody(entry);
    }
  }
  async function prepareKnowledgeLifecycle(
    collection: "notes" | "library",
    id: string,
    version: number,
  ) {
    const generation = serverGeneration;
    const note = (await local.loadWorkspace())[collection].find(
      (entry) => entry.id === id,
    );
    if (!note) throw new DomainError("NOT_FOUND");
    if (note.version !== version) throw new DomainError("VERSION_CONFLICT");
    await readDocumentBody(note);
    if (generation !== serverGeneration) throw new Error("SERVER_CHANGED");
  }
  const privateImageLoader = scopedImageLoader(
    () =>
      `${serverGeneration}|${local.context.workspaceId}|${local.context.principalId}`,
    async (path: string) => {
      const file = /^\/api\/v1\/files\/bytes\?id=([a-zA-Z0-9-]+)$/.exec(path);
      if (file) {
        const metadata = await local.readFile(local.context, file[1]!);
        if (!["image/png", "image/jpeg", "image/webp"].includes(metadata.mime))
          throw new DomainError("VALIDATION_ERROR");
        try {
          return await readFileBytes(metadata.id);
        } catch (error) {
          throw imageLoadFailure(error);
        }
      }
      if (!/^\/api\/library\/asset\?id=[a-zA-Z0-9-]+$/.test(path))
        throw new DomainError("VALIDATION_ERROR");
      try {
        return await local.loadImage(path);
      } catch (error) {
        if (
          !(error instanceof DomainError && error.code === "NOT_FOUND") &&
          !(error instanceof Error && error.message === "LOCAL_BINARY_MISSING")
        )
          throw imageLoadFailure(error);
        // Legacy assets are not in the workspace bootstrap manifest. The server
        // still owns their bytes and performs the original Workspace/Space guard.
        const generation = serverGeneration;
        const binding = async () => {
          const current = await localStore.syncState.get(
            local.context.workspaceId,
          );
          if (!current) throw imageLoadFailure(error);
          if (navigator.onLine === false) {
            const remote = activeWorkspace.remote;
            if (
              generation !== serverGeneration ||
              !remote ||
              remote.serverOrigin !== current.serverOrigin ||
              remote.workspaceId !== current.remoteWorkspaceId ||
              remote.principalId !== current.remotePrincipalId
            )
              throw new DomainError("FORBIDDEN");
          } else requireRemoteBindingScope(current, generation);
          return current;
        };
        return readLegacyImage(
          local.context,
          path.slice("/api/library/asset?id=".length),
          {
            binding,
            metadata: localStore.metadata,
            blobs: localBlobs,
            replica: localStore.replica,
            offline: navigator.onLine === false,
            download: async (scope) => {
              requireRemoteBindingScope(scope, generation);
              const response = await transport(
                path,
                undefined,
                "",
                scope.remoteWorkspaceId!,
              );
              requireRemoteBindingScope(scope, generation);
              return imageResponseBlob(response);
            },
            revalidateCache: async (scope, contentHash) => {
              requireRemoteBindingScope(scope, generation);
              const response = await transport(
                `/api/library/asset/meta?id=${encodeURIComponent(path.slice("/api/library/asset?id=".length))}`,
                undefined,
                "",
                scope.remoteWorkspaceId!,
              );
              requireRemoteBindingScope(scope, generation);
              // Older servers have no metadata route; fall back to a full fetch.
              if (response.status === 404 || response.status === 405)
                return false;
              if (response.status === 401 || response.status === 403)
                throw new ImageLoadError("access", response.status);
              if (!response.ok)
                throw new ImageLoadError("response", response.status);
              let meta: Record<string, unknown> | null = null;
              try {
                const value: unknown = await response.json();
                if (value && typeof value === "object" && !Array.isArray(value))
                  meta = value as Record<string, unknown>;
              } catch {
                meta = null;
              }
              return meta?.contentHash === contentHash;
            },
          },
        );
      }
    },
  );
  return {
    readDocumentBody,
    async readRemoteDocumentBody(
      entry:
        | import("@arclattice/application").WorkspaceNote
        | import("@arclattice/application").WorkspaceLibraryEntry,
    ): Promise<Note | LibraryEntry> {
      if (!context || entry.workspaceId !== context.workspaceId)
        throw new DomainError("NOT_FOUND");
      if (typeof entry.bodyMd === "string") return entry;
      const generation = serverGeneration;
      const prefix = [
        generation,
        context?.workspaceId,
        context?.principalId,
        entry.kind,
        entry.id,
      ].join(":");
      const cached = documentBodies.get(prefix + ":" + entry.version);
      if (cached) return cached;
      const kind =
        entry.kind === "NOTE" || entry.kind === "JOURNAL" ? "NOTE" : "LIBRARY";
      const body = await request<Note | LibraryEntry>(
        "/api/document/body?" +
          new URLSearchParams({
            kind,
            id: entry.id,
            ...(entry.deletedAt ? { deleted: "include" } : {}),
          }),
      );
      if (generation !== serverGeneration) throw new Error("SERVER_CHANGED");
      if (
        body.id !== entry.id ||
        body.workspaceId !== entry.workspaceId ||
        body.kind !== entry.kind ||
        !Number.isInteger(body.version) ||
        body.version < entry.version ||
        typeof body.bodyMd !== "string"
      )
        throw new Error("INVALID_DOCUMENT_BODY");
      documentBodies.set(prefix + ":" + body.version, body);
      return body;
    },
    storageMode: "local" as const,
    async documentPersistenceState(kind: "notes" | "library", id: string) {
      const pending = await localStore.outbox.list(local.context.workspaceId);
      const binding = await localStore.syncState.get(local.context.workspaceId);
      return {
        bound: !!binding?.remotePrincipalId,
        pending: pending.some(
          (entry) => entry.entityType === kind && entry.entityId === id,
        ),
        offline: !navigator.onLine || localSyncUnavailable,
      };
    },
    uploadFile: async (
      input: import("@arclattice/application").FileUploadInput,
      bytes: Blob,
    ) => {
      const file = await local.uploadFile(input, bytes);
      wakeFileProcessing();
      return file;
    },
    fileProcessingFailure: () => processingFailure,
    uploadProjectFile: async (
      projectId: string,
      input: import("@arclattice/application").FileUploadInput,
      bytes: Blob,
    ) => {
      try {
        return await local.uploadProjectFile(projectId, input, bytes);
      } finally {
        wakeFileProcessing();
      }
    },
    importLegacyProjectFile: async (id: string) => {
      const snapshot = await local.loadWorkspace();
      if ((snapshot.files ?? []).some((file) => file.id === id))
        return local.readFile(local.context, id);
      const material = snapshot.projectMaterials.find(
        (entry) => entry.id === id && entry.kind === "FILE" && !entry.deletedAt,
      );
      if (!material) throw new DomainError("NOT_FOUND");
      const generation = serverGeneration;
      const binding = await localStore.syncState.get(local.context.workspaceId);
      if (!binding) throw new DomainError("NOT_FOUND");
      requireRemoteBindingScope(binding, generation);
      const base = await localStore.metadata.get(
        local.context.workspaceId,
        "$local.remoteBase",
        JSON.stringify(["projectMaterials", id]),
      );
      if (!base) throw new DomainError("NOT_FOUND");
      const originalScope = localObject(base.value);
      if (
        originalScope.remoteWorkspaceId !== binding.remoteWorkspaceId ||
        originalScope.remotePrincipalId !== binding.remotePrincipalId ||
        originalScope.serverOrigin !== binding.serverOrigin ||
        originalScope.epoch !== binding.epoch
      )
        throw new DomainError("FORBIDDEN");
      const response = await transport(
        `/api/v1/files/bytes?id=${encodeURIComponent(id)}&legacyProjectMaterial=1&version=${material.version}`,
      );
      if (!response.ok) throw new Error(`FILE_DOWNLOAD_${response.status}`);
      const bytes = await response.blob();
      const current = await localStore.syncState.get(local.context.workspaceId);
      if (
        !current ||
        current.remoteWorkspaceId !== binding.remoteWorkspaceId ||
        current.remotePrincipalId !== binding.remotePrincipalId ||
        current.serverOrigin !== binding.serverOrigin ||
        current.epoch !== binding.epoch
      )
        throw new DomainError("FORBIDDEN");
      requireRemoteBindingScope(current, generation);
      try {
        return await local.importLegacyProjectFile(id, material.version, bytes);
      } finally {
        wakeFileProcessing();
      }
    },
    subscribeFileProcessing: (id: string, listener: () => void) =>
      localStore.metadata.subscribeFileProcessing!(
        local.context.workspaceId,
        id,
        listener,
      ),
    subscribeFileIndex: (listener: () => void) =>
      localStore.metadata.subscribeFileIndex!(
        local.context.workspaceId,
        listener,
      ),
    retryFileProcessing: async (id: string) => {
      const file = await local.readFile(local.context, id);
      await fileProcessor.process(local.context, file, true);
      return processingStore.get(local.context, file);
    },
    readFileProcessing: async (id: string) =>
      processingStore.get(
        local.context,
        await local.readFile(local.context, id),
      ),
    renameFile: async (id: string, version: number, name: string) => {
      const file = await local.renameFile(id, version, name);
      wakeFileProcessing();
      return file;
    },
    deleteFile: async (id: string, version: number, deleted: boolean) => {
      const file = await local.deleteFile(id, version, deleted);
      if (!deleted) wakeFileProcessing();
      return file;
    },
    setFilePolicy: async (
      id: string,
      version: number,
      policy: import("@arclattice/application").ContentPolicy,
    ) => {
      const file = await local.setFilePolicy(id, version, policy);
      wakeFileProcessing();
      return file;
    },
    async searchFileIds(
      query: string,
      ids: readonly string[],
    ): Promise<string[]> {
      const store = localStore.metadata.fileExtractions;
      if (!store) throw new Error("FILE_EXTRACTION_STORE_INCOMPLETE");
      return new FileExtractionService(
        {
          read: (actor, id) => local.readFile(actor, id),
          bytes: (_actor, id) => this.readFileBytes(id),
        },
        store,
        new WorkerFileParser(),
        {
          require: async (actor) => {
            if (
              actor.workspaceId !== local.context.workspaceId ||
              actor.principalId !== local.context.principalId
            )
              throw new DomainError("FORBIDDEN");
          },
        },
      ).searchFileIds(local.context, query, ids);
    },
    async extractFile(
      id: string,
      version: number,
      signal?: AbortSignal,
    ): Promise<import("@arclattice/domain").FileExtractionDocument> {
      try {
        return await extractionCoordinator.extract(
          local.context,
          id,
          version,
          signal,
        );
      } catch (error) {
        const api = await import("@arclattice/application");
        if (!(error instanceof api.FileBytesUnavailableError)) throw error;
        await this.readFileBytes(id);
        return extractionCoordinator.extract(
          local.context,
          id,
          version,
          signal,
        );
      }
    },
    readFileBytes,
    async searchNotes(query: string) {
      const actor = { ...local.context },
        generation = serverGeneration;
      const localIds = await local.searchNotes(query);
      assertLocalSearchScope(actor, generation);
      const remoteIds = await searchRemoteKnowledge("notes", query);
      assertLocalSearchScope(actor, generation);
      return [...new Set([...localIds, ...remoteIds])];
    },
    noteBacklinks: async (id: string) => {
      const current = local.context;
      const localResult = await local.noteBacklinks(id, (markdown, documents) =>
        resolveWikiLinks(parseWikiLinks(markdown), documents),
      );
      const binding = await localStore.syncState.get(current.workspaceId);
      if (!binding?.remotePrincipalId) return localResult.references;
      const remote = await request<typeof localResult.references>(
        "/api/document/note-backlinks?id=" + encodeURIComponent(id),
      );
      const after = await localStore.syncState.get(current.workspaceId);
      if (
        local.context.workspaceId !== current.workspaceId ||
        local.context.principalId !== current.principalId ||
        after?.serverOrigin !== binding.serverOrigin ||
        after?.remoteWorkspaceId !== binding.remoteWorkspaceId ||
        after?.remotePrincipalId !== binding.remotePrincipalId ||
        after?.epoch !== binding.epoch
      )
        throw new DomainError("FORBIDDEN");
      const localSources = new Set(localResult.resolvedNoteIds);
      return [
        ...localResult.references,
        ...remote.filter((link) => !localSources.has(link.sourceId)),
      ];
    },
    i18n,
    native,
    notifications,
    notificationCenter,
    notificationDelivery,
    /**
     * Native notification taps. Windows pushes a window event after focusing the
     * app; Android keeps the route on the launch intent, so it is pulled on start
     * and whenever the app returns to the foreground.
     */
    subscribeNotificationOpen: (listener: (route: string) => void) => {
      const accept = (route: unknown) => {
        if (
          typeof route === "string" &&
          route.startsWith("/") &&
          !route.startsWith("//") &&
          !route.includes("://") &&
          !route.includes("\\") &&
          !/[\u0000-\u001f\u007f]/.test(route) &&
          route.length <= 512
        )
          listener(route);
      };
      const pull = () => {
        if (!native) return;
        void invoke<string | null>("notification_take_route").then(
          accept,
          () => undefined,
        );
      };
      const onEvent = () => pull();
      window.addEventListener("orivane-notification-open", onEvent);
      pull();
      document.addEventListener("visibilitychange", pull);
      return () => {
        window.removeEventListener("orivane-notification-open", onEvent);
        document.removeEventListener("visibilitychange", pull);
      };
    },
    subscribeNotifications: (listener: () => void) =>
      localStore.notifications.subscribe(local.context.workspaceId, listener),
    updates: {
      available: isTauri(),
      check: () => invoke("check_app_update"),
      install: async (version, onProgress) => {
        const progress = new Channel<AppUpdateProgress>();
        progress.onmessage = onProgress;
        await invoke("install_app_update", { version, progress });
      },
    } satisfies AppUpdates,
    get context(): ActorContext {
      return local.context;
    },
    editorProposals: new EditorProposalService(async (text) => {
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(text),
      );
      return Array.from(new Uint8Array(hash), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    }),
    get remoteContext() {
      return context ? { ...context } : null;
    },
    get remoteInitialized() {
      return remoteInitialized;
    },
    async listWorkspaceMergeBackups() {
      const store = await IndexedDbWorkspaceMergeBackups.open();
      try {
        return await store.list(
          local.context.workspaceId,
          local.context.principalId,
        );
      } finally {
        store.close();
      }
    },
    async readWorkspaceMergeBackup(id: string) {
      const store = await IndexedDbWorkspaceMergeBackups.open();
      try {
        const backup = await store.get(id);
        if (
          !backup ||
          backup.sourceWorkspaceId !== local.context.workspaceId ||
          backup.sourcePrincipalId !== local.context.principalId
        )
          throw new DomainError("FORBIDDEN");
        if (
          !localBlobs.digest ||
          (await localBlobs.digest(backup.bytes)) !== backup.sha256
        )
          throw new Error("MERGE_BACKUP_VERIFICATION_FAILED");
        return backup.bytes;
      } finally {
        store.close();
      }
    },
    saveWorkspaceMergeBackup,
    async workspaceMergeCandidates(
      previewInput: import("@arclattice/application").WorkspaceConnectionPreview,
    ) {
      const preview = structuredClone(previewInput),
        generation = serverGeneration;
      const assert = async () => {
        if (
          generation !== serverGeneration ||
          preview.serverOrigin !== serverOrigin ||
          preview.remotePrincipalId !== context?.principalId ||
          preview.localWorkspaceId !== local.context.workspaceId
        )
          throw new DomainError("FORBIDDEN");
        const revision = await localStore.metadata.get(
          local.context.workspaceId,
          "$local.workspace",
          "revision",
        );
        if ((revision?.version ?? 0) !== preview.localRevision)
          throw new DomainError("VERSION_CONFLICT");
      };
      await assert();
      const records = (
        await Promise.all(
          [
            "items",
            "edges",
            "categories",
            "organization",
            "manualOrders",
            "projectMaterials",
            "links",
            "reminders",
            "workflows",
            "notes",
            "library",
            "files",
            "entityMemos",
          ].map((collection) =>
            localStore.metadata.list(local.context.workspaceId, collection),
          ),
        )
      ).flat();
      await assert();
      return records
        .filter((row) => !localObject(row.value).deletedAt)
        .map((row) => {
          const value = localObject(row.value);
          return {
            collection: row.collection,
            sourceId: row.id,
            title:
              typeof value.title === "string"
                ? value.title
                : typeof value.name === "string"
                  ? value.name
                  : row.id,
            remoteIds: preview.exactDuplicates
              .filter(
                (group) =>
                  group.collection === row.collection &&
                  group.localIds.includes(row.id),
              )
              .flatMap((group) => group.remoteIds),
          };
        });
    },
    async prepareWorkspaceMergeImport(
      backupId: string,
      choicesInput: readonly import("@arclattice/application").WorkspaceMergeChoice[],
    ) {
      const choices = structuredClone(choicesInput);
      await initialize();
      const generation = serverGeneration;
      const { backups, imports } = await openWorkspaceImportStores();
      try {
        const backup = await backups.get(backupId);
        if (!backup) throw new DomainError("NOT_FOUND");
        const empty = createWorkspaceImportJournal(
          local.context,
          backup,
          crypto.randomUUID(),
          [],
        );
        await assertWorkspaceImportScope(empty, generation);
        await verifyWorkspaceImportBackup(empty, backup);
        const records = (
          await Promise.all(
            [
              "items",
              "edges",
              "categories",
              "organization",
              "manualOrders",
              "projectMaterials",
              "links",
              "reminders",
              "workflows",
              "notes",
              "library",
              "files",
              "entityMemos",
            ].map((collection) =>
              localStore.metadata.list(local.context.workspaceId, collection),
            ),
          )
        ).flat();
        const hydrated = await Promise.all(
          records.map(async (row) => {
            if (
              !["notes", "library"].includes(row.collection) ||
              !choices.some(
                (choice) =>
                  choice.collection === row.collection &&
                  choice.sourceId === row.id &&
                  choice.action === "COPY",
              )
            )
              return row;
            const value = row.value as unknown as
              | import("@arclattice/application").WorkspaceNote
              | import("@arclattice/application").WorkspaceLibraryEntry;
            const full = await local.readDocumentBody(value);
            if (full.version !== row.version)
              throw new DomainError("VERSION_CONFLICT");
            return { ...row, value: localDto(full) };
          }),
        );
        const manifest = await request<
          import("@arclattice/application").WorkspaceBootstrap
        >(
          "/api/bootstrap?relationMode=canonical",
          undefined,
          backup.targetWorkspaceId,
        );
        if (
          manifest.epoch !== backup.targetEpoch ||
          manifest.cursor !== backup.targetRevision
        )
          throw new DomainError("VERSION_CONFLICT");
        const source = {
          workspaceId: local.context.workspaceId,
          revision: backup.sourceRevision,
          records: hydrated,
        };
        const selection = planWorkspaceMergeSelection(
          local.context,
          source,
          {
            workspaceId: backup.targetWorkspaceId,
            revision: manifest.cursor,
            records: bindingManifestRecords(backup.targetWorkspaceId, manifest),
          },
          choices,
          { next: () => crypto.randomUUID() },
        );
        const materialized = await materializeWorkspaceMemoCopies(
          source,
          selection,
          {
            workspaceId: backup.targetWorkspaceId,
            principalId: backup.targetPrincipalId,
          },
          { forTarget: deriveEntityMemoId },
        );
        const steps = planWorkspaceImportSteps(
          materialized.copies,
          {
            sourcePrincipalId: local.context.principalId,
            targetPrincipalId: backup.targetPrincipalId,
            deviceId: localIdentity.deviceId,
            targetManualOrders: manifest.workspace.manualOrders ?? [],
          },
          { next: () => crypto.randomUUID() },
        );
        const journal = createWorkspaceImportJournal(
          local.context,
          backup,
          empty.id,
          steps,
        );
        await assertWorkspaceImportScope(journal, generation);
        await imports.create(journal);
        await assertWorkspaceImportScope(journal, generation);
        return { journal, selection: materialized.selection };
      } finally {
        backups.close();
        imports.close();
      }
    },
    async prepareWorkspaceImport(
      backupId: string,
      steps: readonly import("@arclattice/application").WorkspaceImportStep[],
    ) {
      await initialize();
      const generation = serverGeneration;
      const { backups, imports } = await openWorkspaceImportStores();
      try {
        const backup = await backups.get(backupId);
        if (!backup) throw new DomainError("NOT_FOUND");
        const journal = createWorkspaceImportJournal(
          local.context,
          backup,
          crypto.randomUUID(),
          steps,
        );
        await assertWorkspaceImportScope(journal, generation);
        await verifyWorkspaceImportBackup(journal, backup);
        await imports.create(journal);
        await assertWorkspaceImportScope(journal, generation);
        return journal;
      } finally {
        backups.close();
        imports.close();
      }
    },
    async reviewWorkspaceImportChanges(id: string) {
      await initialize();
      const generation = serverGeneration;
      const { backups, imports } = await openWorkspaceImportStores();
      try {
        if (await imports.successor(id))
          throw new DomainError("VERSION_CONFLICT");
        const journal = await recoverWorkspaceImportReceipts(
          local.context,
          id,
          {
            store: imports,
            lookup: lookupWorkspaceImportReceipt,
            assertScope: (entry) =>
              assertWorkspaceImportScope(entry, generation),
            verifyBackup: async (entry) =>
              verifyWorkspaceImportBackup(
                entry,
                await backups.get(entry.backupId),
              ),
          },
        );
        const preview = await workspaceConnectionPreview(
          journal.targetWorkspaceId,
        );
        if (
          preview.epoch !== journal.revision.epoch ||
          preview.remoteRevision < journal.revision.cursor
        )
          throw new DomainError("VERSION_CONFLICT");
        await assertWorkspaceImportScope(journal, generation);
        const manifest = await request<
          import("@arclattice/application").WorkspaceBootstrap
        >(
          "/api/bootstrap?relationMode=canonical",
          undefined,
          journal.targetWorkspaceId,
        );
        if (
          manifest.epoch !== preview.epoch ||
          manifest.cursor !== preview.remoteRevision
        )
          throw new DomainError("VERSION_CONFLICT");
        const records = await workspaceImportReviewRecords(
          journal,
          manifest,
          generation,
        );
        const conflicts = reviewWorkspaceImportSuffix(journal, records);
        const candidates = workspaceImportResolutionCandidates(
          journal,
          records,
        );
        await assertWorkspaceImportScope(journal, generation);
        return {
          id: journal.id,
          version: journal.version,
          preview,
          conflicts,
          candidates,
          remainingSteps: journal.steps.length - journal.accepted.length,
          needsRebase: preview.remoteRevision > journal.revision.cursor,
        };
      } finally {
        backups.close();
        imports.close();
      }
    },
    async prepareWorkspaceImportRebase(expectedInput: {
      id: string;
      version: number;
      preview: import("@arclattice/application").WorkspaceConnectionPreview;
      resolutions?: readonly import("@arclattice/application").WorkspaceImportResolution[];
    }) {
      const expected = structuredClone(expectedInput);
      await initialize();
      const generation = serverGeneration;
      const { backups, imports } = await openWorkspaceImportStores();
      try {
        if (await imports.successor(expected.id))
          throw new DomainError("VERSION_CONFLICT");
        const journal = await recoverWorkspaceImportReceipts(
          local.context,
          expected.id,
          {
            store: imports,
            lookup: lookupWorkspaceImportReceipt,
            assertScope: (entry) =>
              assertWorkspaceImportScope(entry, generation),
            verifyBackup: async (entry) =>
              verifyWorkspaceImportBackup(
                entry,
                await backups.get(entry.backupId),
              ),
          },
        );
        if (
          journal.version !== expected.version ||
          expected.preview.remoteWorkspaceId !== journal.targetWorkspaceId
        )
          throw new DomainError("VERSION_CONFLICT");
        const fresh = await workspaceConnectionPreview(
          journal.targetWorkspaceId,
        );
        for (const key of [
          "localWorkspaceId",
          "localRevision",
          "remoteWorkspaceId",
          "remoteRevision",
          "remotePrincipalId",
          "serverOrigin",
          "epoch",
        ] as const)
          if (fresh[key] !== expected.preview[key])
            throw new DomainError("VERSION_CONFLICT");
        const manifest = await request<
          import("@arclattice/application").WorkspaceBootstrap
        >(
          "/api/bootstrap?relationMode=canonical",
          undefined,
          journal.targetWorkspaceId,
        );
        if (
          manifest.epoch !== fresh.epoch ||
          manifest.cursor !== fresh.remoteRevision
        )
          throw new DomainError("VERSION_CONFLICT");
        const records = await workspaceImportReviewRecords(
          journal,
          manifest,
          generation,
        );
        for (const resolution of expected.resolutions ?? []) {
          const remote = records.find(
            (row) =>
              row.collection === resolution.remote.collection &&
              row.id === resolution.remote.id,
          );
          if (
            !remote ||
            !equalLocalJson(localDto(remote), localDto(resolution.remote))
          )
            throw new DomainError("VERSION_CONFLICT");
        }
        const resolved = resolveWorkspaceImportSteps(
          journal,
          expected.resolutions ?? [],
        );
        if (
          reviewWorkspaceImportSuffix(
            {
              ...journal,
              steps: [
                ...journal.steps.slice(0, journal.accepted.length),
                ...resolved,
              ],
            },
            records,
          ).length
        )
          throw new DomainError("VERSION_CONFLICT");
        const backup = await saveWorkspaceMergeBackup(fresh);
        const child = createWorkspaceImportFork(
          local.context,
          journal,
          backup,
          crypto.randomUUID(),
          { next: () => crypto.randomUUID() },
          expected.resolutions,
        );
        await assertWorkspaceImportScope(child, generation);
        await verifyWorkspaceImportBackup(child, backup);
        await imports.create(child);
        await assertWorkspaceImportScope(child, generation);
        return { id: child.id };
      } finally {
        backups.close();
        imports.close();
      }
    },
    async previewImportedWorkspace(id: string) {
      await initialize();
      const generation = serverGeneration;
      const { backups, imports } = await openWorkspaceImportStores();
      try {
        const journal = await imports.get(id);
        if (!journal) throw new DomainError("NOT_FOUND");
        if (journal.accepted.length !== journal.steps.length)
          throw new DomainError("VERSION_CONFLICT");
        await assertWorkspaceImportScope(journal, generation);
        await verifyWorkspaceImportBackup(
          journal,
          await backups.get(journal.backupId),
        );
        const preview = await workspaceConnectionPreview(
          journal.targetWorkspaceId,
        );
        if (
          preview.epoch !== journal.revision.epoch ||
          preview.remoteRevision < journal.revision.cursor ||
          preview.remotePrincipalId !== journal.targetPrincipalId ||
          preview.serverOrigin !== journal.targetOrigin
        )
          throw new DomainError("VERSION_CONFLICT");
        await assertWorkspaceImportScope(journal, generation);
        return {
          preview,
          destinationChanged:
            preview.remoteRevision !== journal.revision.cursor,
        };
      } finally {
        backups.close();
        imports.close();
      }
    },
    async listWorkspaceImports() {
      const imports = await IndexedDbWorkspaceImports.open();
      try {
        return await imports.list(local.context);
      } finally {
        imports.close();
      }
    },
    async continueWorkspaceImport(id: string) {
      await initialize();
      const generation = serverGeneration;
      const { backups, imports } = await openWorkspaceImportStores();
      try {
        return await continueWorkspaceImport(local.context, id, {
          store: imports,
          assertScope: async (journal) => {
            if (await imports.successor(journal.id))
              throw new DomainError("VERSION_CONFLICT");
            await assertWorkspaceImportScope(journal, generation);
          },
          verifyBackup: async (journal) =>
            verifyWorkspaceImportBackup(
              journal,
              await backups.get(journal.backupId),
            ),
          apply: async (step, journal) => {
            if (step.binary) {
              const binding = async (): Promise<LocalSyncState> => {
                await assertWorkspaceImportScope(journal, generation);
                return {
                  workspaceId: local.context.workspaceId,
                  remoteWorkspaceId: journal.targetWorkspaceId,
                  remotePrincipalId: journal.targetPrincipalId,
                  serverOrigin: journal.targetOrigin,
                  epoch: journal.revision.epoch,
                  cursor: journal.revision.cursor,
                  version: 1,
                };
              };
              await syncVerifiedLocalFileBinary(
                local.context,
                step.binary,
                localBlobs,
                localFileBinaryTransport(generation, {
                  remoteWorkspaceId: journal.targetWorkspaceId,
                  remotePrincipalId: journal.targetPrincipalId,
                  serverOrigin: journal.targetOrigin,
                  epoch: journal.revision.epoch,
                }),
                binding,
              );
              await assertWorkspaceImportScope(journal, generation);
            }
            return request<{
              result: import("@arclattice/application").LocalJson;
              workspaceRevision: import("@arclattice/application").WorkspaceMutationPrecondition;
            }>(
              step.path,
              step.payload,
              journal.targetWorkspaceId,
              step.id,
              journal.revision,
            );
          },
        });
      } finally {
        backups.close();
        imports.close();
      }
    },
    previewWorkspaceConnection: workspaceConnectionPreview,
    listOwnedWorkspaces: () =>
      request<readonly import("@arclattice/application").OwnedWorkspace[]>(
        "/api/v1/workspaces",
      ),
    createOwnedWorkspace: (id: string, name: string) =>
      request<import("@arclattice/application").OwnedWorkspace>(
        "/api/v1/workspaces/create",
        { id, name },
        undefined,
        id,
      ),
    async localWorkConflicts() {
      const binding = await localStore.syncState.get(local.context.workspaceId);
      if (!binding?.remotePrincipalId) return [];
      return listLocalWorkConflictReviews(
        local.context,
        binding,
        localStore.metadata,
        localStore.outbox,
      );
    },
    async notificationAttention() {
      const actor = local.context;
      const binding = await localStore.syncState.get(actor.workspaceId);
      if (!binding?.remotePrincipalId) return [];
      return (await localStore.outbox.list(actor.workspaceId)).filter(
        (mutation) =>
          mutation.workspaceId === actor.workspaceId &&
          mutation.principalId === actor.principalId &&
          (mutation.state === "CONFLICT" || mutation.state === "REJECTED"),
      );
    },
    async resolveLocalWorkConflict(
      captured: import("@arclattice/application").LocalWorkConflictReview,
      choice: "LOCAL" | "REMOTE",
    ) {
      if (choice !== "LOCAL" && choice !== "REMOTE")
        throw new DomainError("VALIDATION_ERROR");
      await initialize();
      const generation = serverGeneration;
      requireRemoteBindingScope(captured.binding, generation);
      const receipt = await localWorkTransport(generation).lookup(
        captured.binding,
        captured.original.commandId!,
        captured.original.deviceId,
      );
      requireRemoteBindingScope(captured.binding, generation);
      if (receipt !== null)
        throw new DomainError("VERSION_CONFLICT", { field: "acceptedReceipt" });
      await syncLocalWork();
      requireRemoteBindingScope(captured.binding, generation);
      const binding = await localStore.syncState.get(local.context.workspaceId);
      if (!binding) throw new DomainError("FORBIDDEN");
      const pending = await localStore.outbox.list(local.context.workspaceId);
      const plan = (
        await planLocalCommands(local.context, localStore.metadata, pending)
      ).find((entry) => entry.id === captured.original.commandId);
      if (!plan) throw new DomainError("VERSION_CONFLICT");
      const prepared = await prepareLocalPendingWorkRebase(
        local.context,
        binding,
        plan,
        pending,
        localStore.metadata,
        { next: () => crypto.randomUUID() },
        { now: () => new Date().toISOString() },
        { captured: structuredClone(captured), choice },
        localWiki,
        { forTarget: deriveEntityMemoId },
      );
      if (!prepared)
        throw new DomainError("VERSION_CONFLICT", { field: "conflictReview" });
      requireRemoteBindingScope(binding, generation);
      await localStore.pendingWorkRebase.commit(prepared);
    },
    async openLocalWorkConflict(
      capturedInput: import("@arclattice/application").LocalWorkConflictReview,
    ) {
      const captured = structuredClone(capturedInput),
        generation = serverGeneration;
      requireRemoteBindingScope(captured.binding, generation);
      const transport = localWorkTransport(generation);
      await hydrateLocalConflictBody(
        local.context,
        captured.binding,
        captured.original,
        localStore.metadata,
        localStore.replica,
        (binding, collection, id) =>
          transport.readKnowledge!(binding, collection, id),
      );
      requireRemoteBindingScope(captured.binding, generation);
      const binding = await localStore.syncState.get(local.context.workspaceId);
      if (!binding) throw new DomainError("FORBIDDEN");
      const current = (
        await listLocalWorkConflictReviews(
          local.context,
          binding,
          localStore.metadata,
          localStore.outbox,
        )
      ).find((entry) => entry.original.id === captured.original.id);
      if (!current) throw new DomainError("VERSION_CONFLICT");
      return current;
    },
    async resolveDeletedKnowledgeConflict(
      capturedInput: import("@arclattice/application").LocalWorkConflictReview,
      choice: import("@arclattice/application").DeletedKnowledgeChoice,
    ) {
      const captured = structuredClone(capturedInput);
      await initialize();
      const generation = serverGeneration;
      requireRemoteBindingScope(captured.binding, generation);
      const receipt = await localWorkTransport(generation).lookup(
        captured.binding,
        captured.original.commandId!,
        captured.original.deviceId,
      );
      requireRemoteBindingScope(captured.binding, generation);
      if (receipt !== null)
        throw new DomainError("VERSION_CONFLICT", { field: "acceptedReceipt" });
      await syncLocalWork();
      requireRemoteBindingScope(captured.binding, generation);
      const prepared =
        captured.original.entityType === "entityMemos"
          ? choice === "REMOTE"
            ? await prepareLocalPurgedMemo(
                local.context,
                captured,
                localStore.metadata,
                localStore.outbox,
                {
                  forTarget: deriveEntityMemoId,
                  nextChangeId: () => crypto.randomUUID(),
                },
                { now: () => new Date().toISOString() },
              )
            : (() => {
                throw new DomainError("VALIDATION_ERROR");
              })()
          : await prepareLocalDeletedKnowledge(
              local.context,
              captured,
              choice,
              localStore.metadata,
              localStore.outbox,
              localBlobs,
              localWiki,
              { now: () => new Date().toISOString() },
              { next: () => crypto.randomUUID() },
            );
      requireRemoteBindingScope(captured.binding, generation);
      await localStore.deletedKnowledge.commit(prepared);
      return prepared.resultId;
    },
    get activeWorkspace() {
      return activeWorkspace;
    },
    listLocalWorkspaces: () => workspaceCatalog.list(),
    selectLocalWorkspace: (id: string) =>
      workspaceCatalog.select(id, activeWorkspace.databaseName),
    async openAccountWorkspace(
      previewInput: import("@arclattice/application").WorkspaceConnectionPreview,
    ) {
      const preview = structuredClone(previewInput);
      const generation = serverGeneration;
      const assertScope = () => {
        if (
          generation !== serverGeneration ||
          context?.principalId !== preview.remotePrincipalId ||
          serverOrigin !== preview.serverOrigin
        )
          throw new Error("SERVER_CHANGED");
      };
      const service = new OpenAccountWorkspaceService({
        catalog: workspaceCatalog,
        ids: { next: () => crypto.randomUUID() },
        preview: () => workspaceConnectionPreview(preview.remoteWorkspaceId),
        assertScope,
        open: async (entry, reviewed) => {
          const target = await IndexedDbLocalStore.open(
            entry.databaseName,
            indexedDB,
          );
          try {
            const own = await target.identity.ensure({
              schemaVersion: 1,
              workspaceId: crypto.randomUUID(),
              principalId: crypto.randomUUID(),
              deviceId: crypto.randomUUID(),
            });
            const existing = await target.syncState.get(own.workspaceId);
            if (existing) {
              assertScope();
              if (
                existing.remoteWorkspaceId !== reviewed.remoteWorkspaceId ||
                existing.remotePrincipalId !== reviewed.remotePrincipalId ||
                existing.serverOrigin !== reviewed.serverOrigin
              )
                throw new DomainError("FORBIDDEN");
              if (existing.epoch !== reviewed.epoch)
                throw new DomainError("VERSION_CONFLICT");
            } else {
              assertScope();
              if (!target.syncState.bindEmpty)
                throw new Error("MISSING_ATOMIC_BINDING");
              await target.syncState.bindEmpty({
                workspaceId: own.workspaceId,
                remoteWorkspaceId: reviewed.remoteWorkspaceId,
                remotePrincipalId: reviewed.remotePrincipalId,
                serverOrigin: reviewed.serverOrigin,
                epoch: reviewed.epoch,
                cursor: 0,
                version: 1,
              });
            }
            const coordinator = new LocalWorkSyncCoordinator(
              { workspaceId: own.workspaceId, principalId: own.principalId },
              {
                beforeBootstrap: async (scope, revision, cursor) => {
                  const blobs = await IndexedDbLocalBlobStore.open(
                    entry.databaseName,
                  );
                  const backups = await IndexedDbWorkspaceMergeBackups.open();
                  try {
                    await preserveReplicaBootstrapBackup(
                      own,
                      scope,
                      revision,
                      cursor,
                      {
                        metadata: target.metadata,
                        blobs,
                        store: backups,
                        assertScope,
                        id: () => crypto.randomUUID(),
                        now: () => new Date().toISOString(),
                      },
                    );
                  } finally {
                    blobs.close();
                    backups.close();
                  }
                },
                memoIdentity: { forTarget: deriveEntityMemoId },
                metadata: target.metadata,
                outbox: target.outbox,
                syncState: target.syncState,
                replica: target.replica,
                transport: localWorkTransport(generation, reviewed),
                clock: { now: () => new Date().toISOString() },
              },
            );
            return {
              synchronize: async () => {
                await coordinator.run();
              },
              close: () => target.close(),
            };
          } catch (error) {
            target.close();
            throw error;
          }
        },
      });
      return service.open(local.context, preview);
    },
    async recoverLocalReceipts() {
      const generation = serverGeneration;
      return recoverLocalWorkReceipts(local.context, {
        memoIdentity: { forTarget: deriveEntityMemoId },
        metadata: localStore.metadata,
        outbox: localStore.outbox,
        syncState: localStore.syncState,
        replica: localStore.replica,
        transport: localWorkTransport(generation),
        knowledgeWiki: localWiki,
      });
    },
    syncLocalWork,
    async synchronizeConnectedWorkspace() {
      const binding = await localStore.syncState.get(local.context.workspaceId);
      if (!binding?.remotePrincipalId || !binding.epoch) return null;
      await initialize();
      requireRemoteBindingScope(binding, serverGeneration);
      return syncLocalWork();
    },
    async pullLocalWorkChanges() {
      const generation = serverGeneration;
      const original = await localStore.syncState.get(
        local.context.workspaceId,
      );
      if (!original?.remotePrincipalId || !original.epoch)
        throw new DomainError("FORBIDDEN");
      const currentBinding = async () => {
        const value = await localStore.syncState.get(local.context.workspaceId);
        if (
          !value ||
          [
            "remotePrincipalId",
            "remoteWorkspaceId",
            "serverOrigin",
            "epoch",
          ].some(
            (key) =>
              value[key as keyof LocalSyncState] !==
              original[key as keyof LocalSyncState],
          )
        )
          throw new DomainError("VERSION_CONFLICT");
        requireRemoteBindingScope(value, generation);
        return value;
      };
      const transport = localWorkTransport(generation);
      if (!transport.pullPrivateMemos)
        throw new Error("LOCAL_MEMO_BOOTSTRAP_PORT_INCOMPLETE");
      const initializedMemos = await initializeLocalEntityMemoHistory(
        local.context,
        currentBinding,
        {
          identity: { forTarget: deriveEntityMemoId },
          metadata: localStore.metadata,
          outbox: localStore.outbox,
          replica: localStore.replica,
          pull: (scope, after) => transport.pullPrivateMemos!(scope, after),
        },
      );
      const binding = await currentBinding();
      requireRemoteBindingScope(binding, generation);
      const page = await transport.pull(binding);
      requireRemoteBindingScope(binding, generation);
      const pending = await localStore.outbox.list(local.context.workspaceId);
      const prepared = await prepareLocalWorkPull(
        local.context,
        binding,
        page,
        pending,
        localStore.metadata,
        { forTarget: deriveEntityMemoId },
      );
      requireRemoteBindingScope(binding, generation);
      if (prepared) await localStore.replica.commit(prepared);
      return {
        changed: initializedMemos || prepared !== null,
        cursor: prepared?.nextCursor ?? binding.cursor,
        hasMore:
          typeof page === "object" &&
          page !== null &&
          "hasMore" in page &&
          page.hasMore === true,
      };
    },
    set context(value: ActorContext | null) {
      if (
        value &&
        (value.workspaceId !== local.context.workspaceId ||
          value.principalId !== local.context.principalId)
      )
        throw new DomainError("FORBIDDEN");
    },
    initialize: async () => {},
    initializeRemoteAccount: initialize,
    get initialized() {
      return true;
    },
    get unavailable() {
      return unavailable;
    },
    get logoutWarning() {
      return logoutWarning;
    },
    get serverOrigin() {
      return serverOrigin;
    },
    /** Read-only reachability probe: health first, then authenticated session status. */
    probeServer: async (): Promise<ServerProbeResult> => {
      const checkedAt = new Date().toISOString();
      if (!serverOrigin)
        return {
          kind: "LOCAL_ONLY",
          latencyMs: null,
          status: null,
          checkedAt,
        };
      const started = performance.now();
      try {
        const health = await transport("/api/health");
        const latencyMs = Math.max(0, Math.round(performance.now() - started));
        if (!health.ok)
          return {
            kind: "SERVER_ERROR",
            latencyMs,
            status: health.status,
            checkedAt,
          };
        const session = await transport("/api/account/sessions");
        if (session.ok)
          return { kind: "OK", latencyMs, status: session.status, checkedAt };
        if (session.status === 401 || session.status === 403)
          return {
            kind: "AUTH_REQUIRED",
            latencyMs,
            status: session.status,
            checkedAt,
          };
        return {
          kind: "SERVER_ERROR",
          latencyMs,
          status: session.status,
          checkedAt,
        };
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        return {
          kind: code === "LOGIN_TIMEOUT" ? "TIMEOUT" : "NETWORK_FAILURE",
          latencyMs: Math.max(0, Math.round(performance.now() - started)),
          status: null,
          checkedAt,
        };
      }
    },
    async setServerOrigin(value: string) {
      await notifications.reconcile([]);
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
      await notifications.reconcile([]);
      resetIdentity();
      if (native) await invoke("detach_account");
    },
    async switchAccount(id: string) {
      await notifications.reconcile([]);
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
        if (
          selected.serverUrl === serverOrigin &&
          selected.userId === account?.id
        )
          await notifications.reconcile([]);
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
          await notifications.reconcile([]);
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
    createProjectSpace: (input: {
      projectId: string;
      title: string;
      inheritToChildren: boolean;
    }) => local.createProjectSpace(input),
    linkProjectSpace: (input: {
      projectId: string;
      spaceId: string;
      inheritToChildren: boolean;
    }) => local.linkProjectSpace(input),
    createProjectDocument: (input: {
      projectId: string;
      spaceId: string;
      title: string;
      bodyMd: string;
      aiPolicy?: LibraryInput["aiPolicy"];
    }) => local.createProjectDocument(input),
    projectUpload: (input: {
      projectId: string;
      name: string;
      mime: string;
      base64: string;
    }): Promise<ProjectMaterial> => {
      throw new DomainError("VALIDATION_ERROR", {
        reason: "FIRST_CLASS_FILE_REQUIRED",
        projectId: input.projectId,
      });
    },
    projectDelete: (id: string, version: number, deleted: boolean) =>
      local.projectDelete(id, version, deleted),
    projectActivity: (projectId: string) => local.projectActivity(projectId),
    projectFile: (id: string) =>
      Promise.reject<{ material: ProjectMaterial; base64: string }>(
        new DomainError("NOT_FOUND", { id }),
      ),
    saveLibrary: (id: string | null, version: number, input: LibraryInput) =>
      local.saveLibrary(id, version, input),
    async searchLibrary(query: string, spaceId: string) {
      const actor = { ...local.context },
        generation = serverGeneration;
      const localResults = await local.searchLibrary(query, spaceId);
      assertLocalSearchScope(actor, generation);
      const remoteIds = new Set(
        await searchRemoteKnowledge("library", query, spaceId),
      );
      const localIds = new Set(localResults.map((entry) => entry.id));
      const snapshot = remoteIds.size ? await local.loadWorkspace() : null;
      assertLocalSearchScope(actor, generation);
      return [
        ...localResults,
        ...(snapshot?.library ?? [])
          .filter(
            (entry) =>
              remoteIds.has(entry.id) &&
              !localIds.has(entry.id) &&
              entry.kind === "DOCUMENT" &&
              !entry.deletedAt &&
              (!spaceId || entry.spaceId === spaceId),
          )
          .map((entry) => ({
            id: entry.id,
            title: entry.title,
            spaceId: entry.spaceId!,
            score: 1,
          })),
      ];
    },
    purgeLibrary: async (id: string, version: number) => {
      await prepareKnowledgeLifecycle("library", id, version);
      return local.purgeLibrary(id, version);
    },
    deleteLibrary: async (id: string, version: number, deleted: boolean) => {
      await prepareKnowledgeLifecycle("library", id, version);
      return local.deleteLibrary(id, version, deleted);
    },
    libraryRevisions: (id: string) => local.libraryRevisions(id),
    async uploadImage(spaceId: string | null, file: File) {
      if (
        file.size === 0 ||
        !["image/png", "image/jpeg", "image/webp"].includes(file.type)
      )
        throw new DomainError("VALIDATION_ERROR");
      await requireRasterImage(file);
      const asset = await local.uploadFile(
        { name: file.name, mime: file.type, spaceId },
        file,
      );
      wakeFileProcessing();
      return { id: asset.id, url: "/api/v1/files/bytes?id=" + asset.id };
    },
    service: local.service,
    loadWorkspace: () => local.loadWorkspace(),
    loadWorkspaceWithRevision: () => local.loadWorkspaceWithRevision(),
    workspaceRevision: () => local.workspaceRevision(),
    subscribeWorkspace: (listener: () => void) =>
      local.subscribeWorkspace(listener),
    loadRemoteWorkspace: sync,
    async streamWorkspaceEvents(
      cursor: string,
      signal: AbortSignal,
      onCursor: (cursor: string) => void,
      onConnected: () => void,
    ) {
      if (native) throw new Error("STREAM_UNAVAILABLE");
      const generation = serverGeneration;
      const combined = AbortSignal.any([signal, requestController.signal]);
      const response = await fetch(
        serverOrigin +
          "/api/workspace/events?cursor=" +
          encodeURIComponent(cursor),
        {
          credentials: "same-origin",
          signal: combined,
          headers: workspaceRequestHeaders(),
        },
      );
      if (!response.ok || !response.body) throw new Error("STREAM_UNAVAILABLE");
      onConnected();
      const reader = response.body.getReader(),
        decoder = new WorkspaceEventDecoder(cursor);
      try {
        while (true) {
          const chunk = await reader.read();
          if (generation !== serverGeneration)
            throw new Error("SERVER_CHANGED");
          if (chunk.done) throw new Error("STREAM_DISCONNECTED");
          for (const changed of decoder.feed(chunk.value)) onCursor(changed);
        }
      } finally {
        try {
          await reader.cancel();
        } finally {
          reader.releaseLock();
        }
      }
    },
    providers: () => request<PersonalModelSummary[]>("/api/ai/providers"),
    modelConfiguration: () =>
      request<import("@arclattice/application").ModelConfiguration>(
        "/api/ai/configuration",
      ),
    saveModelConfiguration: (
      version: number,
      input: import("@arclattice/application").ModelConfigurationInput,
    ) =>
      request<import("@arclattice/application").ModelConfiguration>(
        "/api/ai/configuration/save",
        { version, input },
      ),
    connectionModels: (connectionId: string) =>
      request<{
        models: string[];
        capabilities: import("@arclattice/application").ModelProviderCapabilities;
      }>("/api/ai/connections/models", { connectionId }),
    testConnection: (connectionId: string) =>
      request<{ connected: true; discovery: "AVAILABLE" | "UNSUPPORTED" }>(
        "/api/ai/connections/test",
        { connectionId },
      ),
    saveProvider: (version: number, input: PersonalModelInput) =>
      request<PersonalModelSummary>("/api/ai/providers/save", {
        version,
        input,
      }),
    removeProvider: (scope: string, version: number, profileId = "default") =>
      request("/api/ai/providers/remove", { scope, version, profileId }),
    ai: (scope = "personal", profileId = "default", includeRuns = true) =>
      request<{
        route: ModelRoute | null;
        routes: ModelRoute[];
        runs: AgentRun[];
      }>(
        "/api/ai?scope=" +
          encodeURIComponent(scope) +
          "&profileId=" +
          encodeURIComponent(profileId) +
          "&includeRuns=" +
          String(includeRuns),
      ),
    async proposeMemo(
      targetInput: import("@arclattice/application").EntityMemoTarget,
      version: number,
      prompt: string,
    ) {
      const target = structuredClone(targetInput);
      await initialize();
      const generation = serverGeneration;
      const original = await localStore.syncState.get(
        local.context.workspaceId,
      );
      if (
        !original?.remotePrincipalId ||
        !original.remoteWorkspaceId ||
        !original.epoch
      )
        throw new DomainError("FORBIDDEN");
      requireRemoteBindingScope(original, generation);
      await syncLocalWork();
      const binding = await localStore.syncState.get(local.context.workspaceId);
      if (
        !binding ||
        [
          "remotePrincipalId",
          "remoteWorkspaceId",
          "serverOrigin",
          "epoch",
        ].some(
          (key) =>
            binding[key as keyof LocalSyncState] !==
            original[key as keyof LocalSyncState],
        )
      )
        throw new DomainError("VERSION_CONFLICT");
      requireRemoteBindingScope(binding, generation);
      const source = await local.getEntityMemo(target);
      if (!source || source.version !== version)
        throw new DomainError("VERSION_CONFLICT");
      if (
        (await localStore.outbox.list(local.context.workspaceId)).some(
          (mutation) =>
            mutation.entityType === "entityMemos" &&
            mutation.entityId === source.id,
        )
      )
        throw new Error("MEMO_SYNC_REQUIRED");
      const id = await deriveEntityMemoId(
        {
          workspaceId: original.remoteWorkspaceId,
          principalId: original.remotePrincipalId,
        },
        target,
      );
      const current = await localStore.syncState.get(local.context.workspaceId);
      if (!current || current.version !== binding.version)
        throw new DomainError("VERSION_CONFLICT");
      requireRemoteBindingScope(current, generation);
      const run = await request<AgentRun>("/api/ai/propose", {
        prompt,
        scope: "personal",
        responseFormat: "ANSWER",
        sources: [{ kind: "MEMO", id, version, target }],
      });
      const after = await localStore.syncState.get(local.context.workspaceId);
      if (!after || after.version !== current.version)
        throw new DomainError("VERSION_CONFLICT");
      requireRemoteBindingScope(after, generation);
      return run;
    },
    propose: (
      prompt: string,
      scope = "personal",
      sources: {
        range?: { from: number; to: number; text: string };
        kind: AiContextItem["ref"]["kind"];
        target?: import("@arclattice/application").EntityMemoTarget;
        id: string;
        version: number;
        source?: AiContextItem["source"];
      }[] = [],
      profileId = "default",
      retrievalContext?: { projectId?: string; currentSpaceId?: string },
      session?: { sessionId: string; sessionVersion: number },
      modelRouting?: { explicitProfileId?: string },
      responseFormat?: "REPLACEMENT" | "ANSWER",
    ) =>
      request<AgentRun>("/api/ai/propose", {
        prompt,
        scope,
        sources,
        profileId,
        ...(retrievalContext ? { retrievalContext } : {}),
        ...(modelRouting ? { modelRouting } : {}),
        ...(responseFormat ? { responseFormat } : {}),
        ...(session ?? {}),
      }),
    agentSessions: () =>
      request<import("@arclattice/application").AgentSessionSummary[]>(
        "/api/ai/sessions",
      ),
    promoteAgentRuns: (
      title: string,
      runs: { id: string; version: number }[],
    ) => request<AgentSession>("/api/v1/ai/sessions/promote", { title, runs }),
    agentSessionPage: (id: string, before?: number) =>
      request<import("@arclattice/application").AgentSessionPage>(
        `/api/ai/sessions/messages?id=${encodeURIComponent(id)}${before === undefined ? "" : `&before=${before}`}`,
      ),
    updateAgentSession: (
      id: string,
      version: number,
      changes: Parameters<
        import("@arclattice/application").AgentSessionService["update"]
      >[3],
    ) =>
      request<AgentSession>("/api/ai/sessions/update", {
        id,
        version,
        ...changes,
      }),
    async streamAiEvents(
      id: string,
      signal: AbortSignal,
      onEvents: (
        page: import("@arclattice/application").ModelEventPage,
      ) => void,
    ) {
      if (native) throw new Error("STREAM_UNAVAILABLE");
      const response = await fetch(
        "/api/ai/events/stream?id=" + encodeURIComponent(id),
        {
          credentials: "same-origin",
          signal,
          headers: workspaceRequestHeaders(),
        },
      );
      if (!response.ok || !response.body) throw new Error("STREAM_UNAVAILABLE");
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = frame
              .split("\n")
              .find((line) => line.startsWith("data: "));
            if (data) {
              const packet = JSON.parse(data.slice(6)) as {
                events: ModelEvent[];
                cursor: number;
                done: boolean;
              };
              onEvents(packet);
              if (packet.done) return;
            }
            boundary = buffer.indexOf("\n\n");
          }
        }
        throw new Error("STREAM_DISCONNECTED");
      } finally {
        try {
          await reader.cancel();
        } finally {
          reader.releaseLock();
        }
      }
    },
    agentRun: (id: string) =>
      request<AgentRun>("/api/v1/ai/run?id=" + encodeURIComponent(id)),
    aiEvents: (id: string, after = 0) =>
      request<import("@arclattice/application").ModelEventPage>(
        "/api/ai/events?id=" + encodeURIComponent(id) + "&after=" + after,
      ),
    createAgentSession: (
      title: string,
      modelProfileOverride: string | null = null,
    ) =>
      request<AgentSession>("/api/ai/sessions/create", {
        title,
        modelProfileOverride,
      }),
    setAgentSessionProfile: (
      id: string,
      version: number,
      profileId: string | null,
    ) =>
      request<AgentSession>("/api/ai/sessions/profile", {
        id,
        version,
        profileId,
      }),
    applyAi: (id: string, version: number, indices: number[]) =>
      request("/api/ai/apply", { id, version, indices }),
    decide: (id: string, version: number, approve: boolean) =>
      request<AgentRun>("/api/ai/decide", { id, version, approve }),
    decideHarness: (
      id: string,
      version: number,
      callId: string,
      approve: boolean,
      input?: unknown,
    ) =>
      request<AgentRun>("/api/ai/harness/decide", {
        id,
        version,
        callId,
        approve,
        ...(input === undefined ? {} : { input }),
      }),
    stopHarness: (id: string, version: number) =>
      request<AgentRun>("/api/ai/harness/stop", { id, version }),
    link: (
      from: EntityRef,
      to: EntityRef,
      relation: KnowledgeLink["relation"],
    ) => local.link(from, to, relation),
    unlink: (id: string, version: number) => local.unlink(id, version),
    activity: () => local.activity(),
    async backup() {
      return local.backup();
    },
    async remoteServerBackup() {
      const response = await transport("/api/backup", "{}");
      if (!response.ok) {
        const data = await response.json();
        throw new DomainError((data.error ?? "UNAVAILABLE") as ErrorCode);
      }
      return response.blob();
    },
    get loadImage() {
      return privateImageLoader();
    },
    revisions: (id: string) => local.revisions(id),
    organize: async (input: OrganizeInput) => {
      const captured = structuredClone(input),
        generation = serverGeneration;
      if (captured.kind === "NOTE" && captured.action === "delete") {
        for (const entry of captured.entries ?? [])
          await prepareKnowledgeLifecycle("notes", entry.id, entry.version);
      }
      if (generation !== serverGeneration) throw new Error("SERVER_CHANGED");
      return local.organize(captured);
    },
    saveCategory: (input: Parameters<CategoryService["save"]>[1]) =>
      local.saveCategory(input),
    reorderCategories: (ordered: Parameters<CategoryService["reorder"]>[1]) =>
      local.reorderCategories(ordered),
    moveManualOrder: (input: Parameters<ManualOrderService["move"]>[1]) =>
      local.moveManualOrder(input),
    previewPlan: (projectId: string | null, manifest: unknown) =>
      local.previewPlan(projectId, manifest),
    publishPlan: (id: string, version: number) =>
      local.publishPlan(id, version),
    saveTaskRecurrence: (
      input: Parameters<WorkflowService["saveTaskRecurrence"]>[1],
    ) => local.saveTaskRecurrence(input),
    saveRecurrence: (input: Parameters<WorkflowService["saveRecurrence"]>[1]) =>
      local.saveRecurrence(input),
    generateRecurrence: (
      id: string,
      version: number,
      from: string,
      to: string,
    ) => local.generateRecurrence(id, version, from, to),
    getEntityMemo: (
      target: import("@arclattice/application").EntityMemoTarget,
    ) => local.getEntityMemo(target),
    prepareMemoProposal: (
      target: import("@arclattice/application").EntityMemoTarget,
      change: import("@arclattice/application").MemoFormalization,
    ) => local.prepareMemoProposal(memoProposals, target, change),
    applyMemoProposal: (
      proposal: import("@arclattice/application").MemoProposal,
    ) => local.applyMemoProposal(memoProposals, proposal),
    saveEntityMemo: (
      input: import("@arclattice/domain").EntityMemoInput,
      version: number,
      deleted = false,
    ) => local.saveEntityMemo(input, version, deleted),
    saveReminder: (
      id: string | null,
      version: number,
      input: import("@arclattice/domain").ReminderInput,
      deleted = false,
    ) => local.saveReminder(id, version, input, deleted),
    skipOccurrence: (id: string, version: number) =>
      local.skipOccurrence(id, version),
    backfillOccurrence: (
      id: string,
      version: number,
      completedAt: string | null,
    ) => local.backfillOccurrence(id, version, completedAt),
    promoteNote: (
      id: string,
      version: number,
      spaceId: string,
      archiveSourceNote: boolean,
      parentDocumentId: string | null = null,
    ) =>
      local.promoteNote(
        id,
        version,
        spaceId,
        archiveSourceNote,
        parentDocumentId,
      ),
    moveLibraryDocument: (id: string, version: number, spaceId: string) =>
      local.moveLibraryDocument(id, version, spaceId),
    linkNoteToSpace: (id: string, version: number, spaceId: string) =>
      local.linkNoteToSpace(id, version, spaceId),
    saveNote: (id: string | null, version: number, input: NoteInput) =>
      local.saveNote(id, version, input),
    purgeNote: async (id: string, version: number) => {
      await prepareKnowledgeLifecycle("notes", id, version);
      return local.purgeNote(id, version);
    },
    deleteNote: async (id: string, version: number, deleted: boolean) => {
      await prepareKnowledgeLifecycle("notes", id, version);
      return local.deleteNote(id, version, deleted);
    },
    logout: async () => {
      logoutWarning = false;
      try {
        await notifications.reconcile([]);
      } catch {
        logoutWarning = true;
      }
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
