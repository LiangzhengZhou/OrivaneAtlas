import { Select } from "./ui/Surfaces";
import "../styles/recurrence.css";
import type { RecurrencePayload } from "@arclattice/application";
import { useTranslation } from "react-i18next";
import { DateField } from "./DateField";
import { recurrenceSummary } from "./recurrence-summary";
import { DisclosureSection } from "./ui/InteractionSurfaces";
import { TimezonePicker } from "./ui/TimezonePicker";
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
export function NaturalRecurrenceEditor({
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
            else {
              const { weekdays, monthlyRule, ...previous } = rule ?? {};
              onChange({
                ...previous,
                startDate:
                  rule?.startDate ?? new Date().toISOString().slice(0, 10),
                timezone:
                  rule?.timezone ??
                  Intl.DateTimeFormat().resolvedOptions().timeZone,
                frequency: e.target.value as "DAILY" | "WEEKLY" | "MONTHLY",
                interval: rule?.interval ?? 1,
                ...(e.target.value === "WEEKLY"
                  ? {
                      weekdays: weekdays ?? [
                        new Date(
                          (rule?.startDate ??
                            new Date().toISOString().slice(0, 10)) +
                            "T00:00:00Z",
                        ).getUTCDay() || 7,
                      ],
                    }
                  : {}),
                ...(e.target.value === "MONTHLY" && monthlyRule
                  ? { monthlyRule }
                  : {}),
                closePolicy: rule?.closePolicy ?? "END_OF_DAY",
                closeIncomplete: rule?.closeIncomplete ?? true,
              });
            }
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
          <p className="muted recurrence-rule-summary">
            {recurrenceSummary(rule, i18n.language)}
          </p>
          <label>
            {text("每", "Every")}
            <input
              type="number"
              aria-label={text("间隔", "Interval")}
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
          {rule.frequency === "WEEKLY" && (
            <fieldset>
              <legend>{text("在这些星期重复", "Repeat on")}</legend>
              {(zh
                ? [
                    "星期一",
                    "星期二",
                    "星期三",
                    "星期四",
                    "星期五",
                    "星期六",
                    "星期日",
                  ]
                : [
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                    "Sunday",
                  ]
              ).map((label, index) => {
                const days = rule.weekdays ?? [
                  new Date(rule.startDate + "T00:00:00Z").getUTCDay() || 7,
                ];
                return (
                  <label key={label}>
                    <input
                      type="checkbox"
                      checked={days.includes(index + 1)}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...days, index + 1].sort((a, b) => a - b)
                          : days.filter((day) => day !== index + 1);
                        if (next.length) update({ weekdays: next });
                      }}
                    />
                    {label}
                  </label>
                );
              })}
            </fieldset>
          )}
          {rule.frequency === "MONTHLY" && (
            <div>
              <label>
                {text("每月安排", "Monthly schedule")}
                <Select
                  aria-label={text("每月安排", "Monthly schedule")}
                  value={rule.monthlyRule?.kind ?? "DAY"}
                  onChange={(event) =>
                    update({
                      monthlyRule:
                        event.target.value === "DAY"
                          ? {
                              kind: "DAY",
                              day: Number(rule.startDate.slice(-2)),
                            }
                          : { kind: "ORDINAL_WEEKDAY", ordinal: 2, weekday: 1 },
                    })
                  }
                >
                  <option value="DAY">
                    {text("每月指定日期", "On a day of the month")}
                  </option>
                  <option value="ORDINAL_WEEKDAY">
                    {text("每月第几个星期几", "On an ordinal weekday")}
                  </option>
                </Select>
              </label>
              {rule.monthlyRule?.kind === "ORDINAL_WEEKDAY" ? (
                <>
                  <Select
                    aria-label={text("第几个", "Ordinal")}
                    value={rule.monthlyRule.ordinal}
                    onChange={(event) =>
                      update({
                        monthlyRule: {
                          kind: "ORDINAL_WEEKDAY",
                          ordinal: Number(event.target.value),
                          weekday:
                            rule.monthlyRule?.kind === "ORDINAL_WEEKDAY"
                              ? rule.monthlyRule.weekday
                              : 1,
                        },
                      })
                    }
                  >
                    {[1, 2, 3, 4, 5, -1].map((value) => (
                      <option key={value} value={value}>
                        {value === -1
                          ? text("最后一个", "Last")
                          : zh
                            ? `第 ${value} 个`
                            : ["First", "Second", "Third", "Fourth", "Fifth"][
                                value - 1
                              ]}
                      </option>
                    ))}
                  </Select>
                  <Select
                    aria-label={text("星期", "Weekday")}
                    value={rule.monthlyRule.weekday}
                    onChange={(event) =>
                      update({
                        monthlyRule: {
                          kind: "ORDINAL_WEEKDAY",
                          weekday: Number(event.target.value),
                          ordinal:
                            rule.monthlyRule?.kind === "ORDINAL_WEEKDAY"
                              ? rule.monthlyRule.ordinal
                              : 2,
                        },
                      })
                    }
                  >
                    {(zh
                      ? [
                          "星期一",
                          "星期二",
                          "星期三",
                          "星期四",
                          "星期五",
                          "星期六",
                          "星期日",
                        ]
                      : [
                          "Monday",
                          "Tuesday",
                          "Wednesday",
                          "Thursday",
                          "Friday",
                          "Saturday",
                          "Sunday",
                        ]
                    ).map((label, index) => (
                      <option key={label} value={index + 1}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </>
              ) : (
                <label>
                  {text("日期", "Day of month")}
                  <input
                    type="number"
                    min={1}
                    max={31}
                    required
                    value={
                      rule.monthlyRule?.day ?? Number(rule.startDate.slice(-2))
                    }
                    onChange={(event) =>
                      update({
                        monthlyRule: {
                          kind: "DAY",
                          day: Number(event.target.value),
                        },
                      })
                    }
                  />
                </label>
              )}
            </div>
          )}
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
            {text("结束", "Ends")}
            <Select
              aria-label={text("结束", "Ends")}
              value={
                rule.endAfterCompleted != null
                  ? "COUNT"
                  : rule.endDate
                    ? "DATE"
                    : "NEVER"
              }
              onChange={(event) =>
                update({
                  endDate:
                    event.target.value === "DATE"
                      ? (rule.endDate ?? rule.startDate)
                      : null,
                  endAfterCompleted:
                    event.target.value === "COUNT"
                      ? (rule.endAfterCompleted ?? 10)
                      : null,
                })
              }
            >
              <option value="NEVER">{text("永不", "Never")}</option>
              <option value="DATE">{text("在日期", "On a date")}</option>
              <option value="COUNT">
                {text("完成次数", "After completions")}
              </option>
            </Select>
          </label>
          {rule.endDate && (
            <label>
              {text("结束日期", "End date")}
              <DateField
                aria-label={text("结束日期", "End date")}
                value={rule.endDate ?? ""}
                min={rule.startDate}
                onChange={(endDate) => update({ endDate: endDate || null })}
              />
            </label>
          )}
          {rule.endAfterCompleted != null && (
            <label>
              {text("完成次数", "Completion count")}
              <input
                type="number"
                required
                min={1}
                max={100000}
                value={rule.endAfterCompleted}
                onChange={(event) =>
                  update({ endAfterCompleted: Number(event.target.value) })
                }
              />
            </label>
          )}
          <DisclosureSection
            title={text("高级重复设置", "Advanced recurrence settings")}
          >
            <TimezonePicker
              value={rule.timezone}
              onChange={(timezone) => update({ timezone })}
            />
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
              {text(
                "到期关闭未完成任务",
                "Close incomplete tasks when expired",
              )}
            </label>
          </DisclosureSection>
        </>
      )}
    </div>
  );
}
