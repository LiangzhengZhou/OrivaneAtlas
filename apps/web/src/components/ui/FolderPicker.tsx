import { Check, Folder, FolderPlus, Search, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { Dialog } from "./Surfaces";
import "./folder-picker.css";

export interface FolderChoice {
  value: string;
  label: string;
  detail?: string;
  disabled?: boolean;
}

export function FolderPicker({
  title,
  subject,
  options,
  current,
  onChoose,
  onCreate,
  onClose,
}: {
  title: string;
  subject?: string;
  options: readonly FolderChoice[];
  current?: string | undefined;
  onChoose(value: string): Promise<boolean> | boolean;
  onCreate?(name: string): Promise<boolean>;
  onClose(): void;
}) {
  const zh = useTranslation().i18n.language.startsWith("zh");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const lock = useRef(false);
  const search = useRef<HTMLInputElement>(null);
  const term = query.trim().toLocaleLowerCase();
  const matches = options.filter((option) =>
    option.label.toLocaleLowerCase().includes(term),
  );
  async function apply(
    action: () => boolean | Promise<boolean>,
    close: boolean,
  ) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError(false);
    try {
      if (!(await action())) {
        setError(true);
        return;
      }
      if (close) onClose();
    } catch {
      setError(true);
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <Dialog
      className="ui-dialog folder-picker"
      aria-label={title}
      keyboardEntry={search}
      onRequestClose={() => {
        if (!lock.current) onClose();
      }}
    >
      <header>
        <div>
          <h2>{title}</h2>
          {subject && <p>{subject}</p>}
        </div>
        <Button
          variant="ghost"
          aria-label={zh ? "关闭" : "Close"}
          disabled={pending}
          onClick={onClose}
        >
          <X size={18} />
        </Button>
      </header>
      <label className="folder-picker-search">
        <Search size={17} />
        <input
          ref={search}
          aria-label={zh ? "搜索文件夹" : "Search folders"}
          placeholder={zh ? "搜索名称或路径…" : "Search by name or path…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="folder-picker-results" aria-busy={pending}>
        {matches.map((option) => (
          <Button
            key={option.value}
            variant="ghost"
            disabled={pending || option.disabled}
            onClick={() => void apply(() => onChoose(option.value), true)}
          >
            <Folder size={18} />
            <span>{option.label}</span>
            {option.detail && <small>{option.detail}</small>}
            {current === option.value && (
              <Check
                size={16}
                aria-label={zh ? "当前位置" : "Current location"}
              />
            )}
          </Button>
        ))}
        {!matches.length && (
          <p>{zh ? "没有匹配的文件夹" : "No matching folders"}</p>
        )}
      </div>
      {onCreate && (
        <footer>
          {term &&
          !options.some((o) => o.label.toLocaleLowerCase() === term) ? (
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => void apply(() => onCreate(query.trim()), false)}
            >
              <FolderPlus size={16} />
              {zh ? "新建文件夹" : "Create folder"} · {query.trim()}
            </Button>
          ) : (
            <small>
              {zh
                ? "输入新名称可创建文件夹。"
                : "Enter a new name to create a folder."}
            </small>
          )}
        </footer>
      )}
      {error && (
        <p role="alert">
          {zh
            ? "操作未完成。请检查目标后重试。"
            : "Could not complete this action. Check the destination and retry."}
        </p>
      )}
    </Dialog>
  );
}
