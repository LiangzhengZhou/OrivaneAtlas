import type { AgentRun, PersonalModelInput } from "@arclattice/application";

type GatewayPolicy = NonNullable<PersonalModelInput["gateway"]>;

export function defaultGatewayPolicy(): GatewayPolicy {
  return {
    providerId: "provider",
    enabled: true,
    capabilities: ["TEXT"],
    capability: "TEXT",
    dailyRequests: 10,
    dailyBudgetMicros: 1000000,
    currency: "USD",
    inputMicrosPerMillion: 0,
    outputMicrosPerMillion: 0,
    fallbackProfileIds: [],
  };
}

export function GatewaySettings({
  value,
  onChange,
  disabled,
  zh,
  profiles,
}: {
  value: GatewayPolicy | undefined;
  onChange: (value: GatewayPolicy | undefined) => void;
  disabled: boolean;
  zh: boolean;
  profiles: string[];
}) {
  const patch = (change: Partial<GatewayPolicy>) =>
    onChange({ ...value!, ...change });
  return (
    <fieldset disabled={disabled}>
      <legend>
        {zh
          ? "模型注册、预算与备用路线"
          : "Model registry, budget and fallback"}
      </legend>
      <label className="field">
        <span>
          <input
            type="checkbox"
            checked={!!value}
            onChange={(event) =>
              onChange(
                event.target.checked ? defaultGatewayPolicy() : undefined,
              )
            }
          />
          {zh ? "启用显式 Gateway 策略" : "Enable explicit Gateway policies"}
        </span>
      </label>
      {value && (
        <>
          <label className="field">
            {zh ? "提供商标识" : "Provider ID"}
            <input
              required
              pattern="[a-zA-Z0-9_-]{1,64}"
              value={value.providerId}
              onChange={(event) => patch({ providerId: event.target.value })}
            />
          </label>
          <label className="field">
            <span>
              <input
                type="checkbox"
                checked={value.enabled}
                onChange={(event) => patch({ enabled: event.target.checked })}
              />
              {zh ? "允许此注册模型执行" : "Enable this registered model"}
            </span>
          </label>
          <label className="field">
            {zh ? "执行能力" : "Execution capability"}
            <select
              value={value.capability}
              onChange={(event) => {
                const capability = event.target
                  .value as GatewayPolicy["capability"];
                patch({
                  capability,
                  capabilities: [
                    ...new Set([...value.capabilities, capability]),
                  ],
                  fallbackProfileIds: [],
                });
              }}
            >
              <option value="TEXT">
                {zh ? "文本生成" : "Text generation"}
              </option>
              <option value="JSON">JSON</option>
              <option value="EMBEDDING">{zh ? "向量嵌入" : "Embedding"}</option>
            </select>
          </label>
          <label className="field">
            {zh ? "已注册能力" : "Registered capabilities"}
            <span>{value.capabilities.join(" · ")}</span>
          </label>
          {(["dailyRequests", "dailyBudgetMicros"] as const).map((field) => (
            <div className="field" key={field}>
              <label>
                <input
                  type="checkbox"
                  checked={value[field] === "UNLIMITED"}
                  onChange={(event) =>
                    patch({
                      [field]: event.target.checked
                        ? "UNLIMITED"
                        : field === "dailyRequests"
                          ? 10
                          : 1000000,
                    })
                  }
                />
                {field === "dailyRequests"
                  ? zh
                    ? "每日请求不限量（仍须审批）"
                    : "Unlimited daily requests (approval still required)"
                  : zh
                    ? "每日金额预算不限量"
                    : "Unlimited daily spending"}
              </label>
              {value[field] !== "UNLIMITED" && (
                <label>
                  {field === "dailyRequests"
                    ? zh
                      ? "每日请求数"
                      : "Daily requests"
                    : zh
                      ? "每日美元预算（同范围全部模型合计）"
                      : "Daily USD budget (all models in this scope)"}
                  <input
                    type="number"
                    min={0}
                    step={field === "dailyRequests" ? 1 : 0.000001}
                    required
                    value={
                      Number(value[field]) /
                      (field === "dailyRequests" ? 1 : 1000000)
                    }
                    onChange={(event) =>
                      patch({
                        [field]: Math.round(
                          Number(event.target.value) *
                            (field === "dailyRequests" ? 1 : 1000000),
                        ),
                      })
                    }
                  />
                </label>
              )}
            </div>
          ))}
          {(["inputMicrosPerMillion", "outputMicrosPerMillion"] as const).map(
            (field) => (
              <label className="field" key={field}>
                {field === "inputMicrosPerMillion"
                  ? zh
                    ? "输入价格：美元 / 百万 token"
                    : "Input price: USD / million tokens"
                  : zh
                    ? "输出价格：美元 / 百万 token"
                    : "Output price: USD / million tokens"}
                <input
                  type="number"
                  min={0}
                  step={0.000001}
                  required
                  value={value[field] / 1000000}
                  onChange={(event) =>
                    patch({
                      [field]: Math.round(Number(event.target.value) * 1000000),
                    })
                  }
                />
              </label>
            ),
          )}
          {(value.inputMicrosPerMillion === 0 ||
            value.outputMicrosPerMillion === 0) && (
            <label className="field">
              <span>
                <input type="checkbox" required />
                {zh
                  ? "我确认价格为 0 的部分确实免费"
                  : "I confirm any zero-priced usage is free"}
              </span>
            </label>
          )}
          <p>
            {zh
              ? "请按供应商实际价格配置；预算是本应用估算，非供应商账单。未知用量保留全部预留金额。"
              : "Enter actual provider prices. Budgets are application estimates, not invoices. Unknown usage retains the full reservation."}
          </p>
          {[0, 1].map((index) => (
            <label className="field" key={index}>
              {zh
                ? `备用配置 ${index + 1}（顺序执行，最多两项）`
                : `Fallback ${index + 1} (ordered, at most two)`}
              <select
                value={value.fallbackProfileIds[index] ?? ""}
                disabled={index === 1 && !value.fallbackProfileIds[0]}
                onChange={(event) => {
                  const next = [...value.fallbackProfileIds];
                  if (event.target.value) next[index] = event.target.value;
                  else next.splice(index);
                  patch({ fallbackProfileIds: next });
                }}
              >
                <option value="">{zh ? "无" : "None"}</option>
                {profiles
                  .filter(
                    (id) =>
                      !value.fallbackProfileIds.includes(id) ||
                      value.fallbackProfileIds[index] === id,
                  )
                  .map((id) => (
                    <option key={id}>{id}</option>
                  ))}
              </select>
            </label>
          ))}
          <p>
            {zh
              ? "每次请求会展示全部备用路线并要求审批。仅明确未发送的失败可切换；超时或未知结果不重发。备用配置必须同范围、同能力且启用。"
              : "Each request previews every fallback for approval. Only definitely unsent failures may fall back; timeouts and unknown outcomes never resend. Alternatives must be enabled with the same scope and capability."}
          </p>
        </>
      )}
    </fieldset>
  );
}

