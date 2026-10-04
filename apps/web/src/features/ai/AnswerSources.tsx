import type { AgentSessionMessage, EntityRef } from "@arclattice/application";
export function AnswerSources({
  evidence,
  zh,
  onOpen,
}: {
  evidence: AgentSessionMessage["evidence"];
  zh: boolean;
  onOpen(ref: EntityRef): void;
}) {
  if (!evidence?.length) return null;
  return (
    <section aria-label={zh ? "来源" : "Sources"} className="answer-sources">
      <h3>
        {zh ? "来源" : "Sources"} {evidence.length}
      </h3>
      {evidence.map((source) => (
        <button
          key={source.ref.kind + source.ref.id}
          type="button"
          title={`${source.title} · v${source.version}`}
          onClick={() => onOpen(source.ref)}
        >
          {source.title}
        </button>
      ))}
    </section>
  );
}
