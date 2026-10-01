import { expect, it } from "vitest";
import { requiresExecutionApproval } from "./ai-context";

it("keeps destructive actions under review and separates read approval", () => {
  expect(requiresExecutionApproval("READ", "REVIEW_EVERYTHING")).toBe(true);
  expect(requiresExecutionApproval("READ", "REVIEW_WRITES")).toBe(false);
  expect(requiresExecutionApproval("WRITE", "REVIEW_WRITES")).toBe(true);
  expect(requiresExecutionApproval("WRITE", "AUTO_SAFE")).toBe(false);
  expect(requiresExecutionApproval("DESTRUCTIVE", "AUTO_SAFE")).toBe(true);
});
