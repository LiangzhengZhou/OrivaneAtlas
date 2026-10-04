import type {
  ModelMessage,
  ModelProviderAdapter,
  ModelProviderCapabilities,
  ModelResponse,
  ModelToolCall,
  ModelToolDefinition,
  ProviderKind,
} from "@arclattice/application";

export interface ProviderHttpRequest {
  path: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: unknown;
}
export type ProviderHttp = (
  request: ProviderHttpRequest,
  signal: AbortSignal,
) => Promise<unknown>;
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("MODEL_RESPONSE_INVALID");
  return value as Record<string, unknown>;
};
const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error("MODEL_RESPONSE_INVALID");
  return value;
};
const string = (value: unknown) => {
  if (typeof value !== "string") throw new Error("MODEL_RESPONSE_INVALID");
  return value;
};
function calls(value: unknown, ollama = false): ModelToolCall[] {
  if (value === undefined) return [];
  return array(value).map((value, index) => {
    const item = record(value),
      fn = record(item.function);
    return {
      id: ollama ? `ollama-${index}` : string(item.id),
      name: string(fn.name),
      input: ollama ? fn.arguments : JSON.parse(string(fn.arguments)),
    };
  });
}
function usage(input: unknown, output: unknown) {
  if (
    !Number.isSafeInteger(input) ||
    !Number.isSafeInteger(output) ||
    Number(input) < 0 ||
    Number(output) < 0
  )
    return undefined;
  return {
    inputTokens: Number(input),
    outputTokens: Number(output),
    source: "PROVIDER_REPORTED" as const,
  };
}

