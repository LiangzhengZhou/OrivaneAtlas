import { expect, it } from "vitest";
import { providerUsage } from "./model-usage";

it("records both supported usage formats without inventing missing or invalid usage", () => {
  const expected = {
    inputTokens: 42,
    outputTokens: 13,
    source: "PROVIDER_REPORTED",
  };
  expect(providerUsage({ prompt_tokens: 42, completion_tokens: 13 })).toEqual(
    expected,
  );
  expect(providerUsage({ input_tokens: 42, output_tokens: 13 })).toEqual(
    expected,
  );
  for (const value of [
    null,
    {},
    { input_tokens: 2 },
    { input_tokens: -1, output_tokens: 3 },
    { input_tokens: "2", output_tokens: 3 },
    { input_tokens: 1, output_tokens: Infinity },
  ]) {
    expect(providerUsage(value)).toBeUndefined();
  }
});
