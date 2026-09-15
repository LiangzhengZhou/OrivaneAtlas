import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ModelPort, PersonalModelVault } from "@arclattice/application";
import { restoreDatabase } from "@arclattice/storage-sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { passwordHash } from "./password";
import { openPersonalVault } from "./personal-model";
import { createHost } from "./server";

let directory: string,
  secret: string,
  host: Awaited<ReturnType<typeof createHost>>,
  base: string,
  cookie: string,
  csrf: string;
const origin = "http://127.0.0.1:4317";
describe("atomic workbench organization", () => {
  it("archives independently of status, replays once, detects conflicts and restores soft deletion", async () => {
    await login();
    const task = await create("Archive me");
    const input = {
      kind: "WORK",
      action: "archive",
      entries: [{ id: task.id, version: 1, organizationVersion: 0 }],
    };
    const headers = { "Idempotency-Key": randomUUID() };
    expect((await call("/api/v1/organize", input, headers)).status).toBe(200);
    expect((await call("/api/v1/organize", input, headers)).status).toBe(200);
    let snapshot = await (await call("/api/snapshot")).json();
    expect(snapshot.items[0].status).toBe("TODO");
    expect(snapshot.organization).toHaveLength(1);
    expect(snapshot.organization[0]).toMatchObject({
      archived: true,
      version: 1,
    });
    expect((await call("/api/organize", input)).status).toBe(409);
    expect(
      (
        await call("/api/organize", {
          ...input,
          action: "unarchive",
          entries: [{ id: task.id, version: 1, organizationVersion: 1 }],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("/api/organize", {
          ...input,
          action: "delete",
          entries: [{ id: task.id, version: 1, organizationVersion: 2 }],
        })
      ).status,
    ).toBe(200);
    snapshot = await (await call("/api/snapshot")).json();
    expect(snapshot.items[0].deletedAt).toBeTruthy();
    expect(snapshot.items[0].version).toBe(2);
    expect(
      (
        await call("/api/work/delete", {
          id: task.id,
          version: 2,
          deleted: false,
        })
      ).status,
    ).toBe(200);
    const raw = new DatabaseSync(join(directory, "work.sqlite"), {
      readOnly: true,
    });
    try {
      expect(
        raw.prepare("SELECT count(*) n FROM organization_activity").get()?.n,
      ).toBe(2);
      expect(
        raw.prepare("SELECT count(*) n FROM organization_outbox").get()?.n,
      ).toBe(2);
    } finally {
      raw.close();
    }
  });
  it("moves notes and journals without changing text/day; conflict rolls back every item", async () => {
    await login();
    const first = await note("Keep $E=mc^2$\r\nunchanged");
    const journal = await (
      await call("/api/note/save", {
        id: null,
        version: 0,
        input: {
          title: "Journal",
          bodyMd: "日记正文",
          kind: "JOURNAL",
          day: "2026-09-14",
        },
      })
    ).json();
    const entries = [first, journal].map((n) => ({
      id: n.id,
      version: n.version,
      organizationVersion: 0,
    }));
    const input = {
      kind: "NOTE",
      action: "move",
      folder: "  量子场论  ",
      entries,
    };
    expect(
      (
        await call("/api/organize", {
          ...input,
          entries: [entries[0], { ...entries[1], version: 99 }],
        })
      ).status,
    ).toBe(409);
    expect(
      (await (await call("/api/snapshot")).json()).organization,
    ).toHaveLength(0);
    expect((await call("/api/organize", input)).status).toBe(200);
    const moved = await (await call("/api/snapshot")).json();
    expect(moved.notes.find((n: { id: string }) => n.id === first.id)).toEqual(
      first,
    );
    expect(
      moved.notes.find((n: { id: string }) => n.id === journal.id),
    ).toEqual(journal);
    expect(
      moved.organization.every(
        (m: { folder: string }) => m.folder === "量子场论",
      ),
    ).toBe(true);
    const selected = entries.map((e) => ({ ...e, organizationVersion: 1 }));
    expect(
      (
        await call("/api/organize", {
          kind: "NOTE",
          action: "delete",
          entries: [selected[0], { ...selected[1], version: 9 }],
        })
      ).status,
    ).toBe(409);
    expect(
      (await (await call("/api/snapshot")).json()).notes.every(
        (n: { deletedAt: unknown }) => !n.deletedAt,
      ),
    ).toBe(true);
    expect(
      (
        await call("/api/organize", {
          kind: "NOTE",
          action: "delete",
          entries: selected,
        })
      ).status,
    ).toBe(200);
    expect(
      (await (await call("/api/snapshot")).json()).notes.every(
        (n: { deletedAt: unknown }) => !!n.deletedAt,
      ),
    ).toBe(true);
  });
  it("rejects unknown/duplicate/oversized/foreign entries and missing auth", async () => {
    expect((await call("/api/organize", {})).status).toBe(401);
    await login();
    const n = await note();
    const e = { id: n.id, version: 1, organizationVersion: 0 };
    for (const entries of [
      [],
      [e, e],
      Array.from({ length: 101 }, (_, i) => ({ ...e, id: String(i) })),
      [null],
    ])
      expect(
        (
          await call("/api/organize", {
            kind: "NOTE",
            action: "delete",
            entries,
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await call("/api/organize", {
          kind: "NOTE",
          action: "delete",
          entries: [{ ...e, id: "other-workspace" }],
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call("/api/organize", {
          kind: "NOTE",
          action: "archive",
          entries: [e],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("/api/organize", {
          kind: "NOTE",
          action: "move",
          folder: "x".repeat(81),
          entries: [e],
        })
      ).status,
    ).toBe(400);
  });
});
async function start(
  database = join(directory, "work.sqlite"),
  model?: ModelPort,
  vault?: PersonalModelVault,
) {
  host = await createHost({
    database,
    secret,
    origin,
    webRoot: directory,
    model: model ?? null,
    ...(vault ? { vault } : {}),
  });
  await new Promise<void>((done) => host.server.listen(0, "127.0.0.1", done));
  base = "http://127.0.0.1:" + (host.server.address() as AddressInfo).port;
}
async function call(
  path: string,
  value?: unknown,
  headers: Record<string, string> = {},
) {
  return new Promise<Response>((resolve, reject) => {
    const req = httpRequest(
      base + path,
      {
        method: value === undefined ? "GET" : "POST",
        headers: {
          Host: "127.0.0.1:4317",
          Origin: origin,
          Cookie: cookie ?? "",
          "X-CSRF-Token": csrf ?? "",
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (value !== undefined)
              responseHeaders.set(
                key,
                Array.isArray(value) ? value.join(",") : value,
              );
          }
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 500,
              headers: responseHeaders,
            }),
          );
        });
      },
    );
    req.on("error", reject);
    req.end(value === undefined ? undefined : JSON.stringify(value));
  });
}
async function login() {
  const response = await call("/api/session", { secret });
  expect(response.status).toBe(200);
  cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  csrf = (await response.json()).csrf;
}
async function create(title = "A") {
  const response = await call("/api/work/create", { title });
  expect(response.status).toBe(200);
  return response.json();
}
async function note(bodyMd = "原文\r\n# Thought") {
  const response = await call("/api/note/save", {
    id: null,
    version: 0,
    input: { title: "Thought", bodyMd, kind: "NOTE", day: null },
  });
  expect(response.status).toBe(200);
  return response.json();
}
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "arclattice-host-"));
  secret = randomBytes(32).toString("hex");
  cookie = "";
  csrf = "";
  writeFileSync(
    join(directory, "index.html"),
    "<!doctype html><title>test</title>",
  );
  await start();
});
afterEach(async () => {
  await host.close();
  if (
    !resolve(directory).startsWith(resolve(tmpdir()) + sep + "arclattice-host-")
  )
    throw new Error("Unsafe cleanup");
  rmSync(directory, { recursive: true });
});

