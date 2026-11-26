import { expect, it } from "vitest";
import { workspaceSyncIssue } from "./workspace-sync-issue";

it.each([
  ["SYNC_REQUEST_401", "syncAuth"],
  ["FORBIDDEN", "syncForbidden"],
  ["VERSION_CONFLICT", "syncConflict"],
  ["LOGIN_TIMEOUT", "syncNetwork"],
  ["private item name", "syncFailed"],
])("classifies %s without exposing transport details", (message, expected) => {
  expect(workspaceSyncIssue(new Error(message))).toBe(expected);
});
