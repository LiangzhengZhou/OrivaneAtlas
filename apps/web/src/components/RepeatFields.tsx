import { Select } from "./ui/Surfaces";
import "../styles/recurrence.css";
import type { RecurrencePayload } from "@arclattice/application";
import { useTranslation } from "react-i18next";
import { DateField } from "./DateField";
export type RepeatRule = Omit<
  RecurrencePayload,
  | "kind"
  | "title"
  | "descriptionMd"
  | "projectIds"
  | "priority"
  | "activationState"
  | "activationPolicy"
>;
export function RepeatFields({
  rule,
  onChange,
}: {
  rule: RepeatRule | null;
  onChange(rule: RepeatRule | null): void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const text = (cn: string, en: string) => (zh ? cn : en);
  const update = (patch: Partial<RepeatRule>) => {
    if (rule) onChange({ ...rule, ...patch });
  };
  return (
    <div className="repeat-fields">
      <label>
        {text("重复", "Repeat")}
        <Select
          aria-label={text("重复", "Repeat")}
          value={rule?.frequency ?? "NONE"}
          onChange={(e) => {
            if (e.target.value === "NONE") onChange(null);
            else
              onChange({
                ...rule,
                startDate:
                  rule?.startDate ?? new Date().toISOString().slice(0, 10),
                timezone:
                  rule?.timezone ??
                  Intl.DateTimeFormat().resolvedOptions().timeZone,
                frequency: e.target.value as "DAILY" | "WEEKLY" | "MONTHLY",
                interval: rule?.interval ?? 1,
                closePolicy: rule?.closePolicy ?? "END_OF_DAY",
                closeIncomplete: rule?.closeIncomplete ?? true,
              });
          }}
        >
          <option value="NONE">{text("不重复", "Does not repeat")}</option>
          <option value="DAILY">{text("每天", "Daily")}</option>
          <option value="WEEKLY">{text("每周", "Weekly")}</option>
          <option value="MONTHLY">{text("每月", "Monthly")}</option>
        </Select>
      </label>
      {rule && (
        <>
          <label>
            {text("间隔", "Interval")}
            <input
              type="number"
              required
              min={1}
              max={365}
              value={rule.interval}
              onChange={(e) => update({ interval: Number(e.target.value) })}
            />
            <span>
              {text(
                rule.frequency === "DAILY"
                  ? "天"
                  : rule.frequency === "WEEKLY"
                    ? "周"
                    : "月",
                rule.frequency === "DAILY"
                  ? "days"
                  : rule.frequency === "WEEKLY"
                    ? "weeks"
                    : "months",
              )}
            </span>
          </label>
          <label>
            {text("首次日期", "First date")}
            <DateField
              required
              aria-label={text("首次日期", "First date")}
              value={rule.startDate}
              max={rule.endDate || "9999-12-31"}
              onChange={(startDate) => update({ startDate })}
            />
          </label>
          <label>
            {text("结束日期", "End date")}
            <DateField
              aria-label={text("结束日期", "End date")}
              value={rule.endDate ?? ""}
              min={rule.startDate}
              onChange={(endDate) => update({ endDate: endDate || null })}
            />
          </label>
          <label>
            {text("时区", "Timezone")}
            <input
              required
              value={rule.timezone}
              onChange={(e) => update({ timezone: e.target.value })}
            />
          </label>
          <label>
            {text("到期行为", "Expiration")}
            <Select
              value={rule.closePolicy}
              onChange={(e) =>
                update({
                  durationValue: rule.durationValue ?? 24,
                  durationUnit: rule.durationUnit ?? "HOUR",
                  closePolicy: e.target.value as NonNullable<
                    RepeatRule["closePolicy"]
                  >,
                })
              }
            >
              <option value="END_OF_DAY">
                {text("当天结束后关闭", "Close at the end of the day")}
              </option>
              <option value="NEXT_OCCURRENCE">
                {text(
                  "下一次任务出现时关闭",
                  "Close when the next task occurs",
                )}
              </option>
              <option value="DURATION">
                {text("创建后指定时间关闭", "Close after a duration")}
              </option>
            </Select>
          </label>
          {rule.closePolicy === "DURATION" && (
            <div>
              <label>
                {text("持续时间", "Duration")}
                <input
                  required
                  type="number"
                  min={1}
                  max={8760}
                  value={rule.durationValue ?? 24}
                  onChange={(e) =>
                    update({ durationValue: Number(e.target.value) })
                  }
                />
              </label>
              <Select
                aria-label={text("时间单位", "Duration unit")}
                value={rule.durationUnit ?? "HOUR"}
                onChange={(e) =>
                  update({ durationUnit: e.target.value as "HOUR" | "DAY" })
                }
              >
                <option value="HOUR">{text("小时", "Hours")}</option>
                <option value="DAY">{text("天", "Days")}</option>
              </Select>
            </div>
          )}
          <label>
            <input
              type="checkbox"
              checked={rule.closeIncomplete}
              onChange={(e) => update({ closeIncomplete: e.target.checked })}
            />
            {text("到期关闭未完成任务", "Close incomplete tasks when expired")}
          </label>
        </>
      )}
    </div>
  );
}
