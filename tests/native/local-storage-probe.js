// Runs in an isolated WebView with the real compiled candidate, never product runtime.
(async () => {
  if (location.pathname === "/result") return;
  let outcome;
  try {
    const {
      IndexedDbLocalStore,
      IndexedDbLocalBlobStore,
      LocalMutationTransaction,
      LocalWorkUnitOfWork,
      LocalWorkspace,
      LocalRuntime,
      WorkService,
      NotebookService,
      LibraryService,
      LocalImageAssets,
      indexDocument,
      buildAliasIndex,
      normalizeWikiTitle,
    } = globalThis.OrivaneLocalStorageFixture;
    const db = await IndexedDbLocalStore.open("native-local-spike");
    const priorIdentity = await db.identity.get();
    const localIdentity = await db.identity.ensure({
      schemaVersion: 1,
      workspaceId: crypto.randomUUID(),
      principalId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
    });
    const identityDurable =
      !priorIdentity ||
      (priorIdentity.workspaceId === localIdentity.workspaceId &&
        priorIdentity.principalId === localIdentity.principalId &&
        priorIdentity.deviceId === localIdentity.deviceId);
    const before = await db.metadata.list("native-local", "tasks");
    const started = performance.now();
    if (!before.length) {
      const writes = Array.from({ length: 50 }, (_, index) => ({
        entity: {
          workspaceId: "native-local",
          collection: "tasks",
          id: "task-" + index,
          version: 1,
          value: { title: "native task " + index },
        },
        expectedVersion: null,
        mutation: {
          id: "native-write-" + index,
          deviceId: "native-probe",
          workspaceId: "native-local",
          principalId: "probe-owner",
          operation: "CREATE",
          entityType: "tasks",
          entityId: "task-" + index,
          baseVersion: null,
          payload: { title: "native task " + index },
          createdAt: "2026-10-12T00:00:00Z",
          attemptCount: 0,
          lastAttemptAt: null,
          state: "PENDING",
        },
      }));
      await db.metadata.commit("native-local", "probe-owner", writes, [
        {
          entity: {
            workspaceId: "native-local",
            collection: "$local.body",
            id: "original",
            version: 1,
            value: { bodyMd: "Original\nMarkdown" },
          },
          expectedVersion: null,
        },
      ]);
      // Seed only synthetic fixture metadata; business mutations use the adapter above.
      await new Promise((resolve, reject) => {
        const request = indexedDB.open("native-local-spike");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const fixture = request.result;
          const tx = fixture.transaction("entities", "readwrite", {
            durability: "strict",
          });
          tx.oncomplete = () => {
            fixture.close();
            resolve();
          };
          tx.onabort = () => {
            const error = tx.error;
            fixture.close();
            reject(error);
          };
          const store = tx.objectStore("entities");
          for (const [collection, start, end] of [
            ["tasks", 50, 1500],
            ["documents", 0, 500],
            ["files", 0, 1000],
          ])
            for (let index = start; index < end; index++)
              store.add({
                workspaceId: "native-local",
                collection,
                id:
                  (collection === "tasks" ? "task" : collection) + "-" + index,
                version: 1,
                value: {
                  title: collection + " " + index,
                  ...(collection === "documents"
                    ? { bodyMd: "original Markdown\n".repeat(60) }
                    : {}),
                },
              });
        };
      });
    }
    const writeMs = performance.now() - started;
    const readStart = performance.now();
    const [tasks, documents, files, outbox] = await Promise.all([
      db.metadata.list("native-local", "tasks"),
      db.metadata.list("native-local", "documents"),
      db.metadata.list("native-local", "files"),
      db.outbox.list("native-local"),
    ]);
    const readMs = performance.now() - readStart;
    let staleRejected = false;
    try {
      await db.metadata.commit("native-local", "probe-owner", [
        {
          entity: tasks[0],
          expectedVersion: null,
          mutation: { ...outbox[0], id: "native-stale", entityId: tasks[0].id },
        },
      ]);
    } catch (error) {
      staleRejected =
        error instanceof Error && error.message === "VERSION_CONFLICT";
    }
    const blobs = await IndexedDbLocalBlobStore.open(
      "native-local-binary-spike",
    );
    const original = new Uint8Array([0, 255, 128, 13, 10, 1]);
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", original)),
    ]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    await blobs.put("native-local", hash, new Blob([original]));
    const binary = await blobs.get("native-local", hash);
    const binaryValid =
      binary &&
      [...new Uint8Array(await binary.arrayBuffer())].join(",") ===
        [...original].join(",");
    const body = await db.metadata.get(
      "native-local",
      "$local.body",
      "original",
    );
    const bodyValid = body?.value?.bodyMd === "Original\nMarkdown";
    const actor = {
      workspaceId: "native-staged-" + crypto.randomUUID(),
      principalId: "probe-owner",
    };
    const begin = () =>
      LocalMutationTransaction.begin(
        db.metadata,
        actor,
        "native-probe",
        { now: () => "2026-10-12T00:00:00Z" },
        { next: () => crypto.randomUUID() },
      );
    const winner = await begin(),
      stale = await begin();
    await stale.list("tasks");
    winner.stage(
      {
        workspaceId: actor.workspaceId,
        collection: "tasks",
        id: "winner",
        version: 1,
        value: {},
      },
      null,
      "CREATE",
      {},
    );
    winner.stage(
      {
        workspaceId: actor.workspaceId,
        collection: "tasks",
        id: "winner",
        version: 2,
        value: { reconciled: true },
      },
      1,
      "PATCH",
      { reconciled: true },
    );
    await winner.commit();
    stale.stage(
      {
        workspaceId: actor.workspaceId,
        collection: "tasks",
        id: "stale",
        version: 1,
        value: {},
      },
      null,
      "CREATE",
      {},
    );
    stale.stageInternal(
      {
        workspaceId: actor.workspaceId,
        collection: "$local.body",
        id: "stale",
        version: 1,
        value: { bodyMd: "Do not persist" },
      },
      null,
    );
    let stagedGuardRejected = false;
    try {
      await stale.commit();
    } catch (error) {
      stagedGuardRejected =
        error instanceof Error && error.message === "VERSION_CONFLICT";
    }
    const stagedAtomic =
      stagedGuardRejected &&
      (await db.metadata.get(actor.workspaceId, "tasks", "stale")) === null &&
      (await db.metadata.get(actor.workspaceId, "$local.body", "stale")) ===
        null &&
      (await db.outbox.list(actor.workspaceId)).length === 2 &&
      (await db.metadata.get(actor.workspaceId, "tasks", "winner"))?.version ===
        2;
    const businessActor = {
      workspaceId: "native-application",
      principalId: "probe-owner",
    };
    const businessClock = { now: () => "2026-10-12T00:00:00Z" };
    const businessIds = { next: () => crypto.randomUUID() };
    const businessUow = new LocalWorkUnitOfWork(
      db.metadata,
      businessActor,
      "native-device",
      businessClock,
      businessIds,
    );
    const businessAuth = { require: async () => {} };
    const workService = new WorkService(
      businessUow,
      businessAuth,
      businessClock,
      businessIds,
    );
    const initialBusiness = await workService.snapshot(businessActor);
    const sourceText =
      "# Native durable Markdown\n第二行\n[[Native document]]\n" +
      "preserved body\n".repeat(4000);
    const wiki = {
      extract: (sourceId, markdown) => indexDocument(sourceId, markdown, []),
      resolve: (links, entries) => {
        const aliases = buildAliasIndex(entries);
        return links.map((link) => ({
          ...link,
          targetDocumentId:
            aliases.get(normalizeWikiTitle(link.targetText)) ?? null,
        }));
      },
    };
    const imageAssets = (stage, publish) =>
      new LocalImageAssets(
        stage,
        blobs,
        businessActor,
        businessClock,
        businessIds,
        publish,
      );
    if (!initialBusiness.items.length) {
      const project = await workService.create(businessActor, {
        title: "Native durable project",
        type: "PROJECT",
      });
      await businessUow.runWithLibrary(
        businessActor.workspaceId,
        wiki,
        imageAssets,
        async (tx, notes, library) => {
          const scoped = {
            run: async (workspaceId, operation) => {
              if (workspaceId !== businessActor.workspaceId)
                throw new Error("FORBIDDEN");
              return operation(tx);
            },
          };
          await new WorkService(
            scoped,
            businessAuth,
            businessClock,
            businessIds,
          ).create(businessActor, {
            title: "Native durable task",
            projectIds: [project.id],
          });
          await new NotebookService(
            notes,
            businessAuth,
            businessClock,
            businessIds,
          ).save(businessActor, null, 0, {
            title: "Native durable note",
            kind: "NOTE",
            day: null,
            bodyMd: sourceText,
          });
          const service = new LibraryService(
            library,
            businessAuth,
            businessClock,
            businessIds,
          );
          const space = await service.save(businessActor, null, 0, {
            title: "Native durable space",
            kind: "SPACE",
            spaceId: null,
            bodyMd: "Description",
          });
          await service.save(businessActor, null, 0, {
            title: "Native document",
            kind: "DOCUMENT",
            spaceId: space.id,
            bodyMd: sourceText,
          });
        },
      );
    }
    const cleanWiki = {
      ...wiki,
      extract: () => {
        throw new Error("CLEAN_START_MUST_NOT_REPARSE");
      },
    };
    const business = await businessUow.runWithLibrary(
      businessActor.workspaceId,
      cleanWiki,
      imageAssets,
      async (tx, notes, library) => ({
        items: await tx.list(),
        notes: await notes.listMetadata(),
        library: await library.listMetadata(),
        links: await library.wikiLinks(),
        noteBodies: await notes.list(),
        documentBodies: await library.list(),
        changes: await tx.workspaceChanges(0),
      }),
    );
    const applicationDurable =
      business.items.length === 2 &&
      business.notes.length === 1 &&
      business.library.length === 2 &&
      business.notes.every((value) => !Object.hasOwn(value, "bodyMd")) &&
      business.library.every((value) => !Object.hasOwn(value, "bodyMd")) &&
      business.noteBodies[0]?.bodyMd === sourceText &&
      business.documentBodies.find((value) => value.kind === "DOCUMENT")
        ?.bodyMd === sourceText &&
      business.links[0]?.targetDocumentId ===
        business.documentBodies.find((value) => value.kind === "DOCUMENT")
          ?.id &&
      business.changes.changes.length === 5 &&
      (await db.outbox.list(businessActor.workspaceId)).length === 5;
    // Keep actual database connections alive until the WebView/process ends.
    const fileWorkspace = new LocalWorkspace(
      db.metadata,
      blobs,
      localIdentity,
      {
        extract: (id, markdown) => indexDocument(id, markdown, []),
        resolve: (links, entries) => {
          const aliases = buildAliasIndex(entries);
          return links.map((link) => ({
            ...link,
            targetDocumentId:
              aliases.get(normalizeWikiTitle(link.targetText)) ?? null,
          }));
        },
      },
      { now: () => "2026-10-13T00:00:00Z", calendarTimezone: "Asia/Shanghai" },
      { next: () => crypto.randomUUID() },
    );
    const fileRuntime = new LocalRuntime(fileWorkspace);
    const priorFiles = (await fileRuntime.loadWorkspace()).files;
    if (!priorFiles.length) {
      const uploaded = await fileRuntime.uploadFile(
        {
          name: "native-original.bin",
          mime: "application/octet-stream",
          spaceId: null,
        },
        new Blob([original]),
      );
      await fileRuntime.renameFile(
        uploaded.id,
        uploaded.version,
        "Native renamed.txt",
      );
    }
    const realFiles = (await fileRuntime.loadWorkspace()).files;
    if (realFiles.length !== 1) throw new Error("INVALID_NATIVE_FILE_COUNT");
    const realFile = realFiles[0];
    const fileBytes = new Uint8Array(
      await (await fileRuntime.readFileBytes(realFile.id)).arrayBuffer(),
    );
    const fileDurable =
      realFile.version === 2 &&
      realFile.originalName === "native-original.bin" &&
      realFile.name === "Native renamed.txt" &&
      realFile.extension === "bin" &&
      realFile.extractionStatus === "NOT_APPLICABLE" &&
      realFile.aiPolicy.processingBoundary === "LOCAL_ONLY" &&
      realFile.aiPolicy.aiAccess === "DENY" &&
      fileBytes.length === original.length &&
      fileBytes.every((byte, index) => byte === original[index]);
    const replica = await IndexedDbLocalStore.open("native-replica-spike");
    const replicaResumed = !!(await replica.metadata.get(
      localIdentity.workspaceId,
      "$local.remoteBase",
      '["items","native-ack-task"]',
    ));
    const replicaBinding = {
      workspaceId: localIdentity.workspaceId,
      remoteWorkspaceId: "native-remote",
      serverOrigin: "https://example.test",
      epoch: "native-epoch",
      cursor: 10,
      version: 1,
    };
    const accepted = {
      id: "native-accepted",
      workspaceId: localIdentity.workspaceId,
      principalId: localIdentity.principalId,
      deviceId: localIdentity.deviceId,
      entityType: "items",
      entityId: "native-ack-task",
      operation: "CREATE",
      baseVersion: null,
      payload: { title: "Offline" },
      createdAt: "2026-10-13T00:00:00Z",
      attemptCount: 1,
      lastAttemptAt: "2026-10-13T00:01:00Z",
      state: "SENDING",
    };
    if (!(await replica.identity.get())) {
      await replica.metadata.restoreEmptyWorkspace(
        {
          schemaVersion: 2,
          identity: localIdentity,
          syncState: replicaBinding,
          entities: [
            {
              workspaceId: localIdentity.workspaceId,
              collection: "$local.workspace",
              id: "revision",
              version: 1,
              value: { revision: 1 },
            },
            {
              workspaceId: localIdentity.workspaceId,
              collection: "items",
              id: "native-ack-task",
              version: 1,
              value: { title: "Offline" },
            },
          ],
          mutations: [
            accepted,
            {
              ...accepted,
              id: "native-later",
              state: "PENDING",
              attemptCount: 0,
              lastAttemptAt: null,
            },
          ],
        },
        localIdentity.deviceId,
      );
    }
    if (!replicaResumed) {
      const receipt = {
        workspaceId: localIdentity.workspaceId,
        principalId: localIdentity.principalId,
        expectedWorkspaceVersion: 1,
        binding: replicaBinding,
        nextCursor: 11,
        acknowledgement: {
          mutationId: accepted.id,
          deviceId: localIdentity.deviceId,
          attemptCount: 1,
          lastAttemptAt: accepted.lastAttemptAt,
        },
        records: [
          {
            expectedVersion: null,
            entity: {
              workspaceId: localIdentity.workspaceId,
              collection: "$local.remoteBase",
              id: '["items","native-ack-task"]',
              version: 1,
              value: {
                remoteWorkspaceId: "native-remote",
                collection: "items",
                id: "native-ack-task",
                version: 1,
                mutationId: accepted.id,
                value: { title: "Canonical" },
              },
            },
          },
        ],
      };
      const beforeReplica = JSON.stringify(
        await replica.metadata.exportWorkspace(localIdentity.workspaceId),
      );
      let overwriteRejected = false;
      try {
        await replica.replica.commit({
          ...receipt,
          records: [
            ...receipt.records,
            {
              expectedVersion: 1,
              entity: {
                workspaceId: localIdentity.workspaceId,
                collection: "items",
                id: "native-ack-task",
                version: 2,
                value: { title: "Canonical" },
              },
            },
          ],
        });
      } catch (error) {
        overwriteRejected =
          error instanceof Error && error.message === "VERSION_CONFLICT";
      }
      if (
        !overwriteRejected ||
        beforeReplica !==
          JSON.stringify(
            await replica.metadata.exportWorkspace(localIdentity.workspaceId),
          )
      )
        throw new Error("NATIVE_REPLICA_OVERWRITE");
      await replica.replica.commit(receipt);
    }
    const replicaSync = await replica.syncState.get(localIdentity.workspaceId);
    const replicaPending = await replica.outbox.list(localIdentity.workspaceId);
    const replicaBody = await replica.metadata.get(
      localIdentity.workspaceId,
      "items",
      "native-ack-task",
    );
    const replicaBase = await replica.metadata.get(
      localIdentity.workspaceId,
      "$local.remoteBase",
      '["items","native-ack-task"]',
    );
    const replicaDurable =
      replicaSync?.cursor === 11 &&
      replicaSync.version === 2 &&
      replicaPending.length === 1 &&
      replicaPending[0].id === "native-later" &&
      replicaBody?.value.title === "Offline" &&
      replicaBase?.value.value.title === "Canonical";
    const commandDb = await IndexedDbLocalStore.open("native-command-spike");
    await commandDb.identity.ensure(localIdentity);
    const commandRuntime = new LocalRuntime(
      new LocalWorkspace(
        commandDb.metadata,
        blobs,
        localIdentity,
        wiki,
        businessClock,
        businessIds,
      ),
    );
    const initialCommands = await commandRuntime.loadWorkspace();
    if (!initialCommands.items.length) {
      const project = await commandRuntime.service.create(
        commandRuntime.context,
        { title: "Command project", type: "PROJECT", lifecycle: "ACTIVE" },
      );
      await commandRuntime.service.create(commandRuntime.context, {
        title: "Command task",
        projectIds: [project.id],
      });
      await commandRuntime.service.update(
        commandRuntime.context,
        project.id,
        project.version,
        {
          projectLifecycle: "COMPLETED",
          completionResolution: { action: "INBOX" },
        },
      );
    }
    const commandRecords = await commandDb.metadata.list(
      localIdentity.workspaceId,
      "$local.command",
    );
    const commandRecord = commandRecords.find(
      (entry) => entry.value.name === "work.update",
    );
    let commandEffects = (
      await commandDb.outbox.list(localIdentity.workspaceId)
    ).filter((entry) => entry.commandId === commandRecord?.id);
    const commandBinding = {
      workspaceId: localIdentity.workspaceId,
      remoteWorkspaceId: "native-command-remote",
      serverOrigin: "https://example.test",
      epoch: "command-epoch",
      cursor: 0,
      version: 1,
    };
    if (!(await commandDb.syncState.get(localIdentity.workspaceId)))
      await commandDb.syncState.save(commandBinding, null);
    if (
      commandEffects.every(
        (entry) => entry.state === "PENDING" && entry.attemptCount === 0,
      )
    ) {
      await commandDb.outbox.transitionMany(
        commandEffects.map((entry) => ({
          workspaceId: localIdentity.workspaceId,
          mutationId: entry.id,
          binding: commandBinding,
          expectedState: "PENDING",
          expectedAttemptCount: 0,
          expectedLastAttemptAt: null,
          nextState: "SENDING",
          at: "2026-10-13T00:01:00Z",
        })),
      );
      commandEffects = (
        await commandDb.outbox.list(localIdentity.workspaceId)
      ).filter((entry) => entry.commandId === commandRecord?.id);
    }
    const commandAttemptDurable =
      commandEffects.length === 2 &&
      commandEffects.every(
        (entry) =>
          entry.state === "SENDING" &&
          entry.attemptCount === 1 &&
          entry.lastAttemptAt === "2026-10-13T00:01:00Z",
      );
    const commandSnapshot = await commandRuntime.loadWorkspace();
    const commandDurable =
      commandRecords.length === 3 &&
      commandRecord?.value.input.input.completionResolution.action ===
        "INBOX" &&
      commandEffects.length === 2 &&
      JSON.stringify(commandRecord.value.mutationIds) ===
        JSON.stringify(commandEffects.map((entry) => entry.id)) &&
      commandSnapshot.items.find((entry) => entry.type === "TASK")?.projectIds
        .length === 0;
    globalThis.ATLAS_STORAGE_PROBE_CONNECTIONS = [
      db,
      blobs,
      replica,
      commandDb,
    ];
    outcome = {
      ok:
        staleRejected &&
        binaryValid &&
        bodyValid &&
        stagedAtomic &&
        applicationDurable &&
        fileDurable &&
        identityDurable &&
        replicaDurable &&
        commandDurable &&
        commandAttemptDurable &&
        tasks.length === 1500 &&
        documents.length === 500 &&
        files.length === 1000 &&
        outbox.length === 50,
      runtime: globalThis.ATLAS_STORAGE_PROBE_RUNTIME ?? "Windows WebView2",
      userAgent: navigator.userAgent,
      resumed: before.length === 1500,
      tasks: tasks.length,
      documents: documents.length,
      files: files.length,
      outbox: outbox.length,
      writeMs,
      readMs,
      staleRejected,
      binaryValid,
      bodyValid,
      stagedAtomic,
      applicationDurable,
      fileDurable,
      fileResumed: priorFiles.length === 1,
      fileId: realFile.id,
      applicationResumed: initialBusiness.items.length === 2,
      identityDurable,
      localIdentity,
      replicaDurable,
      replicaResumed,
      commandDurable,
      commandAttemptDurable,
      commandResumed: initialCommands.items.length === 2,
    };
  } catch (error) {
    outcome = {
      ok: false,
      error: error instanceof Error ? error.message : "probe failure",
    };
  }
  // Fetch leaves the original document and its live DB handles intact for crash tests.
  await fetch(
    location.origin +
      "/result?json=" +
      encodeURIComponent(JSON.stringify(outcome)),
  );
})();
