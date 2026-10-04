import { describe, expect, it } from "vitest";
import {
  createProviderAdapter,
  type ProviderHttpRequest,
} from "./provider-protocol";

const signal = new AbortController().signal;
const tool = {
  name: "get_project",
  description: "Read a project",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
    additionalProperties: false,
  },
};
describe("provider-specific native contracts", () => {
  it("uses Anthropic headers and tool_use/tool_result blocks and keeps signed reasoning", async () => {
    const requests: ProviderHttpRequest[] = [];
    const blocks = [
      { type: "thinking", thinking: "internal", signature: "signed" },
      { type: "tool_use", id: "call-1", name: tool.name, input: { id: "p" } },
    ];
    const adapter = createProviderAdapter(
      "ANTHROPIC",
      "claude",
      "test-only",
      async (request) => {
        requests.push(request);
        return {
          content: blocks,
          usage: { input_tokens: 10, output_tokens: 2 },
        };
      },
      { maxOutputTokens: 4096 },
    );
    const response = await adapter.respond!(
      [{ role: "user", text: "Read project" }],
      [tool],
      signal,
    );
    expect(response.toolCalls).toEqual([
      { id: "call-1", name: tool.name, input: { id: "p" } },
    ]);
    expect(response.usage?.inputTokens).toBe(10);
    expect(requests[0]).toMatchObject({
      path: "messages",
      method: "POST",
      headers: { "x-api-key": "test-only", "anthropic-version": "2023-06-01" },
      body: { tools: [{ input_schema: tool.inputSchema }] },
    });
    expect(requests[0]!.headers).not.toHaveProperty("Authorization");
    await adapter.respond!(
      [
        {
          role: "assistant",
          text: "",
          toolCalls: response.toolCalls,
          providerData: response.providerData,
        },
        {
          role: "tool",
          text: '{"title":"Project"}',
          toolCallId: "call-1",
          toolName: tool.name,
        },
      ],
      [tool],
      signal,
    );
    expect(requests[1]!.body).toMatchObject({
      messages: [
        { role: "assistant", content: blocks },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "call-1" }],
        },
      ],
    });
  });
  it("uses Gemini function declarations and preserves thoughtSignature across turns", async () => {
    const requests: ProviderHttpRequest[] = [];
    const parts = [
      {
        functionCall: { id: "g-1", name: tool.name, args: { id: "p" } },
        thoughtSignature: "signature",
      },
    ];
    const adapter = createProviderAdapter(
      "GEMINI",
      "gemini/model",
      "test-only",
      async (request) => {
        requests.push(request);
        return {
          candidates: [{ content: { parts } }],
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 },
        };
      },
      { maxOutputTokens: 4096 },
    );
    const response = await adapter.respond!(
      [{ role: "user", text: "Read project" }],
      [tool],
      signal,
    );
    expect(requests[0]).toMatchObject({
      path: "models/gemini%2Fmodel:generateContent",
      headers: { "x-goog-api-key": "test-only" },
      body: {
        tools: [{ functionDeclarations: [{ parameters: tool.inputSchema }] }],
      },
    });
    expect(response.toolCalls).toEqual([
      { id: "g-1", name: tool.name, input: { id: "p" } },
    ]);
    await adapter.respond!(
      [
        { role: "assistant", text: "", providerData: response.providerData },
        {
          role: "tool",
          text: "Project",
          toolCallId: "g-1",
          toolName: tool.name,
        },
      ],
      [tool],
      signal,
    );
    expect(requests[1]!.body).toMatchObject({
      contents: [
        { role: "model", parts },
        {
          role: "user",
          parts: [{ functionResponse: { name: tool.name, id: "g-1" } }],
        },
      ],
    });
  });
  it.each([
    "OPENAI",
    "DEEPSEEK",
    "OPENROUTER",
    "LM_STUDIO",
    "VLLM",
    "CUSTOM_OPENAI",
  ] as const)(
    "uses documented chat completion envelopes for %s",
    async (kind) => {
      const requests: ProviderHttpRequest[] = [];
      const adapter = createProviderAdapter(
        kind,
        "model",
        "test-only",
        async (request) => {
          requests.push(request);
          return {
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "c-1",
                      function: { name: tool.name, arguments: '{"id":"p"}' },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 2 },
          };
        },
        { maxOutputTokens: 4096, capabilities: { tools: true } },
      );
      const response = await adapter.respond!(
        [{ role: "user", text: "Read" }],
        [tool],
        signal,
      );
      expect(requests[0]).toMatchObject({
        path: "chat/completions",
        headers: { Authorization: "Bearer test-only" },
        body: { model: "model", stream: false },
      });
      expect(requests[0]!.body).toHaveProperty(
        kind === "OPENAI" ? "max_completion_tokens" : "max_tokens",
        4096,
      );
      expect(response.toolCalls[0]?.input).toEqual({ id: "p" });
    },
  );
  it("uses Ollama native API and object arguments without requiring a fabricated bearer key", async () => {
    const requests: ProviderHttpRequest[] = [];
    const adapter = createProviderAdapter(
      "OLLAMA",
      "local",
      "",
      async (request) => {
        requests.push(request);
        return request.method === "GET"
          ? { models: [{ name: "local" }] }
          : {
              message: {
                content: "",
                tool_calls: [
                  { function: { name: tool.name, arguments: { id: "p" } } },
                ],
              },
              prompt_eval_count: 5,
              eval_count: 1,
            };
      },
      { maxOutputTokens: 512, capabilities: { tools: true } },
    );
    expect(
      (await adapter.respond!([{ role: "user", text: "Read" }], [tool], signal))
        .toolCalls[0]?.input,
    ).toEqual({ id: "p" });
    expect(requests[0]).toMatchObject({
      path: "api/chat",
      headers: {},
      body: { options: { num_predict: 512 }, stream: false },
    });
    expect(await adapter.listModels(signal)).toEqual(["local"]);
    expect(requests[1]).toMatchObject({ path: "api/tags", method: "GET" });
  });
  it("rejects malformed tool arguments and unsupported local tools", async () => {
    const adapter = createProviderAdapter(
      "CUSTOM_OPENAI",
      "local",
      "test-only",
      async () => ({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "1",
                  function: { name: "get_project", arguments: "invalid JSON" },
                },
              ],
            },
          },
        ],
      }),
      { maxOutputTokens: 512 },
    );
    await expect(
      adapter.respond!([{ role: "user", text: "Read" }], [tool], signal),
    ).rejects.toThrow("MODEL_TOOLS_NOT_SUPPORTED");
    await expect(
      adapter.respond!([{ role: "user", text: "Read" }], [], signal),
    ).rejects.toThrow();
  });
  it("follows Gemini/Anthropic pagination and never returns embedding-only Gemini models", async () => {
    const seen: string[] = [];
    const adapter = createProviderAdapter(
      "GEMINI",
      "gemini",
      "test-only",
      async (request) => {
        seen.push(request.path);
        return seen.length === 1
          ? {
              models: [
                {
                  name: "models/embedding",
                  supportedGenerationMethods: ["embedContent"],
                },
                {
                  name: "models/chat",
                  supportedGenerationMethods: ["generateContent"],
                },
              ],
              nextPageToken: "next / token",
            }
          : {
              models: [
                {
                  name: "models/chat2",
                  supportedGenerationMethods: ["generateContent"],
                },
              ],
            };
      },
      { maxOutputTokens: 512 },
    );
    expect(await adapter.listModels(signal)).toEqual(["chat", "chat2"]);
    expect(seen).toEqual(["models", "models?pageToken=next%20%2F%20token"]);
  });
});
