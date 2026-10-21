import type { WorkspaceMergeBackup } from "@arclattice/application";
import { useEffect, useState } from "react";
import type { Runtime } from "../bootstrap";
import { Button } from "../components/ui/Button";

/** Original archives remain available offline after a failed or interrupted import. */
export function WorkspaceMergeBackups({
  runtime,
  zh,
  revision,
}: {
  runtime: Runtime;
  zh: boolean;
  revision: number;
}) {
  const [entries, setEntries] = useState<
    readonly Omit<WorkspaceMergeBackup, "bytes">[]
  >([]);
  const [failed, setFailed] = useState(false),
    [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void runtime.listWorkspaceMergeBackups().then(
      (rows) => {
        if (active) {
          setEntries(rows);
          setFailed(false);
        }
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [runtime, revision]);
  if (!entries.length && !failed) return null;
  return (
    <section aria-label={zh ? "合并前备份" : "Backups before merging"}>
      <h3>{zh ? "合并前备份" : "Backups before merging"}</h3>
      {failed && (
        <p role="alert">
          {zh
            ? "备份无法读取或未通过完整性校验。原始备份仍保留在本机。"
            : "The backup could not be read or verified. The original remains on this device."}
        </p>
      )}
      {entries.map((entry) => (
        <div key={entry.id}>
          <time dateTime={entry.createdAt}>
            {new Date(entry.createdAt).toLocaleString(zh ? "zh-CN" : "en-US")}
          </time>
          <Button
            variant="ghost"
            pending={pending === entry.id}
            disabled={pending !== null}
            onClick={async () => {
              setPending(entry.id);
              setFailed(false);
              try {
                const bytes = await runtime.readWorkspaceMergeBackup(entry.id),
                  url = URL.createObjectURL(bytes),
                  link = document.createElement("a");
                link.href = url;
                link.download = `orivane-before-merge-${entry.id}.orivane`;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 30_000);
              } catch {
                setFailed(true);
              } finally {
                setPending(null);
              }
            }}
          >
            {zh ? "下载原始备份" : "Download original backup"}
          </Button>
        </div>
      ))}
    </section>
  );
}
