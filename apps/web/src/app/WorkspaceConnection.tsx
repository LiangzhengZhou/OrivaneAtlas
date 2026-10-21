import type {
  OwnedWorkspace,
  WorkspaceCatalogEntry,
  WorkspaceConnectionPreview,
} from "@arclattice/application";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Runtime } from "../bootstrap";
import { Button } from "../components/ui/Button";
import { loginErrorKey } from "../login-error";
import { WorkspaceConflictReview } from "./WorkspaceConflictReview";
import { WorkspaceImportRecovery } from "./WorkspaceImportRecovery";
import { WorkspaceMergeBackups } from "./WorkspaceMergeBackups";
import { WorkspaceMergeReview } from "./WorkspaceMergeReview";

/** Authentication is separate from explicit durable workspace selection. */
export function WorkspaceConnection({
  runtime,
  confirmLeave,
  onChanged,
}: {
  runtime: Runtime;
  confirmLeave(): Promise<boolean>;
  onChanged(): void;
}) {
  const { i18n } = useTranslation(),
    zh = i18n.language.startsWith("zh");
  const { t: desk } = useTranslation("desk");
  const [ready, setReady] = useState(runtime.remoteInitialized),
    [busy, setBusy] = useState(false);
  const [server, setServer] = useState(runtime.serverOrigin || location.origin),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  const [error, setError] = useState(""),
    [preview, setPreview] = useState<WorkspaceConnectionPreview | null>(null);
  const [entries, setEntries] = useState<readonly WorkspaceCatalogEntry[]>([]);
  const [mergeReview, setMergeReview] = useState(false);
  const [backupRevision, setBackupRevision] = useState(0);
  const [workspaceName, setWorkspaceName] = useState("");
  const [createAttempt, setCreateAttempt] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [owned, setOwned] = useState<readonly OwnedWorkspace[]>([]);
  const [savedAccounts, setSavedAccounts] = useState(() =>
    runtime.savedAccounts(),
  );
  const [, render] = useState(0);
  useEffect(() => {
    setPreview((current) =>
      current?.remotePrincipalId === runtime.account?.id &&
      current?.serverOrigin === runtime.serverOrigin
        ? current
        : null,
    );
    setMergeReview(false);
    setOwned([]);
    setCreateAttempt(null);
    setSavedAccounts(runtime.savedAccounts());
  }, [runtime, runtime.account?.id, runtime.serverOrigin]);
  useEffect(() => {
    let active = true;
    void runtime.listLocalWorkspaces().then(
      (list) => {
        if (active) setEntries(list);
      },
      (failure) => {
        if (active)
          setError(failure instanceof Error ? failure.message : "UNAVAILABLE");
      },
    );
    void runtime.initializeRemoteAccount().then(
      () => {
        if (!active) return;
        setReady(true);
        setSavedAccounts(runtime.savedAccounts());
        render((value) => value + 1);
        onChanged();
      },
      (failure) => {
        if (active) {
          setReady(true);
          setSavedAccounts(runtime.savedAccounts());
          setError(failure instanceof Error ? failure.message : "UNAVAILABLE");
        }
      },
    );
    return () => {
      active = false;
    };
  }, [runtime]);
  async function review() {
    if (busy) return;
    setBusy(true);
    setError("");
    setMergeReview(false);
    try {
      setPreview(await runtime.previewWorkspaceConnection());
      setOwned(await runtime.listOwnedWorkspaces());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "UNAVAILABLE");
    } finally {
      setBusy(false);
    }
  }
  const account = runtime.account;
  return (
    <section
      className="workspace-connection"
      aria-label={zh ? "连接账户与工作区" : "Account and workspace connection"}
    >
      <h2>{zh ? "工作区与同步" : "Workspaces and sync"}</h2>
      <WorkspaceConflictReview runtime={runtime} zh={zh} />
      <WorkspaceImportRecovery
        confirmLeave={confirmLeave}
        runtime={runtime}
        zh={zh}
        revision={backupRevision}
      />
      <WorkspaceMergeBackups
        runtime={runtime}
        zh={zh}
        revision={backupRevision}
      />
      <p>
        {zh
          ? "内容先保存在本机。登录账户不会合并或替换当前工作区。"
          : "Content is stored on this device first. Signing in does not merge or replace this workspace."}
      </p>
      {ready && savedAccounts.length > 0 && (
        <section aria-label={zh ? "已保存的账户" : "Saved accounts"}>
          {savedAccounts.map((entry) => (
            <div className="token-row" key={entry.id}>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  if (busy || !(await confirmLeave())) return;
                  setServer(entry.serverUrl);
                  setUsername(entry.displayName);
                  setPassword("");
                  setError("");
                  if (!runtime.native) return;
                  setBusy(true);
                  setPreview(null);
                  setMergeReview(false);
                  try {
                    await runtime.switchAccount(entry.id);
                    render((value) => value + 1);
                    onChanged();
                  } catch (failure) {
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : "UNAVAILABLE",
                    );
                  } finally {
                    setSavedAccounts(runtime.savedAccounts());
                    setBusy(false);
                  }
                }}
              >
                {entry.displayName}
              </Button>
              <small>{entry.serverUrl}</small>
              <Button
                variant="ghost"
                disabled={busy}
                aria-label={`${zh ? "忘记账户" : "Forget account"} ${entry.displayName}`}
                onClick={async () => {
                  if (busy || !(await confirmLeave())) return;
                  setBusy(true);
                  setError("");
                  try {
                    await runtime.forgetAccount(entry.id);
                    setPreview(null);
                    setMergeReview(false);
                    onChanged();
                    render((value) => value + 1);
                  } catch (failure) {
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : "UNAVAILABLE",
                    );
                  } finally {
                    setSavedAccounts(runtime.savedAccounts());
                    setBusy(false);
                  }
                }}
              >
                {zh ? "忘记账户" : "Forget account"}
              </Button>
            </div>
          ))}
        </section>
      )}
      {!ready ? (
        <p role="status">{zh ? "检查账户…" : "Checking account…"}</p>
      ) : account ? (
        <>
          <p>{account.username}</p>
          <details>
            <summary>
              {zh ? "新建空的远程工作区" : "Create an empty remote workspace"}
            </summary>
            <p>
              {zh
                ? "新工作区会单独创建。本机内容保留，合并需要另外预览和确认。"
                : "Creates a separate workspace. Device content is retained; importing requires a separate review."}
            </p>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (busy || !workspaceName.trim()) return;
                const attempt = createAttempt ?? {
                  id: crypto.randomUUID(),
                  name: workspaceName.trim(),
                };
                setCreateAttempt(attempt);
                setBusy(true);
                setError("");
                try {
                  const workspace = await runtime.createOwnedWorkspace(
                    attempt.id,
                    attempt.name,
                  );
                  setOwned(await runtime.listOwnedWorkspaces());
                  setPreview(
                    await runtime.previewWorkspaceConnection(workspace.id),
                  );
                  setMergeReview(false);
                  setWorkspaceName("");
                  setCreateAttempt(null);
                } catch (failure) {
                  setError(
                    failure instanceof Error ? failure.message : "UNAVAILABLE",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="field">
                <span>{zh ? "新工作区名称" : "New workspace name"}</span>
                <input
                  required
                  maxLength={240}
                  value={workspaceName}
                  disabled={busy || createAttempt !== null}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                />
              </label>
              <Button
                type="submit"
                variant="secondary"
                pending={busy}
                disabled={!workspaceName.trim()}
              >
                {createAttempt
                  ? zh
                    ? "重试创建"
                    : "Retry creation"
                  : zh
                    ? "创建空工作区"
                    : "Create empty workspace"}
              </Button>
            </form>
          </details>
          <Button
            variant="secondary"
            pending={busy}
            onClick={() => void review()}
          >
            {zh ? "查看同步选项" : "Review sync options"}
          </Button>
        </>
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            try {
              await runtime.setServerOrigin(server);
              await runtime.session({ username: username.trim(), password });
              setPassword("");
              render((value) => value + 1);
              onChanged();
              setPreview(await runtime.previewWorkspaceConnection());
            } catch (failure) {
              setError(
                failure instanceof Error ? failure.message : "UNAVAILABLE",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span>{zh ? "服务器" : "Server"}</span>
            <input
              type="url"
              required
              value={server}
              disabled={busy}
              onChange={(event) => setServer(event.target.value)}
            />
          </label>
          <label className="field">
            <span>{zh ? "用户名" : "Username"}</span>
            <input
              required
              autoComplete="username"
              maxLength={32}
              value={username}
              disabled={busy}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="field">
            <span>{zh ? "密码" : "Password"}</span>
            <input
              required
              type="password"
              autoComplete="current-password"
              maxLength={128}
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <Button type="submit" variant="primary" pending={busy}>
            {zh ? "登录并查看选项" : "Sign in and review options"}
          </Button>
          {busy && <p role="status">{desk("loginDeadline")}</p>}
        </form>
      )}
      {error && (
        <div role="alert">
          <p>
            {!account && loginErrorKey(error) !== "loginError"
              ? desk(loginErrorKey(error))
              : error === "VERSION_CONFLICT"
                ? zh
                  ? "工作区在预览后发生了变化，请重新查看。"
                  : "The workspace changed after the preview. Review it again."
                : zh
                  ? "无法完成连接，请检查账户、服务器或网络。"
                  : "Could not connect. Check the account, server or network."}
          </p>
          <details>
            <summary>{zh ? "技术详情" : "Technical details"}</summary>
            <code>{error}</code>
          </details>
        </div>
      )}
      {account && owned.length > 1 && (
        <nav aria-label={zh ? "账户中的工作区" : "Workspaces in this account"}>
          {owned.map((workspace) => (
            <Button
              key={workspace.id}
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                if (busy) return;
                setBusy(true);
                setError("");
                setMergeReview(false);
                try {
                  setPreview(
                    await runtime.previewWorkspaceConnection(workspace.id),
                  );
                } catch (failure) {
                  setError(
                    failure instanceof Error ? failure.message : "UNAVAILABLE",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {workspace.name}
            </Button>
          ))}
        </nav>
      )}
      {preview && (
        <section
          aria-label={zh ? "工作区连接预览" : "Workspace connection preview"}
        >
          <h3>{zh ? "选择工作区前" : "Before choosing a workspace"}</h3>
          <dl>
            {(["local", "remote"] as const).map((side) => (
              <div key={side}>
                <dt>
                  {side === "local"
                    ? zh
                      ? "当前本机工作区"
                      : "Current device workspace"
                    : zh
                      ? "账户工作区"
                      : "Account workspace"}
                </dt>
                <dd>
                  {zh ? "任务" : "Tasks"} {preview.counts[side].tasks} ·{" "}
                  {zh ? "项目" : "Projects"} {preview.counts[side].projects} ·{" "}
                  {zh ? "文档" : "Documents"} {preview.counts[side].documents} ·{" "}
                  {zh ? "文件" : "Files"} {preview.counts[side].files}
                </dd>
              </div>
            ))}
          </dl>
          <p>
            {zh
              ? "打开账户工作区会建立独立的本机副本。当前工作区会保留，可随时切回。"
              : "Open the account workspace as a separate local replica. This workspace is retained and you can switch back."}
          </p>
          <Button
            variant="primary"
            pending={busy}
            onClick={async () => {
              if (busy || !(await confirmLeave())) return;
              setBusy(true);
              setError("");
              try {
                await runtime.openAccountWorkspace(preview);
                location.reload();
              } catch (failure) {
                setError(
                  failure instanceof Error ? failure.message : "UNAVAILABLE",
                );
                setBusy(false);
              }
            }}
          >
            {zh ? "打开账户工作区" : "Open account workspace"}
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setMergeReview((value) => !value)}
            aria-expanded={mergeReview}
          >
            {zh ? "查看合并预览" : "Review merge preview"}
          </Button>
          {mergeReview && (
            <WorkspaceMergeReview
              key={`${preview.remoteWorkspaceId}:${preview.localRevision}`}
              preview={preview}
              zh={zh}
              runtime={runtime}
              onBackupSaved={() => setBackupRevision((value) => value + 1)}
            />
          )}
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setPreview(null)}
          >
            {zh ? "暂不启用同步" : "Keep sync off for now"}
          </Button>
        </section>
      )}
      {entries.length > 1 && (
        <nav aria-label={zh ? "本机工作区" : "Device workspaces"}>
          {entries.map((entry) => (
            <Button
              key={entry.id}
              variant="ghost"
              aria-current={
                runtime.activeWorkspace.id === entry.id ? "page" : undefined
              }
              disabled={busy || runtime.activeWorkspace.id === entry.id}
              onClick={async () => {
                if (!(await confirmLeave())) return;
                setBusy(true);
                setError("");
                try {
                  await runtime.selectLocalWorkspace(entry.id);
                  location.reload();
                } catch (failure) {
                  setError(
                    failure instanceof Error ? failure.message : "UNAVAILABLE",
                  );
                  setBusy(false);
                }
              }}
            >
              {entry.id === "default"
                ? zh
                  ? "本机原工作区"
                  : "Original device workspace"
                : entry.title === "Account workspace"
                  ? zh
                    ? "账户工作区"
                    : "Account workspace"
                  : entry.title}
            </Button>
          ))}
        </nav>
      )}
    </section>
  );
}