describe("private HTTP host", () => {
  it("permanent and dated API tokens preserve defaults, revoke normally, and reject invalid durations", async () => {
    await claim();
    await signIn();
    for (const days of [undefined, 30, 90, 365, null]) {
      const result = await call("/api/tokens/create", {
        name: "duration",
        scope: "read-write",
        ...(days !== undefined ? { days } : {}),
      });
      expect(result.status).toBe(201);
      const token = await result.json();
      if (days === null) expect(token.expiresAt).toBeNull();
      else
        expect(
          Math.round((Date.parse(token.expiresAt) - Date.now()) / 86400000),
        ).toBe(days ?? 30);
      const headers = { Authorization: "Bearer " + token.secret };
      expect((await call("/api/snapshot", undefined, headers)).status).toBe(
        200,
      );
      await call("/api/tokens/revoke", { id: token.id });
      expect((await call("/api/snapshot", undefined, headers)).status).toBe(
        401,
      );
    }
    for (const days of [0, -1, 7, "365", 365.5])
      expect(
        (
          await call("/api/tokens/create", {
            name: "bad",
            scope: "write",
            days,
          })
        ).status,
      ).toBe(400);
  }, 15000);
  it("draft reauthentication rejects a different identity before changing the session cookie", async () => {
    const owner = await claim();
    await registerUser();
    await signIn();
    const rejected = await call("/api/session", {
      username: "reader",
      password,
      expectedContext: {
        workspaceId: owner.workspaceId,
        principalId: owner.principalId,
      },
    });
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get("set-cookie")).toBeNull();
    expect(
      (await (await call("/api/session")).json()).context.principalId,
    ).toBe(owner.principalId);
    expect(
      (
        await call("/api/session", {
          username: "owner",
          password,
          expectedContext: {
            workspaceId: owner.workspaceId,
            principalId: owner.principalId,
          },
        })
      ).status,
    ).toBe(200);
  }, 15000);
  it("personal providers and reviewed AI edits are isolated, version-bound and atomic", async () => {
    await host.close();
    const vault = openPersonalVault(join(directory, "vault"));
    const complete = vi.fn(async () => "");
    await start(undefined, undefined, {
      ...vault,
      resolve(actor, scope) {
        const actual = vault.resolve(actor, scope);
        return actual ? { route: actual.route, complete } : null;
      },
    });
    const admin = await claim();
    await registerUser();
    await signIn();
    const privateKey = "ISOLATED-TEST-KEY";
    const input = {
      scope: "personal",
      endpoint: "https://provider.example/v1",
      protocol: "chat",
      model: "test-model",
      key: privateKey,
      maxRunsPerDay: 10,
    };
    expect(
      (await call("/api/ai/providers/save", { version: 0, input })).status,
    ).toBe(200);
    expect(await (await call("/api/ai/providers")).text()).not.toContain(
      privateKey,
    );
    const parent = await space();
    const parentScope = "SPACE:" + parent.id;
    expect(
      (
        await call("/api/ai/providers/save", {
          version: 0,
          input: { ...input, scope: parentScope },
        })
      ).status,
    ).toBe(200);
    const ownerNote = await note();
    await signIn("reader");
    expect(await (await call("/api/ai/providers")).json()).toEqual([]);
    expect(
      (
        await call("/api/ai/providers/save", {
          version: 0,
          input: { ...input, scope: parentScope },
        })
      ).status,
    ).toBe(404);
    expect(
      (await call("/api/ai/providers/save", { version: 0, input })).status,
    ).toBe(200);
    const own = await note("one"),
      second = await note("two");
    expect(
      (
        await call("/api/ai/propose", {
          prompt: "read foreign",
          sources: [{ kind: "NOTE", id: ownerNote.id, version: 1 }],
        })
      ).status,
    ).toBe(404);
    const sources = [own, second].map((n) => ({
      kind: "NOTE",
      id: n.id,
      version: n.version,
    }));
    const edits = sources.map((n, i) => ({
      ...n,
      title: "AI " + i,
      bodyMd: "updated " + i,
    }));
    complete.mockResolvedValue(JSON.stringify({ edits }));
    const proposal = await (
      await call("/api/ai/propose", { prompt: "review", sources })
    ).json();
    expect(proposal.createdBy).not.toBe(admin.principalId);
    expect(proposal.context).toHaveLength(2);
    expect(complete).not.toHaveBeenCalled();
    expect(
      (
        await call("/api/ai/decide", {
          id: proposal.id,
          version: 1,
          approve: true,
        })
      ).status,
    ).toBe(200);
    let run: { id: string; version: number; status: string; updatedBy: string };
    await vi.waitFor(async () => {
      run = (await (await call("/api/ai")).json()).runs[0];
      expect(run.status).toBe("SUCCEEDED");
    });
    expect(run!.updatedBy).toBe(proposal.createdBy);
    expect(
      (await (await call("/api/snapshot")).json()).notes.find(
        (n: { id: string }) => n.id === own.id,
      ).bodyMd,
    ).toBe("one");
    await call("/api/note/save", {
      id: second.id,
      version: 1,
      input: {
        kind: "NOTE",
        day: null,
        title: second.title,
        bodyMd: "concurrent human edit",
      },
    });
    const apply = { id: run!.id, version: run!.version, indices: [0, 1] };
    expect((await call("/api/ai/apply", apply)).status).toBe(409);
    expect(
      (await (await call("/api/snapshot")).json()).notes.find(
        (n: { id: string }) => n.id === own.id,
      ).bodyMd,
    ).toBe("one");
    const key = { "Idempotency-Key": randomUUID() };
    const selected = { ...apply, indices: [0] };
    const applied = await call("/api/ai/apply", selected, key);
    expect(applied.status).toBe(200);
    expect((await applied.json())[0].provenance).toBe("EXTERNAL_AI");
    expect((await call("/api/ai/apply", selected, key)).status).toBe(200);
    expect((await call("/api/ai/apply", selected)).status).toBe(409);
    const bearer = await tokenFor("read-write");
    for (const path of [
      "/api/ai/providers/save",
      "/api/ai/propose",
      "/api/ai/apply",
    ])
      expect(
        (await call(path, {}, { Authorization: "Bearer " + bearer.secret }))
          .status,
      ).toBe(403);
    await signIn();
    expect((await call("/api/ai/apply", selected)).status).toBe(404);
    const scoped = await (
      await call("/api/ai/propose", {
        prompt: "scoped review",
        scope: parentScope,
      })
    ).json();
    expect(
      (
        await call("/api/library/delete", {
          id: parent.id,
          version: 1,
          deleted: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("/api/ai/propose", {
          prompt: "deleted scope",
          scope: parentScope,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call("/api/ai/decide", {
          id: scoped.id,
          version: 1,
          approve: true,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call("/api/ai/decide", {
          id: scoped.id,
          version: 1,
          approve: false,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("/api/ai/providers/remove", {
          scope: parentScope,
          version: 1,
        })
      ).status,
    ).toBe(200);
    const raw = new DatabaseSync(join(directory, "work.sqlite"), {
      readOnly: true,
    });
    try {
      for (const table of ["request_receipt", "audit_record", "agent_run"])
        expect(
          JSON.stringify(raw.prepare("SELECT * FROM " + table).all()),
        ).not.toContain(privateKey);
    } finally {
      raw.close();
    }
  }, 20000);
  const password = "Test-only-password-123";
  async function claim() {
    await login();
    const response = await call("/api/account/claim", {
      username: "owner",
      password,
    });
    expect(response.status).toBe(200);
    return response.json();
  }
  async function signIn(username = "owner", candidate = password) {
    cookie = "";
    csrf = "";
    const response = await call("/api/session", {
      username,
      password: candidate,
    });
    expect(response.status).toBe(200);
    cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    csrf = (await response.json()).csrf;
  }
  async function registerUser() {
    expect(
      (await call("/api/register", { username: "reader", password })).status,
    ).toBe(201);
    const accounts = (await (await call("/api/admin")).json()).accounts;
    const user = accounts.find(
      (a: { username: string }) => a.username === "reader",
    );
    expect(user.status).toBe("PENDING");
    expect(
      (await call("/api/session", { username: "reader", password })).status,
    ).toBe(401);
    const response = await call("/api/admin/status", {
      id: user.id,
      version: user.version,
      status: "ACTIVE",
    });
    expect(response.status).toBe(200);
    return response.json();
  }
  async function tokenFor(scope = "write") {
    const response = await call("/api/tokens/create", {
      name: "Local AI",
      scope,
    });
    expect(response.status).toBe(201);
    return response.json();
  }
  async function space(title = "量子场论") {
    const response = await call("/api/library/save", {
      id: null,
      version: 0,
      input: { kind: "SPACE", spaceId: null, title, bodyMd: "# Overview" },
    });
    expect(response.status).toBe(200);
    return response.json();
  }
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXs8AAAAASUVORK5CYII=";
  it("only a legacy owner can claim the original workspace; public registration is pending and isolated", async () => {
    expect(
      (await call("/api/account/claim", { username: "attacker", password }))
        .status,
    ).toBe(401);
    const admin = await claim();
    expect(admin.role).toBe("ADMIN");
    expect(admin.workspaceId).toBe(host.context.workspaceId);
    expect(
      (await call("/api/account/claim", { username: "second", password }))
        .status,
    ).toBe(403);
    const original = await note(),
      library = await space();
    const asset = await (
      await call("/api/library/upload", {
        spaceId: library.id,
        name: "x.png",
        mime: "image/png",
        base64: png,
      })
    ).json();
    const user = await registerUser();
    expect(user.workspaceId).not.toBe(admin.workspaceId);
    await signIn("reader");
    const snapshot = await (await call("/api/v1/snapshot")).json();
    expect(snapshot.notes).toEqual([]);
    expect(await (await call("/api/library")).json()).toEqual([]);
    for (const path of [
      "/api/admin",
      "/api/revisions?id=" + original.id,
      "/api/library/revisions?id=" + library.id,
      "/api/library/asset?id=" + asset.id,
    ])
      expect([403, 404]).toContain((await call(path)).status);
    expect((await call("/api/backup", {})).status).toBe(403);
    expect(
      (
        await call("/api/work/create", {
          title: "bad",
          workspaceId: admin.workspaceId,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("/api/library/save", {
          id: null,
          version: 0,
          input: {
            kind: "DOCUMENT",
            spaceId: library.id,
            title: "bad",
            bodyMd: "",
          },
        })
      ).status,
    ).toBe(404);
  }, 15000);
  it("external AI credentials are scoped, hashed, versioned, idempotent and rechecked before replay", async () => {
    await claim();
    await signIn();
    const token = await tokenFor();
    const headers = {
      Authorization: "Bearer " + token.secret,
      Cookie: "",
      "X-CSRF-Token": "",
      "Idempotency-Key": randomUUID(),
    };
    for (const path of [
      "/api/snapshot",
      "/api/admin",
      "/api/tokens",
      "/api/library",
    ])
      expect((await call(path, undefined, headers)).status).toBe(403);
    for (const path of [
      "/api/backup",
      "/api/ai/propose",
      "/api/tokens/create",
      "/api/account/claim",
    ])
      expect((await call(path, {}, headers)).status).toBe(403);
    const input = {
      id: null,
      version: 0,
      input: {
        kind: "SPACE",
        spaceId: null,
        title: "Local AI research",
        bodyMd: "Original Markdown",
      },
    };
    const response = await call("/api/v1/library/save", input, headers);
    expect(response.status).toBe(200);
    const entry = await response.json();
    expect(entry.provenance).toBe("EXTERNAL_AI");
    expect(entry.createdBy).toBe(token.principalId);
    expect(
      await (await call("/api/v1/library/save", input, headers)).json(),
    ).toEqual(entry);
    expect(
      (
        await call(
          "/api/v1/library/save",
          { ...input, input: { ...input.input, title: "changed" } },
          headers,
        )
      ).status,
    ).toBe(409);
    expect(await (await call("/api/library")).json()).toHaveLength(1);
    const noteResponse = await call(
      "/api/v1/note/save",
      {
        id: null,
        version: 0,
        input: { kind: "NOTE", day: null, title: "AI note", bodyMd: "整理" },
      },
      { ...headers, "Idempotency-Key": randomUUID() },
    );
    expect((await noteResponse.json()).provenance).toBe("EXTERNAL_AI");
    const raw = new DatabaseSync(join(directory, "work.sqlite"), {
      readOnly: true,
    });
    try {
      expect(
        raw.prepare("SELECT hash FROM api_credential").get()?.hash,
      ).toMatch(/^[a-f0-9]{64}$/);
      expect(
        JSON.stringify(raw.prepare("SELECT * FROM request_receipt").all()),
      ).not.toContain(token.secret);
    } finally {
      raw.close();
    }
    expect((await call("/api/tokens/revoke", { id: token.id })).status).toBe(
      200,
    );
    expect((await call("/api/v1/library/save", input, headers)).status).toBe(
      401,
    );
  }, 15000);
  it("organization isolates real workspaces and permits scoped write tokens with revocation checks", async () => {
    await claim();
    const original = await note("Owner private note");
    await registerUser();
    await signIn("reader");
    const own = await note("Reader note");
    const token = await tokenFor("write");
    const headers = {
      Authorization: "Bearer " + token.secret,
      Cookie: "",
      "X-CSRF-Token": "",
      "Idempotency-Key": randomUUID(),
    };
    const entry = (id: string) => ({ id, version: 1, organizationVersion: 0 });
    const input = {
      kind: "NOTE",
      action: "move",
      folder: "Physics",
      entries: [entry(own.id)],
    };
    expect(
      (
        await call(
          "/api/v1/organize",
          { ...input, entries: [entry(own.id), entry(original.id)] },
          headers,
        )
      ).status,
    ).toBe(404);
    expect((await (await call("/api/snapshot")).json()).organization).toEqual(
      [],
    );
    headers["Idempotency-Key"] = randomUUID();
    expect((await call("/api/v1/organize", input, headers)).status).toBe(200);
    expect((await call("/api/v1/organize", input, headers)).status).toBe(200);
    expect(
      (await (await call("/api/snapshot")).json()).organization,
    ).toMatchObject([{ id: own.id, folder: "Physics", version: 1 }]);
    expect((await call("/api/tokens/revoke", { id: token.id })).status).toBe(
      200,
    );
    expect((await call("/api/v1/organize", input, headers)).status).toBe(401);
    await signIn();
    const owner = await (await call("/api/snapshot")).json();
    expect(owner.organization).toEqual([]);
    expect(owner.notes[0]).toEqual(original);
  }, 15000);
  it("read-write credentials can update their own lectures but cannot manage credentials or read another workspace", async () => {
    await claim();
    const original = await space();
    await registerUser();
    await signIn("reader");
    const own = await space("统计物理"),
      token = await tokenFor("read-write");
    const headers = { Authorization: "Bearer " + token.secret };
    const entries = await (
      await call("/api/v1/library", undefined, headers)
    ).json();
    expect(entries.map((e: { id: string }) => e.id)).toEqual([own.id]);
    expect(
      (
        await call(
          "/api/v1/library/revisions?id=" + original.id,
          undefined,
          headers,
        )
      ).status,
    ).toBe(404);
    const value = {
      id: own.id,
      version: 1,
      input: {
        kind: "SPACE",
        spaceId: null,
        title: own.title,
        bodyMd: "# Updated by local AI",
      },
    };
    expect((await call("/api/v1/library/save", value, headers)).status).toBe(
      200,
    );
    expect((await call("/api/v1/library/save", value, headers)).status).toBe(
      409,
    );
    expect(
      (await call("/api/tokens/revoke", { id: token.id }, headers)).status,
    ).toBe(403);
  }, 15000);
  it("disable immediately invalidates sessions and tokens, including after re-enabling the account", async () => {
    await claim();
    const adminCookie = cookie,
      adminCsrf = csrf;
    const user = await registerUser();
    await signIn("reader");
    const token = await tokenFor("read-write"),
      userCookie = cookie;
    const response = await call(
      "/api/admin/status",
      { id: user.id, version: user.version, status: "DISABLED" },
      { Cookie: adminCookie, "X-CSRF-Token": adminCsrf },
    );
    expect(response.status).toBe(200);
    const disabled = await response.json();
    expect((await call("/api/snapshot")).status).toBe(401);
    expect(
      (
        await call("/api/snapshot", undefined, {
          Authorization: "Bearer " + token.secret,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call(
          "/api/admin/status",
          { id: user.id, version: disabled.version, status: "ACTIVE" },
          { Cookie: adminCookie, "X-CSRF-Token": adminCsrf },
        )
      ).status,
    ).toBe(200);
    expect(
      (await call("/api/snapshot", undefined, { Cookie: userCookie })).status,
    ).toBe(401);
    expect(
      (
        await call("/api/snapshot", undefined, {
          Authorization: "Bearer " + token.secret,
        })
      ).status,
    ).toBe(401);
  }, 15000);
  it.each(["bearer", "cookie"])(
    "rejects a delayed %s write after revocation, without a receipt or event",
    async (mode) => {
      await claim();
      await signIn();
      const integration = await tokenFor("read-write");
      const key = randomUUID();
      let markReceived!: () => void;
      const received = new Promise<void>((resolve) => {
        markReceived = resolve;
      });
      host.server.once("request", () => setImmediate(markReceived));
      let finish!: () => void;
      const response = new Promise<number>((resolve, reject) => {
        const raw = JSON.stringify({ title: "Must never commit" });
        const req = httpRequest(
          base + "/api/work/create",
          {
            method: "POST",
            headers: {
              Host: "127.0.0.1:4317",
              Origin: origin,
              Cookie: cookie,
              "X-CSRF-Token": csrf,
              "Content-Type": "application/json",
              "Idempotency-Key": key,
              ...(mode === "bearer"
                ? { Authorization: "Bearer " + integration.secret }
                : {}),
            },
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode ?? 500));
          },
        );
        req.on("error", reject);
        req.write(raw.slice(0, -1));
        finish = () => req.end(raw.slice(-1));
      });
      try {
        await received;
        expect(
          (
            await call(
              mode === "bearer" ? "/api/tokens/revoke" : "/api/logout",
              mode === "bearer" ? { id: integration.id } : {},
            )
          ).status,
        ).toBe(200);
      } finally {
        finish();
      }
      expect(await response).toBe(401);
      expect(
        (await host.db.inspectEvents(host.context.workspaceId)).activity,
      ).toHaveLength(0);
      const raw = new DatabaseSync(join(directory, "work.sqlite"), {
        readOnly: true,
      });
      try {
        expect(raw.prepare("SELECT count(*) n FROM work_item").get()?.n).toBe(
          0,
        );
        expect(
          raw
            .prepare("SELECT count(*) n FROM request_receipt WHERE key=?")
            .get(key)?.n,
        ).toBe(0);
      } finally {
        raw.close();
      }
    },
    15000,
  );
  it("never replays a token secret and keeps admin status retries version-safe", async () => {
    await claim();
    await signIn();
    const headers = { "Idempotency-Key": randomUUID() };
    expect(
      (
        await call(
          "/api/tokens/create",
          { name: "one", scope: "write" },
          headers,
        )
      ).status,
    ).toBe(201);
    const replay = await call(
      "/api/tokens/create",
      { name: "one", scope: "write" },
      headers,
    );
    expect(replay.status).toBe(409);
    expect(await replay.text()).not.toContain("arc_");
    expect(await (await call("/api/tokens")).json()).toHaveLength(1);
    const user = await registerUser();
    const statusHeaders = { "Idempotency-Key": randomUUID() };
    const input = { id: user.id, version: user.version, status: "DISABLED" };
    const disabled = await (
      await call("/api/admin/status", input, statusHeaders)
    ).json();
    expect(
      await (await call("/api/admin/status", input, statusHeaders)).json(),
    ).toEqual(disabled);
    expect(
      (
        await call(
          "/api/admin/status",
          { ...input, status: "ACTIVE" },
          statusHeaders,
        )
      ).status,
    ).toBe(409);
  }, 15000);
  it("password changes verify the old password and revoke all sessions and integration tokens", async () => {
    await claim();
    await signIn();
    const token = await tokenFor("read-write");
    expect(
      (
        await call("/api/account/password", {
          current: "wrong-password",
          password: "Changed-password-123",
        })
      ).status,
    ).toBe(401);
    expect((await call("/api/snapshot")).status).toBe(200);
    expect(
      (
        await call("/api/account/password", {
          current: password,
          password: "Changed-password-123",
        })
      ).status,
    ).toBe(200);
    expect((await call("/api/snapshot")).status).toBe(401);
    expect(
      (
        await call("/api/snapshot", undefined, {
          Authorization: "Bearer " + token.secret,
        })
      ).status,
    ).toBe(401);
    expect(
      (await call("/api/session", { username: "owner", password })).status,
    ).toBe(401);
    await signIn("owner", "Changed-password-123");
  }, 15000);
  it("chunked images exceed old size and quota, remain private, and survive backup", async () => {
    const verifier = await passwordHash(password);
    await host.db.accounts((store) => store.register("owner", verifier, true));
    await signIn();
    const uploadId = randomUUID();
    const bytes = Buffer.alloc(21 * 1024 * 1024 + 3, 42);
    Buffer.from(png, "base64").copy(bytes);
    const metadata = {
      uploadId,
      spaceId: null,
      name: "large.png",
      mime: "image/png",
    };
    const url = "/api/library/asset?id=" + uploadId;
    let lastValue = {},
      lastHeaders = {};
    for (
      let offset = 0, index = 0;
      offset < bytes.length;
      offset += 262144, index++
    ) {
      const value = {
        ...metadata,
        index,
        final: offset + 262144 >= bytes.length,
        base64: bytes.subarray(offset, offset + 262144).toString("base64"),
      };
      const headers = { "Idempotency-Key": randomUUID() };
      const response = await call(
        "/api/v1/library/upload-chunk",
        value,
        headers,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        id: uploadId,
        url: value.final ? url : null,
      });
      if (index === 0) {
        expect((await call(url)).status).toBe(404);
        expect(
          (await call("/api/v1/library/upload-chunk", value, headers)).status,
        ).toBe(200);
        expect(
          (await call("/api/library/upload-chunk", { ...value, index: 2 }))
            .status,
        ).toBe(409);
        expect(
          (
            await call("/api/library/upload-chunk", {
              ...value,
              index: 1,
              name: "changed.png",
            })
          ).status,
        ).toBe(409);
      }
      lastValue = value;
      lastHeaders = headers;
    }
    expect(
      (await call("/api/v1/library/upload-chunk", lastValue, lastHeaders))
        .status,
    ).toBe(200);
    expect((await call("/api/library/upload-chunk", lastValue)).status).toBe(
      409,
    );
    expect(
      Buffer.from(await (await call(url)).arrayBuffer()).equals(bytes),
    ).toBe(true);
    expect((await call(url, undefined, { Cookie: "" })).status).toBe(401);
    for (const invalid of [
      { base64: Buffer.alloc(262145).toString("base64") },
      { base64: Buffer.alloc(12).toString("base64") },
      { mime: "image/svg+xml" },
      { index: -1 },
      { final: "yes" },
    ])
      expect(
        (
          await call("/api/library/upload-chunk", {
            ...metadata,
            uploadId: randomUUID(),
            index: 0,
            final: true,
            base64: png,
            ...invalid,
          })
        ).status,
      ).toBe(400);
    const backup = join(directory, "large-image.sqlite"),
      restoredPath = join(directory, "large-image-restored.sqlite");
    await host.db.backup(backup);
    await restoreDatabase(backup, restoredPath);
    const restored = new DatabaseSync(restoredPath, { readOnly: true });
    try {
      const rows = restored
        .prepare(
          "SELECT base64 FROM library_asset_chunk WHERE upload_id=? ORDER BY chunk_index",
        )
        .all(uploadId);
      expect(
        Buffer.concat(
          rows.map((row) => Buffer.from(String(row.base64), "base64")),
        ).equals(bytes),
      ).toBe(true);
      expect(
        restored
          .prepare(
            "SELECT count(*) n FROM connected_activity WHERE entity_id=? AND type='ASSET_UPLOADED'",
          )
          .get(uploadId)?.n,
      ).toBe(1);
      expect(restored.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      restored.close();
    }
    await host.db.accounts((store) => {
      const user = store.register("reader", verifier, false);
      store.status(user.id, user.version, "ACTIVE");
    });
    await signIn("reader");
    expect((await call(url)).status).toBe(404);
    expect(
      (
        await call("/api/library/upload-chunk", {
          ...metadata,
          index: 1,
          final: true,
          base64: png,
        })
      ).status,
    ).toBe(409);
  }, 30000);
  it("workspace images are authenticated, isolated, idempotent and included in backups", async () => {
    const verifier = await passwordHash(password);
    await host.db.accounts((store) => store.register("owner", verifier, true));
    await signIn();
    const value = {
      spaceId: null,
      name: "paste.png",
      mime: "image/png",
      base64: png,
    };
    const headers = { "Idempotency-Key": randomUUID() };
    const upload = await call("/api/library/upload", value, headers);
    expect(upload.status).toBe(200);
    const asset = await upload.json();
    expect(
      await (await call("/api/library/upload", value, headers)).json(),
    ).toEqual(asset);
    expect(
      Buffer.from(await (await call(asset.url)).arrayBuffer()).toString(
        "base64",
      ),
    ).toBe(png);
    expect((await call(asset.url, undefined, { Cookie: "" })).status).toBe(401);
    for (const invalid of [
      { mime: "image/svg+xml", base64: png },
      { mime: "image/png", base64: Buffer.alloc(16).toString("base64") },
      { mime: "image/png", base64: Buffer.alloc(500001).toString("base64") },
    ])
      expect(
        (await call("/api/library/upload", { ...value, ...invalid })).status,
      ).toBe(400);
    const parent = await space();
    const linked = await (
      await call("/api/library/upload", { ...value, spaceId: parent.id })
    ).json();
    expect((await call(linked.url)).status).toBe(200);
    expect(
      (
        await call("/api/library/delete", {
          id: parent.id,
          version: parent.version,
          deleted: true,
        })
      ).status,
    ).toBe(200);
    expect((await call(linked.url)).status).toBe(404);
    expect((await call(asset.url)).status).toBe(200);
    expect(
      (
        await call("/api/library/upload", {
          name: "x",
          mime: "image/png",
          base64: png,
        })
      ).status,
    ).toBe(400);
    const backup = join(directory, "workspace-image.sqlite");
    const restoredPath = join(directory, "workspace-image-restored.sqlite");
    await host.db.backup(backup);
    await restoreDatabase(backup, restoredPath);
    const restored = new DatabaseSync(restoredPath, { readOnly: true });
    try {
      expect(
        restored
          .prepare("SELECT space_id,base64 FROM library_asset WHERE id=?")
          .get(asset.id),
      ).toEqual({ space_id: null, base64: png });
      expect(
        restored
          .prepare(
            "SELECT count(*) n FROM connected_activity WHERE entity_id=?",
          )
          .get(asset.id)?.n,
      ).toBe(1);
    } finally {
      restored.close();
    }
    await host.db.accounts((store) => {
      const user = store.register("reader", verifier, false);
      store.status(user.id, user.version, "ACTIVE");
    });
    await signIn("reader");
    expect((await call(asset.url)).status).toBe(404);
  }, 15000);
  it("knowledge revisions, private images and account verifiers survive a consistent backup and new-file restore", async () => {
    await claim();
    const library = await space();
    const value = {
      id: null,
      version: 0,
      input: {
        kind: "DOCUMENT",
        spaceId: library.id,
        title: "第一讲",
        bodyMd: "# 原文\r\n$$ E=mc^2 $$",
      },
    };
    const entry = await (await call("/api/library/save", value)).json();
    const changed = await (
      await call("/api/library/save", {
        ...value,
        id: entry.id,
        version: 1,
        input: { ...value.input, bodyMd: "Updated" },
      })
    ).json();
    expect(changed.version).toBe(2);
    expect(
      await (await call("/api/library/revisions?id=" + entry.id)).json(),
    ).toHaveLength(2);
    const asset = await (
      await call("/api/library/upload", {
        spaceId: library.id,
        name: "figure.png",
        mime: "image/png",
        base64: png,
      })
    ).json();
    expect(
      Buffer.from(await (await call(asset.url)).arrayBuffer()).toString(
        "base64",
      ),
    ).toBe(png);
    expect((await call(asset.url, undefined, { Cookie: "" })).status).toBe(401);
    for (const invalid of [
      { mime: "image/svg+xml", base64: png },
      { mime: "image/png", base64: Buffer.alloc(16).toString("base64") },
      { mime: "image/png", base64: Buffer.alloc(500001).toString("base64") },
    ])
      expect(
        (
          await call("/api/library/upload", {
            spaceId: library.id,
            name: "bad",
            ...invalid,
          })
        ).status,
      ).toBe(400);
    await call("/api/library/delete", {
      id: library.id,
      version: 1,
      deleted: true,
    });
    expect((await call(asset.url)).status).toBe(404);
    expect(
      (
        await call("/api/library/delete", {
          id: entry.id,
          version: 2,
          deleted: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("/api/library/delete", {
          id: entry.id,
          version: 3,
          deleted: false,
        })
      ).status,
    ).toBe(404);
    await call("/api/library/delete", {
      id: library.id,
      version: 2,
      deleted: false,
    });
    const backup = join(directory, "v5-backup.sqlite"),
      restored = join(directory, "v5-restored.sqlite");
    await host.db.backup(backup);
    await restoreDatabase(backup, restored);
    const raw = new DatabaseSync(restored, { readOnly: true });
    try {
      expect(raw.prepare("PRAGMA user_version").get()?.user_version).toBe(9);
      expect(
        raw.prepare("SELECT base64 FROM library_asset").get()?.base64,
      ).toBe(png);
      expect(
        raw.prepare("SELECT verifier FROM account").get()?.verifier,
      ).not.toBe(password);
      expect(
        raw
          .prepare("SELECT count(*) n FROM library_revision WHERE id=?")
          .get(entry.id)?.n,
      ).toBe(3);
      expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      raw.close();
    }
  }, 15000);
  const route = {
    fingerprint: "test-route",
    provider: "https://model.example",
    model: "test",
    maxInputChars: 1000,
    maxOutputTokens: 100,
    timeoutMs: 2000,
    maxRunsPerDay: 2,
  };
  it("syncs conditional snapshots, knowledge backlinks and soft-deleted endpoints", async () => {
    expect((await call("/api/sync")).status).toBe(401);
    await login();
    const first = await (await call("/api/sync")).json();
    expect(
      (await (await call("/api/sync?cursor=" + first.cursor)).json()).snapshot,
    ).toBeNull();
    const a = await note(),
      b = await create();
    const from = { kind: "NOTE", id: a.id },
      to = { kind: "WORK", id: b.id };
    const key = randomUUID();
    const link = await (
      await call(
        "/api/link/create",
        { from, to, relation: "RELATED" },
        { "Idempotency-Key": key },
      )
    ).json();
    expect(link.version).toBe(1);
    expect(
      (
        await call("/api/link/create", {
          from: to,
          to: from,
          relation: "RELATED",
        })
      ).status,
    ).toBe(409);
    expect(
      (await call("/api/link/create", { from, to: from, relation: "RELATED" }))
        .status,
    ).toBe(400);
    expect(
      (
        await call("/api/link/create", {
          from,
          to: { kind: "WORK", id: "foreign" },
          relation: "REFERENCES",
        })
      ).status,
    ).toBe(404);
    await call(
      "/api/link/create",
      { from, to, relation: "RELATED" },
      { "Idempotency-Key": key },
    );
    const changed = await (
      await call("/api/sync?cursor=" + first.cursor)
    ).json();
    expect(changed.cursor).not.toBe(first.cursor);
    expect(changed.snapshot.links).toHaveLength(1);
    await call("/api/note/delete", { id: a.id, version: 1, deleted: true });
    expect((await (await call("/api/snapshot")).json()).links).toEqual([]);
    await call("/api/note/delete", { id: a.id, version: 2, deleted: false });
    expect((await (await call("/api/snapshot")).json()).links).toHaveLength(1);
    expect(
      (await call("/api/link/delete", { id: link.id, version: 99 })).status,
    ).toBe(409);
    expect(
      (await call("/api/link/delete", { id: link.id, version: 1 })).status,
    ).toBe(200);
    expect((await (await call("/api/snapshot")).json()).links).toEqual([]);
  });
  it("blocks AI with missing configuration and rejects client model/context injection", async () => {
    expect((await call("/api/ai")).status).toBe(401);
    await login();
    expect((await (await call("/api/ai")).json()).route).toBeNull();
    expect((await call("/api/ai/propose", { prompt: "hello" })).status).toBe(
      409,
    );
    expect(
      (await call("/api/ai/propose", { prompt: "hello", model: "injected" }))
        .status,
    ).toBe(400);
  });
  it("executes only approved input once, persists results and attributes the worker independently", async () => {
    await host.close();
    const complete = vi.fn(
      async (_prompt: string, _signal: AbortSignal) => "# Result",
    );
    await start(undefined, { route, complete });
    await login();
    await note("NEVER SEND THIS");
    const proposed = await (
      await call("/api/ai/propose", { prompt: "Only this" })
    ).json();
    expect(proposed.status).toBe("WAITING_APPROVAL");
    expect(complete).not.toHaveBeenCalled();
    const headers = { "Idempotency-Key": randomUUID() };
    const approval = { id: proposed.id, version: 1, approve: true };
    const responses = await Promise.all([
      call("/api/ai/decide", approval, headers),
      call("/api/ai/decide", approval, headers),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    await vi.waitFor(async () =>
      expect((await (await call("/api/ai")).json()).runs[0].status).toBe(
        "SUCCEEDED",
      ),
    );
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[0]).toBe("Only this");
    const run = (await (await call("/api/ai")).json()).runs[0];
    expect(run.updatedBy).toBe("arclattice-owner");
    expect(run.output).toBe("# Result");
    expect((await call("/api/ai/decide", approval)).status).toBe(409);
    const raw = new DatabaseSync(join(directory, "work.sqlite"), {
      readOnly: true,
    });
    try {
      expect(
        raw.prepare("SELECT COUNT(*) AS n FROM connected_activity").get()?.n,
      ).toBe(3);
      expect(
        raw.prepare("SELECT COUNT(*) AS n FROM audit_record").get()?.n,
      ).toBe(2);
    } finally {
      raw.close();
    }
    await host.close();
    await start(undefined, { route, complete });
    await login();
    expect((await (await call("/api/ai")).json()).runs[0].output).toBe(
      "# Result",
    );
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("rejects declined or stale approvals, marks failures and enforces daily limits", async () => {
    await host.close();
    const complete = vi.fn(async () => {
      throw new Error("SECRET ERROR");
    });
    await start(undefined, { route: { ...route, maxRunsPerDay: 1 }, complete });
    await login();
    const propose = async () =>
      (await call("/api/ai/propose", { prompt: "request" })).json();
    const rejected = await propose();
    expect(
      (
        await call("/api/ai/decide", {
          id: rejected.id,
          version: 1,
          approve: false,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("/api/ai/decide", {
          id: rejected.id,
          version: 2,
          approve: true,
        })
      ).status,
    ).toBe(409);
    const run = await propose();
    expect(
      (await call("/api/ai/decide", { id: run.id, version: 2, approve: true }))
        .status,
    ).toBe(409);
    await call("/api/ai/decide", { id: run.id, version: 1, approve: true });
    await vi.waitFor(async () =>
      expect(
        (await (await call("/api/ai")).json()).runs.find(
          (r: { id: string }) => r.id === run.id,
        ).status,
      ).toBe("FAILED"),
    );
    expect(await (await call("/api/ai")).text()).not.toContain("SECRET ERROR");
    const next = await propose();
    expect(
      (await call("/api/ai/decide", { id: next.id, version: 1, approve: true }))
        .status,
    ).toBe(403);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("invalidates pending approval after route change and recovers abandoned runs without resending", async () => {
    await host.close();
    const complete = vi.fn(async () => "unused");
    await start(undefined, { route, complete });
    await login();
    const run = await (
      await call("/api/ai/propose", { prompt: "old config" })
    ).json();
    await host.close();
    await start(undefined, {
      route: { ...route, fingerprint: "changed" },
      complete,
    });
    await login();
    expect(
      (await call("/api/ai/decide", { id: run.id, version: 1, approve: true }))
        .status,
    ).toBe(409);
    await host.close();
    const raw = new DatabaseSync(join(directory, "work.sqlite"));
    raw
      .prepare("UPDATE agent_run SET payload=? WHERE id=?")
      .run(JSON.stringify({ ...run, status: "RUNNING" }), run.id);
    raw.close();
    await start(undefined, { route, complete });
    await login();
    expect((await (await call("/api/ai")).json()).runs[0].status).toBe(
      "INTERRUPTED",
    );
    expect(complete).not.toHaveBeenCalled();
  });
  it("bounds concurrency and interrupts timed-out requests without resending", async () => {
    await host.close();
    const complete = vi.fn(
      async (_prompt: string, signal: AbortSignal) =>
        new Promise<string>((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          ),
        ),
    );
    await start(undefined, { route: { ...route, timeoutMs: 300 }, complete });
    await login();
    const a = await (await call("/api/ai/propose", { prompt: "first" })).json();
    const b = await (
      await call("/api/ai/propose", { prompt: "second" })
    ).json();
    const responses = await Promise.all(
      [a, b].map((r) =>
        call("/api/ai/decide", { id: r.id, version: 1, approve: true }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 403]);
    await vi.waitFor(async () =>
      expect(
        (await (await call("/api/ai")).json()).runs.some(
          (r: { status: string }) => r.status === "INTERRUPTED",
        ),
      ).toBe(true),
    );
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("permits only exact HTTPS origin with secure cookies, never public HTTP", async () => {
    await expect(
      createHost({
        database: join(directory, "bad.sqlite"),
        secret,
        origin: "http://example.test",
        webRoot: directory,
      }),
    ).rejects.toThrow();
    await host.close();
    host = await createHost({
      database: join(directory, "secure.sqlite"),
      secret,
      origin: "https://example.test",
      webRoot: directory,
    });
    await new Promise<void>((done) => host.server.listen(0, "127.0.0.1", done));
    base = "http://127.0.0.1:" + (host.server.address() as AddressInfo).port;
    const headers = {
      Host: "example.test",
      Origin: "https://example.test",
    };
    const response = await call("/api/session", { secret }, headers);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("; Secure");
    expect(
      (
        await call(
          "/api/session",
          { secret },
          { ...headers, Origin: "http://example.test" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          "/api/session",
          { secret },
          { ...headers, Host: "attacker.test" },
        )
      ).status,
    ).toBe(403);
  });
  it("downloads authenticated consistent backups and rejects parallel/unsafe requests", async () => {
    expect((await call("/api/backup", {})).status).toBe(401);
    await login();
    await create("Backed up");
    await note();
    expect(
      (await call("/api/backup", {}, { "X-CSRF-Token": "bad" })).status,
    ).toBe(403);
    expect((await call("/api/backup", { path: "/etc/passwd" })).status).toBe(
      400,
    );
    const responses = await Promise.all([
      call("/api/backup", {}),
      call("/api/backup", {}),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 429]);
    const response = responses.find((r) => r.status === 200);
    expect(response?.headers.get("content-type")).toBe(
      "application/vnd.sqlite3",
    );
    const target = join(directory, "download.sqlite");
    writeFileSync(target, Buffer.from(await response!.arrayBuffer()));
    const restored = join(directory, "download-restored.sqlite");
    await restoreDatabase(target, restored);
    const raw = new DatabaseSync(restored, { readOnly: true });
    try {
      expect(raw.prepare("SELECT title FROM work_item").get()?.title).toBe(
        "Backed up",
      );
      expect(raw.prepare("SELECT count(*) AS n FROM notebook").get()?.n).toBe(
        1,
      );
      expect(raw.prepare("PRAGMA user_version").get()?.user_version).toBe(9);
    } finally {
      raw.close();
    }
  });
  it("persists planning fields and rejects invalid dates and foreign project references", async () => {
    await login();
    const project = await (
      await call("/api/work/create", { title: "Project", type: "PROJECT" })
    ).json();
    const item = await (
      await call("/api/work/create", {
        title: "Task",
        projectId: project.id,
        startDate: "2026-09-14",
        dueDate: "2026-09-30",
      })
    ).json();
    expect(item.projectId).toBe(project.id);
    expect(item.dueDate).toBe("2026-09-30");
    expect(
      (
        await call("/api/work/delete", {
          id: project.id,
          version: 1,
          deleted: true,
        })
      ).status,
    ).toBe(409);
    for (const dueDate of ["2026-02-30", "2026-09-01", "2026-9-30"]) {
      expect(
        (
          await call("/api/work/update", {
            id: item.id,
            version: 1,
            input: { dueDate },
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await call("/api/work/update", {
          id: item.id,
          version: 1,
          input: { projectId: "foreign" },
        })
      ).status,
    ).toBe(404);
    const updated = await (
      await call("/api/work/update", {
        id: item.id,
        version: 1,
        input: { projectId: null, startDate: null, dueDate: null },
      })
    ).json();
    expect(updated.projectId).toBeNull();
    expect(updated.dueDate).toBeNull();
    expect(
      (
        await call("/api/work/delete", {
          id: project.id,
          version: 1,
          deleted: true,
        })
      ).status,
    ).toBe(200);
  });
  it("requires a real session and uses protected cookies and security headers", async () => {
    expect((await call("/api/snapshot")).status).toBe(401);
    expect((await call("/api/session", { secret: "bad" })).status).toBe(401);
    const response = await call("/api/session", { secret });
    expect(response.headers.get("set-cookie")).toContain(
      "HttpOnly; SameSite=Strict",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("rejects foreign hosts, cross-origin writes and missing CSRF", async () => {
    await login();
    expect(
      (await call("/api/snapshot", undefined, { Host: "attacker.test" }))
        .status,
    ).toBe(403);
    expect(
      (
        await call(
          "/api/work/create",
          { title: "x" },
          { Origin: "https://attacker.test" },
        )
      ).status,
    ).toBe(403);
    expect(
      (await call("/api/work/create", { title: "x" }, { "X-CSRF-Token": "" }))
        .status,
    ).toBe(403);
    expect(
      (await call("/api/work/create", { title: "x" }, { Origin: "" })).status,
    ).toBe(403);
  });
  it("validates idempotency, unknown keys, field types and enums", async () => {
    await login();
    expect(
      (
        await call(
          "/api/work/create",
          { title: "x" },
          { "Idempotency-Key": "" },
        )
      ).status,
    ).toBe(400);
    for (const input of [
      { title: 1 },
      { title: "x", workspaceId: "other" },
      { title: "x", priority: "INVALID" },
      { title: "x", type: "INVALID" },
    ])
      expect((await call("/api/work/create", input)).status).toBe(400);
    expect((await call("/api/snapshot")).status).toBe(200);
    expect((await (await call("/api/snapshot")).json()).items).toHaveLength(0);
  });
  it("commits identical parallel retries only once, including activity and outbox", async () => {
    await login();
    const key = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        call("/api/work/create", { title: "once" }, { "Idempotency-Key": key }),
      ),
    );
    for (const response of responses) expect(response.status).toBe(200);
    const results = await Promise.all(responses.map((r) => r.json()));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect((await (await call("/api/snapshot")).json()).items).toHaveLength(1);
    const events = await host.db.inspectEvents(host.context.workspaceId);
    expect(events.activity).toHaveLength(1);
    expect(events.outbox).toHaveLength(1);
    expect(
      (
        await call(
          "/api/work/create",
          { title: "different" },
          { "Idempotency-Key": key },
        )
      ).status,
    ).toBe(409);
  });
  it("keeps receipts and content after restart, but invalidates sessions", async () => {
    await login();
    const key = randomUUID();
    const item = await (
      await call(
        "/api/work/create",
        { title: "persist" },
        { "Idempotency-Key": key },
      )
    ).json();
    const n = await note();
    await host.close();
    await start();
    expect((await call("/api/snapshot")).status).toBe(401);
    await login();
    const retry = await (
      await call(
        "/api/work/create",
        { title: "persist" },
        { "Idempotency-Key": key },
      )
    ).json();
    expect(retry).toEqual(item);
    const data = await (await call("/api/snapshot")).json();
    expect(data.items).toHaveLength(1);
    expect(data.notes).toEqual([n]);
  });
  it("rejects stale versions without extra events", async () => {
    await login();
    const item = await create();
    expect(
      (
        await call("/api/work/update", {
          id: item.id,
          version: 1,
          input: { title: "new" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("/api/work/update", {
          id: item.id,
          version: 1,
          input: { title: "stale" },
        })
      ).status,
    ).toBe(409);
    expect(
      (await host.db.inspectEvents(host.context.workspaceId)).activity,
    ).toHaveLength(2);
  });
  it("prevents cycles, blocks transitions, and unlocks work after completion", async () => {
    await login();
    const a = await create("first"),
      b = await create("second");
    expect(
      (await call("/api/edge/create", { fromId: a.id, toId: b.id })).status,
    ).toBe(200);
    expect(
      (await call("/api/edge/create", { fromId: b.id, toId: a.id })).status,
    ).toBe(409);
    expect(
      (
        await call("/api/work/update", {
          id: b.id,
          version: 1,
          input: { status: "IN_PROGRESS" },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call("/api/work/update", {
          id: a.id,
          version: 1,
          input: { status: "DONE" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("/api/work/update", {
          id: b.id,
          version: 1,
          input: { status: "IN_PROGRESS" },
        })
      ).status,
    ).toBe(200);
  });
  it("preserves raw Markdown, revisions and soft-delete recovery atomically", async () => {
    await login();
    const a = await note();
    const input = {
      title: "Revised",
      bodyMd: "<script>alert(1)</script>\n中文 😀",
      kind: "NOTE",
      day: null,
    };
    const b = await (
      await call("/api/note/save", { id: a.id, version: 1, input })
    ).json();
    expect(b.version).toBe(2);
    expect(
      (await call("/api/note/save", { id: a.id, version: 1, input })).status,
    ).toBe(409);
    const removed = await (
      await call("/api/note/delete", { id: a.id, version: 2, deleted: true })
    ).json();
    expect(removed.deletedAt).toBeTruthy();
    const restored = await (
      await call("/api/note/delete", { id: a.id, version: 3, deleted: false })
    ).json();
    expect(restored.bodyMd).toBe(input.bodyMd);
    expect(restored.deletedAt).toBeNull();
    const history = await (await call("/api/revisions?id=" + a.id)).json();
    expect(history).toHaveLength(4);
    expect(history[3]).toEqual(a);
    const raw = new DatabaseSync(join(directory, "work.sqlite"), {
      readOnly: true,
    });
    try {
      for (const table of [
        "notebook_revision",
        "notebook_activity",
        "notebook_outbox",
      ])
        expect(raw.prepare("SELECT COUNT(*) AS n FROM " + table).get()?.n).toBe(
          4,
        );
    } finally {
      raw.close();
    }
  });
  it("validates journal dates and permits only one live page per day", async () => {
    await login();
    const input = {
      title: "Today",
      bodyMd: "",
      kind: "JOURNAL",
      day: "2026-09-14",
    };
    for (const day of ["bad", "2026-02-30", "2026-99-99", null])
      expect(
        (
          await call("/api/note/save", {
            id: null,
            version: 0,
            input: { ...input, day },
          })
        ).status,
      ).toBe(400);
    const n = await (
      await call("/api/note/save", { id: null, version: 0, input })
    ).json();
    expect(n.version).toBe(1);
    expect(
      (await call("/api/note/save", { id: null, version: 0, input })).status,
    ).toBe(400);
    expect(
      (await call("/api/note/delete", { id: n.id, version: 1, deleted: true }))
        .status,
    ).toBe(200);
    expect(
      (await call("/api/note/save", { id: null, version: 0, input })).status,
    ).toBe(200);
    expect(
      (await call("/api/note/delete", { id: n.id, version: 2, deleted: false }))
        .status,
    ).toBe(400);
  });
  it("restores v2 backup with notes, receipts and events into a new database", async () => {
    await login();
    await create();
    await note();
    const snapshot = await (await call("/api/snapshot")).json();
    const backup = join(directory, "backup.sqlite");
    await host.db.backup(backup);
    const restored = join(directory, "restored.sqlite");
    await restoreDatabase(backup, restored);
    await host.close();
    await start(restored);
    await login();
    expect(await (await call("/api/snapshot")).json()).toEqual(snapshot);
    expect(
      (await host.db.inspectEvents(host.context.workspaceId)).activity,
    ).toHaveLength(1);
  });
  it("locks a session immediately and rate-limits guesses", async () => {
    await login();
    expect((await call("/api/logout", {})).status).toBe(200);
    expect((await call("/api/snapshot")).status).toBe(401);
    for (let i = 0; i < 9; i++)
      expect((await call("/api/session", { secret: "no" })).status).toBe(401);
    expect((await call("/api/session", { secret })).status).toBe(429);
  });
  it("serves only web assets and never database or key files", async () => {
    expect((await call("/")).status).toBe(200);
    expect((await call("/work.sqlite")).status).toBe(404);
    expect((await call("/access.key")).status).toBe(404);
    expect((await call("/../access.key")).status).toBe(404);
    expect((await call("/api/unknown", {})).status).toBe(401);
  });
  it("rejects oversized JSON payloads without exposing server internals", async () => {
    await login();
    const response = await call("/api/note/save", { body: "x".repeat(910000) });
    expect(response.status).toBe(413);
    expect(await response.text()).toBe('{"error":"VALIDATION_ERROR"}');
  });
});
