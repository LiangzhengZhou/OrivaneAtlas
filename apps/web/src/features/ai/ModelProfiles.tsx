import type { ModelProfile } from "@arclattice/application";
import { useState } from "react";
import {
  configurationInput,
  type ModelSettingsSectionProps,
} from "./model-settings-types";
export function ModelProfiles(props: ModelSettingsSectionProps) {
  const { configuration, busy, zh, save } = props;
  const [editing, setEditing] = useState<ModelProfile | "new" | null>(null);
  const connections = new Map(
    configuration.connections.map((connection) => [
      connection.id,
      connection.name,
    ]),
  );
  const modelNames = new Map(
    configuration.models.map((model) => [
      model.id,
      `${connections.get(model.connectionId)} / ${model.modelId}`,
    ]),
  );
  return (
    <section
      className="model-settings-section"
      aria-label={zh ? "模型配置与路由" : "Profiles / Routing"}
    >
      <h3>{zh ? "模型配置" : "Profiles"}</h3>
      {configuration.profiles.map((profile) => (
        <div className="model-settings-row" key={profile.id}>
          <strong>{profile.name}</strong>
          <span>{modelNames.get(profile.primaryModelId)}</span>
          <span>
            {profile.requestLimit.kind === "UNLIMITED"
              ? zh
                ? "每日调用不限"
                : "Unlimited requests"
              : `${profile.requestLimit.count} ${zh ? "次 / 日" : "requests / day"}`}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing(profile)}
          >
            {zh ? "编辑配置" : "Edit profile"}
          </button>
          <button
            type="button"
            disabled={
              busy ||
              configuration.bindings.some(
                (binding) => binding.profileId === profile.id,
              )
            }
            onClick={() => {
              if (
                window.confirm(
                  zh ? "删除这个模型配置？" : "Remove this model profile?",
                )
              )
                void save((current) => ({
                  ...configurationInput(current),
                  profiles: current.profiles.filter(
                    (row) => row.id !== profile.id,
                  ),
                }));
            }}
          >
            {zh ? "移除配置" : "Remove profile"}
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={busy || !configuration.models.length}
        onClick={() => setEditing("new")}
      >
        {zh ? "添加模型配置" : "Add model profile"}
      </button>
      {editing && (
        <ProfileForm
          key={editing === "new" ? "new" : editing.id}
          {...props}
          profile={editing === "new" ? null : editing}
          modelNames={modelNames}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
function ProfileForm({
  configuration,
  busy,
  zh,
  save,
  profile,
  modelNames,
  onClose,
}: ModelSettingsSectionProps & {
  profile: ModelProfile | null;
  modelNames: Map<string, string>;
  onClose(): void;
}) {
  const [initial] = useState<ModelProfile>(
    () =>
      profile ?? {
        id: `p_${crypto.randomUUID().replaceAll("-", "")}`,
        name: "",
        primaryModelId: configuration.models[0]?.id ?? "",
        fallbackModelIds: [],
        requestLimit: { kind: "UNLIMITED" },
        budget: {
          currency: "USD",
          dailyMicros: "UNLIMITED",
          inputMicrosPerMillion: 0,
          outputMicrosPerMillion: 0,
        },
        enabled: true,
        workload: "TEXT",
      },
  );
  const [draft, setDraft] = useState(initial),
    [limitedCount, setLimitedCount] = useState(
      profile?.requestLimit.kind === "LIMITED"
        ? profile.requestLimit.count
        : 100,
    );
  const [budgetDollars, setBudgetDollars] = useState(
    profile?.budget.dailyMicros === "UNLIMITED" || !profile
      ? 5
      : profile.budget.dailyMicros / 1_000_000,
  );
  const patch = (change: Partial<ModelProfile>) =>
    setDraft((current) => ({ ...current, ...change }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const options = configuration.models.map((model) => (
    <option key={model.id} value={model.id}>
      {modelNames.get(model.id)}
    </option>
  ));
  return (
    <form
      className="model-settings-form"
      aria-label={zh ? "配置编辑" : "Profile editor"}
      onSubmit={async (event) => {
        event.preventDefault();
        if (
          await save((current) => ({
            ...configurationInput(current),
            profiles: [
              ...current.profiles.filter(
                (row) => row.id !== (profile?.id ?? draft.id),
              ),
              draft,
            ],
          }))
        )
          onClose();
      }}
    >
      <label>
        {zh ? "配置名称" : "Profile name"}
        <input
          required
          maxLength={240}
          value={draft.name}
          onChange={(event) => patch({ name: event.target.value })}
        />
      </label>
      <label>
        {zh ? "首选模型" : "Primary model"}
        <select
          required
          value={draft.primaryModelId}
          onChange={(event) =>
            patch({
              primaryModelId: event.target.value,
              fallbackModelIds: draft.fallbackModelIds.filter(
                (id) => id !== event.target.value,
              ),
            })
          }
        >
          {options}
        </select>
      </label>
      {[0, 1].map((index) => (
        <label key={index}>
          {zh ? "备用模型" : "Fallback model"} {index + 1}
          <select
            value={draft.fallbackModelIds[index] ?? ""}
            onChange={(event) => {
              const next = [...draft.fallbackModelIds];
              next[index] = event.target.value;
              patch({ fallbackModelIds: next.filter(Boolean) });
            }}
          >
            <option value="">{zh ? "无" : "None"}</option>
            {configuration.models
              .filter(
                (model) =>
                  model.id !== draft.primaryModelId &&
                  (!draft.fallbackModelIds.includes(model.id) ||
                    draft.fallbackModelIds[index] === model.id),
              )
              .map((model) => (
                <option key={model.id} value={model.id}>
                  {modelNames.get(model.id)}
                </option>
              ))}
          </select>
        </label>
      ))}
      <fieldset className="field">
        <legend>{zh ? "每日调用限制" : "Daily request limit"}</legend>
        <label>
          <input
            type="radio"
            name={`limit-${draft.id}`}
            checked={draft.requestLimit.kind === "UNLIMITED"}
            onChange={() => patch({ requestLimit: { kind: "UNLIMITED" } })}
          />
          {zh ? "不限" : "Unlimited"}
        </label>
        <label>
          <input
            type="radio"
            name={`limit-${draft.id}`}
            checked={draft.requestLimit.kind === "LIMITED"}
            onChange={() =>
              patch({ requestLimit: { kind: "LIMITED", count: limitedCount } })
            }
          />
          {zh ? "限制次数" : "Limited requests"}
        </label>
        {draft.requestLimit.kind === "LIMITED" && (
          <label>
            {zh ? "每天次数" : "Requests per day"}
            <input
              type="number"
              required
              min={1}
              max={1_000_000}
              value={limitedCount}
              onChange={(event) => {
                setLimitedCount(event.target.valueAsNumber);
                patch({
                  requestLimit: {
                    kind: "LIMITED",
                    count: event.target.valueAsNumber,
                  },
                });
              }}
            />
          </label>
        )}
      </fieldset>
      <fieldset className="field">
        <legend>{zh ? "每日预算（USD）" : "Daily budget (USD)"}</legend>
        <label>
          <input
            type="checkbox"
            checked={draft.budget.dailyMicros === "UNLIMITED"}
            onChange={(event) =>
              patch({
                budget: {
                  ...draft.budget,
                  dailyMicros: event.target.checked
                    ? "UNLIMITED"
                    : Math.round(budgetDollars * 1_000_000),
                },
              })
            }
          />
          {zh ? "预算不限" : "Unlimited budget"}
        </label>
        {draft.budget.dailyMicros !== "UNLIMITED" && (
          <label>
            {zh ? "每日美元预算" : "Daily budget in dollars"}
            <input
              type="number"
              required
              min={0}
              max={1_000_000}
              step={0.01}
              value={budgetDollars}
              onChange={(event) => {
                setBudgetDollars(event.target.valueAsNumber);
                patch({
                  budget: {
                    ...draft.budget,
                    dailyMicros: Math.round(
                      event.target.valueAsNumber * 1_000_000,
                    ),
                  },
                });
              }}
            />
          </label>
        )}
      </fieldset>
      <details>
        <summary>{zh ? "高级" : "Advanced"}</summary>
        <label>
          {zh ? "配置 ID" : "Profile ID"}
          <input
            pattern="[a-zA-Z0-9_-]{1,64}"
            required
            readOnly={!!profile}
            value={draft.id}
            onChange={(event) => patch({ id: event.target.value })}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.enabled !== false}
            onChange={(event) => patch({ enabled: event.target.checked })}
          />
          {zh ? "启用配置" : "Enable profile"}
        </label>
        <label>
          {zh
            ? "输入价格（每百万 token，USD）"
            : "Input price (USD / million tokens)"}
          <input
            type="number"
            min={0}
            step={0.01}
            value={draft.budget.inputMicrosPerMillion / 1_000_000}
            onChange={(event) =>
              patch({
                budget: {
                  ...draft.budget,
                  inputMicrosPerMillion: Math.round(
                    event.target.valueAsNumber * 1_000_000,
                  ),
                },
              })
            }
          />
        </label>
        <label>
          {zh
            ? "输出价格（每百万 token，USD）"
            : "Output price (USD / million tokens)"}
          <input
            type="number"
            min={0}
            step={0.01}
            value={draft.budget.outputMicrosPerMillion / 1_000_000}
            onChange={(event) =>
              patch({
                budget: {
                  ...draft.budget,
                  outputMicrosPerMillion: Math.round(
                    event.target.valueAsNumber * 1_000_000,
                  ),
                },
              })
            }
          />
        </label>
      </details>
      <div className="action-row">
        <button type="submit" disabled={busy}>
          {zh ? "保存模型配置" : "Save model profile"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (
              !dirty ||
              window.confirm(zh ? "丢弃配置草稿？" : "Discard profile draft?")
            )
              onClose();
          }}
        >
          {zh ? "取消" : "Cancel"}
        </button>
      </div>
    </form>
  );
}
