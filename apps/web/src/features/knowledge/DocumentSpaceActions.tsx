import type { LibraryEntry } from "@arclattice/application";
import { useState } from "react";
import type { Runtime, Snapshot } from "../../bootstrap";
import { Button } from "../../components/ui/Button";
import { SpacePicker } from "./SpacePicker";

export function DocumentSpaceActions({
  document,
  runtime,
  snapshot,
  disabled,
  zh,
  onMoved,
  onChanged,
}: {
  document: LibraryEntry;
  runtime: Runtime;
  snapshot: Snapshot;
  disabled: boolean;
  zh: boolean;
  onMoved(document: LibraryEntry): void;
  onChanged(): void;
}) {
  const [action, setAction] = useState<"move" | "link" | null>(null);
  const [space, setSpace] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="note-knowledge-actions no-print">
      <Button
        variant="ghost"
        disabled={disabled || pending}
        onClick={() => setAction("move")}
      >
        {zh ? "整理到知识空间" : "Organize into knowledge space"}
      </Button>
      <Button
        variant="ghost"
        disabled={disabled || pending}
        onClick={() => setAction("link")}
      >
        {zh ? "关联到知识空间" : "Link to knowledge space"}
      </Button>
      {action && (
        <div>
          <p>
            {action === "move"
              ? zh
                ? "移动文档归属，保留文档 ID 和正文。含子文档时请先整理子文档。"
                : "Move the document's home, preserving its ID and body. Organize child documents first."
              : zh
                ? "仅创建关联，不移动或复制正文。"
                : "Create a relationship without moving or copying the body."}
          </p>
          <SpacePicker
            spaces={snapshot.library}
            value={space}
            disabled={pending}
            onChange={setSpace}
          />
          <Button
            variant="primary"
            disabled={!space || space === document.spaceId || pending}
            onClick={async () => {
              if (!space) return;
              setPending(true);
              setError("");
              try {
                if (action === "move")
                  onMoved(
                    await runtime.moveLibraryDocument(
                      document.id,
                      document.version,
                      space,
                    ),
                  );
                else
                  await runtime.link(
                    { kind: "DOCUMENT", id: document.id },
                    { kind: "SPACE", id: space },
                    "REFERENCES",
                  );
                onChanged();
                setAction(null);
              } catch (failure) {
                setError(
                  failure instanceof Error ? failure.message : "UNAVAILABLE",
                );
              } finally {
                setPending(false);
              }
            }}
          >
            {zh ? "确认" : "Confirm"}
          </Button>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => setAction(null)}
          >
            {zh ? "取消" : "Cancel"}
          </Button>
        </div>
      )}
      {error && (
        <div role="alert">
          <p>
            {error === "DEPENDENCY_EXISTS"
              ? zh
                ? "请先整理此文档的子文档，再移动所属空间。"
                : "Organize this document's children before moving its home."
              : error === "VERSION_CONFLICT"
                ? zh
                  ? "文档已发生变化，请重新打开后再操作。"
                  : "The document changed. Reopen it before continuing."
                : zh
                  ? "未能完成操作，文档内容仍保留在本机。"
                  : "The action could not finish. Your document remains on this device."}
          </p>
          <details>
            <summary>{zh ? "技术详情" : "Technical details"}</summary>
            {error}
          </details>
        </div>
      )}
    </section>
  );
}
