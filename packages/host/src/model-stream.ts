import type { ModelEvent } from "@arclattice/application";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
/** Incremental SSE decoding; no completion is fabricated for a truncated response. */
export async function* decodeModelStream(
  chunks: AsyncIterable<Uint8Array>,
): AsyncIterable<ModelEvent> {
  const decoder = new TextDecoder();
  let buffer = "",
    data: string[] = [],
    size = 0,
    completed = false;
  for await (const chunk of chunks) {
    size += chunk.byteLength;
    if (size > 1000000) throw new Error("MODEL_RESPONSE_TOO_LARGE");
    buffer += decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, end).replace(/\r$/, "");
      buffer = buffer.slice(end + 1);
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      if (line || !data.length) continue;
      const payload = data.join("\n");
      data = [];
      if (payload === "[DONE]") {
        if (!completed) yield { type: "completed" };
        completed = true;
        continue;
      }
      const item = record(JSON.parse(payload));
      if (completed) throw new Error("MODEL_STREAM_AFTER_COMPLETION");
      if (
        item.error ||
        item.type === "error" ||
        item.type === "response.failed"
      ) {
        yield { type: "error", error: "MODEL_REQUEST_FAILED" };
        return;
      }
      const choices = Array.isArray(item.choices) ? item.choices : [];
      for (const choice of choices) {
        const delta = record(record(choice).delta);
        if (delta.tool_calls) throw new Error("MODEL_TOOLS_NOT_ALLOWED");
        if (typeof delta.content === "string" && delta.content)
          yield { type: "text-delta", text: delta.content };
      }
      if (
        item.type === "response.output_text.delta" &&
        typeof item.delta === "string"
      )
        yield { type: "text-delta", text: item.delta };
      if (
        item.type === "response.output_item.added" &&
        record(item.item).type === "function_call"
      )
        throw new Error("MODEL_TOOLS_NOT_ALLOWED");
      const usage = record(item.usage ?? record(item.response).usage);
      const inputTokens = usage.input_tokens ?? usage.prompt_tokens,
        outputTokens = usage.output_tokens ?? usage.completion_tokens;
      if (typeof inputTokens === "number" && typeof outputTokens === "number")
        yield {
          type: "usage",
          usage: { inputTokens, outputTokens, source: "PROVIDER_REPORTED" },
        };
      if (item.type === "response.completed") {
        yield { type: "completed" };
        completed = true;
      }
    }
  }
  if (!completed || data.length || buffer.trim())
    throw new Error("MODEL_STREAM_TRUNCATED");
}
