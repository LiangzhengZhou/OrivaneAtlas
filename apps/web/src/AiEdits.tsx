import { type AgentRun, parseAiTextEdits } from "@arclattice/application";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./components/ui/Button";
import { confirmAction } from "./components/ui/ConfirmationHost";
import { DiffViewer } from "./features/documents/DiffViewer";
export function AiEdits({
  run,
  busy,
  onApply,
}: {
  run: AgentRun;
  busy: boolean;
  onApply: (indices: number[]) => void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [selected, setSelected] = useState<number[]>([]);
  const edits = parseAiTextEdits(run);
  if (!edits.length)
    return run.appliedAt ? (
      <p>{zh ? "已应用所选建议" : "Selected suggestions applied"}</p>
    ) : null;
  return (
    <section>
      <h3>{zh ? "审核文档修改建议" : "Review proposed document edits"}</h3>
      <p>
        {zh
          ? "仅更新你选中的文档；任何版本冲突都会取消整批修改。未勾选的建议不会应用。"
          : "Only checked documents are updated. Any version conflict cancels the entire batch. Unchecked suggestions are not applied."}
      </p>
      {edits.map((edit, index) => (
        <details key={edit.kind + edit.id}>
          <summary>
            {edit.title} · v{edit.version}
          </summary>
          <label>
            <input
              type="checkbox"
              checked={selected.includes(index)}
              onChange={(e) =>
                setSelected((old) =>
                  e.target.checked
                    ? [...old, index]
                    : old.filter((i) => i !== index),
                )
              }
            />
            {zh ? "应用此修改" : "Apply this edit"}
          </label>
          <h4>{zh ? "原文" : "Original"}</h4>
          <DiffViewer
            before={
              run.context?.find(
                (c) => c.ref.id === edit.id && c.ref.kind === edit.kind,
              )?.bodyMd ?? ""
            }
            after={edit.bodyMd}
          />
          <h4>{zh ? "建议全文" : "Proposed full text"}</h4>
        </details>
      ))}
      <Button
        variant="primary"
        type="button"
        className="button primary"
        disabled={busy || !selected.length}
        onClick={async () => {
          if (
            await confirmAction(
              zh
                ? "确认将所选建议写入文档？"
                : "Write selected suggestions to documents?",
            )
          )
            onApply(selected);
        }}
      >
        {zh ? "确认应用所选建议" : "Confirm selected edits"}
      </Button>
    </section>
  );
}
