import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  type PersonalModelVault,
  ProviderRequestError,
} from "@arclattice/application";
import { afterEach, beforeEach, expect, it } from "vitest";
import { openPersonalVault } from "./personal-model";

const actor = { workspaceId: "provider-integration", principalId: "owner" };
const key = "TEST-ONLY-LOCAL-PROVIDER-KEY";
let directory: string,
  server: Server,
  vault: PersonalModelVault,
  connectionId: string;
let status: number, discoveryUnsupported: boolean, stall: boolean;
let requests: {
  method: string;
  path: string;
  authorization: string;
  body: string;
}[];
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "atlas-provider-integration-"));
  status = 200;
  discoveryUnsupported = false;
  stall = false;
  requests = [];
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push({
      method: req.method ?? "",
      path: req.url ?? "",
      authorization: req.headers.authorization ?? "",
      body: Buffer.concat(chunks).toString("utf8"),
    });
    if (stall) return;
    res.writeHead(discoveryUnsupported && req.method === "GET" ? 404 : status, {
      "Content-Type": "application/json",
    });
    res.end(
      JSON.stringify(
        status !== 200
          ? { error: `Never expose ${key}` }
          : req.method === "GET"
            ? { data: [{ id: "local-model" }] }
            : { choices: [{ message: { content: "OK" } }] },
      ),
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`;
  vault = openPersonalVault(directory);
  vault.setTrustedEndpoints!([
    {
      id: "owned-local-fixture",
      workspaceId: actor.workspaceId,
      title: "Disposable provider",
      provider: "VLLM",
      origin: endpoint,
      enabled: true,
    },
  ]);
  vault.save(actor, 0, {
    scope: "personal",
    providerKind: "CUSTOM_OPENAI",
    endpoint,
    protocol: "chat",
    model: "local-model",
    key,
    maxRunsPerDay: 3,
  });
  connectionId = vault.configuration!(actor).connections[0]!.id;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
  if (
    !resolve(directory).startsWith(
      resolve(tmpdir()) + sep + "atlas-provider-integration-",
    )
  )
    throw new Error("Unsafe fixture cleanup");
  rmSync(directory, { recursive: true });
});

it("real trusted HTTP discovery preserves GET, headers and absent body; chat preserves POST and JSON", async () => {
  const adapter = vault.connectionAdapter!(actor, connectionId);
  expect(await adapter.listModels(new AbortController().signal)).toEqual([
    "local-model",
  ]);
  expect(await adapter.complete("Probe", new AbortController().signal)).toBe(
    "OK",
  );
  expect(requests[0]).toEqual({
    method: "GET",
    path: "/v1/models",
    authorization: `Bearer ${key}`,
    body: "",
  });
  expect(requests[1]).toMatchObject({
    method: "POST",
    path: "/v1/chat/completions",
    authorization: `Bearer ${key}`,
  });
  expect(JSON.parse(requests[1]!.body)).toMatchObject({
    model: "local-model",
    messages: [{ role: "user", content: "Probe" }],
  });
  expect(
    readFileSync(join(directory, "providers.enc")).includes(Buffer.from(key)),
  ).toBe(false);
});

it.each([
  [401, "AUTH_INVALID"],
  [403, "PERMISSION_DENIED"],
  [404, "ENDPOINT_NOT_FOUND"],
  [405, "METHOD_NOT_ALLOWED"],
  [429, "RATE_LIMITED"],
  [503, "UPSTREAM_UNAVAILABLE"],
] as const)(
  "real HTTP %s retains safe diagnostics without echoing server secrets",
  async (httpStatus, category) => {
    status = httpStatus;
    const failure = await vault.connectionAdapter!(actor, connectionId)
      .listModels(new AbortController().signal)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderRequestError);
    expect(failure).toMatchObject({
      failure: { category, status: httpStatus, provider: "CUSTOM_OPENAI" },
    });
    expect(JSON.stringify(failure)).not.toContain(key);
    expect(requests).toHaveLength(1);
  },
);

it("real timeout is classified and does not retry", async () => {
  stall = true;
  const failure = await vault.connectionAdapter!(actor, connectionId)
    .listModels(AbortSignal.timeout(100))
    .catch((error: unknown) => error);
  expect(failure).toMatchObject({
    failure: { category: "NETWORK_TIMEOUT", retryable: true },
  });
  expect(requests).toHaveLength(1);
});

it("unsupported discovery validates auth through a configured model without invalidating the connection", async () => {
  discoveryUnsupported = true;
  expect(
    await vault.testConnection!(
      actor,
      connectionId,
      new AbortController().signal,
    ),
  ).toEqual({ connected: true, discovery: "UNSUPPORTED" });
  expect(requests.map((request) => request.method)).toEqual(["GET", "POST"]);
});
