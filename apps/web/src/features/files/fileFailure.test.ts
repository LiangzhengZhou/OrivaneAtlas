import { expect, it } from "vitest";
import { safeFileFailureCode } from "./fileFailure";

it("File technical details preserve diagnostic codes without revealing transport credentials or paths", () => {
  expect(safeFileFailureCode("FILE_EXTRACTION_MALFORMED")).toBe(
    "FILE_EXTRACTION_MALFORMED",
  );
  expect(safeFileFailureCode("VERSION_CONFLICT")).toBe("VERSION_CONFLICT");
  for (const message of [
    "Authorization: Bearer private-token",
    "https://user:password@example.test/original",
    "C:/private/user/file.txt",
    "unexpected exception body",
  ]) {
    expect(safeFileFailureCode(message)).toBe("FILE_OPERATION_FAILED");
  }
});
