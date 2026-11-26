import { DomainError } from "@arclattice/domain";
import { expect, it } from "vitest";
import {
  recordWorkspaceSyncStage,
  workspaceSyncDiagnostic,
  workspaceSyncIssue,
} from "./workspace-sync-issue";

it.each([
  ["SYNC_REQUEST_401", "syncAuth"],
  ["FORBIDDEN", "syncForbidden"],
  ["VERSION_CONFLICT", "syncConflict"],
  ["LOGIN_TIMEOUT", "syncNetwork"],
  ["private item name", "syncFailed"],
])("classifies %s without exposing transport details", (message, expected) => {
  expect(workspaceSyncIssue(new Error(message))).toBe(expected);
});

it("reports the failing stage and a received HTTP status without leaking private values", () => {
  const conflict = new DomainError("VERSION_CONFLICT", {
    httpStatus: 409,
    field: "private note name",
  });
  recordWorkspaceSyncStage(conflict, "send");
  expect(workspaceSyncDiagnostic(conflict)).toEqual({
    stage: "send",
    code: "VERSION_CONFLICT",
    httpStatus: 409,
  });
  const local = new Error("private file name");
  recordWorkspaceSyncStage(local, "apply");
  expect(workspaceSyncDiagnostic(local)).toEqual({
    stage: "apply",
    code: "UNKNOWN",
    httpStatus: null,
  });
  expect(workspaceSyncDiagnostic(new Error("FILE_CHUNK_503"))).toEqual({
    stage: "unknown",
    code: "FILE_CHUNK",
    httpStatus: 503,
  });
});
