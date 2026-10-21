import type {
  EntityMemoTarget,
  MemoFormalization,
  MemoProposal,
} from "@arclattice/application";
import type { EntityMemo } from "@arclattice/domain";
import { useState } from "react";
import type { Runtime } from "../../bootstrap";
import { Button } from "../../components/ui/Button";
import { Dialog, Select } from "../../components/ui/Surfaces";
import { Markdown } from "../../Markdown";
import { DocumentDrilldownPicker } from "../documents/DocumentDrilldownPicker";
import { SpacePicker } from "../knowledge/SpacePicker";
import { ProjectDrilldownPicker } from "../projects/ProjectDrilldownPicker";
import { MemoAtlasFloat } from "./MemoAtlasFloat";

/** Explicit local review/apply surface. Opening it does not send Memo text to AI. */
export function MemoFormalizationReview({
  runtime,
  target,
  body,
  disabled,
  zh,
}: {
  runtime: Runtime;
  target: EntityMemoTarget;
  body: string;
  disabled: boolean;
  zh: boolean;
}) {
  const [data, setData] = useState<{
    source: EntityMemo;
    workspace: Awaited<ReturnType<Runtime["loadWorkspace"]>>;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [kind, setKind] = useState<MemoFormalization["kind"]>("CREATE_TASK");
  const [title, setTitle] = useState(""),
    [text, setText] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null),
    [documentId, setDocumentId] = useState<string | null>(null);
  const [proposal, setProposal] = useState<MemoProposal | null>(null);
  const [applied, setApplied] = useState(false);
  const [atlasOpen, setAtlasOpen] = useState(false),
    [fromAtlas, setFromAtlas] = useState(false);
  async function open(atlas = false) {
    if (busy || disabled) return;
    setBusy(true);
    setError("");
    setApplied(false);
    try {
      const [source, workspace] = await Promise.all([
        runtime.getEntityMemo(target),
        runtime.loadWorkspace(),
      ]);
      if (!source || source.bodyMd !== body) throw new Error("SOURCE_CHANGED");
      setData({ source, workspace });
      setAtlasOpen(atlas);
      setFromAtlas(false);
      setText(source.bodyMd);
      setTitle("");
      setProposal(null);
      setProjectId(target.targetKind === "PROJECT" ? target.targetId : null);
      setSpaceId(null);
      setDocumentId(null);
      setKind("CREATE_TASK");
    } catch {
      setError(
        zh
          ? "备忘已变化或暂时无法读取，请重新打开。"
          : "The memo changed or could not be read. Reopen it to continue.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function preview() {
    if (!data || busy) return;
    setBusy(true);
    setError("");
    try {
      let change: MemoFormalization;
      if (kind === "CREATE_TASK")
        change = { kind, title, bodyMd: text, projectId };
      else if (kind === "CREATE_DOCUMENT") {
        if (!spaceId) throw new Error("DESTINATION_REQUIRED");
        change = { kind, title, bodyMd: text, spaceId };
      } else {
        const document = data.workspace.library.find(
          (entry) =>
            entry.id === documentId &&
            entry.kind === "DOCUMENT" &&
            !entry.deletedAt,
        );
        if (!document) throw new Error("DESTINATION_REQUIRED");
        change = {
          kind,
          documentId: document.id,
          version: document.version,
          bodyMd: text,
        };
      }
      const prepared = await runtime.prepareMemoProposal(target, change);
      if (
        prepared.source.id !== data.source.id ||
        prepared.source.version !== data.source.version ||
        prepared.source.bodyMd !== data.source.bodyMd
      )
        throw new Error("SOURCE_CHANGED");
      setProposal(prepared);
    } catch {
      setProposal(null);
      setError(
        zh
          ? "请检查标题和目标。若备忘已变化，请关闭后重新审核。"
          : "Check the title and destination. If the memo changed, close and review it again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!proposal || busy) return;
    setBusy(true);
    setError("");
    try {
      await runtime.applyMemoProposal(proposal);
      setData(null);
      setProposal(null);
      setApplied(true);
    } catch {
      setError(
        zh
          ? "无法应用：内容、权限或版本可能已变化。原始备忘未被修改，请重新审核。"
          : "Could not apply: content, access or version may have changed. Your original memo is unchanged; review again.",
      );
      setProposal(null);
    } finally {
      setBusy(false);
    }
  }
  const invalidate = () => setProposal(null);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        pending={busy && !data}
        disabled={disabled || busy}
        onClick={() => void open()}
      >
        {zh ? "整理备忘…" : "Organize memo…"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={disabled || busy}
        onClick={() => void open(true)}
      >
        {zh ? "Atlas 整理备忘…" : "Organize memo with Atlas…"}
      </Button>
      {applied && (
        <span role="status">
          {zh
            ? "已保存到本机，原始备忘保留"
            : "Saved locally; original memo retained"}
        </span>
      )}
      {!data && error && <p role="alert">{error}</p>}
      {data && atlasOpen && (
        <MemoAtlasFloat
          runtime={runtime}
          source={data.source}
          zh={zh}
          onClose={() => {
            setAtlasOpen(false);
            setData(null);
          }}
          onDraft={(draft, action) => {
            setText(draft);
            setKind(action);
            setTitle("");
            setProposal(null);
            setFromAtlas(true);
            setAtlasOpen(false);
          }}
        />
      )}
      {data && !atlasOpen && (
        <Dialog
          className="ui-dialog entity-memo-dialog entity-memo-organization"
          aria-label={zh ? "审核备忘整理" : "Review memo organization"}
          onRequestClose={() => {
            if (!busy) setData(null);
          }}
        >
          <h2>{zh ? "审核备忘整理" : "Review memo organization"}</h2>
          <p>
            {fromAtlas
              ? zh
                ? "Atlas 草案尚未写入正式内容。请预览后明确应用；原始私人备忘保持不变。"
                : "The Atlas draft has not changed formal content. Preview and explicitly apply; your original private memo stays unchanged."
              : zh
                ? "先预览，再明确应用。原始私人备忘保持不变，此操作不会发送给模型。"
                : "Preview before applying. Your original private memo stays unchanged; this action does not send it to a model."}
          </p>
          <Select
            label={zh ? "整理方式" : "Organization action"}
            value={kind}
            disabled={busy}
            onChange={(event) => {
              setKind(event.target.value as MemoFormalization["kind"]);
              invalidate();
            }}
          >
            <option value="CREATE_TASK">
              {zh ? "创建任务" : "Create task"}
            </option>
            <option value="CREATE_DOCUMENT">
              {zh ? "整理为文档" : "Organize as document"}
            </option>
            <option value="APPEND_DOCUMENT">
              {zh ? "追加到文档" : "Append to document"}
            </option>
          </Select>
          {kind !== "APPEND_DOCUMENT" && (
            <label>
              {zh ? "标题" : "Title"}
              <input
                value={title}
                maxLength={240}
                disabled={busy}
                onChange={(event) => {
                  setTitle(event.target.value);
                  invalidate();
                }}
              />
            </label>
          )}
          {kind === "CREATE_TASK" ? (
            <ProjectDrilldownPicker
              kind="PROJECT"
              mode="single"
              projects={data.workspace.items.filter(
                (item) => item.type === "PROJECT" && !item.deletedAt,
              )}
              value={projectId}
              disabled={busy}
              onChange={(id) => {
                setProjectId(typeof id === "string" ? id : null);
                invalidate();
              }}
            />
          ) : (
            <>
              <SpacePicker
                spaces={data.workspace.library}
                value={spaceId}
                disabled={busy}
                onChange={(id) => {
                  setSpaceId(id);
                  setDocumentId(null);
                  invalidate();
                }}
              />
              {kind === "APPEND_DOCUMENT" && spaceId && (
                <DocumentDrilldownPicker
                  label={zh ? "目标文档" : "Destination document"}
                  documents={data.workspace.library}
                  spaceId={spaceId}
                  value={documentId}
                  disabled={busy}
                  onChange={(id) => {
                    setDocumentId(id);
                    invalidate();
                  }}
                />
              )}
            </>
          )}
          <label>
            {zh ? "拟写入的内容" : "Proposed content"}
            <textarea
              rows={4}
              maxLength={100000}
              value={text}
              disabled={busy}
              onChange={(event) => {
                setText(event.target.value);
                invalidate();
              }}
            />
          </label>
          {proposal && (
            <section aria-label={zh ? "整理预览" : "Organization preview"}>
              <h3>
                {proposal.change.kind === "APPEND_DOCUMENT"
                  ? zh
                    ? "追加内容"
                    : "Content to append"
                  : proposal.change.title}
              </h3>
              <Markdown text={proposal.change.bodyMd} />
            </section>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="ui-toolbar">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setData(null)}
            >
              {zh ? "取消" : "Cancel"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy || !text.trim()}
              onClick={() => void preview()}
            >
              {zh ? "预览" : "Preview"}
            </Button>
            <Button
              type="button"
              variant="primary"
              pending={busy}
              disabled={busy || !proposal}
              onClick={() => void apply()}
            >
              {zh ? "应用" : "Apply"}
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
