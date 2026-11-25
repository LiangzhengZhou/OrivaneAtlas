import { useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { readHtmlNote } from "./htmlNote";

export function HtmlNoteImport({
  zh,
  disabled,
  onImport,
}: {
  zh: boolean;
  disabled: boolean;
  onImport: (note: { title: string; body: string }) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState(false);
  return (
    <div className="html-note-import">
      <Button
        type="button"
        variant="secondary"
        disabled={disabled || reading}
        onClick={() => input.current?.click()}
      >
        {zh ? "导入 HTML" : "Import HTML"}
      </Button>
      <input
        hidden
        ref={input}
        type="file"
        aria-label={zh ? "HTML 文件" : "HTML file"}
        accept=".html,.htm"
        onChange={async (event) => {
          const picker = event.currentTarget;
          const file = picker.files?.[0];
          event.target.value = "";
          if (!file) return;
          setError(false);
          setReading(true);
          try {
            const note = await readHtmlNote(file);
            if (picker.isConnected) await onImport(note);
          } catch {
            setError(true);
          } finally {
            setReading(false);
          }
        }}
      />
      {error && (
        <span role="alert">
          {zh
            ? "导入失败。请选择 UTF-8 的 .html 或 .htm 文件（最多 600 KB，正文上限 20 万字符）。"
            : "Import failed. Choose a UTF-8 .html or .htm file (600 KB maximum, 200,000 characters including format metadata)."}
        </span>
      )}
    </div>
  );
}
