import { useState } from "react";
import {
  configurationInput,
  type ModelSettingsSectionProps,
} from "./model-settings-types";
export function ModelDefinitions({
  configuration,
  busy,
  zh,
  save,
}: ModelSettingsSectionProps) {
  const [connectionId, setConnectionId] = useState(""),
    [modelId, setModelId] = useState("");
  const connectionNames = new Map(
    configuration.connections.map((connection) => [
      connection.id,
      connection.name,
    ]),
  );
  return (
    <section
      className="model-settings-section"
      aria-label={zh ? "模型" : "Models"}
    >
      <h3>{zh ? "模型" : "Models"}</h3>
      {configuration.models.map((model) => {
        const used = configuration.profiles.some(
          (profile) =>
            profile.primaryModelId === model.id ||
            profile.fallbackModelIds.includes(model.id),
        );
        return (
          <div className="model-settings-row" key={model.id}>
            <strong>
              {connectionNames.get(model.connectionId)} / {model.modelId}
            </strong>
            <details>
              <summary>{zh ? "模型能力" : "Model capabilities"}</summary>
              <p>
                {zh
                  ? "仅启用已确认受此模型及服务支持的能力；工具参数仍由系统严格校验。"
                  : "Enable only capabilities confirmed for this model and server. Tool arguments remain strictly validated."}
              </p>
              {(
                Object.keys(
                  model.capabilities,
                ) as (keyof typeof model.capabilities)[]
              ).map((capability) => (
                <label key={capability}>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={model.capabilities[capability]}
                    onChange={(event) =>
                      void save((current) => ({
                        ...configurationInput(current),
                        models: current.models.map((row) =>
                          row.id === model.id
                            ? {
                                ...row,
                                capabilities: {
                                  ...row.capabilities,
                                  [capability]: event.target.checked,
                                },
                              }
                            : row,
                        ),
                      }))
                    }
                  />
                  {
                    {
                      tools: zh ? "工具调用" : "Tools",
                      jsonSchema: zh ? "JSON 结构约束" : "JSON schema",
                      vision: zh ? "图像输入" : "Vision",
                      streaming: zh ? "流式输出" : "Streaming",
                      embedding: zh ? "向量嵌入" : "Embedding",
                    }[capability]
                  }
                </label>
              ))}
            </details>
            <button
              type="button"
              disabled={busy || used}
              onClick={() =>
                void save((current) => ({
                  ...configurationInput(current),
                  models: current.models.filter((row) => row.id !== model.id),
                }))
              }
            >
              {zh ? "移除模型" : "Remove model"}
            </button>
          </div>
        );
      })}
      <form
        className="model-settings-form"
        aria-label={zh ? "手工添加模型" : "Add model manually"}
        onSubmit={async (event) => {
          event.preventDefault();
          if (
            await save((current) => ({
              ...configurationInput(current),
              models: [
                ...current.models,
                {
                  id: `m_${crypto.randomUUID().replaceAll("-", "")}`,
                  connectionId,
                  modelId,
                  capabilities: {
                    tools: false,
                    jsonSchema: false,
                    vision: false,
                    streaming: false,
                    embedding: false,
                  },
                },
              ],
            }))
          )
            setModelId("");
        }}
      >
        <label>
          {zh ? "所属连接" : "Provider connection"}
          <select
            required
            value={connectionId}
            onChange={(event) => setConnectionId(event.target.value)}
          >
            <option value="">{zh ? "选择连接" : "Choose connection"}</option>
            {configuration.connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {zh ? "模型标识" : "Model identifier"}
          <input
            required
            maxLength={160}
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={busy || !connectionId || !modelId.trim()}
        >
          {zh ? "添加模型" : "Add model"}
        </button>
      </form>
    </section>
  );
}
