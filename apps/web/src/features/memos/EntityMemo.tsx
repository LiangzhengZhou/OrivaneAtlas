import type { WorkItem } from "@arclattice/domain";
import {
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import type { Runtime } from "../../bootstrap";
import { Button } from "../../components/ui/Button";
import { PressableSurface } from "../../components/ui/Content";
import { Dialog } from "../../components/ui/Surfaces";
import {
  clearDraftStrict,
  loadDraftStrict,
  saveDraft,
} from "../../localDrafts";
import { Markdown } from "../../Markdown";
import {
  type MemoConflictReview,
  MemoController,
  type MemoTarget,
} from "./memo-controller";
import "./memos.css";
import { MemoAiPermission } from "./MemoAiPermission";
import { MemoFormalizationReview } from "./MemoFormalization";

const controllers = new WeakMap<Runtime, Map<string, MemoController>>();
export function WorkEntityMemo({
  runtime,
  item,
}: {
  runtime: Runtime;
  item: WorkItem | undefined;
}) {
  if (
    !item ||
    item.deletedAt ||
    (item.type !== "TASK" &&
      item.type !== "PROJECT" &&
      item.type !== "MILESTONE")
  )
    return null;
  return (
    <EntityMemo runtime={runtime} targetKind={item.type} targetId={item.id} />
  );
}
function controllerFor(runtime: Runtime, target: MemoTarget) {
  const actor = runtime.context;
  const key = JSON.stringify([
    "entity-memo",
    actor.workspaceId,
    actor.principalId,
    target.targetKind,
    target.targetId,
  ]);
  let entries = controllers.get(runtime);
  if (!entries) {
    entries = new Map();
    controllers.set(runtime, entries);
  }
  let controller = entries.get(key);
  if (!controller) {
    controller = new MemoController(target, key, {
      read: (value) => runtime.getEntityMemo(value),
      save: (value, version) => runtime.saveEntityMemo(value, version),
      drafts: {
        load: loadDraftStrict,
        save: saveDraft,
        clear: clearDraftStrict,
      },
    });
    entries.set(key, controller);
  }
  return controller;
}

type EntityMemoProps = { runtime: Runtime } & MemoTarget;

/** Identity changes must not retain another owner's open review or editor state. */
export function EntityMemo(props: EntityMemoProps) {
  return (
    <EntityMemoSurface
      key={JSON.stringify([
        props.runtime.context.workspaceId,
        props.runtime.context.principalId,
        props.targetKind,
        props.targetId,
      ])}
      {...props}
    />
  );
}

/** A private continuous memo, separate from the target description or Document. */
function EntityMemoSurface({ runtime, targetKind, targetId }: EntityMemoProps) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const id = useId();
  const controller = useMemo(
    () => controllerFor(runtime, { targetKind, targetId }),
    [runtime, targetKind, targetId],
  );
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [editing, setEditing] = useState(false);
  const [review, setReview] = useState<MemoConflictReview | null>(null);
  const [resolving, setResolving] = useState(false);
  useEffect(() => {
    if (editing) return controller.retainEditing();
  }, [controller, editing]);
  async function resolve(choice: "LOCAL" | "REMOTE") {
    if (!review || resolving) return;
    setResolving(true);
    try {
      if (await controller.resolveConflict(review, choice)) setReview(null);
      else setReview(await controller.reviewConflict());
    } finally {
      setResolving(false);
    }
  }
  useEffect(() => {
    void controller.refresh();
    const unsubscribe = runtime.subscribeWorkspace(() => {
      void controller.refresh();
    });
    const flush = () => {
      void controller.flush();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      flush();
      if (controller.snapshot().dirty) event.preventDefault();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      unsubscribe();
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", beforeUnload);
      flush();
    };
  }, [controller, runtime]);
  const label = zh ? "私人备忘" : "Private memo";
  return (
    <section className="entity-memo" aria-label={label}>
      <div className="entity-memo-heading">
        <span id={id}>{label}</span>
        <span className="muted" role="status">
          {state.saving
            ? zh
              ? "正在保存到本机…"
              : "Saving locally…"
            : state.ready && !state.dirty && !state.failure
              ? zh
                ? "已保存到本机"
                : "Saved locally"
              : ""}
        </span>
        {editing && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              void controller.flush();
              setEditing(false);
            }}
          >
            {zh ? "完成编辑" : "Done editing"}
          </Button>
        )}
      </div>
      {state.ready && !!state.body.trim() && (
        <MemoFormalizationReview
          runtime={runtime}
          target={{ targetKind, targetId }}
          body={state.body}
          disabled={state.dirty || state.saving || !!state.failure}
          zh={zh}
        />
      )}
      {state.ready && !!state.body.trim() && !editing && (
        <MemoAiPermission
          runtime={runtime}
          target={{ targetKind, targetId }}
          disabled={state.dirty || state.saving || !!state.failure}
          zh={zh}
        />
      )}
      {!state.ready ? (
        <Button
          type="button"
          variant="ghost"
          disabled={!state.failure}
          onClick={() => void controller.load()}
        >
          {state.failure
            ? zh
              ? "读取失败，重试"
              : "Could not load. Retry"
            : zh
              ? "正在读取…"
              : "Loading…"}
        </Button>
      ) : editing ? (
        <textarea
          aria-labelledby={id}
          value={state.body}
          maxLength={100000}
          rows={5}
          onChange={(event) => controller.edit(event.target.value)}
          onBlur={() => void controller.flush()}
          onKeyDown={(event) => {
            if (
              (event.ctrlKey || event.metaKey) &&
              event.key.toLowerCase() === "s"
            ) {
              event.preventDefault();
              event.stopPropagation();
              void controller.flush();
            }
            if (event.key === "Escape") {
              event.stopPropagation();
              void controller.flush();
              setEditing(false);
            }
          }}
        />
      ) : state.body ? (
        <PressableSurface
          intent="NAVIGATE"
          aria-label={zh ? "编辑私人备忘" : "Edit private memo"}
          onOpen={() => setEditing(true)}
        >
          <Markdown text={state.body} />
        </PressableSurface>
      ) : (
        <Button type="button" variant="ghost" onClick={() => setEditing(true)}>
          {zh ? "+ 添加备忘" : "+ Add memo"}
        </Button>
      )}
      {state.failure && state.ready && (
        <p role="alert">
          {state.failure === "CONFLICT"
            ? zh
              ? "备忘存在版本冲突。本机草稿已保留，尚未覆盖其他版本。"
              : "Memo version conflict. Your local draft is retained; other versions have not been overwritten."
            : zh
              ? "未能保存备忘，请重试。"
              : "Could not save your memo. Please retry."}{" "}
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              state.failure === "CONFLICT"
                ? void controller.reviewConflict().then(setReview)
                : void controller.flush()
            }
          >
            {state.failure === "CONFLICT"
              ? zh
                ? "审核版本"
                : "Review versions"
              : zh
                ? "重试本地保存"
                : "Retry local save"}
          </Button>
        </p>
      )}
      {review && (
        <Dialog
          className="ui-dialog entity-memo-dialog"
          aria-label={zh ? "审核备忘版本" : "Review memo versions"}
          onRequestClose={() => {
            if (!resolving) setReview(null);
          }}
        >
          <h2>{zh ? "审核备忘版本" : "Review memo versions"}</h2>
          <p>
            {zh
              ? "请选择保留哪个版本。确认前会再次检查当前版本；新的修改不会被静默覆盖。"
              : "Choose which version to keep. The current version is checked again before applying; newer edits will not be silently overwritten."}
          </p>
          <h3>{zh ? "本机草稿" : "Local draft"}</h3>
          <pre className="entity-memo-review">{review.localBody}</pre>
          <h3>{zh ? "当前保存版本" : "Current saved version"}</h3>
          <pre className="entity-memo-review">
            {review.remote?.bodyMd ?? (zh ? "尚无已保存备忘" : "No saved memo")}
          </pre>
          <Button
            type="button"
            variant="secondary"
            disabled={resolving}
            onClick={() => void resolve("LOCAL")}
          >
            {zh ? "保留本机草稿" : "Keep local draft"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={resolving}
            onClick={() => void resolve("REMOTE")}
          >
            {zh ? "使用当前保存版本" : "Use current saved version"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={resolving}
            onClick={() => setReview(null)}
          >
            {zh ? "稍后处理" : "Review later"}
          </Button>
        </Dialog>
      )}
    </section>
  );
}
