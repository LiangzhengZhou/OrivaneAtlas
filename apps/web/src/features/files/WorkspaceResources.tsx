import type { EntityRef, WorkspaceLibraryEntry } from "@arclattice/application";
import type { LibraryFile } from "@arclattice/domain";
import { File, FileText, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Surfaces";
import "./workspace-resources.css";

export function WorkspaceResources({
  library,
  files,
  query,
  busy,
  onOpen,
  onUpload,
}: {
  library: readonly WorkspaceLibraryEntry[];
  files: readonly LibraryFile[];
  query: string;
  busy: boolean;
  onOpen(ref: EntityRef): void;
  onUpload(file: globalThis.File): Promise<boolean>;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState("all");
  const [sort, setSort] = useState("updated");
  const resources = [
    ...library
      .filter((entry) => entry.kind === "DOCUMENT" && !entry.deletedAt)
      .map((entry) => ({
        id: entry.id,
        kind: "DOCUMENT" as const,
        title: entry.title || (zh ? "未命名文档" : "Untitled document"),
        updatedAt: entry.updatedAt,
        location:
          library.find((space) => space.id === entry.spaceId)?.title ?? "",
      })),
    ...files
      .filter((entry) => !entry.deletedAt)
      .map((entry) => ({
        id: entry.id,
        kind: "FILE" as const,
        title: entry.name,
        updatedAt: entry.updatedAt,
        location:
          library.find(
            (parent) => parent.id === (entry.parentDocumentId ?? entry.spaceId),
          )?.title ?? "",
      })),
  ]
    .filter(
      (entry) =>
        (kind === "all" || kind === entry.kind) &&
        `${entry.title} ${entry.location}`
          .toLocaleLowerCase(i18n.language)
          .includes(query.trim().toLocaleLowerCase(i18n.language)),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.title.localeCompare(b.title, i18n.language)
        : b.updatedAt.localeCompare(a.updatedAt),
    );
  return (
    <section
      className="workspace-resources"
      aria-label={zh ? "文档与文件" : "Documents and files"}
    >
      <div className="workspace-resources-toolbar">
        <h2>
          {zh ? "文档与文件" : "Documents and files"}{" "}
          <small>{resources.length}</small>
        </h2>
        <Select
          aria-label={zh ? "资源类型" : "Resource type"}
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          <option value="all">{zh ? "全部类型" : "All types"}</option>
          <option value="DOCUMENT">{zh ? "文档" : "Documents"}</option>
          <option value="FILE">{zh ? "上传文件" : "Uploaded files"}</option>
        </Select>
        <Select
          aria-label={zh ? "资源排序" : "Resource order"}
          value={sort}
          onChange={(event) => setSort(event.target.value)}
        >
          <option value="updated">{zh ? "最近更新" : "Last updated"}</option>
          <option value="name">{zh ? "名称" : "Name"}</option>
        </Select>
        <Button disabled={busy} onClick={() => input.current?.click()}>
          <Upload size={16} />
          {zh ? "上传文件" : "Upload file"}
        </Button>
        <input
          hidden
          type="file"
          ref={input}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void onUpload(file);
          }}
        />
      </div>
      {resources.map((entry) => (
        <Button
          key={`${entry.kind}:${entry.id}`}
          variant="ghost"
          className="workspace-resource-row"
          onClick={() => onOpen({ kind: entry.kind, id: entry.id })}
        >
          {entry.kind === "FILE" ? <File size={18} /> : <FileText size={18} />}
          <span className="workspace-resource-name">{entry.title}</span>
          <span className="workspace-resource-location">
            {entry.location || (zh ? "工作区" : "Workspace")}
          </span>
          <time dateTime={entry.updatedAt}>
            {new Date(entry.updatedAt).toLocaleDateString(i18n.language)}
          </time>
        </Button>
      ))}
      {!resources.length && (
        <p>
          {zh
            ? "没有匹配的文档或上传文件。"
            : "No matching documents or uploaded files."}
        </p>
      )}
    </section>
  );
}
