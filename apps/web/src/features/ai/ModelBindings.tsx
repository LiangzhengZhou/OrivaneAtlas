import { useState } from "react";
import type { Snapshot } from "../../bootstrap";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Surfaces";
import { SpacePicker } from "../knowledge/SpacePicker";
import { ProjectDrilldownPicker } from "../projects/ProjectDrilldownPicker";
import {
  configurationInput,
  type ModelSettingsSectionProps,
} from "./model-settings-types";
export function ModelBindings({
  configuration,
  busy,
  zh,
  save,
  snapshot,
}: ModelSettingsSectionProps & { snapshot: Snapshot }) {
  const [kind, setKind] = useState<"PROJECT" | "SPACE">("PROJECT"),
    [entityId, setEntityId] = useState<string | null>(null),
    [profileId, setProfileId] = useState("");
  const names = new Map(
    [...snapshot.items, ...snapshot.library].map((entry) => [
      entry.id,
      entry.title,
    ]),
  );
  const options = configuration.profiles.map((profile) => (
    <option key={profile.id} value={profile.id}>
      {profile.name}
    </option>
  ));
  const defaults = configuration.bindings.find(
    (binding) => binding.scope === "PERSONAL",
  );
  return (
    <section
      className="model-settings-section"
      aria-label={zh ? "默认与范围覆盖" : "Default and overrides"}
    >
      <h3>{zh ? "默认与范围覆盖" : "Default and overrides"}</h3>
      <p>
        {zh
          ? "对话指定配置优先，其次当前空间、当前项目，最后默认模型。未设置的覆盖自动继承。这与对话中允许检索的内容分开。"
          : "Conversation override, then current space, current project, and personal default. Unset overrides inherit. Retrieval context remains separate."}
      </p>
      <label>
        {zh ? "默认模型配置" : "Default model profile"}
        <Select
          disabled={busy}
          value={defaults?.profileId ?? ""}
          onChange={(event) =>
            void save((current) => ({
              ...configurationInput(current),
              bindings: [
                ...current.bindings.filter(
                  (binding) => binding.scope !== "PERSONAL",
                ),
                ...(event.target.value
                  ? [
                      {
                        scope: "PERSONAL" as const,
                        entityId: null,
                        profileId: event.target.value,
                      },
                    ]
                  : []),
              ],
            }))
          }
        >
          <option value="">{zh ? "未设置" : "Not configured"}</option>
          {options}
        </Select>
      </label>
      {configuration.bindings
        .filter((binding) => binding.scope !== "PERSONAL")
        .map((binding) => (
          <label key={`${binding.scope}:${binding.entityId}`}>
            {binding.scope === "PROJECT"
              ? zh
                ? "项目覆盖"
                : "Project override"
              : zh
                ? "空间覆盖"
                : "Space override"}{" "}
            · {names.get(binding.entityId ?? "") ?? binding.entityId}
            <Select
              disabled={busy}
              value={binding.profileId}
              onChange={(event) =>
                void save((current) => ({
                  ...configurationInput(current),
                  bindings: current.bindings.flatMap((row) =>
                    row.scope !== binding.scope ||
                    row.entityId !== binding.entityId
                      ? [row]
                      : event.target.value
                        ? [{ ...row, profileId: event.target.value }]
                        : [],
                  ),
                }))
              }
            >
              <option value="">{zh ? "继承" : "Inherit"}</option>
              {options}
            </Select>
          </label>
        ))}
      <details>
        <summary>
          {zh ? "添加项目 / 空间覆盖" : "Add project / space override"}
        </summary>
        <label>
          {zh ? "覆盖对象类型" : "Override entity type"}
          <Select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as "PROJECT" | "SPACE");
              setEntityId(null);
            }}
          >
            <option value="PROJECT">{zh ? "项目" : "Project"}</option>
            <option value="SPACE">{zh ? "知识空间" : "Space"}</option>
          </Select>
        </label>
        {kind === "PROJECT" ? (
          <ProjectDrilldownPicker
            mode="single"
            projects={snapshot.items}
            value={entityId}
            disabled={busy}
            onChange={(value) =>
              setEntityId(typeof value === "string" ? value : null)
            }
          />
        ) : (
          <SpacePicker
            spaces={snapshot.library}
            value={entityId}
            disabled={busy}
            onChange={setEntityId}
          />
        )}
        <label>
          {zh ? "覆盖使用的配置" : "Override profile"}
          <Select
            value={profileId}
            onChange={(event) => setProfileId(event.target.value)}
          >
            <option value="">{zh ? "选择配置" : "Choose profile"}</option>
            {options}
          </Select>
        </label>
        <Button
          type="button"
          disabled={busy || !entityId || !profileId}
          onClick={async () => {
            if (
              await save((current) => ({
                ...configurationInput(current),
                bindings: [
                  ...current.bindings.filter(
                    (row) => row.scope !== kind || row.entityId !== entityId,
                  ),
                  { scope: kind, entityId, profileId },
                ],
              }))
            )
              setEntityId(null);
          }}
        >
          {zh ? "保存覆盖" : "Save override"}
        </Button>
      </details>
    </section>
  );
}
