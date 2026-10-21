const sessionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseConversationRoute(hash: string) {
  if (hash.split("?")[0] !== "#ai") return null;
  const query = new URLSearchParams(hash.split("?")[1]);
  const id = query.get("session");
  return id && query.getAll("session").length === 1 && sessionIdPattern.test(id)
    ? id
    : null;
}
export function conversationHash(id: string) {
  return sessionIdPattern.test(id)
    ? `#ai?session=${encodeURIComponent(id)}`
    : "#ai";
}
