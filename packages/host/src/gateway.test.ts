import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, test, vi } from "vitest";
import {
  type AgentRun,
  ConnectedService,
  type ModelPort,
  type ModelRoute,
} from "../../application/src/connected";
import {
  type GatewayPolicy,
  gatewayReservation,
  ModelNotSentError,
  settleGatewayMoney,
  validateGatewayPolicy,
} from "../../application/src/gateway-policy";
import { executeApprovedModel } from "../../application/src/model-gateway";
import { snapshotToNewFile } from "../../storage-sqlite/src/database";
import { restoreDatabase } from "../../storage-sqlite/src/index";
import { context, sqliteHarness } from "../../storage-sqlite/src/testing";

const policy: GatewayPolicy = {
  providerId: "provider",
  enabled: true,
  capabilities: ["TEXT"],
  capability: "TEXT",
  dailyRequests: "UNLIMITED",
  dailyBudgetMicros: 10000,
  currency: "USD",
  inputMicrosPerMillion: 1000000,
  outputMicrosPerMillion: 1000000,
  fallbackProfileIds: [],
};
const route: ModelRoute = {
  fingerprint: "primary",
  provider: "provider",
  model: "model",
  maxInputChars: 32000,
  maxOutputTokens: 100,
  timeoutMs: 1000,
  maxRunsPerDay: 1,
  gateway: policy,
};
const auth = { require: async () => {} },
  clock = { now: () => "2026-09-18T12:00:00Z" },
  ids = { next: randomUUID };
const harness = sqliteHarness();
function run(): AgentRun {
  return {
    id: "run",
    workspaceId: context.workspaceId,
    createdBy: context.principalId,
    updatedBy: context.principalId,
    version: 2,
    createdAt: clock.now(),
    updatedAt: clock.now(),
    deletedAt: null,
    route: structuredClone(route),
    prompt: "hello",
    status: "RUNNING",
    approvedAt: clock.now(),
    approvedBy: context.principalId,
    output: null,
    error: null,
  };
}

