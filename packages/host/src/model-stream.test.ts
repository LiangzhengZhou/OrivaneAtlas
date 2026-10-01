import { expect, it } from "vitest";
import { decodeModelStream } from "./model-stream";

async function* chunks(text: string) {
  const bytes = new TextEncoder().encode(text);
  for (const byte of bytes) yield new Uint8Array([byte]);
}
it("decodes real byte-fragmented SSE deltas, Unicode and usage", async () => {
  const events = [];
  for await (const event of decodeModelStream(
    chunks(
      'data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: {"usage":{"prompt_tokens":8,"completion_tokens":2},"choices":[]}\n\ndata: [DONE]\n\n',
    ),
  ))
    events.push(event);
  expect(events).toEqual([
    { type: "text-delta", text: "你好" },
    {
      type: "usage",
      usage: { inputTokens: 8, outputTokens: 2, source: "PROVIDER_REPORTED" },
    },
    { type: "completed" },
  ]);
});
it("rejects truncated streams and unsolicited tool execution", async () => {
  const drain = async (text: string) => {
    for await (const _event of decodeModelStream(chunks(text))) {
    }
  };
  await expect(
    drain('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
  ).rejects.toThrow("TRUNCATED");
  await expect(
    drain('data: {"choices":[{"delta":{"tool_calls":[{}]}}]}\n\n'),
  ).rejects.toThrow("TOOLS_NOT_ALLOWED");
});
