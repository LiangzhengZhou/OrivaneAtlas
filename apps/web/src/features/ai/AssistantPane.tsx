import type {
  AgentRun,
  AgentSession,
  AiContextItem,
} from "@arclattice/application";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Runtime } from "../../bootstrap";
import { Markdown } from "../../Markdown";

export function AssistantPane({
  runtime,
  context,
  projectId,
  currentSpaceId,
  onClose,
}: {
  runtime: Runtime;
  context: AiContextItem[];
  projectId?: string | undefined;
  currentSpaceId?: string | undefined;
  onClose(): void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [prompt, setPrompt] = useState("");
  const [session, setSession] = useState<AgentSession | null>(null);
  useEffect(() => {
    let active = true;
    void runtime
      .agentSessions()
      .then(async (sessions) => {
        const state = await runtime.ai();
        if (active) {
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
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => {
      active = false;
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
    <aside className="assistant-pane" aria-label="Atlas Assistant">
      <header>
        <h2>Atlas</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={zh ? "关闭助手" : "Close assistant"}
        >
          ×
        </button>
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
          <Markdown text={message.text} />
        </section>
      ))}
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
                context
                  .filter((item) => item.permission.aiAccess !== "DENY")
                  .map((item) => ({
                    ...item.ref,
                    version: item.version,
                    source: item.source,
                  })),
                "default",
                {
                  ...(projectId ? { projectId } : {}),
                  ...(currentSpaceId ? { currentSpaceId } : {}),
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
      {error && <p role="alert">{error}</p>}
      {run?.status === "RUNNING" && streamedText && (
        <div aria-live="polite">
          <Markdown text={streamedText} />
        </div>
      )}
      {run?.status === "WAITING_APPROVAL" && (
        <section>
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
          (message) => message.runId === run.id && message.kind === "ASSISTANT",
        ) && (
          <section
            data-message-kind="ASSISTANT"
            aria-label={zh ? "助手消息" : "Assistant message"}
          >
            <Markdown text={run.output} />
          </section>
        )}
    </aside>
  );
}
