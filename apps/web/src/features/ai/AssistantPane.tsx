import type {
  AgentRun,
  AgentSession,
  AgentSessionSummary,
  AiContextItem,
  EntityRef,
  ModelProfile,
} from "@arclattice/application";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Runtime, Snapshot } from "../../bootstrap";
import { Button } from "../../components/ui/Button";
import { Dialog, Select } from "../../components/ui/Surfaces";
import { Markdown } from "../../Markdown";
import { VirtualTaskCollection } from "../tasks/VirtualTaskCollection";
import { AnswerSources } from "./AnswerSources";
import { ContextBar } from "./ContextBar";
import { ConversationFilters } from "./ConversationFilters";
import { ConversationMenu } from "./ConversationMenu";
import { HarnessApproval, ToolActivity } from "./ToolActivity";

export function AssistantPane({
  runtime,
  context,
  projectId,
  currentSpaceId,
  onClose,
  embedded = false,
  snapshot,
  onSource,
}: {
  runtime: Runtime;
  context: AiContextItem[];
  projectId?: string | undefined;
  currentSpaceId?: string | undefined;
  onClose(): void;
  embedded?: boolean;
  snapshot?: Snapshot;
  onSource?(ref: EntityRef): void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [prompt, setPrompt] = useState("");
  const [selectedProject, setSelectedProject] = useState<string | null>(
    projectId ?? null,
  );
  const [selectedSpace, setSelectedSpace] = useState<string | null>(
    currentSpaceId ?? null,
  );
  const [selectedContext, setSelectedContext] = useState(context);
  const contextKey = context
    .map((item) => item.ref.kind + ":" + item.ref.id + ":" + item.version)
    .join("|");
  const previousContextKey = useRef(contextKey);
  useEffect(() => {
    if (previousContextKey.current === contextKey) return;
    previousContextKey.current = contextKey;
    setSelectedContext(context);
  }, [context, contextKey]);
  useEffect(() => {
    setSelectedProject(projectId ?? null);
  }, [projectId]);
  useEffect(() => {
    setSelectedSpace(currentSpaceId ?? null);
  }, [currentSpaceId]);
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [conversationSearch, setConversationSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [groupByProject, setGroupByProject] = useState(false);
  const projectTitles = useMemo(
    () =>
      new Map(
        snapshot?.items
          .filter((item) => item.type === "PROJECT")
          .map((item) => [item.id, item.title]),
      ),
    [snapshot?.items],
  );
  const conversationGroups = useMemo(() => {
    const query = conversationSearch.trim().toLocaleLowerCase();
    const visible = sessions.filter(
      (entry) =>
        !!entry.archivedAt === showArchived &&
        `${entry.title} ${entry.preview}`.toLocaleLowerCase().includes(query),
    );
    if (!groupByProject) return [{ id: "recent", title: "", entries: visible }];
    const groups = new Map<string, AgentSessionSummary[]>();
    for (const entry of visible) {
      const key = entry.projectId ?? "unbound";
      const entries = groups.get(key) ?? [];
      entries.push(entry);
      groups.set(key, entries);
    }
    return [...groups].map(([id, entries]) => ({
      id,
      entries,
      title:
        projectTitles.get(id) ??
        (id === "unbound"
          ? zh
            ? "未关联项目"
            : "No project"
          : zh
            ? "关联项目"
            : "Linked project"),
    }));
  }, [
    sessions,
    conversationSearch,
    showArchived,
    groupByProject,
    projectTitles,
    zh,
  ]);
  const [renameTitle, setRenameTitle] = useState<string | null>(null);
  const [deletedSession, setDeletedSession] = useState<AgentSession | null>(
    null,
  );
  async function changeConversation(
    changes: Parameters<Runtime["updateAgentSession"]>[2],
  ) {
    if (!session) return;
    setPending(true);
    try {
      const updated = await runtime.updateAgentSession(
        session.id,
        session.version,
        changes,
      );
      if (updated.deletedAt) {
        setDeletedSession(updated);
        setSession(null);
        setRun(null);
      } else
        setSession((previous) =>
          previous ? { ...updated, messages: previous.messages } : updated,
        );
      setSessions(await runtime.agentSessions());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "UNAVAILABLE");
    } finally {
      setPending(false);
    }
  }
  const [excludedContext, setExcludedContext] = useState<Set<string>>(
    new Set(),
  );
  const [session, setSession] = useState<AgentSession | null>(null);
  const [historyBefore, setHistoryBefore] = useState(0);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  async function openSession(id: string) {
    const page = await runtime.agentSessionPage(id);
    setSession(page.session);
    setHistoryBefore(page.before);
    setHasMoreHistory(page.hasMore);
    return page.session;
  }
  const [profiles, setProfiles] = useState<ModelProfile[]>([]),
    [explicitProfile, setExplicitProfile] = useState("");
  useEffect(() => {
    let active = true;
    void runtime
      .modelConfiguration()
      .then((configuration) => {
        if (active) setProfiles(configuration.profiles);
      })
      .catch((failure) => {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : "MODEL_CONFIGURATION_UNAVAILABLE",
          );
      });
    return () => {
      active = false;
    };
  }, [runtime]);
  useEffect(() => {
    setExplicitProfile(session?.modelProfileOverride ?? "");
  }, [session?.id, session?.modelProfileOverride]);
  useEffect(() => {
    let active = true;
    void Promise.all([runtime.agentSessions(), runtime.ai()])
      .then(async ([sessions, state]) => {
        if (active) {
          setSessions(sessions);
          const latestSummary =
            sessions.find((entry) => !entry.archivedAt) ?? null;
          const latest = latestSummary
            ? await runtime.agentSessionPage(latestSummary.id)
            : null;
          if (!active) return;
          setSession(latest?.session ?? null);
          setHistoryBefore(latest?.before ?? 0);
          setHasMoreHistory(latest?.hasMore ?? false);
          setRun(
            state.runs.find(
              (entry) =>
                entry.sessionId === latest?.session.id &&
                ["WAITING_APPROVAL", "RUNNING"].includes(entry.status),
            ) ??
              state.runs.find(
                (entry) => entry.sessionId === latest?.session.id,
              ) ??
              null,
          );
        }
      })
      .catch((failure) => {
        if (active)
          setError(failure instanceof Error ? failure.message : "UNAVAILABLE");
      });
    return () => {
      active = false;
    };
  }, [runtime]);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [pending, setPending] = useState(false);
  const [streamedText, setStreamedText] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (
      run?.status !== "RUNNING" ||
      (run.harness?.status === "WAITING_APPROVAL" &&
        !run.toolApprovals?.[run.harness.pending[0]?.id ?? ""])
    )
      return;
    let active = true,
      loading = false,
      cursor = 0,
      delay = 1000;
    let timer: number | undefined;
    const controller = new AbortController();
    const append = (page: import("@arclattice/application").ModelEventPage) => {
      if (!active || page.cursor <= cursor) return;
      const overlap = Math.max(0, cursor - (page.cursor - page.events.length));
      const delta = page.events
        .slice(overlap)
        .flatMap((event) => (event.type === "text-delta" ? [event.text] : []))
        .join("");
      cursor = page.cursor;
      if (delta) setStreamedText((previous) => previous + delta);
    };
    const refresh = async () => {
      if (loading || !active) return;
      loading = true;
      try {
        const result = await runtime.ai();
        const latest = result.runs.find((entry) => entry.id === run.id);
        if (active && latest) {
          if (latest.status !== "RUNNING") {
            if (latest.sessionId) {
              const page = await runtime.agentSessionPage(latest.sessionId);
              if (active) {
                setSession(page.session);
                setHistoryBefore(page.before);
                setHasMoreHistory(page.hasMore);
                const summaries = await runtime.agentSessions();
                if (active) setSessions(summaries);
              }
            }
          }
          if (active) setRun(latest);
        }
      } catch (failure) {
        if (active)
          setError(failure instanceof Error ? failure.message : "UNAVAILABLE");
      } finally {
        loading = false;
      }
    };
    const poll = async () => {
      if (!active) return;
      try {
        const page = await runtime.aiEvents(run.id, cursor);
        append(page);
        if (page.done) {
          await refresh();
          return;
        }
        delay = Math.min(4000, delay * 2);
      } catch (failure) {
        if (active)
          setError(failure instanceof Error ? failure.message : "UNAVAILABLE");
        delay = Math.min(4000, delay * 2);
      }
      if (active) timer = window.setTimeout(() => void poll(), delay);
    };
    void runtime
      .streamAiEvents(run.id, controller.signal, append)
      .then(() => refresh())
      .catch(() => {
        if (active) timer = window.setTimeout(() => void poll(), 1000);
      });
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [runtime, run?.id, run?.status, run?.version, run?.harness?.status]);
  async function execute(action: () => Promise<AgentRun>) {
    setPending(true);
    setError("");
    setStreamedText("");
    try {
      const result = await action();
      setRun(result);
      const sessions = await runtime.agentSessions();
      setSessions(sessions);
      setPrompt("");
      if (result.sessionId) await openSession(result.sessionId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "UNAVAILABLE");
    } finally {
      setPending(false);
    }
  }
  async function sendQuestion(question: string) {
    return execute(() =>
      (async () => {
        let currentSession =
          session ??
          (await runtime.createAgentSession(
            question.slice(0, 240),
            explicitProfile || null,
          ));
        if (!session && (selectedProject || selectedSpace))
          currentSession = await runtime.updateAgentSession(
            currentSession.id,
            currentSession.version,
            { projectId: selectedProject, spaceId: selectedSpace },
          );
        return runtime.propose(
          question,
          "personal",
          selectedContext
            .filter(
              (item) =>
                item.permission.aiAccess !== "DENY" &&
                !excludedContext.has(item.ref.id),
            )
            .map((item) => ({
              ...item.ref,
              version: item.version,
              source: item.source,
            })),
          "default",
          {
            ...(selectedProject ? { projectId: selectedProject } : {}),
            ...(selectedSpace ? { currentSpaceId: selectedSpace } : {}),
          },
          {
            sessionId: currentSession.id,
            sessionVersion: currentSession.version,
          },
          explicitProfile ? { explicitProfileId: explicitProfile } : {},
        );
      })(),
    );
  }
  return (
    <aside
      className={
        embedded ? "assistant-pane atlas-conversation" : "assistant-pane"
      }
      aria-label="Atlas Assistant"
    >
      <header>
        <h2>Atlas</h2>
        {!embedded && (
          <Button
            type="button"
            onClick={onClose}
            aria-label={zh ? "关闭助手" : "Close assistant"}
          >
            ×
          </Button>
        )}
      </header>
      <div className="conversation-body">
        <div className="conversation-sidebar">
          <Button
            variant="primary"
            type="button"
            disabled={
              pending ||
              run?.status === "RUNNING" ||
              run?.status === "WAITING_APPROVAL"
            }
            onClick={() => {
              setSession(null);
              setRun(null);
              setExplicitProfile("");
            }}
          >
            {zh ? "新对话" : "New conversation"}
          </Button>
          <nav
            className="conversation-list"
            aria-label={zh ? "最近对话" : "Recent conversations"}
          >
            <input
              aria-label={zh ? "搜索对话" : "Search conversations"}
              placeholder={zh ? "搜索" : "Search"}
              value={conversationSearch}
              onChange={(event) => setConversationSearch(event.target.value)}
            />
            <ConversationFilters
              zh={zh}
              archived={showArchived}
              grouped={groupByProject}
              onArchived={setShowArchived}
              onGrouped={setGroupByProject}
            />
            {conversationGroups.map((group) => (
              <section key={group.id}>
                {group.title && <h3>{group.title}</h3>}
                <VirtualTaskCollection
                  items={group.entries}
                  virtualizeAfter={40}
                  estimatedRowHeight={72}
                  render={(entry) => (
                    <Button
                      className="conversation-entry"
                      variant="ghost"
                      type="button"
                      key={entry.id}
                      aria-current={
                        entry.id === session?.id ? "page" : undefined
                      }
                      disabled={
                        pending ||
                        run?.status === "RUNNING" ||
                        run?.status === "WAITING_APPROVAL"
                      }
                      onClick={async () => {
                        setPending(true);
                        try {
                          await openSession(entry.id);
                          setRun(null);
                          setStreamedText("");
                          const state = await runtime.ai();
                          setRun(
                            state.runs.find(
                              (run) => run.sessionId === entry.id,
                            ) ?? null,
                          );
                        } catch (failure) {
                          setError(
                            failure instanceof Error
                              ? failure.message
                              : "UNAVAILABLE",
                          );
                        } finally {
                          setPending(false);
                        }
                      }}
                    >
                      <span className="conversation-entry-title">
                        {entry.title}
                      </span>
                      {entry.projectId && (
                        <small>
                          {projectTitles.get(entry.projectId) ??
                            (zh ? "项目" : "Project")}
                        </small>
                      )}
                    </Button>
                  )}
                />
              </section>
            ))}
          </nav>
        </div>
        <div className="conversation-main">
          <div className="conversation-messages">
            {session && (
              <div className="toolbar">
                <h3 className="conversation-title">{session.title}</h3>
                <ConversationMenu
                  zh={zh}
                  archived={!!session.archivedAt}
                  disabled={
                    pending ||
                    run?.status === "RUNNING" ||
                    run?.status === "WAITING_APPROVAL"
                  }
                  onRename={() => setRenameTitle(session.title)}
                  onArchive={() =>
                    void changeConversation({
                      archivedAt: session.archivedAt
                        ? null
                        : new Date().toISOString(),
                    })
                  }
                  onDelete={() =>
                    void changeConversation({
                      deletedAt: new Date().toISOString(),
                    })
                  }
                />
              </div>
            )}
            {deletedSession && (
              <div role="status">
                {zh ? "对话已删除" : "Conversation deleted"}
                <Button
                  disabled={pending}
                  onClick={async () => {
                    setPending(true);
                    try {
                      await runtime.updateAgentSession(
                        deletedSession.id,
                        deletedSession.version,
                        { deletedAt: null },
                      );
                      setSessions(await runtime.agentSessions());
                      await openSession(deletedSession.id);
                      setDeletedSession(null);
                    } catch (failure) {
                      setError(
                        failure instanceof Error
                          ? failure.message
                          : "UNAVAILABLE",
                      );
                    } finally {
                      setPending(false);
                    }
                  }}
                >
                  {zh ? "撤销" : "Undo"}
                </Button>
              </div>
            )}
            {renameTitle !== null && (
              <Dialog
                aria-label={zh ? "重命名对话" : "Rename conversation"}
                onRequestClose={() => setRenameTitle(null)}
              >
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void changeConversation({ title: renameTitle });
                    setRenameTitle(null);
                  }}
                >
                  <input
                    autoFocus
                    required
                    maxLength={240}
                    aria-label={zh ? "对话标题" : "Conversation title"}
                    value={renameTitle}
                    onChange={(event) => setRenameTitle(event.target.value)}
                  />
                  <Button type="submit" disabled={pending}>
                    {zh ? "保存" : "Save"}
                  </Button>
                </form>
              </Dialog>
            )}
            {hasMoreHistory && session && (
              <Button
                type="button"
                disabled={pending}
                onClick={async () => {
                  setPending(true);
                  try {
                    const page = await runtime.agentSessionPage(
                      session.id,
                      historyBefore,
                    );
                    setSession((previous) =>
                      previous?.id === page.session.id
                        ? {
                            ...page.session,
                            messages: [
                              ...page.session.messages,
                              ...previous.messages,
                            ],
                          }
                        : previous,
                    );
                    setHistoryBefore(page.before);
                    setHasMoreHistory(page.hasMore);
                  } catch (failure) {
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : "UNAVAILABLE",
                    );
                  } finally {
                    setPending(false);
                  }
                }}
              >
                {zh ? "加载更早消息" : "Load earlier messages"}
              </Button>
            )}
            {session?.messages.map((message) => (
              <section
                key={message.id}
                data-message-kind={message.kind}
                aria-label={
                  message.kind === "USER"
                    ? zh
                      ? "用户消息"
                      : "User message"
                    : message.kind === "ASSISTANT"
                      ? zh
                        ? "助手消息"
                        : "Assistant message"
                      : zh
                        ? "对话事件"
                        : "Conversation event"
                }
              >
                <strong>
                  {message.kind === "USER"
                    ? zh
                      ? "你"
                      : "You"
                    : message.kind === "ASSISTANT"
                      ? "Atlas"
                      : message.kind === "PROPOSAL"
                        ? zh
                          ? "提案"
                          : "Proposal"
                        : message.kind === "ERROR"
                          ? zh
                            ? "错误"
                            : "Error"
                          : zh
                            ? "工具活动"
                            : "Tool activity"}
                </strong>
                <div
                  className={
                    message.kind === "PROPOSAL"
                      ? "proposal-card"
                      : message.kind.startsWith("TOOL")
                        ? "tool-call-card"
                        : "message-content"
                  }
                >
                  {message.kind.startsWith("TOOL") ||
                  message.kind === "PROPOSAL" ? (
                    <ToolActivity text={message.text} zh={zh} />
                  ) : message.kind === "ERROR" ? (
                    <div role="alert">
                      <strong>
                        {message.text === "MODEL_REQUEST_REJECTED"
                          ? zh
                            ? "请求已取消"
                            : "Request canceled"
                          : zh
                            ? "模型请求失败"
                            : "Model request failed"}
                      </strong>
                      <p>
                        {message.text === "MODEL_REQUEST_REJECTED"
                          ? zh
                            ? "本次请求未发送给模型。"
                            : "This request was not sent to the model."
                          : zh
                            ? "请检查模型配置或网络连接。"
                            : "Check your model configuration or network connection."}
                      </p>
                      <Button
                        disabled={
                          pending ||
                          run?.status === "RUNNING" ||
                          run?.status === "WAITING_APPROVAL"
                        }
                        onClick={() =>
                          void sendQuestion(
                            session?.messages
                              .slice()
                              .reverse()
                              .find((entry) => entry.kind === "USER")?.text ??
                              prompt,
                          )
                        }
                      >
                        {zh ? "重新尝试" : "Retry"}
                      </Button>
                      <Button
                        onClick={() => {
                          window.location.hash = "settings";
                          if (!embedded) onClose();
                        }}
                      >
                        {zh ? "检查模型设置" : "Check model settings"}
                      </Button>
                      <details>
                        <summary>
                          {zh ? "查看技术详情" : "Technical details"}
                        </summary>
                        <code>{message.text}</code>
                      </details>
                    </div>
                  ) : (
                    <Markdown text={message.text} />
                  )}
                </div>
                {message.kind === "ASSISTANT" && (
                  <AnswerSources
                    evidence={message.evidence}
                    zh={zh}
                    onOpen={(ref) => {
                      onSource?.(ref);
                      if (!embedded) onClose();
                    }}
                  />
                )}
              </section>
            ))}

            {error && (
              <div role="alert">
                <strong>{zh ? "模型请求失败" : "Model request failed"}</strong>
                <p>
                  {zh
                    ? "请检查模型配置或网络连接。"
                    : "Check your model configuration or network connection."}
                </p>
                <Button
                  disabled={pending}
                  onClick={() =>
                    void sendQuestion(
                      prompt ||
                        session?.messages
                          .slice()
                          .reverse()
                          .find((entry) => entry.kind === "USER")?.text ||
                        "",
                    )
                  }
                >
                  {zh ? "重新尝试" : "Retry"}
                </Button>
                <Button
                  onClick={() => {
                    location.hash = "settings";
                    if (!embedded) onClose();
                  }}
                >
                  {zh ? "检查模型设置" : "Check model settings"}
                </Button>
                <details>
                  <summary>{zh ? "查看技术详情" : "Technical details"}</summary>
                  <code>{error}</code>
                </details>
              </div>
            )}
            {!session?.messages.length && (
              <div
                className="contextual-starters"
                aria-label={zh ? "开始对话" : "Conversation starters"}
              >
                {(selectedContext.some((item) => item.ref.kind === "DOCUMENT")
                  ? zh
                    ? [
                        "总结本文",
                        "寻找相关 Wiki",
                        "改进文档",
                        "根据本文创建任务",
                      ]
                    : [
                        "Summarize this document",
                        "Find related Wiki pages",
                        "Improve this document",
                        "Create tasks from this document",
                      ]
                  : selectedProject
                    ? zh
                      ? [
                          "总结这个项目",
                          "找出阻塞任务",
                          "建议下一步",
                          "搜索相关知识",
                        ]
                      : [
                          "Summarize this project",
                          "Find blocked tasks",
                          "Suggest next steps",
                          "Search related knowledge",
                        ]
                    : zh
                      ? ["今天最值得做什么", "找出阻塞任务", "整理未完成任务"]
                      : [
                          "What should I do today?",
                          "Find blocked tasks",
                          "Organize unfinished tasks",
                        ]
                ).map((starter) => (
                  <Button
                    key={starter}
                    type="button"
                    onClick={() => setPrompt(starter)}
                  >
                    {starter}
                  </Button>
                ))}
              </div>
            )}
            {run?.harness?.status === "WAITING_APPROVAL" && (
              <div>
                <HarnessApproval
                  key={run.harness.pending[0]?.id}
                  run={run}
                  runtime={runtime}
                  zh={zh}
                  busy={pending}
                  onDecision={(action) => void execute(action)}
                />
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    void execute(() => runtime.stopHarness(run.id, run.version))
                  }
                >
                  {zh ? "停止本次运行" : "Stop this run"}
                </Button>
              </div>
            )}
            {!!run?.context?.length &&
              !session?.messages.some(
                (message) =>
                  message.runId === run.id &&
                  message.kind === "ASSISTANT" &&
                  message.evidence?.length,
              ) && (
                <section
                  aria-label={zh ? "来源" : "Sources"}
                  className="answer-sources"
                >
                  <h3>
                    {zh ? "来源" : "Sources"} {run.context.length}
                  </h3>
                  {run.context.map((source) => (
                    <Button
                      key={source.ref.kind + source.ref.id}
                      type="button"
                      onClick={() => {
                        onSource?.(source.ref);
                        if (!embedded) onClose();
                      }}
                    >
                      {source.title}
                    </Button>
                  ))}
                </section>
              )}
            {run?.status === "RUNNING" && streamedText && (
              <div aria-live="polite">
                <Markdown text={streamedText} />
              </div>
            )}
            {run?.status === "WAITING_APPROVAL" && (
              <section className="approval-card">
                <h3>{zh ? "AI 将读取" : "AI will read"}</h3>
                {(run.context ?? []).map((item) => (
                  <p key={item.ref.id}>{item.title}</p>
                ))}
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    void execute(() =>
                      runtime.decide(run.id, run.version, true),
                    )
                  }
                >
                  {zh ? "批准本次请求" : "Approve request"}
                </Button>
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    void execute(() =>
                      runtime.decide(run.id, run.version, false),
                    )
                  }
                >
                  {zh ? "拒绝" : "Reject"}
                </Button>
              </section>
            )}
            {run?.output &&
              !session?.messages.some(
                (message) =>
                  message.runId === run.id && message.kind === "ASSISTANT",
              ) && (
                <section
                  data-message-kind="ASSISTANT"
                  aria-label={zh ? "助手消息" : "Assistant message"}
                >
                  <Markdown text={run.output} />
                </section>
              )}
          </div>
          <div className="conversation-composer">
            <label>
              {zh ? "模型配置" : "Model profile"}
              <Select
                aria-label={zh ? "对话模型配置" : "Conversation model profile"}
                value={explicitProfile}
                disabled={
                  pending ||
                  run?.status === "WAITING_APPROVAL" ||
                  run?.status === "RUNNING"
                }
                onChange={async (event) => {
                  const selected = event.target.value;
                  if (!session) {
                    setExplicitProfile(selected);
                    return;
                  }
                  setPending(true);
                  setError("");
                  try {
                    const updated = await runtime.setAgentSessionProfile(
                      session.id,
                      session.version,
                      selected || null,
                    );
                    setSession(updated);
                    setSessions(await runtime.agentSessions());
                    setExplicitProfile(selected);
                  } catch (failure) {
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : "MODEL_PROFILE_SAVE_FAILED",
                    );
                  } finally {
                    setPending(false);
                  }
                }}
              >
                <option value="">
                  {zh
                    ? "自动继承空间 / 项目 / 默认"
                    : "Inherit space / project / default"}
                </option>
                {profiles.map((profile) => (
                  <option
                    key={profile.id}
                    value={profile.id}
                    disabled={profile.enabled === false}
                  >
                    {profile.name}
                  </option>
                ))}
                {explicitProfile &&
                  !profiles.some(
                    (profile) => profile.id === explicitProfile,
                  ) && (
                    <option value={explicitProfile}>
                      {zh ? "配置不可用" : "Profile unavailable"}
                    </option>
                  )}
              </Select>
            </label>
            {snapshot ? (
              <ContextBar
                snapshot={snapshot}
                projectId={selectedProject}
                spaceId={selectedSpace}
                context={selectedContext}
                disabled={
                  pending ||
                  run?.status === "WAITING_APPROVAL" ||
                  run?.status === "RUNNING"
                }
                onProject={setSelectedProject}
                onSpace={setSelectedSpace}
                onContext={setSelectedContext}
              />
            ) : (
              <div className="context-bar">
                {selectedContext.map((item) => (
                  <Button
                    type="button"
                    key={item.ref.id}
                    variant="toggle"
                    onClick={() =>
                      setExcludedContext(
                        (previous) => new Set([...previous, item.ref.id]),
                      )
                    }
                  >
                    {item.title}
                  </Button>
                ))}
              </div>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void sendQuestion(prompt);
              }}
            >
              <textarea
                required
                aria-label={zh ? "向 Atlas 提问" : "Ask Atlas"}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={zh ? "问 Atlas…" : "Ask anything…"}
              />
              <Button
                variant="primary"
                type="submit"
                disabled={
                  pending ||
                  run?.status === "RUNNING" ||
                  run?.status === "WAITING_APPROVAL"
                }
              >
                {zh ? "发送" : "Send"}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </aside>
  );
}
