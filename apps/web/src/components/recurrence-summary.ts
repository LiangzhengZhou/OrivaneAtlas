import type { CalendarRule } from "@arclattice/domain";
import { formatCalendarDate } from "@arclattice/domain";
import { timezoneLabel } from "./ui/TimezonePicker";

export function recurrenceSummary(
  rule: {
    frequency: "DAILY" | "WEEKLY" | "MONTHLY";
    interval: number;
    timezone: string;
    endDate?: string | null;
    weekdays?: number[];
    monthlyRule?: NonNullable<CalendarRule["monthlyRule"]>;
    endAfterCompleted?: number | null;
  },
  language: string,
) {
  const zh = language.startsWith("zh");
  const units = zh
    ? { DAILY: "天", WEEKLY: "周", MONTHLY: "月" }
    : { DAILY: "day", WEEKLY: "week", MONTHLY: "month" };
  const unit = units[rule.frequency];
  const schedule = zh
    ? `每${rule.interval === 1 ? "" : rule.interval}${unit}`
    : `Every ${rule.interval === 1 ? unit : `${rule.interval} ${unit}s`}`;
  const weekdays = zh
    ? ["一", "二", "三", "四", "五", "六", "日"]
    : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const detail = rule.weekdays
    ? rule.weekdays
        .map((day) => (zh ? `周${weekdays[day - 1]}` : weekdays[day - 1]))
        .join(zh ? "、" : ", ")
    : rule.monthlyRule?.kind === "DAY"
      ? zh
        ? `${rule.monthlyRule.day} 日`
        : `Day ${rule.monthlyRule.day}`
      : rule.monthlyRule?.kind === "ORDINAL_WEEKDAY"
        ? `${rule.monthlyRule.ordinal === -1 ? (zh ? "最后一个" : "Last") : zh ? `第 ${rule.monthlyRule.ordinal} 个` : ["First", "Second", "Third", "Fourth", "Fifth"][rule.monthlyRule.ordinal - 1]} ${zh ? "星期" : ""}${weekdays[rule.monthlyRule.weekday - 1]}`
        : "";
  const end =
    rule.endAfterCompleted != null
      ? zh
        ? `完成 ${rule.endAfterCompleted} 次后结束`
        : `Ends after ${rule.endAfterCompleted} completions`
      : rule.endDate
        ? `${zh ? "到" : "Until"} ${formatCalendarDate(rule.endDate, language, { month: "short", day: "numeric" })}`
        : zh
          ? "持续重复"
          : "No end date";
  return `${schedule}${detail ? ` · ${detail}` : ""} · ${timezoneLabel(rule.timezone, language)} · ${end}`;
}
