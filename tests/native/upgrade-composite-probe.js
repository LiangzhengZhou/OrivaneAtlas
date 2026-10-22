// Isolated installed-schema fixture. Never opens a product profile or a server.
(async () => {
  if (location.pathname === "/result") return;
  let outcome;
  let phase = "open";
  const check = (condition, label) => {
    if (!condition) throw Error(label);
  };
  const canonical = (value) => JSON.stringify(value);
  const api = globalThis.OrivaneLocalStorageFixture;
  const stores = [];
  try {
    const expected = JSON.parse(
      localStorage.getItem("composite-fixture-expected") ?? "null",
    );
    if (expected) {
      phase = "native-process-restart";
      const source = await api.IndexedDbLocalStore.open("composite-source");
      const target = await api.IndexedDbLocalStore.open("composite-upgraded");
      const blobs =
        await api.IndexedDbLocalBlobStore.open("composite-upgraded");
      stores.push(source, target, blobs);
      const original = await source.metadata.exportWorkspace(
        expected.identity.workspaceId,
      );
      const current = await target.metadata.exportWorkspace(
        expected.identity.workspaceId,
      );
      check(
        canonical(current.entities) === canonical(original.entities),
        "PROCESS_RESTART_ENTITIES",
      );
      check(
        canonical(current.mutations) ===
          canonical(
            original.mutations.map((mutation) =>
              mutation.state === "SENDING"
                ? { ...mutation, state: "PENDING" }
                : mutation,
            ),
          ),
        "PROCESS_RESTART_OUTBOX",
      );
      check(
        canonical(current.syncState) === canonical(original.syncState),
        "PROCESS_RESTART_BINDING",
      );
      check(
        canonical(await target.identity.get()) ===
          canonical(expected.restoredIdentity),
        "PROCESS_RESTART_IDENTITY",
      );
      const runtime = new api.LocalRuntime(
        new api.LocalWorkspace(
          target.metadata,
          blobs,
          expected.restoredIdentity,
          { extract: () => [], resolve: () => [] },
          { now: () => "2026-10-01T00:00:00.000Z" },
          { next: () => crypto.randomUUID() },
        ),
        {
          forTarget: async () => "44444444-4444-4444-8444-444444444444",
          nextChangeId: () => crypto.randomUUID(),
        },
      );
      check(
        (await runtime.readDocumentBody(expected.note)).bodyMd ===
          expected.markdown,
        "PROCESS_RESTART_NOTE",
      );
      check(
        (await runtime.readDocumentBody(expected.doc)).bodyMd ===
          expected.markdown,
        "PROCESS_RESTART_DOCUMENT",
      );
      check(
        (await runtime.getEntityMemo(expected.memoTarget)).bodyMd ===
          expected.memoText,
        "PROCESS_RESTART_MEMO",
      );
      check(
        (await blobs.digest(await runtime.readFileBytes(expected.file.id))) ===
          expected.file.contentHash,
        "PROCESS_RESTART_FILE",
      );
      for (const { id, mime } of expected.images) {
        const bytes = await runtime.loadImage(`/api/library/asset?id=${id}`);
        check(bytes.type === mime, "PROCESS_RESTART_IMAGE_MIME");
        const url = URL.createObjectURL(bytes);
        try {
          const image = new Image();
          image.src = url;
          document.body.append(image);
          await image.decode();
          check(
            image.naturalWidth === 2 && image.naturalHeight === 2,
            "PROCESS_RESTART_IMAGE_DECODE",
          );
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      outcome = {
        ok: true,
        runtime: "Windows WebView2",
        nativeProcessRestart: true,
        entities: current.entities.length,
        pending: current.mutations.length,
        nativeImagesDecoded: 3,
        originalOutboxDeviceIdsPreserved: true,
        recoveredSending: 1,
        restartUnchanged: true,
        productionWritten: false,
      };
      await fetch(
        `${location.origin}/result?json=${encodeURIComponent(JSON.stringify(outcome))}`,
      );
      return;
    }
    const source = await api.IndexedDbLocalStore.open("composite-source");
    const sourceBlobs =
      await api.IndexedDbLocalBlobStore.open("composite-source");
    stores.push(source, sourceBlobs);
    const identity = await source.identity.ensure({
      schemaVersion: 1,
      workspaceId: "11111111-1111-4111-8111-111111111111",
      principalId: "22222222-2222-4222-8222-222222222222",
      deviceId: "33333333-3333-4333-8333-333333333333",
    });
    const binding = {
      workspaceId: identity.workspaceId,
      serverOrigin: "https://fixture.invalid",
      remoteWorkspaceId: "55555555-5555-4555-8555-555555555555",
      remotePrincipalId: "66666666-6666-4666-8666-666666666666",
      epoch: "installed-schema-fixture",
      cursor: 0,
      version: 1,
    };
    phase = "bind-empty";
    await source.syncState.bindEmpty(binding);
    const wiki = { extract: () => [], resolve: () => [] };
    const clock = { now: () => "2026-10-01T00:00:00.000Z" };
    const ids = { next: () => crypto.randomUUID() };
    const memoIdentity = {
      forTarget: async () => "44444444-4444-4444-8444-444444444444",
      nextChangeId: () => crypto.randomUUID(),
    };
    const runtimeFor = (store, blobs, own) =>
      new api.LocalRuntime(
        new api.LocalWorkspace(store.metadata, blobs, own, wiki, clock, ids),
        memoIdentity,
      );
    const runtime = runtimeFor(source, sourceBlobs, identity);
    phase = "seed-work";
    const root = await runtime.service.create(runtime.context, {
      type: "PROJECT",
      title: "Original root",
    });
    phase = "seed-child";
    const child = await runtime.service.create(runtime.context, {
      type: "PROJECT",
      title: "Original child",
      parentProjectId: root.id,
    });
    phase = "seed-task";
    const task = await runtime.service.create(runtime.context, {
      title: "Original task",
      projectIds: [root.id, child.id],
    });
    phase = "seed-milestone";
    const milestone = await runtime.service.create(runtime.context, {
      type: "MILESTONE",
      title: "Original milestone",
      parentProjectId: root.id,
    });
    phase = "seed-edge";
    const dependent = await runtime.service.create(runtime.context, {
      title: "Original dependent task",
      projectIds: [child.id],
    });
    await runtime.service.addEdge(
      runtime.context,
      task.id,
      dependent.id,
      "BLOCKS",
    );
    phase = "seed-closed";
    const closed = await runtime.service.create(runtime.context, {
      type: "PROJECT",
      title: "Original completed project",
    });
    phase = "complete-project";
    await runtime.service.update(runtime.context, closed.id, closed.version, {
      projectLifecycle: "COMPLETED",
    });
    phase = "seed-deleted";
    const deleted = await runtime.service.create(runtime.context, {
      type: "PROJECT",
      title: "Original soft deleted project",
    });
    await runtime.service.setDeleted(
      runtime.context,
      deleted.id,
      deleted.version,
      true,
    );
    phase = "seed-images";
    const imageSources = [];
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    canvas.getContext("2d").fillRect(0, 0, 2, 2);
    for (const mime of ["image/png", "image/jpeg", "image/webp"]) {
      const uri = canvas.toDataURL(mime);
      check(uri.startsWith(`data:${mime};base64,`), "ENCODER_MIME");
      const id = crypto.randomUUID();
      await runtime.uploadImageChunk(
        { id, spaceId: null, name: id, mime, base64: uri.split(",")[1] },
        0,
        true,
      );
      imageSources.push({ id, mime });
    }
    const markdown =
      "# Original\r\n中文 $Z=0$ 🧭\n\n" +
      imageSources
        .map(({ id, mime }) => `![${mime}](/api/library/asset?id=${id})`)
        .join("\n\n");
    phase = "seed-knowledge";
    const note = await runtime.saveNote(null, 0, {
      title: "Original research",
      bodyMd: markdown,
      kind: "NOTE",
      day: null,
    });
    await runtime.saveNote(null, 0, {
      title: "Another original note",
      bodyMd: "Original second note\r\n",
      kind: "NOTE",
      day: null,
    });
    await runtime.saveNote(null, 0, {
      title: "Original journal",
      bodyMd: "Original journal\r\n$E=mc^2$",
      kind: "JOURNAL",
      day: "2026-10-01",
    });
    const space = await runtime.saveLibrary(null, 0, {
      kind: "SPACE",
      spaceId: null,
      title: "Original knowledge",
      bodyMd: "Original space",
    });
    const doc = await runtime.saveLibrary(null, 0, {
      kind: "DOCUMENT",
      spaceId: space.id,
      title: "Original document",
      bodyMd: markdown,
    });
    await runtime.linkProjectSpace({
      projectId: root.id,
      spaceId: space.id,
      role: "REFERENCE",
      inheritToChildren: true,
    });
    await runtime.link(
      { kind: "WORK", id: root.id },
      { kind: "DOCUMENT", id: doc.id },
      "REFERENCES",
    );
    const fileBytes = new Blob([new Uint8Array([0, 255, 13, 10, 128, 42])], {
      type: "application/octet-stream",
    });
    const file = await runtime.uploadProjectFile(
      root.id,
      { name: "original.bin", mime: fileBytes.type, spaceId: space.id },
      fileBytes,
    );
    const memoTarget = { targetKind: "TASK", targetId: task.id };
    const memoText = "Original private memo\r\n$Z=0$ 🧭";
    await runtime.saveEntityMemo({ ...memoTarget, bodyMd: memoText }, 0);
    binding.cursor = 272;
    binding.version = 2;
    await source.syncState.save(binding, 1);
    const firstPending = (await source.outbox.list(identity.workspaceId))[0];
    await source.outbox.transition({
      workspaceId: identity.workspaceId,
      mutationId: firstPending.id,
      binding,
      expectedState: "PENDING",
      expectedAttemptCount: 0,
      expectedLastAttemptAt: null,
      nextState: "SENDING",
      at: clock.now(),
    });
    phase = "source-archive";
    const original = await source.metadata.exportWorkspace(
      identity.workspaceId,
    );
    check(original.schemaVersion === 2, "ARCHIVE_SCHEMA");
    check(
      !original.entities.some(
        (row) => row.collection === "$local.workspaceBootstrap",
      ),
      "LEGACY_MARKER_MUST_BE_ABSENT",
    );
    const backup = await runtime.backup();
    const target = await api.IndexedDbLocalStore.open("composite-upgraded");
    const targetBlobs =
      await api.IndexedDbLocalBlobStore.open("composite-upgraded");
    stores.push(target, targetBlobs);
    const newDevice = "77777777-7777-4777-8777-777777777777";
    phase = "restore";
    await api.restoreLocalWorkspace(
      backup,
      newDevice,
      target.metadata,
      targetBlobs,
    );
    const restoredIdentity = await target.identity.get();
    check(
      restoredIdentity.workspaceId === identity.workspaceId &&
        restoredIdentity.principalId === identity.principalId &&
        restoredIdentity.deviceId === newDevice,
      "RESTORED_IDENTITY",
    );
    const restored = runtimeFor(target, targetBlobs, restoredIdentity);
    phase = "compare";
    const after = await target.metadata.exportWorkspace(identity.workspaceId);
    check(
      canonical(after.entities) === canonical(original.entities),
      "ENTITY_ID_VERSION_BODY_DIFF",
    );
    check(
      canonical(after.mutations) === canonical(original.mutations),
      "OUTBOX_DEVICE_RECEIPT_IDENTITY_DIFF",
    );
    check(
      canonical(after.syncState) === canonical(original.syncState),
      "BINDING_CURSOR_DIFF",
    );
    const work = await restored.service.snapshot(restored.context, true);
    check(
      work.items.find((item) => item.id === child.id).parentProjectId ===
        root.id,
      "PROJECT_HIERARCHY",
    );
    check(
      work.items.find((item) => item.id === milestone.id).parentProjectId ===
        root.id,
      "MILESTONE_RELATION",
    );
    check(
      work.items.find((item) => item.id === deleted.id).deletedAt !== null,
      "SOFT_DELETE_PRESERVED",
    );
    check(
      work.items.find((item) => item.id === closed.id).lifecycle ===
        "COMPLETED",
      "LIFECYCLE_PRESERVED",
    );
    check(
      (await restored.readDocumentBody(note)).bodyMd === markdown,
      "NOTE_ORIGINAL_BYTES",
    );
    check(
      (await restored.readDocumentBody(doc)).bodyMd === markdown,
      "DOCUMENT_ORIGINAL_BYTES",
    );
    check(
      (await restored.getEntityMemo(memoTarget)).bodyMd === memoText,
      "MEMO_ORIGINAL_BYTES",
    );
    check(
      (await targetBlobs.digest(await restored.readFileBytes(file.id))) ===
        file.contentHash,
      "FILE_ORIGINAL_BYTES",
    );
    for (const { id, mime } of imageSources) {
      const bytes = await restored.loadImage(`/api/library/asset?id=${id}`);
      check(bytes.type === mime, "IMAGE_MIME");
      const url = URL.createObjectURL(bytes);
      try {
        const image = new Image();
        image.src = url;
        document.body.append(image);
        await image.decode();
        check(
          image.complete &&
            image.naturalWidth === 2 &&
            image.naturalHeight === 2,
          "NATIVE_IMAGE_RENDER",
        );
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    let fileDenied = false;
    try {
      await restored.readFile(
        { ...restored.context, principalId: crypto.randomUUID() },
        file.id,
      );
    } catch (error) {
      fileDenied = error.code === "FORBIDDEN";
    }
    check(fileDenied, "FILE_OWNER_BOUNDARY");
    const foreign = runtimeFor(target, targetBlobs, {
      ...restoredIdentity,
      principalId: "88888888-8888-4888-8888-888888888888",
    });
    let memoIsolated = false;
    try {
      memoIsolated = (await foreign.getEntityMemo(memoTarget)) === null;
    } catch (error) {
      memoIsolated = error.code === "FORBIDDEN";
    }
    check(memoIsolated, "MEMO_OWNER_BOUNDARY");
    target.close();
    targetBlobs.close();
    const reopened = await api.IndexedDbLocalStore.open("composite-upgraded");
    const reopenedBlobs =
      await api.IndexedDbLocalBlobStore.open("composite-upgraded");
    stores.push(reopened, reopenedBlobs);
    const restarted = await reopened.metadata.exportWorkspace(
      identity.workspaceId,
    );
    check(
      canonical(restarted.entities) === canonical(original.entities),
      "RESTART_ENTITY_DIFF",
    );
    check(
      canonical(restarted.mutations) === canonical(original.mutations),
      "RESTART_OUTBOX_DIFF",
    );
    check(
      (await reopened.outbox.recoverSending(identity.workspaceId)) === 1,
      "RECOVER_SENDING_COUNT",
    );
    const recovered = await reopened.outbox.list(identity.workspaceId);
    const byId = (mutations) =>
      [...mutations].sort((a, b) => a.id.localeCompare(b.id));
    check(
      canonical(byId(recovered)) ===
        canonical(
          byId(
            original.mutations.map((mutation) =>
              mutation.state === "SENDING"
                ? { ...mutation, state: "PENDING" }
                : mutation,
            ),
          ),
        ),
      "RECOVERY_ATTEMPT_DEVICE_DIFF",
    );
    const digestJson = async (value) =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(canonical(value)),
          ),
        ),
      )
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    const business = (archive) =>
      archive.entities
        .filter((row) =>
          [
            "items",
            "edges",
            "notes",
            "library",
            "files",
            "entityMemos",
            "links",
            "projectMaterials",
          ].includes(row.collection),
        )
        .map((row) => ({
          collection: row.collection,
          id: row.id,
          version: row.version,
        }));
    const schemaVersion = (await indexedDB.databases()).find(
      (entry) => entry.name === "composite-source",
    ).version;
    check(schemaVersion === 5, "INSTALLED_SCHEMA_VERSION");
    localStorage.setItem(
      "composite-fixture-expected",
      canonical({
        identity,
        restoredIdentity,
        note,
        doc,
        file,
        memoTarget,
        memoText,
        markdown,
        images: imageSources,
      }),
    );
    outcome = {
      ok: true,
      runtime: "Windows WebView2",
      schemaVersion,
      identity: restoredIdentity,
      binding: after.syncState,
      structuredDiff: {
        before: business(original),
        after: business(after),
        entitiesBeforeSha256: await digestJson(original.entities),
        entitiesAfterSha256: await digestJson(after.entities),
        outboxBeforeSha256: await digestJson(original.mutations),
        outboxAfterSha256: await digestJson(after.mutations),
        changes: [],
      },
      entities: original.entities.length,
      pending: original.mutations.length,
      originalOutboxDeviceIdsPreserved: true,
      recoveredSending: 1,
      remoteReceiptAcceptanceVerified: false,
      cursor: binding.cursor,
      imageFormats: imageSources.map(({ mime }) => mime),
      nativeImagesDecoded: 3,
      markdownUnchanged: true,
      bytesUnchanged: true,
      privateOwnerBoundary: true,
      restartUnchanged: true,
      sourceBackupHash: await sourceBlobs.digest(backup),
      collections: Object.fromEntries(
        [...new Set(original.entities.map((row) => row.collection))].map(
          (name) => [
            name,
            original.entities.filter((row) => row.collection === name).length,
          ],
        ),
      ),
      fixtureOnly: true,
      productionWritten: false,
    };
  } catch (error) {
    outcome = {
      ok: false,
      phase,
      error: error instanceof Error ? error.message : "COMPOSITE_FAILED",
      code: error?.code,
      details: error?.details,
    };
  } finally {
    for (const store of stores) store.close();
  }
  await fetch(
    `${location.origin}/result?json=${encodeURIComponent(JSON.stringify(outcome))}`,
  );
})();
