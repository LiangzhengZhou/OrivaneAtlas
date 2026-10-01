export type TrustedAiProvider = "OLLAMA" | "LM_STUDIO" | "VLLM";
export interface TrustedAiEndpoint {
  id: string;
  workspaceId: string;
  title: string;
  provider: TrustedAiProvider;
  origin: string;
  enabled: boolean;
}
export function validateTrustedAiEndpoint(
  endpoint: TrustedAiEndpoint,
): TrustedAiEndpoint {
  const url = new URL(endpoint.origin);
  if (
    !endpoint.id ||
    !endpoint.workspaceId ||
    !endpoint.title ||
    typeof endpoint.enabled !== "boolean" ||
    !["OLLAMA", "LM_STUDIO", "VLLM"].includes(endpoint.provider) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("INVALID_ENDPOINT");
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("INVALID_ENDPOINT");
  if (
    endpoint.provider === "OLLAMA" &&
    !["/api", "/v1"].includes(url.pathname.replace(/\/$/, ""))
  )
    throw new Error("INVALID_ENDPOINT");
  const path = url.pathname.replace(/\/$/, "");
  if (endpoint.provider === "LM_STUDIO" && path !== "/v1")
    throw new Error("INVALID_ENDPOINT");
  if (endpoint.provider === "VLLM" && path !== "/v1")
    throw new Error("INVALID_ENDPOINT");
  return { ...endpoint, origin: url.origin + url.pathname.replace(/\/$/, "") };
}
export function matchesTrustedAiEndpoint(
  entries: readonly TrustedAiEndpoint[],
  workspaceId: string,
  endpoint: string,
): boolean {
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash) return false;
  const base =
    url.origin +
    url.pathname
      .replace(/\/(chat\/completions|responses|models|embeddings)\/?$/, "")
      .replace(/\/$/, "");
  return entries.some(
    (entry) =>
      entry.workspaceId === workspaceId &&
      entry.enabled &&
      validateTrustedAiEndpoint(entry).origin === base,
  );
}
