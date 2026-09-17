import type { ContentPolicy } from "@arclattice/application";
import { useTranslation } from "react-i18next";

export function ContentPolicyEditor({
  value,
  onChange,
  disabled,
}: {
  value: ContentPolicy;
  onChange: (value: ContentPolicy) => void;
  disabled: boolean;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  return (
    <details className="document-tools content-policy no-print">
      <summary>
        {zh ? "AI 数据许可" : "AI data permission"} · {value.aiAccess}
      </summary>
      <p>
        {zh
          ? "默认禁止发送。允许询问仍需逐次审批；文档与所属空间均须允许。审批不能绕过禁止、机密或处理位置限制。"
          : "Sending is denied by default. Ask still requires per-run approval. Both document and parent space must permit processing. Approval cannot override denial, secrets or location restrictions."}
      </p>
      <label>
        {zh ? "AI 访问" : "AI access"}
        <select
          disabled={disabled}
          value={value.aiAccess}
          onChange={(e) =>
            onChange({
              ...value,
              aiAccess: e.target.value as ContentPolicy["aiAccess"],
            })
          }
        >
          <option value="DENY">{zh ? "禁止" : "Deny"}</option>
          <option value="ASK">{zh ? "逐次询问" : "Ask each time"}</option>
          <option value="ALLOW">
            {zh
              ? "允许（仍需运行审批）"
              : "Allow (run approval still required)"}
          </option>
        </select>
      </label>
      <label>
        {zh ? "处理位置" : "Processing boundary"}
        <select
          disabled={disabled}
          value={value.processingBoundary}
          onChange={(e) =>
            onChange({
              ...value,
              processingBoundary: e.target
                .value as ContentPolicy["processingBoundary"],
            })
          }
        >
          <option value="LOCAL_ONLY">{zh ? "仅本地" : "Local only"}</option>
          <option value="SELF_HOSTED_ONLY">
            {zh ? "仅自托管" : "Self-hosted only"}
          </option>
          <option value="TRUSTED_CLOUD">
            {zh
              ? "仅受信云（尚未配置）"
              : "Trusted cloud only (not configured)"}
          </option>
          <option value="ANY">
            {zh ? "允许已审批的云服务" : "Allow approved cloud services"}
          </option>
        </select>
      </label>
      <label>
        {zh ? "敏感级别" : "Classification"}
        <select
          disabled={disabled}
          value={value.classification}
          onChange={(e) =>
            onChange({
              ...value,
              classification: e.target.value as ContentPolicy["classification"],
            })
          }
        >
          <option value="PUBLIC">{zh ? "公开" : "Public"}</option>
          <option value="WORKSPACE">{zh ? "工作区" : "Workspace"}</option>
          <option value="PRIVATE">{zh ? "私人" : "Private"}</option>
          <option value="SENSITIVE">{zh ? "敏感" : "Sensitive"}</option>
          <option value="SECRET">
            {zh ? "机密（禁止 AI）" : "Secret (AI blocked)"}
          </option>
        </select>
      </label>
    </details>
  );
}
