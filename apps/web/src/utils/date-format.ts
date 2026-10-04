export function formatDateField(value: string, locale: string): string {
  const zh = locale.startsWith("zh");
  if (!value) return zh ? "年 / 月 / 日" : "MM / DD / YYYY";
  return new Intl.DateTimeFormat(zh ? "zh-CN" : "en-US", {
    year: "numeric",
    month: zh ? "long" : "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value + "T12:00:00Z"));
}
export function calendarMonth(year: number, month: number) {
  const first = new Date(0);
  first.setUTCFullYear(year, month - 1, 1);
  const last = new Date(0);
  last.setUTCFullYear(year, month, 0);
  return { first, days: last.getUTCDate() };
}
