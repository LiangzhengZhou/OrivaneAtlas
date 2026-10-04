import type { AgentRun } from "@arclattice/application";

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
