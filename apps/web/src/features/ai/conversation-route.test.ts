import { expect, it } from "vitest";
import { conversationHash, parseConversationRoute } from "./conversation-route";

it("restores the exact canonical v7 conversation and ignores unrelated routes", () => {
  const id = "01997722-3344-7555-8666-778899aabbcc";
  expect(parseConversationRoute(conversationHash(id))).toBe(id);
  expect(parseConversationRoute(`#library?session=${id}`)).toBeNull();
  expect(parseConversationRoute(`#ai?session=${id}&session=${id}`)).toBeNull();
  expect(
    parseConversationRoute("#ai?session=javascript%3Aalert(1)"),
  ).toBeNull();
  expect(conversationHash("invalid")).toBe("#ai");
});