export function GatewayRunDetails({ run, zh }: { run: AgentRun; zh: boolean }) {
  const money = run.attempt?.money;
  return (
    <>
      {run.route.gateway && (
        <p>
          {run.route.gateway.providerId} · {run.route.gateway.capability} ·{" "}
          {zh ? "每日预算" : "Daily budget"}:{" "}
          {run.route.gateway.dailyBudgetMicros === "UNLIMITED"
            ? "UNLIMITED"
            : `$${(run.route.gateway.dailyBudgetMicros / 1000000).toFixed(6)}`}
        </p>
      )}
      {!!run.route.fallbackRoutes?.length && (
        <p>
          {zh
            ? "本次审批包含备用路线"
            : "This approval includes fallback routes"}
          :{" "}
          {run.route.fallbackRoutes
            .map(
              (route) =>
                `${route.profileId} / ${route.model} / ${route.provider}`,
            )
            .join(" → ")}
        </p>
      )}
      {money && (
        <p>
          {zh
            ? "金额预留 / 当前记账（USD）"
            : "Reserved / currently accounted (USD)"}
          : {(money.reservedMicros / 1000000).toFixed(6)} /{" "}
          {(money.chargedMicros / 1000000).toFixed(6)} ·{" "}
          {money.state === "RECONCILED"
            ? zh
              ? "实际 token 对账"
              : "Reconciled token usage"
            : money.state === "NOT_SENT"
              ? zh
                ? "未发送，已释放"
                : "Not sent, released"
              : zh
                ? "保守预留，尚未确认用量"
                : "Conservative reservation; usage unconfirmed"}
        </p>
      )}
    </>
  );
}
