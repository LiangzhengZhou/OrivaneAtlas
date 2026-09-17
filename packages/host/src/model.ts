import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { ModelPort, ModelRoute } from "@arclattice/application";
import { providerUsage } from "./model-usage";

async function privateFile(path: string) {
  if (!isAbsolute(path)) throw new Error("MODEL_CONFIG_INVALID");
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.size > 16_384 ||
    (process.platform !== "win32" && (info.mode & 0o077) !== 0)
  )
    throw new Error("MODEL_CONFIG_PERMISSIONS");
  return readFile(path, "utf8");
}
/** Admin-owned configuration only. No caller-controlled destinations, redirects or retries. */
export async function loadModel(
  path: string | undefined,
): Promise<ModelPort | null> {
  if (!path) return null;
  const config = JSON.parse(await privateFile(path));
  const endpoint = new URL(config.endpoint);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !endpoint.pathname.endsWith("/chat/completions")
  )
    throw new Error("MODEL_CONFIG_INVALID");
  if (
    typeof config.model !== "string" ||
    !/^[a-zA-Z0-9._:/-]{1,160}$/.test(config.model)
  )
    throw new Error("MODEL_CONFIG_INVALID");
  const bounds: Record<string, [number, number]> = {
    maxInputChars: [1, 32_000],
    maxOutputTokens: [1, 8192],
    timeoutMs: [1000, 120_000],
    maxRunsPerDay: [1, 100],
  };
  for (const [key, [min, max]] of Object.entries(bounds))
    if (
      !Number.isSafeInteger(config[key]) ||
      config[key] < min ||
      config[key] > max
    )
      throw new Error("MODEL_CONFIG_INVALID");
  const key = (await privateFile(config.keyFile)).trim();
  if (!key || key.length > 4096 || /[\r\n]/.test(key))
    throw new Error("MODEL_KEY_INVALID");
  const safe = {
    provider: endpoint.origin,
    model: config.model,
    maxInputChars: config.maxInputChars,
    maxOutputTokens: config.maxOutputTokens,
    timeoutMs: config.timeoutMs,
    maxRunsPerDay: config.maxRunsPerDay,
  };
  const route: ModelRoute = {
    ...safe,
    fingerprint: createHash("sha256")
      .update(JSON.stringify(safe) + endpoint.href + key)
      .digest("hex"),
  };
  return {
    route,
    async complete(prompt, signal, reportUsage) {
      const response = await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          Authorization: "Bearer " + key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: route.model,
          messages: [{ role: "user", content: prompt }],
          max_completion_tokens: route.maxOutputTokens,
          store: false,
          stream: false,
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("MODEL_REQUEST_FAILED");
      }
      if (!response.body) throw new Error("MODEL_RESPONSE_INVALID");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 1_000_000) throw new Error("MODEL_RESPONSE_TOO_LARGE");
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel();
      }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const usage = providerUsage(data.usage);
      if (usage) reportUsage?.(usage);
      const text = data.choices?.[0]?.message?.content;
      if (
        typeof text !== "string" ||
        !text ||
        text.length > 100_000 ||
        data.choices[0].message.tool_calls?.length
      )
        throw new Error("MODEL_RESPONSE_INVALID");
      return text;
    },
  };
}
