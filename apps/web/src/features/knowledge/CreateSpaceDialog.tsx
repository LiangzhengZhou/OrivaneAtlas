import type { LibraryEntry } from "@arclattice/application";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Runtime } from "../../bootstrap";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Surfaces";

export function CreateSpaceDialog({
  runtime,
  onClose,
  onCreated,
}: {
  runtime: Runtime;
  onClose(): void;
  onCreated(space: LibraryEntry): void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [name, setName] = useState(""),
    [description, setDescription] = useState("");
  const [pending, setPending] = useState(false),
    [failed, setFailed] = useState(false);
  return (
    <Dialog
      className="ui-dialog create-space-dialog"
      aria-label={zh ? "新建知识空间" : "Create knowledge space"}
      onRequestClose={() => {
        if (!pending) onClose();
      }}
    >
      <h2>{zh ? "新建知识空间" : "Create knowledge space"}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (pending || !name.trim()) return;
          setPending(true);
          setFailed(false);
          void runtime
            .saveLibrary(null, 0, {
              kind: "SPACE",
              spaceId: null,
              title: name,
              bodyMd: description,
            })
            .then(onCreated, () => {
              setFailed(true);
              setPending(false);
            });
        }}
      >
        <label className="field">
          {zh ? "空间名称" : "Space name"}
          <input
            autoFocus
            required
            maxLength={240}
            value={name}
            disabled={pending}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          {zh ? "描述（可选）" : "Description (optional)"}
          <textarea
            value={description}
            disabled={pending}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        {failed && (
          <p role="alert">
            {zh
              ? "无法保存到本机，请保留内容并重试。"
              : "Could not save on this device. Keep your content and try again."}
          </p>
        )}
        <div className="action-row">
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            {zh ? "取消" : "Cancel"}
          </Button>
          <Button
            variant="primary"
            type="submit"
            pending={pending}
            disabled={!name.trim()}
          >
            {zh ? "创建" : "Create"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
