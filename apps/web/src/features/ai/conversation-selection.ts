export function conversationSelectionKey(
  server: string,
  workspaceId: string,
  principalId: string,
  surface: string,
): string {
  return `orivane.atlas.conversation-selection.v1:${JSON.stringify([server, workspaceId, principalId, surface])}`;
}

export function accessibleConversationSelection(
  selected: string | null,
  summaries: readonly { id: string }[],
): string | null {
  return selected &&
    selected.length <= 240 &&
    summaries.some((entry) => entry.id === selected)
    ? selected
    : null;
}
export function latestConversationRunId(
  messages: readonly { runId: string | null }[],
): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const id = messages[index]?.runId;
    if (id) return id;
  }
  return null;
}
