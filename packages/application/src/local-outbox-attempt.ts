import {
  type LocalMutation,
  type LocalOutboxTransition,
  LocalStorageError,
} from "./local-persistence";

/** Sending is durable before transport; a stale response cannot finish another attempt. */
export function localOutboxTransition(
  current: LocalMutation,
  input: LocalOutboxTransition,
): LocalMutation {
  if (
    !input.workspaceId ||
    !input.mutationId ||
    !input.binding.remoteWorkspaceId ||
    !input.binding.serverOrigin ||
    !Number.isSafeInteger(input.binding.version) ||
    input.binding.version < 1 ||
    !Number.isSafeInteger(input.expectedAttemptCount) ||
    input.expectedAttemptCount < 0 ||
    !Number.isFinite(Date.parse(input.at)) ||
    !(
      (input.expectedState === "PENDING" && input.nextState === "SENDING") ||
      (input.expectedState === "SENDING" &&
        ["PENDING", "CONFLICT", "REJECTED"].includes(input.nextState))
    )
  )
    throw new LocalStorageError("INVALID_WRITE");
  if (
    current.workspaceId !== input.workspaceId ||
    current.id !== input.mutationId ||
    current.state !== input.expectedState ||
    current.attemptCount !== input.expectedAttemptCount ||
    current.lastAttemptAt !== input.expectedLastAttemptAt
  )
    throw new LocalStorageError("VERSION_CONFLICT");
  const attemptCount =
    current.attemptCount + (input.nextState === "SENDING" ? 1 : 0);
  if (!Number.isSafeInteger(attemptCount))
    throw new LocalStorageError("INVALID_WRITE");
  return {
    ...current,
    state: input.nextState,
    attemptCount,
    lastAttemptAt:
      input.nextState === "SENDING" ? input.at : current.lastAttemptAt,
  };
}
