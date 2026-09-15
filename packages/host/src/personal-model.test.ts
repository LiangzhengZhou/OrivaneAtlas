import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { PersonalModelInput } from "@arclattice/application";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));
vi.mock("node:https", () => ({ request: network.request }));

import {
  modelEndpoint,
  openPersonalVault,
  publicAddress,
} from "./personal-model";

const actor = { workspaceId: "w", principalId: "p" };
const input: PersonalModelInput = {
  scope: "personal",
  endpoint: "https://provider.example/v1/chat/completions",
  protocol: "chat",
  model: "model-1",
  key: "TEST-ONLY-PRIVATE-KEY",
  maxRunsPerDay: 3,
};
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "orivane-vault-"));
  vi.resetAllMocks();
});
afterEach(() => {
  if (
    !resolve(directory).startsWith(resolve(tmpdir()) + sep + "orivane-vault-")
  )
    throw new Error("Unsafe cleanup");
  rmSync(directory, { recursive: true });
});
describe("personal model vault and public-only egress", () => {
  it.each([
    "0.0.0.0",
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.100.100.200",
    "198.18.0.1",
    "224.0.0.1",
    "::1",
    "::ffff:8.8.8.8",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:7f00:1::",
    "not-ip",
  ])("rejects non-public destination %s", (address) =>
    expect(publicAddress(address)).toBe(false),
  );
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
    "accepts global address %s",
    (address) => expect(publicAddress(address)).toBe(true),
  );
  it.each([
    "http://provider.example",
    "https://localhost",
    "https://foo.local",
    "https://2130706433",
    "https://0x7f000001",
    "https://[::ffff:127.0.0.1]",
    "https://example.com:8443",
    "https://user:pass@example.com",
    "https://example.com?a=b",
    "https://example.com/#key",
  ])("rejects unsafe endpoint %s", (endpoint) =>
    expect(() => modelEndpoint(endpoint)).toThrow(),
  );
  it("normalizes routes and isolates users and workspaces without plaintext persistence", () => {
    const vault = openPersonalVault(directory);
    const saved = vault.save(actor, 0, input);
    expect(saved.endpoint).toBe("https://provider.example/v1/");
    expect(JSON.stringify(saved)).not.toContain(input.key);
    expect(
      readFileSync(join(directory, "providers.enc")).includes(
        Buffer.from(input.key),
      ),
    ).toBe(false);
    expect(vault.list({ ...actor, principalId: "other" })).toEqual([]);
    expect(
      vault.resolve({ ...actor, workspaceId: "other" }, "personal"),
    ).toBeNull();
    const reopened = openPersonalVault(directory);
    expect(reopened.list(actor)).toEqual([saved]);
    expect(() => reopened.save(actor, 0, input)).toThrow("VERSION_CONFLICT");
    const updated = reopened.save(actor, 1, {
      ...input,
      key: "",
      model: "model-2",
    });
    expect(updated.version).toBe(2);
    expect(updated.route.fingerprint).not.toBe(saved.route.fingerprint);
    expect(() => reopened.remove(actor, "personal", 1)).toThrow(
      "VERSION_CONFLICT",
    );
    reopened.remove(actor, "personal", 2);
    expect(openPersonalVault(directory).list(actor)).toEqual([]);
  });
  it("fails closed on altered ciphertext", () => {
    openPersonalVault(directory).save(actor, 0, input);
    const file = join(directory, "providers.enc"),
      bytes = readFileSync(file);
    bytes[30] = bytes[30]! ^ 1;
    writeFileSync(file, bytes);
    expect(() => openPersonalVault(directory)).toThrow();
  });
  it("rejects mixed DNS answers before sending any key or request", async () => {
    const vault = openPersonalVault(directory);
    vault.save(actor, 0, input);
    network.lookup.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(
      vault
        .resolve(actor, "personal")!
        .complete("private", new AbortController().signal),
    ).rejects.toThrow("MODEL_DESTINATION_REJECTED");
    expect(network.request).not.toHaveBeenCalled();
  });
  function response(data: unknown, status = 200) {
    network.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    network.request.mockImplementation((_url, options, callback) => {
      const req = new EventEmitter() as EventEmitter & {
        end: (payload: string) => void;
      };
      req.end = () =>
        queueMicrotask(() => {
          const res = new EventEmitter() as EventEmitter & {
            statusCode: number;
            destroy: () => void;
          };
          res.statusCode = status;
          res.destroy = vi.fn();
          callback(res);
          if (status === 200) {
            res.emit("data", Buffer.from(JSON.stringify(data)));
            res.emit("end");
          }
        });
      const pinned = vi.fn();
      options.lookup("provider.example", {}, pinned);
      expect(pinned).toHaveBeenCalledWith(null, "8.8.8.8", 4);
      expect(options.agent).toBe(false);
      return req;
    });
  }
  it("pins validated DNS, uses the HTTPS hostname and parses Chat/Responses text", async () => {
    const vault = openPersonalVault(directory);
    vault.save(actor, 0, input);
    response({ choices: [{ message: { content: "chat result" } }] });
    expect(
      await vault
        .resolve(actor, "personal")!
        .complete("private", new AbortController().signal),
    ).toBe("chat result");
    expect(network.request.mock.calls[0]![0].href).toBe(
      "https://provider.example/v1/chat/completions",
    );
    vault.save(actor, 1, { ...input, protocol: "responses" });
    response({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "response result" }],
        },
      ],
    });
    expect(
      await vault
        .resolve(actor, "personal")!
        .complete("private", new AbortController().signal),
    ).toBe("response result");
  });
  it("does not follow redirects or accept tool calls", async () => {
    const vault = openPersonalVault(directory);
    vault.save(actor, 0, input);
    response({}, 302);
    await expect(
      vault
        .resolve(actor, "personal")!
        .complete("private", new AbortController().signal),
    ).rejects.toThrow("MODEL_REQUEST_FAILED");
    expect(network.request).toHaveBeenCalledTimes(1);
    response({ choices: [{ message: { content: "x", tool_calls: [{}] } }] });
    await expect(
      vault
        .resolve(actor, "personal")!
        .complete("private", new AbortController().signal),
    ).rejects.toThrow("MODEL_TOOLS_NOT_ALLOWED");
  });
});
