import type { AgentSessionMessage, EntityRef } from "@arclattice/application";
import { aiContextNavigationRef } from "@arclattice/application";
import { Button } from "../../components/ui/Button";
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
      <details>
        <summary>
          {zh ? "来源" : "Sources"} {evidence.length}
        </summary>
        {evidence.map((source) => (
          <Button
            key={source.ref.kind + source.ref.id}
            type="button"
            variant="ghost"
            title={`${source.title} · v${source.version}`}
            onClick={() => onOpen(aiContextNavigationRef(source.ref))}
          >
            {source.title}
          </Button>
        ))}
      </details>
    </section>
  );
}
