import { expect, it } from "vitest";
import { timezoneLabel } from "./TimezonePicker";

it("presents natural time names while rejecting invalid canonical zones", () => {
  expect(timezoneLabel("Asia/Shanghai", "zh-CN")).toContain("时间");
  expect(timezoneLabel("Asia/Shanghai", "zh-CN")).not.toContain("Asia/");
  expect(timezoneLabel("America/New_York", "en-US")).toContain("Time");
  expect(() => timezoneLabel("not-a-timezone", "en-US")).toThrow();
});