/** All HTTP is supplied by the pinned-DNS, TrustedAiEndpoint-aware host transport. */
export function createProviderAdapter(
  kind: ProviderKind,
  model: string,
  key: string,
  http: ProviderHttp,
  options: {
    maxOutputTokens: number;
    capabilities?: Partial<ModelProviderCapabilities>;
  },
): ModelProviderAdapter {
  const local = ["OLLAMA", "LM_STUDIO", "VLLM", "CUSTOM_OPENAI"].includes(kind);
  const capabilities: ModelProviderCapabilities = {
    tools: !local,
    jsonSchema: !local,
    vision: false,
    ...options.capabilities,
    // This adapter's bounded turn transport is non-streaming. Legacy OpenAI SSE
    // remains available through its existing adapter; never advertise fake streams.
    streaming: false,
    embedding: false,
  };
  const headers =
    kind === "ANTHROPIC"
      ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
      : kind === "GEMINI"
        ? { "x-goog-api-key": key }
        : key
          ? { Authorization: `Bearer ${key}` }
          : {};
  const request = (path: string, body: unknown, signal: AbortSignal) =>
    http({ path, method: "POST", headers, body }, signal);
  async function respond(
    messages: readonly ModelMessage[],
    tools: readonly ModelToolDefinition[],
    signal: AbortSignal,
  ): Promise<ModelResponse> {
    if (tools.length && !capabilities.tools)
      throw new Error("MODEL_TOOLS_NOT_SUPPORTED");
    if (
      messages.length > 100 ||
      JSON.stringify(messages).length > 128000 ||
      tools.length > 40
    )
      throw new Error("MODEL_INPUT_LIMIT");
    if (kind === "ANTHROPIC") {
      const content = messages.map((message) => {
        if (message.role === "tool")
          return {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: message.toolCallId,
                content: message.text,
              },
            ],
          };
        const blocks =
          message.role === "assistant" && Array.isArray(message.providerData)
            ? message.providerData
            : [
                ...(message.text ? [{ type: "text", text: message.text }] : []),
                ...(message.toolCalls ?? []).map((call) => ({
                  type: "tool_use",
                  id: call.id,
                  name: call.name,
                  input: call.input,
                })),
              ];
        return { role: message.role, content: blocks };
      });
      const data = record(
        await request(
          "messages",
          {
            model,
            max_tokens: options.maxOutputTokens,
            messages: content,
            ...(tools.length
              ? {
                  tools: tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    input_schema: tool.inputSchema,
                  })),
                }
              : {}),
          },
          signal,
        ),
      );
      const blocks = array(data.content),
        reported = data.usage ? record(data.usage) : {};
      return {
        text: blocks
          .flatMap((value) => {
            const block = record(value);
            return block.type === "text" ? [string(block.text)] : [];
          })
          .join(""),
        toolCalls: blocks.flatMap((value) => {
          const block = record(value);
          return block.type === "tool_use"
            ? [
                {
                  id: string(block.id),
                  name: string(block.name),
                  input: block.input,
                },
              ]
            : [];
        }),
        providerData: blocks,
        usage: usage(reported.input_tokens, reported.output_tokens),
      };
    }
    if (kind === "GEMINI") {
      const contents = messages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts:
          message.role === "tool"
            ? [
                {
                  functionResponse: {
                    name: message.toolName,
                    response: { result: message.text },
                    ...(message.toolCallId ? { id: message.toolCallId } : {}),
                  },
                },
              ]
            : message.role === "assistant" &&
                Array.isArray(message.providerData)
              ? message.providerData
              : [
                  ...(message.text ? [{ text: message.text }] : []),
                  ...(message.toolCalls ?? []).map((call) => ({
                    functionCall: {
                      name: call.name,
                      args: call.input,
                      id: call.id,
                    },
                  })),
                ],
      }));
      const data = record(
        await request(
          `models/${encodeURIComponent(model.replace(/^models\//, ""))}:generateContent`,
          {
            contents,
            generationConfig: { maxOutputTokens: options.maxOutputTokens },
            ...(tools.length
              ? {
                  tools: [
                    {
                      functionDeclarations: tools.map((tool) => ({
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.inputSchema,
                      })),
                    },
                  ],
                }
              : {}),
          },
          signal,
        ),
      );
      const candidate = record(array(data.candidates)[0]),
        parts = array(record(candidate.content).parts);
      const reported = data.usageMetadata ? record(data.usageMetadata) : {};
      return {
        text: parts
          .flatMap((value) => {
            const part = record(value);
            return typeof part.text === "string" && !part.thought
              ? [part.text]
              : [];
          })
          .join(""),
        toolCalls: parts.flatMap((value, index) => {
          const part = record(value);
          if (!part.functionCall) return [];
          const call = record(part.functionCall);
          return [
            {
              id: typeof call.id === "string" ? call.id : `gemini-${index}`,
              name: string(call.name),
              input: call.args,
            },
          ];
        }),
        providerData: parts,
        usage: usage(reported.promptTokenCount, reported.candidatesTokenCount),
      };
    }
    const ollama = kind === "OLLAMA";
    const converted = messages.map((message) => ({
      role: message.role,
      content: message.text,
      ...(message.role === "tool"
        ? ollama
          ? { tool_name: message.toolName }
          : { tool_call_id: message.toolCallId }
        : {}),
      ...(message.toolCalls?.length
        ? {
            tool_calls: message.toolCalls.map((call) => ({
              ...(ollama ? {} : { id: call.id, type: "function" }),
              function: {
                name: call.name,
                arguments: ollama ? call.input : JSON.stringify(call.input),
              },
            })),
          }
        : {}),
    }));
    const payload = {
      model,
      messages: converted,
      stream: false,
      ...(ollama
        ? { options: { num_predict: options.maxOutputTokens } }
        : kind === "OPENAI"
          ? { max_completion_tokens: options.maxOutputTokens, store: false }
          : { max_tokens: options.maxOutputTokens }),
      ...(tools.length
        ? {
            tools: tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
              },
            })),
          }
        : {}),
    };
    const data = record(
      await request(ollama ? "api/chat" : "chat/completions", payload, signal),
    );
    const message = ollama
      ? record(data.message)
      : record(record(array(data.choices)[0]).message);
    const reported = data.usage ? record(data.usage) : {};
    return {
      text:
        message.content === null || message.content === undefined
          ? ""
          : string(message.content),
      toolCalls: calls(message.tool_calls, ollama),
      usage: ollama
        ? usage(data.prompt_eval_count, data.eval_count)
        : usage(reported.prompt_tokens, reported.completion_tokens),
    };
  }
  return {
    capabilities,
    respond,
    async complete(prompt, signal, reportUsage) {
      const response = await respond(
        [{ role: "user", text: prompt }],
        [],
        signal,
      );
      if (response.toolCalls.length) throw new Error("MODEL_UNREQUESTED_TOOLS");
      if (response.usage) reportUsage?.(response.usage);
      return response.text;
    },
    async *stream() {
      yield { type: "error", error: "STREAMING_NOT_SUPPORTED" };
    },
    async listModels(signal) {
      const result: string[] = [];
      let cursor = "";
      for (let page = 0; page < 10; page++) {
        const endpoint = kind === "OLLAMA" ? "api/tags" : `models${cursor}`;
        const data = record(
          await http({ path: endpoint, method: "GET", headers }, signal),
        );
        const rows = array(
          kind === "OLLAMA" || kind === "GEMINI" ? data.models : data.data,
        );
        for (const value of rows) {
          const item = record(value);
          if (
            kind === "GEMINI" &&
            Array.isArray(item.supportedGenerationMethods) &&
            !item.supportedGenerationMethods.includes("generateContent")
          )
            continue;
          result.push(
            string(
              kind === "OLLAMA"
                ? item.name
                : kind === "GEMINI"
                  ? item.name
                  : item.id,
            ).replace(/^models\//, ""),
          );
        }
        if (
          kind === "GEMINI" &&
          typeof data.nextPageToken === "string" &&
          data.nextPageToken
        )
          cursor = `?pageToken=${encodeURIComponent(data.nextPageToken)}`;
        else if (
          kind === "ANTHROPIC" &&
          data.has_more === true &&
          typeof data.last_id === "string"
        )
          cursor = `?after_id=${encodeURIComponent(data.last_id)}`;
        else return [...new Set(result)];
      }
      throw new Error("MODEL_LIST_LIMIT");
    },
  };
}
