import {
  type ContentPolicy,
  type EntityMemoTarget,
  privateContentPolicy,
} from "@arclattice/application";
import type { EntityMemo } from "@arclattice/domain";
import { useState } from "react";
import type { Runtime } from "../../bootstrap";
import { ContentPolicyEditor } from "../../ContentPolicyEditor";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Surfaces";

/** Explicit owner metadata edit, separate from per-run approval or model output. */
export function MemoAiPermission({
  runtime,
  target,
  disabled,
  zh,
}: {
  runtime: Runtime;
  target: EntityMemoTarget;
  disabled: boolean;
  zh: boolean;
}) {
  const [source, setSource] = useState<EntityMemo | null>(null);
  const [policy, setPolicy] = useState<ContentPolicy>({
    ...privateContentPolicy,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function open() {
    if (busy || disabled) return;
    setBusy(true);
    setError("");
    try {
      const value = await runtime.getEntityMemo(target);
      if (!value) throw new Error("MEMO_NOT_FOUND");
      setSource(value);
      setPolicy({ ...(value.aiPolicy ?? privateContentPolicy) });
    } catch {
      setError(
        zh
          ? "暂时无法读取备忘，请重试。"
          : "The memo could not be read. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!source || busy) return;
    setBusy(true);
    setError("");
    try {
      await runtime.saveEntityMemo(
        {
          targetKind: source.targetKind,
          targetId: source.targetId,
          bodyMd: source.bodyMd,
          aiPolicy: policy,
        },
        source.version,
      );
      setSource(null);
    } catch {
      setError(
        zh
          ? "未保存许可。备忘可能已变化，请关闭后重新审核；原文未被覆盖。"
          : "Permission was not saved. The memo may have changed; close and review again. Its text was not overwritten.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        disabled={disabled || busy}
        onClick={() => void open()}
      >
        {zh ? "备忘 AI 许可…" : "Memo AI permission…"}
      </Button>
      {!source && error && <p role="alert">{error}</p>}
      {source && (
        <Dialog
          className="ui-dialog entity-memo-dialog"
          aria-label={zh ? "备忘 AI 数据许可" : "Memo AI data permission"}
          onRequestClose={() => {
            if (!busy) setSource(null);
          }}
        >
          <h2>{zh ? "备忘 AI 数据许可" : "Memo AI data permission"}</h2>
          <p>
            {zh
              ? "私人备忘默认禁止发送。修改许可不会立即发送内容；Atlas 请求仍需审批，不能绕过机密或处理位置限制。"
              : "Private memos deny sending by default. Changing permission sends no content. Atlas requests still require approval and cannot bypass secret or location restrictions."}
          </p>
          <ContentPolicyEditor
            value={policy}
            onChange={setPolicy}
            disabled={busy}
            description={
              zh
                ? "此许可仅属于你自己的这条备忘，不继承或改变项目、文件或文档的许可。"
                : "This permission belongs only to your memo; it does not inherit or change Project, File or Document permissions."
            }
          />
          {error && <p role="alert">{error}</p>}
          <div className="ui-toolbar">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setSource(null)}
            >
              {zh ? "取消" : "Cancel"}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={busy}
              onClick={() => void save()}
            >
              {zh ? "保存许可" : "Save permission"}
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
