import type { WorkspaceLibraryEntry as LibraryEntry } from "@arclattice/application";
import { BookOpen, File as FileIcon, Plus, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEntitySelection } from "./app/EntitySelection";
import { showToast } from "./app/ToastHost";
import type { Runtime, Snapshot } from "./bootstrap";
import { Button, SegmentedControl } from "./components/ui/Button";
import { ListRow, ListSurface } from "./components/ui/Content";
import { EntityMenu } from "./components/ui/EntityMenu";
import { Select } from "./components/ui/Surfaces";
import type { WorkspaceRequest } from "./DocumentWorkspace";
import { SpaceBodyPreview } from "./features/documents/SpaceBodyPreview";
import { KnowledgeGraph } from "./features/knowledge/KnowledgeGraph";
import { VirtualTaskCollection } from "./features/tasks/VirtualTaskCollection";
import { useDebouncedValue } from "./utils/use-debounced-value";

type FileType = "ALL" | "PDF" | "TABLE" | "SLIDES" | "IMAGE" | "OTHER";
type LibraryViewState = {
  spaceId: string | null;
  query: string;
  kind?: "ALL" | "DOCUMENT" | "FILE";
  fileType?: FileType;
};
const extensionTypes: Record<string, FileType> = {
  pdf: "PDF",
  csv: "TABLE",
  tsv: "TABLE",
  xls: "TABLE",
  xlsx: "TABLE",
  ods: "TABLE",
  ppt: "SLIDES",
  pptx: "SLIDES",
  odp: "SLIDES",
  png: "IMAGE",
  jpg: "IMAGE",
  jpeg: "IMAGE",
  gif: "IMAGE",
  webp: "IMAGE",
  svg: "IMAGE",
  avif: "IMAGE",
  bmp: "IMAGE",
  tif: "IMAGE",
  tiff: "IMAGE",
};
export function LibraryView({
  runtime,
  onOpen,
  snapshot,
  onChanged,
  onTrash,
  viewState,
  onViewChange,
}: {
  runtime: Runtime;
  onOpen: (request: WorkspaceRequest) => void;
  snapshot: Snapshot;
  onChanged(): Promise<void>;
  onTrash(): void;
  viewState: LibraryViewState;
  onViewChange(state: LibraryViewState): void;
}) {
  const { t } = useTranslation("spaces");
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const selection = useEntitySelection();
  const [graphOpen, setGraphOpen] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [fileIndexRevision, setFileIndexRevision] = useState(0);
  useEffect(
    () =>
      runtime.subscribeFileIndex(() =>
        setFileIndexRevision((version) => version + 1),
      ),
    [runtime],
  );
  const entries = snapshot.library;
  const entriesById = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry])),
    [entries],
  );
  const { spaceId, query } = viewState;
  const kind = viewState.kind ?? "ALL";
  const fileType = viewState.fileType ?? "ALL";
  const fileTypes: { value: FileType; label: string }[] = [
    { value: "ALL", label: zh ? "全部类型" : "All types" },
    { value: "PDF", label: "PDF" },
    { value: "TABLE", label: zh ? "表格" : "Spreadsheets" },
    { value: "SLIDES", label: zh ? "演示" : "Presentations" },
    { value: "IMAGE", label: zh ? "图片" : "Images" },
    { value: "OTHER", label: zh ? "其它" : "Other" },
  ];
  const settledQuery = useDebouncedValue(query).trim().toLocaleLowerCase();
  const fileSearch = useMemo(
    () =>
      new Map(
        (snapshot.files ?? []).map((file) => [
          file.id,
          file.name.toLocaleLowerCase(),
        ]),
      ),
    [snapshot.files],
  );
  const scopedFiles = useMemo(
    () =>
      (snapshot.files ?? []).filter(
        (file) =>
          !file.deletedAt &&
          file.spaceId === spaceId &&
          (fileType === "ALL" ||
            (extensionTypes[file.extension ?? ""] ?? "OTHER") === fileType),
      ),
    [snapshot.files, spaceId, fileType],
  );
  const [fileMatches, setFileMatches] = useState<{
    query: string;
    spaceId: string | null;
    fileType: FileType;
    ids: ReadonlySet<string>;
  } | null>(null);
  const [fileSearchPending, setFileSearchPending] = useState(false);
  const files = scopedFiles.filter(
    (file) =>
      !settledQuery ||
      fileSearch.get(file.id)?.includes(settledQuery) ||
      (fileMatches?.query === settledQuery &&
        fileMatches.spaceId === spaceId &&
        fileMatches.fileType === fileType &&
        fileMatches.ids.has(file.id)),
  );
  const setSpaceId = (spaceId: string | null) =>
    onViewChange({ ...viewState, spaceId });
  const setQuery = (query: string) => onViewChange({ ...viewState, query });
  const [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!settledQuery || !scopedFiles.length) {
      setFileSearchPending(false);
      return;
    }
    let current = true;
    setFileSearchPending(true);
    void runtime
      .searchFileIds(
        settledQuery,
        scopedFiles.map((file) => file.id),
      )
      .then(
        (ids) => {
          if (current) {
            setFileMatches({
              query: settledQuery,
              spaceId,
              fileType,
              ids: new Set(ids),
            });
            setFileSearchPending(false);
          }
        },
        () => {
          if (current) {
            setFileMatches(null);
            setError(true);
            setFileSearchPending(false);
          }
        },
      );
    return () => {
      current = false;
    };
  }, [
    runtime,
    settledQuery,
    spaceId,
    fileType,
    scopedFiles,
    fileIndexRevision,
  ]);
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await action();
      await onChanged();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  const spaces = entries.filter((e) => e.kind === "SPACE" && !e.deletedAt),
    space = spaces.find((e) => e.id === spaceId);
  const [matches, setMatches] = useState<{
    query: string;
    spaceId: string;
    ids: ReadonlySet<string>;
  } | null>(null);
  useEffect(() => {
    if (!spaceId || !settledQuery) return;
    let current = true;
    setError(false);
    void runtime.searchLibrary(settledQuery, spaceId).then(
      (results) => {
        if (current)
          setMatches({
            query: settledQuery,
            spaceId,
            ids: new Set(results.map((result) => result.id)),
          });
      },
      () => {
        if (current) {
          setMatches(null);
          setError(true);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [runtime, spaceId, settledQuery, entries]);
  const documentCountBySpaceId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries)
      if (entry.kind === "DOCUMENT" && !entry.deletedAt && entry.spaceId)
        counts.set(entry.spaceId, (counts.get(entry.spaceId) ?? 0) + 1);
    return counts;
  }, [entries]);
  const docs = entries.filter(
    (e) =>
      e.kind === "DOCUMENT" &&
      !e.deletedAt &&
      e.spaceId === spaceId &&
      (!settledQuery ||
        (matches?.query === settledQuery &&
          matches.spaceId === spaceId &&
          matches.ids.has(e.id))),
  );
  const paths = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const document of entries) {
      const ancestors: string[] = [];
      const visited = new Set([document.id]);
      let parentId = document.parentDocumentId;
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const parent = entriesById.get(parentId);
        if (!parent || parent.deletedAt || parent.spaceId !== document.spaceId)
          break;
        ancestors.unshift(parent.title);
        parentId = parent.parentDocumentId;
      }
      result.set(document.id, ancestors);
    }
    return result;
  }, [entries, entriesById]);
  const hierarchy = (document: LibraryEntry) => paths.get(document.id) ?? [];
  docs.sort((left, right) =>
    [...hierarchy(left), left.title]
      .join("/")
      .localeCompare([...hierarchy(right), right.title].join("/")),
  );
  function open(entity?: LibraryEntry) {
    const kind = entity?.kind ?? (space ? "DOCUMENT" : "SPACE");
    onOpen({
      key: entity?.id ?? crypto.randomUUID(),
      kind,
      entity,
      spaceId: entity?.spaceId ?? (kind === "DOCUMENT" ? spaceId : null),
    });
  }
  return (
    <div
      className="library-view"
      aria-busy={
        query.trim().toLocaleLowerCase() !== settledQuery || fileSearchPending
      }
    >
      {error && (
        <p className="error" role="alert">
          {t("error")}
        </p>
      )}
      {graphOpen && (
        <KnowledgeGraph
          key={spaceId ?? "workspace"}
          snapshot={snapshot}
          currentSpaceId={spaceId ?? undefined}
          onOpen={(ref) => {
            const entity = entriesById.get(ref.id);
            if (entity)
              onOpen({
                key: entity.id,
                kind: entity.kind,
                entity,
                spaceId: entity.spaceId,
              });
          }}
        />
      )}
      <div className="library-toolbar action-row">
        <input
          ref={uploadRef}
          type="file"
          hidden
          aria-label={zh ? "上传文件" : "Upload file"}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void run(async () => {
              const created = await runtime.uploadFile(
                {
                  name: file.name,
                  mime: file.type || "application/octet-stream",
                  spaceId,
                },
                file,
              );
              onOpen({
                key: `FILE:${created.id}`,
                kind: "FILE",
                file: created,
                spaceId: created.spaceId,
              });
            });
          }}
        />
        <Button
          type="button"
          variant="toggle"
          aria-pressed={graphOpen}
          onClick={() => setGraphOpen(!graphOpen)}
        >
          {zh ? "知识图谱" : "Knowledge graph"}
        </Button>

        <Button
          variant="secondary"
          type="button"
          onClick={() => setSpaceId(null)}
        >
          {t("back")}
        </Button>
        <Button variant="primary" type="button" onClick={() => open()}>
          <Plus size={16} />
          {t(space ? "newLecture" : "newSpace")}
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => uploadRef.current?.click()}
        >
          <Upload size={16} />
          {zh ? "导入文件" : "Import file"}
        </Button>
      </div>
      <SegmentedControl
        label={zh ? "内容类型" : "Content type"}
        value={kind}
        onChange={(kind) => onViewChange({ ...viewState, kind })}
        options={[
          { value: "ALL", label: zh ? "全部" : "All" },
          { value: "DOCUMENT", label: zh ? "文档" : "Documents" },
          { value: "FILE", label: zh ? "文件" : "Files" },
        ]}
      />
      {kind !== "DOCUMENT" && (
        <label className="field">
          {zh ? "文件类型" : "File type"}
          <Select
            label={zh ? "文件类型" : "File type"}
            value={fileType}
            onChange={(event) => {
              const selected = fileTypes.find(
                (option) => option.value === event.target.value,
              );
              if (selected)
                onViewChange({ ...viewState, fileType: selected.value });
            }}
          >
            {fileTypes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
      )}
      <label className="field">
        {zh ? "搜索" : "Search"}
        <input value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {space ? (
        <>
          <section className="panel account-panel">
            <p className="eyebrow">{t("library")}</p>
            <h2>{space.title}</h2>
            <SpaceBodyPreview entry={space} runtime={runtime} />
            <div className="action-row">
              <Button
                variant="secondary"
                type="button"
                onClick={() => open(space)}
              >
                {t("edit")}
              </Button>
              <Button
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const deleted = await runtime.deleteLibrary(
                      space.id,
                      space.version,
                      true,
                    );
                    showToast(
                      zh ? "已移至回收站" : "Moved to Trash",
                      async () => {
                        await runtime.deleteLibrary(
                          deleted.id,
                          deleted.version,
                          false,
                        );
                        await onChanged();
                      },
                    );
                    setSpaceId(null);
                  })
                }
              >
                {t("delete")}
              </Button>
            </div>
          </section>
          {kind !== "FILE" && (
            <>
              <ListSurface className="library-list">
                <VirtualTaskCollection
                  items={docs}
                  estimatedRowHeight={64}
                  render={(doc) => (
                    <ListRow
                      className="library-document-row"
                      key={doc.id}
                      style={{
                        marginInlineStart: `${hierarchy(doc).length * 16}px`,
                      }}
                      selected={selection?.selected?.id === doc.id}
                      intent="NAVIGATE"
                      onOpen={() => open(doc)}
                    >
                      <BookOpen size={20} />
                      <h3>{doc.title}</h3>
                      {hierarchy(doc).length > 0 && (
                        <small>{hierarchy(doc).join(" / ")}</small>
                      )}
                      <small>
                        {new Intl.DateTimeFormat(i18n.language, {
                          dateStyle: "medium",
                        }).format(new Date(doc.updatedAt))}
                      </small>
                      <EntityMenu
                        title={doc.title}
                        pending={busy}
                        onOpen={() => open(doc)}
                        onDelete={() =>
                          void run(async () => {
                            const deleted = await runtime.deleteLibrary(
                              doc.id,
                              doc.version,
                              true,
                            );
                            showToast(
                              zh ? "已移至回收站" : "Moved to Trash",
                              async () => {
                                await runtime.deleteLibrary(
                                  deleted.id,
                                  deleted.version,
                                  false,
                                );
                                await onChanged();
                              },
                            );
                          })
                        }
                      />
                    </ListRow>
                  )}
                />
              </ListSurface>
              {!docs.length && <p>{t("empty")}</p>}
            </>
          )}
        </>
      ) : (
        <>
          <p className="subtitle">{t("spaceHint")}</p>
          <ListSurface className="library-list">
            {spaces.map((item) => (
              <ListRow
                className="space-card"
                key={item.id}
                selected={selection?.selected?.id === item.id}
                intent="NAVIGATE"
                onOpen={() => setSpaceId(item.id)}
              >
                <BookOpen size={20} />
                <h2>{item.title}</h2>
                <footer>
                  {documentCountBySpaceId.get(item.id) ?? 0}{" "}
                  {t("documentCount")}
                </footer>
              </ListRow>
            ))}
          </ListSurface>
        </>
      )}
      {kind !== "DOCUMENT" && files.length > 0 && (
        <ListSurface className="library-list library-files">
          <VirtualTaskCollection
            items={files}
            estimatedRowHeight={64}
            render={(file) => (
              <ListRow
                key={file.id}
                className="library-file-row"
                intent="NAVIGATE"
                onOpen={() =>
                  onOpen({
                    key: `FILE:${file.id}`,
                    kind: "FILE",
                    file,
                    spaceId: file.spaceId,
                  })
                }
              >
                <FileIcon size={20} />
                <h3>{file.name}</h3>
                <small>
                  {new Intl.NumberFormat(i18n.language).format(file.size)} B
                </small>
                <EntityMenu
                  title={file.name}
                  pending={busy}
                  onOpen={() =>
                    onOpen({
                      key: `FILE:${file.id}`,
                      kind: "FILE",
                      file,
                      spaceId: file.spaceId,
                    })
                  }
                  onDelete={() => {
                    void run(async () => {
                      const deleted = await runtime.deleteFile(
                        file.id,
                        file.version,
                        true,
                      );
                      showToast(
                        zh ? "已移至回收站" : "Moved to Trash",
                        async () => {
                          await runtime.deleteFile(
                            deleted.id,
                            deleted.version,
                            false,
                          );
                          await onChanged();
                        },
                      );
                    });
                  }}
                />
              </ListRow>
            )}
          />
        </ListSurface>
      )}
      <Button variant="ghost" type="button" onClick={onTrash}>
        {zh ? "查看回收站 →" : "View Trash →"}
      </Button>
    </div>
  );
}
