import { expect, test } from "vitest";
import { recurrenceSummary } from "./recurrence-summary";

test("natural summaries retain weekdays, monthly ordinal and completion end without raw timezone IDs", () => {
  const rule = {
    frequency: "WEEKLY" as const,
    interval: 2,
    timezone: "Asia/Shanghai",
    weekdays: [1, 5],
    endAfterCompleted: 3,
  };
  const en = recurrenceSummary(rule, "en-US");
  expect(en).toContain("Every 2 weeks");
  expect(en).toContain("Mon, Fri");
  expect(en).toContain("3 completions");
  expect(en).not.toContain("Asia/Shanghai");
  const { weekdays: _, ...monthly } = rule;
  const zh = recurrenceSummary(
    {
      ...monthly,
      frequency: "MONTHLY",
      monthlyRule: { kind: "ORDINAL_WEEKDAY", ordinal: 2, weekday: 1 },
    },
    "zh-CN",
  );
  expect(zh).toContain("第 2 个 星期一");
  expect(zh).toContain("完成 3 次后结束");
});
