import type { WorkspaceLibraryEntry } from "@arclattice/application";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Runtime } from "../../bootstrap";
import { Button } from "../../components/ui/Button";
import { Markdown } from "../../Markdown";

export function SpaceBodyPreview({
  entry,
  runtime,
}: {
  entry: WorkspaceLibraryEntry;
  runtime: Runtime;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [loaded, setLoaded] = useState<{
    id: string;
    version: number;
    body: string;
  } | null>(null);
  const [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (entry.bodyMd !== undefined) return;
    let current = true;
    setFailed(false);
    void runtime.readDocumentBody(entry).then(
      (entity) => {
        if (current)
          setLoaded({
            id: entry.id,
            version: entry.version,
            body: entity.bodyMd,
          });
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [runtime, entry, retry]);
  const body =
    entry.bodyMd ??
    (loaded?.id === entry.id && loaded.version === entry.version
      ? loaded.body
      : undefined);
  if (body !== undefined) return body ? <Markdown text={body} /> : null;
  if (failed)
    return (
      <div role="status">
        <p>
          {zh ? "未能加载空间简介。" : "Could not load the space introduction."}
        </p>
        <Button variant="ghost" onClick={() => setRetry((value) => value + 1)}>
          {zh ? "重试" : "Retry"}
        </Button>
      </div>
    );
  return (
    <small className="muted" role="status">
      {zh ? "正在加载简介…" : "Loading introduction…"}
    </small>
  );
}
