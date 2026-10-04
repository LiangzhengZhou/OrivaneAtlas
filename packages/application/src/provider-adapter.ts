import type { ModelPort, ModelUsage } from "./connected";

export interface ModelProviderCapabilities {
  tools: boolean;
  jsonSchema: boolean;
  vision: boolean;
  streaming: boolean;
  embedding: boolean;
}
export type ProviderKind =
  | "OPENAI"
  | "ANTHROPIC"
  | "GEMINI"
  | "DEEPSEEK"
  | "OPENROUTER"
  | "OLLAMA"
  | "LM_STUDIO"
  | "VLLM"
  | "CUSTOM_OPENAI";
export interface ModelToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
export interface ModelToolCall {
  id: string;
  name: string;
  input: unknown;
}
export interface ModelMessage {
  role: "user" | "assistant" | "tool";
  text: string;
  toolCalls?: ModelToolCall[];
  toolCallId?: string;
  toolName?: string;
  /** Adapter-owned signed reasoning blocks, never interpreted as executable input. */
  providerData?: unknown;
}
export interface ModelResponse {
  text: string;
  toolCalls: ModelToolCall[];
  providerData?: unknown;
  usage?: ModelUsage | undefined;
}
export type ModelEvent =
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; name: string; input: unknown }
  | { type: "tool-result"; name: string; output: unknown }
  | { type: "usage"; usage: ModelUsage }
  | { type: "completed" }
  | { type: "error"; error: string };
export interface ModelEventPage {
  events: ModelEvent[];
  cursor: number;
  done: boolean;
}
export interface ModelProviderAdapter {
  capabilities: ModelProviderCapabilities;
  respond?(
    messages: readonly ModelMessage[],
    tools: readonly ModelToolDefinition[],
    signal: AbortSignal,
  ): Promise<ModelResponse>;
  complete(
    prompt: string,
    signal: AbortSignal,
    reportUsage?: (usage: ModelUsage) => void,
  ): Promise<string>;
  stream(prompt: string, signal: AbortSignal): AsyncIterable<ModelEvent>;
  embed?(texts: readonly string[], signal: AbortSignal): Promise<number[][]>;
  listModels(signal: AbortSignal): Promise<string[]>;
}
export function adaptModelProvider(port: ModelPort): ModelProviderAdapter {
  if (port.providerAdapter) return port.providerAdapter;
  return {
    capabilities: {
      tools: false,
      jsonSchema: false,
      vision: false,
      streaming: false,
      embedding: false,
    },
    complete: (prompt, signal, reportUsage) =>
      port.complete(prompt, signal, reportUsage),
    async *stream(prompt, signal) {
      void prompt;
      void signal;
      yield { type: "error", error: "STREAMING_NOT_SUPPORTED" };
    },
    listModels: async () => [port.route.model],
  };
}
