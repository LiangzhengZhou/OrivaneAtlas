const diagnosticCodes = new Set([
  "VALIDATION_ERROR",
  "VERSION_CONFLICT",
  "NOT_FOUND",
  "FORBIDDEN",
  "HASH_MISMATCH",
  "FILE_OPERATION_FAILED",
  "FILE_READ_FAILED",
  "FILE_PROCESSING_UNAVAILABLE",
  "FILE_BLOB_MISSING_OR_CORRUPT",
  "LOCAL_FILE_INDEX_CORRUPT",
  "LOCAL_FILE_PROCESSING_CORRUPT",
  "LOCAL_TRANSACTION_ABORTED",
  ...[
    "UNSUPPORTED",
    "MALFORMED",
    "RESOURCE_LIMIT",
    "ENCRYPTED",
    "UNSAFE_CONTENT",
    "TIMEOUT",
    "CANCELED",
  ].map((code) => "FILE_EXTRACTION_" + code),
]);
/** Technical details contain a known diagnostic code, never an arbitrary transport message. */
export function safeFileFailureCode(message: string): string {
  return diagnosticCodes.has(message) ? message : "FILE_OPERATION_FAILED";
}
