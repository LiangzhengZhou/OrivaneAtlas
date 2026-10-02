import type {
  AgentRun,
  AgentSession,
  AiContextItem,
} from "@arclattice/application";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Runtime, Snapshot } from "../../bootstrap";
import { Markdown } from "../../Markdown";
import { ContextBar } from "./ContextBar";

export function AssistantPane({
  runtime,
  context,
  projectId,
  currentSpaceId,
  onClose,
  embedded = false,
  snapshot,
}: {
  runtime: Runtime;
  context: AiContextItem[];
  projectId?: string | undefined;
  currentSpaceId?: string | undefined;
  onClose(): void;
  embedded?: boolean;
  snapshot?: Snapshot;
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
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [excludedContext, setExcludedContext] = useState<Set<string>>(
    new Set(),
  );
  const [session, setSession] = useState<AgentSession | null>(null);
  useEffect(() => {
    let active = true;
    void runtime
      .agentSessions()
      .then(async (sessions) => {
        const state = await runtime.ai();
        if (active) {
          setSessions(sessions);
          const latest = sessions[0] ?? null;
          setSession(latest);
          setRun(
            state.runs.find(
              (entry) =>
                entry.sessionId === latest?.id &&
                ["WAITING_APPROVAL", "RUNNING"].includes(entry.status),
            ) ?? null,
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
    if (run?.status !== "RUNNING") return;
    let active = true;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const result = await runtime.ai();
        const events = await runtime.aiEvents(run.id);
        if (active)
          setStreamedText(
            events
              .flatMap((event) =>
                event.type === "text-delta" ? [event.text] : [],
              )
              .join(""),
          );
        const latest = result.runs.find((entry) => entry.id === run.id);
        if (active && latest) {
          setRun(latest);
          if (latest.status !== "RUNNING") {
            const sessions = await runtime.agentSessions();
            if (active)
              setSession(
                sessions.find((entry) => entry.id === latest.sessionId) ?? null,
              );
          }
        }
      } catch (failure) {
        if (active)
          setError(failure instanceof Error ? failure.message : "UNAVAILABLE");
      } finally {
        loading = false;
      }
    };
    const controller = new AbortController();
    let timer: number | undefined;
    void runtime
      .streamAiEvents(run.id, controller.signal, (events) => {
        if (active)
          setStreamedText(
            events
              .flatMap((event) =>
                event.type === "text-delta" ? [event.text] : [],
              )
              .join(""),
          );
      })
      .then(() => refresh())
      .catch(() => {
        if (active) {
          void refresh();
          timer = window.setInterval(() => void refresh(), 1000);
        }
      });
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [runtime, run?.id, run?.status]);
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
      setSession(
        sessions.find((entry) => entry.id === result.sessionId) ?? null,
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "UNAVAILABLE");
    } finally {
      setPending(false);
    }
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
          <button
            type="button"
            onClick={onClose}
            aria-label={zh ? "关闭助手" : "Close assistant"}
          >
            ×
          </button>
        )}
      </header>
      <button
        type="button"
        className="chip"
        disabled={pending || run?.status === "RUNNING"}
        onClick={() => {
          setSession(null);
          setRun(null);
        }}
      >
        {zh ? "新对话" : "New conversation"}
      </button>
      <div className="conversation-body">
        <nav
          className="conversation-list"
          aria-label={zh ? "最近对话" : "Recent conversations"}
        >
          {sessions.map((entry) => (
            <button
              type="button"
              className="text-button"
              key={entry.id}
              aria-current={entry.id === session?.id ? "page" : undefined}
              disabled={
                pending ||
                run?.status === "RUNNING" ||
                run?.status === "WAITING_APPROVAL"
              }
              onClick={() => {
                setSession(entry);
                setRun(null);
                setStreamedText("");
              }}
            >
              {entry.title}
            </button>
          ))}
        </nav>
        <div className="conversation-messages">
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
                <Markdown text={message.text} />
              </div>
            </section>
          ))}

          {error && <p role="alert">{error}</p>}
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
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  void execute(() => runtime.decide(run.id, run.version, true))
                }
              >
                {zh ? "批准本次请求" : "Approve request"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  void execute(() => runtime.decide(run.id, run.version, false))
                }
              >
                {zh ? "拒绝" : "Reject"}
              </button>
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
      </div>
      <div className="conversation-composer">
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
              <button
                type="button"
                key={item.ref.id}
                className="chip"
                onClick={() =>
                  setExcludedContext(
                    (previous) => new Set([...previous, item.ref.id]),
                  )
                }
              >
                {item.title}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void execute(() =>
              (async () => {
                const currentSession =
                  session ??
                  (await runtime.createAgentSession(prompt.slice(0, 240)));
                return runtime.propose(
                  prompt,
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
                );
              })(),
            );
          }}
        >
          <textarea
            required
            aria-label={zh ? "向 Atlas 提问" : "Ask Atlas"}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={zh ? "问 Atlas…" : "Ask anything…"}
          />
          <button
            type="submit"
            className="button primary"
            disabled={
              pending ||
              run?.status === "RUNNING" ||
              run?.status === "WAITING_APPROVAL"
            }
          >
            {zh ? "发送" : "Send"}
          </button>
        </form>
      </div>
    </aside>
  );
}
