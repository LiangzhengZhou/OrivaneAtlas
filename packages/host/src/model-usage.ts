import type { ModelUsage } from "@arclattice/application";

/** Provider observations are not an invoice; missing/invalid counters stay unknown. */
export function providerUsage(
  value: unknown,
  embedding = false,
): ModelUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const inputTokens = record.input_tokens ?? record.prompt_tokens;
  const outputTokens =
    record.output_tokens ??
    record.completion_tokens ??
    (embedding ? 0 : undefined);
  if (
    typeof inputTokens !== "number" ||
    typeof outputTokens !== "number" ||
    !Number.isSafeInteger(inputTokens) ||
    inputTokens < 0 ||
    !Number.isSafeInteger(outputTokens) ||
    outputTokens < 0
  )
    return undefined;
  return { inputTokens, outputTokens, source: "PROVIDER_REPORTED" };
}
