import type {
  ModelProviderCapabilities,
  ProviderConnection,
  ProviderKind,
} from "@arclattice/application";
import { useState } from "react";
import type { Runtime } from "../../bootstrap";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog, Dialog, Select } from "../../components/ui/Surfaces";
import {
  configurationInput,
  type ModelSettingsSectionProps,
} from "./model-settings-types";

const kinds: [ProviderKind, string, string][] = [
  ["OPENAI", "OpenAI", "https://api.openai.com/v1/"],
  ["ANTHROPIC", "Anthropic", "https://api.anthropic.com/v1/"],
  ["GEMINI", "Gemini", "https://generativelanguage.googleapis.com/v1beta/"],
  ["DEEPSEEK", "DeepSeek", "https://api.deepseek.com/v1/"],
  ["OPENROUTER", "OpenRouter", "https://openrouter.ai/api/v1/"],
  ["OLLAMA", "Ollama", "http://127.0.0.1:11434/"],
  ["LM_STUDIO", "LM Studio", "http://127.0.0.1:1234/v1/"],
  ["VLLM", "vLLM", "http://127.0.0.1:8000/v1/"],
  ["CUSTOM_OPENAI", "Custom OpenAI-compatible", ""],
];
export function ProviderConnections({
  configuration,
  busy,
  zh,
  save,
  runtime,
}: ModelSettingsSectionProps & { runtime: Runtime }) {
  const [editing, setEditing] = useState<ProviderConnection | "new" | null>(
    null,
  );
  const [discovery, setDiscovery] = useState<{
    id: string;
    models: string[];
    error: string;
    capabilities?: ModelProviderCapabilities;
  } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ProviderConnection | null>(null);
  const close = () => setEditing(null);
  return (
    <section
      aria-label={zh ? "服务连接" : "Provider Connections"}
      className="model-settings-section"
    >
      <h3>{zh ? "服务连接" : "Provider Connections"}</h3>
      <p>
        {zh
          ? "密钥由服务器加密保存，同一连接下的模型共享凭据。"
          : "Keys are encrypted on the server. Models on the same connection share credentials."}
      </p>
      {configuration.connections.map((connection) => {
        const models = configuration.models.filter(
          (model) => model.connectionId === connection.id,
        );
        const used = configuration.profiles.some((profile) =>
          models.some(
            (model) =>
              model.id === profile.primaryModelId ||
              profile.fallbackModelIds.includes(model.id),
          ),
        );
        return (
          <div className="model-settings-row" key={connection.id}>
            <strong>{connection.name}</strong>
            <span>{connection.kind}</span>
            <details>
              <summary>{zh ? "高级" : "Advanced"}</summary>
              <small>{connection.endpoint}</small>
            </details>
            <span>
              {connection.credentialConfigured
                ? zh
                  ? "已保存密钥"
                  : "Key saved"
                : zh
                  ? "无密钥"
                  : "No key"}
            </span>
            <Button
              type="button"
              disabled={busy}
              onClick={() => setEditing(connection)}
            >
              {zh ? "编辑连接" : "Edit connection"}
            </Button>
            <Button
              type="button"
              disabled={busy || !!testing}
              onClick={async () => {
                setTesting(connection.id);
                setDiscovery(null);
                try {
                  const result = await runtime.connectionModels(connection.id);
                  setDiscovery({
                    id: connection.id,
                    models: result.models,
                    capabilities: result.capabilities,
                    error: "",
                  });
                } catch (failure) {
                  setDiscovery({
                    id: connection.id,
                    models: [],
                    error:
                      failure instanceof Error
                        ? failure.message
                        : "CONNECTION_FAILED",
                  });
                } finally {
                  setTesting(null);
                }
              }}
            >
              {zh ? "测试并发现模型" : "Test and discover models"}
            </Button>
            <Button
              type="button"
              disabled={busy || used}
              title={
                used
                  ? zh
                    ? "先移除引用这些模型的配置"
                    : "Remove profiles using these models first"
                  : undefined
              }
              onClick={() => setRemoving(connection)}
            >
              {zh ? "移除连接" : "Remove connection"}
            </Button>
          </div>
        );
      })}
      {discovery && (
        <div role="status">
          {discovery.error ? (
            <p>
              {zh
                ? "模型发现失败；不支持发现的服务可在模型区域手工添加。"
                : "Model discovery failed. Services without discovery can be added manually in Models."}{" "}
              {discovery.error}
            </p>
          ) : (
            <>
              <p>
                {zh ? "连接成功，发现模型" : "Connected; discovered models"}:{" "}
                {discovery.models.length}
              </p>
              {discovery.models.map((modelId) => (
                <Button
                  type="button"
                  key={modelId}
                  disabled={
                    busy ||
                    configuration.models.some(
                      (model) =>
                        model.connectionId === discovery.id &&
                        model.modelId === modelId,
                    )
                  }
                  onClick={() =>
                    void save((current) => ({
                      ...configurationInput(current),
                      models: [
                        ...current.models,
                        {
                          id: `m_${crypto.randomUUID().replaceAll("-", "")}`,
                          connectionId: discovery.id,
                          modelId,
                          capabilities: discovery.capabilities ?? {
                            tools: false,
                            jsonSchema: false,
                            vision: false,
                            streaming: false,
                            embedding: false,
                          },
                        },
                      ],
                    }))
                  }
                >
                  {modelId} +
                </Button>
              ))}
            </>
          )}
        </div>
      )}
      <Button type="button" disabled={busy} onClick={() => setEditing("new")}>
        {zh ? "添加服务连接" : "Add provider connection"}
      </Button>
      {editing && (
        <ConnectionForm
          key={typeof editing === "string" ? "new" : editing.id}
          connection={editing === "new" ? null : editing}
          busy={busy}
          zh={zh}
          onClose={close}
          onSave={async (connection, key) => {
            return save((current) => ({
              ...configurationInput(current),
              connections: [
                ...current.connections.filter(
                  (row) => row.id !== connection.id,
                ),
                connection,
              ],
              credentials: key ? [{ connectionId: connection.id, key }] : [],
            }));
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={zh ? "移除连接" : "Remove connection"}
          confirmLabel={zh ? "移除" : "Remove"}
          cancelLabel={zh ? "取消" : "Cancel"}
          pending={busy}
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={() =>
            void (async () => {
              if (
                await save((current) => ({
                  ...configurationInput(current),
                  connections: current.connections.filter(
                    (row) => row.id !== removing.id,
                  ),
                  models: current.models.filter(
                    (row) => row.connectionId !== removing.id,
                  ),
                }))
              )
                setRemoving(null);
            })()
          }
        >
          {zh
            ? "删除这个连接和服务器保存的密钥？"
            : "Remove this connection and its saved key?"}
        </ConfirmDialog>
      )}
    </section>
  );
}
function ConnectionForm({
  connection,
  busy,
  zh,
  onSave,
  onClose,
}: {
  connection: ProviderConnection | null;
  busy: boolean;
  zh: boolean;
  onSave(connection: ProviderConnection, key: string): Promise<boolean>;
  onClose(): void;
}) {
  const [name, setName] = useState(connection?.name ?? "OpenAI"),
    [kind, setKind] = useState<ProviderKind>(connection?.kind ?? "OPENAI"),
    [endpoint, setEndpoint] = useState(connection?.endpoint ?? kinds[0]![2]),
    [key, setKey] = useState("");
  const [id] = useState(
    connection?.id ?? `c_${crypto.randomUUID().replaceAll("-", "")}`,
  );
  const dirty =
    name !== (connection?.name ?? "OpenAI") ||
    kind !== (connection?.kind ?? "OPENAI") ||
    endpoint !== (connection?.endpoint ?? kinds[0]![2]) ||
    !!key;
  const [discarding, setDiscarding] = useState(false);
  return (
    <Dialog
      aria-label={zh ? "连接编辑" : "Connection editor"}
      onRequestClose={() => {
        if (!busy) {
          if (dirty) setDiscarding(true);
          else onClose();
        }
      }}
    >
      <form
        className="model-settings-form"
        aria-label={zh ? "连接编辑" : "Connection editor"}
        onSubmit={async (event) => {
          event.preventDefault();
          if (
            await onSave(
              {
                id,
                name,
                kind,
                endpoint,
                credentialRef: id,
                credentialConfigured: connection?.credentialConfigured ?? false,
              },
              key,
            )
          ) {
            setKey("");
            onClose();
          }
        }}
      >
        <label>
          {zh ? "连接名称" : "Connection name"}
          <input
            required
            maxLength={240}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          {zh ? "服务商" : "Provider"}
          <Select
            value={kind}
            onChange={(event) => {
              const next = kinds.find((row) => row[0] === event.target.value)!;
              setKind(next[0]);
              setEndpoint(next[2]);
              setName(next[1]);
            }}
          >
            {kinds.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </label>
        <details open={kind === "CUSTOM_OPENAI" ? true : undefined}>
          <summary>{zh ? "高级" : "Advanced"}</summary>
          <label>
            {zh ? "API 基址" : "API base URL"}
            <input
              type="url"
              required
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
            />
          </label>
        </details>
        <label>
          {zh
            ? "API 密钥（留空保留已有密钥）"
            : "API key (blank keeps existing key)"}
          <input
            type="password"
            autoComplete="new-password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
        </label>
        {["OLLAMA", "LM_STUDIO", "VLLM"].includes(kind) && (
          <p>
            {zh
              ? "本地/私有地址须由管理员加入 Trusted AI Endpoint 允许列表。"
              : "Local/private addresses require an administrator's Trusted AI Endpoint allowlist."}
          </p>
        )}
        <div className="action-row">
          <Button type="submit" disabled={busy}>
            {zh ? "保存连接" : "Save connection"}
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!dirty) {
                setKey("");
                onClose();
              } else setDiscarding(true);
            }}
          >
            {zh ? "取消" : "Cancel"}
          </Button>
        </div>
        {discarding && (
          <ConfirmDialog
            title={zh ? "丢弃连接草稿？" : "Discard connection draft?"}
            confirmLabel={zh ? "丢弃" : "Discard"}
            cancelLabel={zh ? "继续编辑" : "Keep editing"}
            onCancel={() => setDiscarding(false)}
            onConfirm={() => {
              setKey("");
              onClose();
            }}
          >
            {zh
              ? "未保存的修改将被丢弃。"
              : "Unsaved changes will be discarded."}
          </ConfirmDialog>
        )}
      </form>
    </Dialog>
  );
}
