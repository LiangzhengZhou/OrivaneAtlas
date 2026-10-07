import { expect, it } from "vitest";
import { FixtureScope } from "../../../tests/fixture-scope";

it("cleanup waits for delayed setup and refuses late resource creation", async () => {
  const scope = new FixtureScope();
  let finish!: () => void;
  const barrier = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let registered = false;
  const setup = scope.run(async () => {
    await barrier;
    registered = true;
  });
  let drained = false;
  const cleanup = scope.drain().then(() => {
    drained = true;
  });
  await expect(scope.run(async () => undefined)).rejects.toThrow(
    "Fixture scope closed",
  );
  expect(drained).toBe(false);
  finish();
  await setup;
  await cleanup;
  expect(registered).toBe(true);
  expect(drained).toBe(true);
  scope.start();
  await expect(scope.run(async () => "new test")).resolves.toBe("new test");
});