test("finite budgets retain unknown costs after restart and independent restore; CAS prevents duplicate dispatch", async () => {
  const file = harness.file(),
    db = await harness.open(file);
  await db.provisionWorkspace({ id: context.workspaceId, name: "Gateway" }, [
    { id: context.principalId, kind: "USER", displayName: "Owner" },
  ]);
  const approved = await db.request(
    context,
    null,
    async (_uow, _notes, store) => {
      const service = new ConnectedService(store, auth, clock, ids);
      const proposed = await service.propose(context, "hello", route);
      return service.decide(
        context,
        proposed.id,
        proposed.version,
        true,
        route,
      );
    },
  );
  const reserve = () =>
    db.request(context, null, (_uow, _notes, store) =>
      new ConnectedService(store, auth, clock, ids).reserve(
        context,
        approved.id,
        approved.version,
      ),
    );
  const results = await Promise.allSettled([reserve(), reserve()]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const backup = harness.file(),
    reader = new DatabaseSync(file);
  try {
    await snapshotToNewFile(reader, backup);
  } finally {
    reader.close();
  }
  const restoredFile = harness.file();
  await restoreDatabase(backup, restoredFile);
  const restored = await harness.open(restoredFile);
  await restored.request(context, null, async (_uow, _notes, store) => {
    const service = new ConnectedService(store, auth, clock, ids);
    const interrupted = await service.finish(
      context,
      approved.id,
      null,
      "HOST_RESTARTED",
      true,
    );
    expect(interrupted.attempt?.money).toMatchObject({
      reservedMicros: 4216,
      chargedMicros: 4216,
      state: "UNKNOWN",
    });
    const low = { ...route, gateway: { ...policy, dailyBudgetMicros: 5000 } };
    const next = await service.propose(context, "hello", low);
    const accepted = await service.decide(
      context,
      next.id,
      next.version,
      true,
      low,
    );
    await expect(
      service.reserve(context, accepted.id, accepted.version),
    ).rejects.toThrow("FORBIDDEN");
    expect((await store.getRun(accepted.id)).attempt).toBeUndefined();
  });
});

test("budget limits are explicit, aggregate across profiles and isolate scope and owner", () => {
  const current = run(),
    previous = run();
  const money = gatewayReservation(previous, [], clock.now())!;
  previous.attempt = {
    id: "attempt",
    reservedAt: clock.now(),
    settledAt: null,
    outcome: "UNKNOWN",
    inputChars: 5,
    reservedOutputTokens: 100,
    money,
  };
  current.route.gateway!.dailyBudgetMicros = 5000;
  expect(() => gatewayReservation(current, [previous], clock.now())).toThrow(
    "FORBIDDEN",
  );
  expect(
    gatewayReservation(
      current,
      [{ ...previous, createdBy: "other" }],
      clock.now(),
    ),
  ).toBeDefined();
  expect(
    gatewayReservation(
      current,
      [{ ...previous, route: { ...previous.route, scope: "WORK:other" } }],
      clock.now(),
    ),
  ).toBeDefined();
  current.route.gateway!.dailyBudgetMicros = "UNLIMITED";
  expect(gatewayReservation(current, [previous], clock.now())).toBeDefined();
  current.route.gateway!.dailyRequests = 1;
  expect(() => gatewayReservation(current, [previous], clock.now())).toThrow(
    "FORBIDDEN",
  );
  expect(() =>
    validateGatewayPolicy({ ...policy, dailyBudgetMicros: null }),
  ).toThrow();
  expect(() =>
    validateGatewayPolicy({ ...policy, inputMicrosPerMillion: -1 }),
  ).toThrow();
  expect(settleGatewayMoney(previous)?.chargedMicros).toBe(4216);
  expect(
    settleGatewayMoney(previous, {
      inputTokens: 100,
      outputTokens: 20,
      source: "PROVIDER_REPORTED",
    })?.chargedMicros,
  ).toBe(120);
  expect(
    settleGatewayMoney(previous, undefined, { notSent: true })?.chargedMicros,
  ).toBe(0);
});

test("fallback reauthorizes exact approved routes and never retries unknown sent failures", async () => {
  const current = run();
  const alternative: ModelRoute = {
    ...route,
    fingerprint: "backup",
    profileId: "backup",
  };
  current.route.fallbackRoutes = [alternative];
  const complete = vi.fn(async () => "backup result");
  const model: ModelPort = {
    route: current.route,
    complete: vi.fn(async () => {
      throw new ModelNotSentError();
    }),
    fallbacks: [{ route: alternative, complete }],
  };
  const authorize = vi.fn(async (_candidate: ModelRoute) => {});
  const result = await executeApprovedModel(
    context,
    current,
    authorize,
    () => model,
    new AbortController().signal,
  );
  expect(result.output).toBe("backup result");
  expect(
    authorize.mock.calls.map(([candidate]) => candidate.fingerprint),
  ).toEqual(["primary", "backup"]);
  expect(result.settlement).toEqual({
    notSent: false,
    routeFingerprint: "backup",
  });
  complete.mockClear();
  model.complete = async () => {
    throw new Error("unknown response after send");
  };
  expect(
    (
      await executeApprovedModel(
        context,
        current,
        authorize,
        () => model,
        new AbortController().signal,
      )
    ).settlement?.notSent,
  ).toBe(false);
  expect(complete).not.toHaveBeenCalled();
  model.complete = async () => {
    throw new ModelNotSentError();
  };
  const denied = await executeApprovedModel(
    context,
    current,
    async (candidate) => {
      if (candidate.fingerprint === "backup") throw new Error("revoked");
    },
    () => model,
    new AbortController().signal,
  );
  expect(denied.error).toBe("MODEL_REQUEST_FAILED");
  expect(complete).not.toHaveBeenCalled();
  model.fallbacks![0]!.route = { ...alternative, fingerprint: "changed" };
  expect(
    (
      await executeApprovedModel(
        context,
        current,
        authorize,
        () => model,
        new AbortController().signal,
      )
    ).error,
  ).toBe("MODEL_REQUEST_FAILED");
  expect(complete).not.toHaveBeenCalled();
});

test("settled amounts persist once and provider overruns prevent further admission", async () => {
  const db = await harness.create();
  const settled = await db.request(
    context,
    null,
    async (_uow, _notes, store) => {
      const service = new ConnectedService(store, auth, clock, ids);
      const proposed = await service.propose(context, "hello", route);
      const approved = await service.decide(
        context,
        proposed.id,
        proposed.version,
        true,
        route,
      );
      const reserved = await service.reserve(
        context,
        approved.id,
        approved.version,
      );
      const result = await service.finish(
        context,
        reserved.id,
        "answer",
        null,
        false,
        { inputTokens: 20000, outputTokens: 10, source: "PROVIDER_REPORTED" },
        { notSent: false, routeFingerprint: route.fingerprint },
      );
      expect(result.attempt?.money).toMatchObject({
        reservedMicros: 4216,
        chargedMicros: 20010,
        state: "RECONCILED",
      });
      await expect(
        service.finish(context, reserved.id, "again", null),
      ).rejects.toThrow("VERSION_CONFLICT");
      return result;
    },
  );
  await db.request(context, null, async (_uow, _notes, store) => {
    expect((await store.getRun(settled.id)).attempt?.money?.chargedMicros).toBe(
      20010,
    );
    const service = new ConnectedService(store, auth, clock, ids);
    const proposed = await service.propose(context, "hello", route);
    const approved = await service.decide(
      context,
      proposed.id,
      proposed.version,
      true,
      route,
    );
    await expect(
      service.reserve(context, approved.id, approved.version),
    ).rejects.toThrow("FORBIDDEN");
  });
});

test("unknown legacy usage is never treated as free under a finite budget", () => {
  const previous = run();
  previous.attempt = {
    id: "legacy",
    reservedAt: clock.now(),
    settledAt: null,
    outcome: "UNKNOWN",
    inputChars: 5,
    reservedOutputTokens: 100,
  };
  expect(() => gatewayReservation(run(), [previous], clock.now())).toThrow(
    "FORBIDDEN",
  );
  const current = run();
  current.route.gateway!.dailyBudgetMicros = "UNLIMITED";
  expect(gatewayReservation(current, [previous], clock.now())).toBeDefined();
});
