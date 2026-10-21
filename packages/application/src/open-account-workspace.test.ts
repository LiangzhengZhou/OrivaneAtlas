import { expect, test, vi } from "vitest";
import {
  OpenAccountWorkspaceService,
  type WorkspaceConnectionPreview,
} from "./open-account-workspace";
import { previewWorkspaceBinding } from "./workspace-binding-preview";
import {
  defaultWorkspaceDatabase,
  type WorkspaceCatalogEntry,
} from "./workspace-catalog";

const actor = { workspaceId: "local", principalId: "owner" };
const preview = (): WorkspaceConnectionPreview => ({
  ...previewWorkspaceBinding(
    actor,
    { workspaceId: "local", revision: 1, records: [] },
    { workspaceId: "remote", revision: 2, records: [] },
  ),
  serverOrigin: "https://example.test",
  remotePrincipalId: "remote-owner",
  epoch: "epoch",
});
function fixture() {
  let active: WorkspaceCatalogEntry = {
    id: "default",
    databaseName: defaultWorkspaceDatabase,
    title: "Local",
  };
  let reserved: WorkspaceCatalogEntry | undefined;
  const close = vi.fn(),
    synchronize = vi.fn(async () => {});
  const ports = {
    catalog: {
      active: vi.fn(async () => active),
      list: vi.fn(async () => [active]),
      reserveRemote: vi.fn(async (entry: WorkspaceCatalogEntry) => {
        reserved = entry;
        return entry;
      }),
      select: vi.fn(async (_id: string, expected: string) => {
        if (active.databaseName !== expected)
          throw new Error("VERSION_CONFLICT");
        if (!reserved) throw new Error("NOT_RESERVED");
        active = reserved;
      }),
      close: vi.fn(),
    },
    ids: { next: () => "11111111-1111-4111-8111-111111111111" },
    preview: vi.fn(async () => preview()),
    assertScope: vi.fn(),
    open: vi.fn(async () => ({ synchronize, close })),
  };
  return {
    ports,
    synchronize,
    close,
    service: new OpenAccountWorkspaceService(ports),
  };
}

test("activation waits for successful synchronization and target closes after activation", async () => {
  const f = fixture();
  f.synchronize.mockImplementation(async () => {
    expect(f.ports.catalog.select).not.toHaveBeenCalled();
  });
  const entry = await f.service.open(actor, preview());
  expect(entry.remote!.workspaceId).toBe("remote");
  expect(f.ports.catalog.select).toHaveBeenCalledWith(
    entry.id,
    defaultWorkspaceDatabase,
  );
  expect(f.close).toHaveBeenCalledOnce();
});

test("stale preview and foreign actors cannot reserve or open another workspace", async () => {
  const f = fixture(),
    changed = preview();
  changed.remoteRevision++;
  f.ports.preview.mockResolvedValue(changed);
  await expect(f.service.open(actor, preview())).rejects.toThrow(
    "VERSION_CONFLICT",
  );
  await expect(
    f.service.open({ ...actor, workspaceId: "foreign" }, preview()),
  ).rejects.toThrow("FORBIDDEN");
  expect(f.ports.catalog.reserveRemote).not.toHaveBeenCalled();
  expect(f.ports.open).not.toHaveBeenCalled();
});

test("pull failure or a changed authenticated scope preserves active source and closes target", async () => {
  const f = fixture();
  f.synchronize.mockRejectedValue(new Error("PULL_FAILED"));
  await expect(f.service.open(actor, preview())).rejects.toThrow("PULL_FAILED");
  expect(f.ports.catalog.select).not.toHaveBeenCalled();
  expect(f.close).toHaveBeenCalledOnce();
  const g = fixture();
  g.synchronize.mockImplementation(async () => {
    g.ports.assertScope.mockImplementation(() => {
      throw new Error("SERVER_CHANGED");
    });
  });
  await expect(g.service.open(actor, preview())).rejects.toThrow(
    "SERVER_CHANGED",
  );
  expect(g.ports.catalog.select).not.toHaveBeenCalled();
  expect(g.close).toHaveBeenCalledOnce();
});
