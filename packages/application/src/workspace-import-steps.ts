import {
  DomainError,
  manualOrderScopeKey,
  requireEntityMemoRecord,
  requireManualOrderScope,
} from "@arclattice/domain";
import { localObject } from "./local-dto";
import type { LocalJson } from "./local-persistence";
import { requireStableUuid } from "./mutation-receipt";
import type { WorkspaceImportStep } from "./workspace-import";
import type { WorkspaceMergeCopy } from "./workspace-merge-materialize";

const fields = (
  value: ReturnType<typeof localObject>,
  names: readonly string[],
) =>
  Object.fromEntries(
    names
      .filter((name) => value[name] !== undefined)
      .map((name) => [name, value[name]!]),
  ) as Record<string, LocalJson>;

/** Convert detached entity drafts to existing version-checked Application commands. */
export function planWorkspaceImportSteps(
  copiesInput: readonly WorkspaceMergeCopy[],
  identity: {
    readonly sourcePrincipalId: string;
    readonly targetPrincipalId: string;
    readonly deviceId: string;
    readonly targetManualOrders?: readonly {
      readonly id: string;
      readonly version: number;
    }[];
  },
  ids: { next(): string },
): readonly WorkspaceImportStep[] {
  requireStableUuid(identity.deviceId, "deviceId");
  const copies = structuredClone(copiesInput);
  const supported = new Set([
    "categories",
    "items",
    "edges",
    "notes",
    "library",
    "reminders",
    "files",
    "organization",
    "manualOrders",
    "links",
    "projectMaterials",
    "entityMemos",
  ]);
  if (copies.some((copy) => !supported.has(copy.collection)))
    throw new DomainError("VALIDATION_ERROR", {
      field: "workspaceImportCollection",
    });
  const steps: WorkspaceImportStep[] = [],
    used = new Set<string>();
  const created: WorkspaceMergeCopy[] = [];
  const add = (
    copy: WorkspaceMergeCopy,
    path: string,
    payload: LocalJson,
    binary?: WorkspaceImportStep["binary"],
  ) => {
    const id = ids.next();
    requireStableUuid(id);
    if (used.has(id)) throw new DomainError("VALIDATION_ERROR");
    used.add(id);
    const effectCollection =
      path === "/api/memo/save"
        ? "entityMemos"
        : path === "/api/files/register"
          ? "files"
          : path === "/api/link/create"
            ? "links"
            : path === "/api/projects/space/link" ||
                path === "/api/projects/link"
              ? "projectMaterials"
              : null;
    const ownedCreation =
      path === "/api/projects/space/create" ||
      path === "/api/projects/document/create";
    const effects = ownedCreation
      ? [
          {
            collection: "projectMaterials",
            id: localObject(payload).stableMaterialId!,
            op: "UPSERT",
            baseVersion: 0,
          },
          {
            collection: "library",
            id: localObject(payload).stableTargetId!,
            op: "UPSERT",
            baseVersion: 0,
          },
        ]
      : effectCollection
        ? [
            {
              collection: effectCollection,
              id: copy.targetId,
              op: "UPSERT",
              baseVersion: 0,
            },
          ]
        : [];
    steps.push({
      id,
      path,
      payload:
        effects.length > 0
          ? {
              ...localObject(payload),
              syncCommand: {
                commandId: id,
                deviceId: identity.deviceId,
                effects,
              },
            }
          : payload,
      ...(binary ? { binary } : {}),
      source: {
        collection: copy.collection,
        id: copy.sourceId,
        version: copy.sourceVersion,
      },
    });
  };
  const stable = (copy: WorkspaceMergeCopy) => ({
    stableId: requireStableUuid(copy.targetId),
    deviceId: identity.deviceId,
  });
  const values = new Map(
    copies.map((copy) => [copy.targetId, localObject(copy.value)]),
  );
  if (values.size !== copies.length)
    throw new DomainError("VALIDATION_ERROR", {
      field: "workspaceImportIdentity",
    });
  const ownedKnowledge = new Map<string, WorkspaceMergeCopy>();
  for (const copy of copies.filter(
    (entry) => entry.collection === "projectMaterials",
  )) {
    const value = values.get(copy.targetId)!;
    if (
      !["SPACE", "DOCUMENT"].includes(String(value.kind)) ||
      value.ownership !== "OWNED"
    )
      continue;
    const target = copies.find(
      (entry) =>
        entry.collection === "library" && entry.targetId === value.targetId,
    );
    if (
      !target ||
      localObject(target.value).kind !== value.kind ||
      ownedKnowledge.has(target.targetId) ||
      typeof value.projectId !== "string"
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "workspaceImportOwnedKnowledge",
      });
    ownedKnowledge.set(target.targetId, copy);
  }
  const create = (copy: WorkspaceMergeCopy) => {
    const value = values.get(copy.targetId)!;
    switch (copy.collection) {
      case "entityMemos": {
        const memo = requireEntityMemoRecord(value);
        if (
          memo.ownerPrincipalId !== identity.sourcePrincipalId ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
            copy.targetId,
          ) ||
          memo.id !== copy.targetId ||
          memo.deletedAt !== null
        )
          throw new DomainError("FORBIDDEN");
        add(copy, "/api/memo/save", {
          version: 0,
          input: fields(value, ["targetKind", "targetId", "bodyMd"]),
          deleted: false,
        });
        break;
      }
      case "files": {
        if (
          typeof value.originalName !== "string" ||
          typeof value.name !== "string" ||
          typeof value.contentHash !== "string" ||
          !/^[a-f0-9]{64}$/.test(value.contentHash) ||
          typeof value.size !== "number" ||
          !Number.isSafeInteger(value.size) ||
          value.size < 0 ||
          typeof value.mime !== "string"
        )
          throw new DomainError("VALIDATION_ERROR", {
            field: "workspaceImportFile",
          });
        add(
          copy,
          "/api/files/register",
          {
            ...fields(value, [
              "spaceId",
              "parentDocumentId",
              "aiPolicy",
              "mime",
              "size",
              "contentHash",
            ]),
            name: value.originalName,
            ...stable(copy),
          },
          {
            contentHash: value.contentHash,
            size: value.size,
            mime: value.mime,
          },
        );
        if (value.name !== value.originalName)
          add(copy, "/api/files/rename", {
            id: copy.targetId,
            version: 1,
            name: value.name,
          });
        break;
      }
      case "categories":
        add(copy, "/api/categories/save", {
          ...fields(value, ["name", "icon", "color", "position"]),
          version: 0,
          deleted: false,
          ...stable(copy),
        });
        break;
      case "items": {
        if (
          value.executionMode !== undefined &&
          value.executionMode !== "MANUAL"
        )
          throw new DomainError("VALIDATION_ERROR", {
            field: "workspaceImportExecution",
          });
        const input = fields(value, [
          "title",
          "type",
          "priority",
          "descriptionMd",
          "categoryId",
          "parentProjectId",
          "projectIds",
          "startDate",
          "dueDate",
        ]);
        const assignee = value.assigneePrincipalId;
        if (
          assignee !== null &&
          assignee !== undefined &&
          assignee !== identity.sourcePrincipalId
        )
          throw new DomainError("VALIDATION_ERROR", {
            field: "workspaceImportAssignee",
          });
        input.assigneePrincipalId = assignee
          ? identity.targetPrincipalId
          : null;
        // Dependencies and final state are restored only after all new identities exist.
        input.activationState = "INACTIVE";
        input.activationPolicy = "MANUAL";
        if (value.type === "PROJECT") input.lifecycle = "PLANNED";
        add(copy, "/api/work/create", { ...input, ...stable(copy) });
        break;
      }
      case "notes":
      case "library": {
        if (typeof value.bodyMd !== "string")
          throw new DomainError("VALIDATION_ERROR", {
            field: "workspaceImportBody",
          });
        if (
          /\/api\/(?:library\/asset|(?:v1\/)?files\/bytes)\?/.test(value.bodyMd)
        )
          throw new DomainError("VALIDATION_ERROR", {
            field: "workspaceImportBinaryReference",
          });
        const input = fields(
          value,
          copy.collection === "notes"
            ? ["title", "bodyMd", "kind", "day", "aiPolicy"]
            : [
                "title",
                "bodyMd",
                "kind",
                "spaceId",
                "parentDocumentId",
                "aliases",
                "aiPolicy",
              ],
        );
        const owner =
          copy.collection === "library"
            ? ownedKnowledge.get(copy.targetId)
            : undefined;
        if (owner) {
          const binding = values.get(owner.targetId)!;
          if (
            value.kind === "DOCUMENT" &&
            value.provenance !== undefined &&
            value.provenance !== "HUMAN"
          )
            throw new DomainError("VALIDATION_ERROR", {
              field: "workspaceImportProvenance",
            });
          add(
            copy,
            value.kind === "SPACE"
              ? "/api/projects/space/create"
              : "/api/projects/document/create",
            {
              projectId: binding.projectId!,
              title: value.title!,
              ...(value.kind === "SPACE"
                ? fields(binding, ["role", "inheritToChildren"])
                : {
                    spaceId: value.spaceId!,
                    bodyMd: value.bodyMd,
                    ...fields(value, ["aiPolicy"]),
                  }),
              stableMaterialId: requireStableUuid(owner.targetId),
              stableTargetId: requireStableUuid(copy.targetId),
              deviceId: identity.deviceId,
            },
          );
          add(copy, "/api/library/save", {
            id: copy.targetId,
            version: 1,
            input,
          });
          break;
        }
        add(
          copy,
          `/api/${copy.collection === "notes" ? "note" : "library"}/save`,
          {
            id: null,
            version: 0,
            input,
            ...stable(copy),
          },
        );
        break;
      }
      case "reminders":
        add(copy, "/api/reminders/save", {
          id: null,
          version: 0,
          deleted: false,
          ...stable(copy),
          input: fields(value, [
            "title",
            "bodyMd",
            "day",
            "time",
            "timezone",
            "notifyMode",
            "notifyOffsetMinutes",
            "linkedProjectId",
            "linkedTaskId",
            "state",
          ]),
        });
        break;
      case "projectMaterials":
        if (
          value.kind === "DOCUMENT" &&
          value.ownership === "LINKED" &&
          typeof value.projectId === "string" &&
          typeof value.targetId === "string"
        ) {
          if (value.role !== undefined || value.inheritToChildren !== undefined)
            throw new DomainError("VALIDATION_ERROR", {
              field: "workspaceImportDocumentBinding",
            });
          add(copy, "/api/projects/link", {
            projectId: value.projectId,
            targetId: value.targetId,
            stableMaterialId: requireStableUuid(copy.targetId),
            deviceId: identity.deviceId,
          });
          break;
        }
        if (
          ["SPACE", "DOCUMENT"].includes(String(value.kind)) &&
          value.ownership === "OWNED" &&
          ownedKnowledge.get(String(value.targetId))?.targetId === copy.targetId
        )
          break;
        if (
          value.kind !== "SPACE" ||
          value.ownership !== "LINKED" ||
          typeof value.targetId !== "string" ||
          typeof value.projectId !== "string"
        )
          throw new DomainError("VALIDATION_ERROR", {
            field: "workspaceImportProjectMaterial",
          });
        add(copy, "/api/projects/space/link", {
          projectId: value.projectId,
          spaceId: value.targetId,
          ...fields(value, ["role", "inheritToChildren"]),
          stableMaterialId: requireStableUuid(copy.targetId),
          deviceId: identity.deviceId,
        });
        break;
      case "links":
        add(copy, "/api/link/create", {
          ...fields(value, ["from", "to", "relation"]),
          ...stable(copy),
        });
        break;
      case "edges":
        add(copy, "/api/edge/create", {
          ...fields(value, ["fromId", "toId", "type"]),
          ...stable(copy),
        });
        break;
    }
  };
  // Topological creation covers category, project, Space and parent-document references.
  const pending = copies.filter(
    (copy) =>
      (copy.collection === "projectMaterials" &&
        values.get(copy.targetId)!.kind === "SPACE" &&
        values.get(copy.targetId)!.ownership === "LINKED") ||
      ![
        "edges",
        "reminders",
        "organization",
        "manualOrders",
        "links",
        "projectMaterials",
      ].includes(copy.collection),
  );
  const remaining = new Set(pending.map((copy) => copy.targetId));
  const dependencies = (copy: WorkspaceMergeCopy): string[] => {
    const value = values.get(copy.targetId)!;
    const owner = ownedKnowledge.get(copy.targetId),
      binding = owner ? values.get(owner.targetId)! : null;
    const spaceBinding =
      binding && value.kind === "DOCUMENT"
        ? copies.find((entry) => {
            const candidate = values.get(entry.targetId)!;
            return (
              entry.collection === "projectMaterials" &&
              candidate.kind === "SPACE" &&
              candidate.projectId === binding.projectId &&
              candidate.targetId === value.spaceId
            );
          })
        : undefined;
    return [
      value.categoryId,
      value.parentProjectId,
      value.spaceId,
      value.parentDocumentId,
      binding?.projectId,
      spaceBinding?.targetId,
      ...(copy.collection === "projectMaterials"
        ? [value.projectId, value.targetId]
        : []),
      ...(copy.collection === "entityMemos" ? [value.targetId] : []),
      ...(Array.isArray(value.projectIds) ? value.projectIds : []),
    ].filter((id): id is string => typeof id === "string" && remaining.has(id));
  };
  while (pending.length) {
    const index = pending.findIndex((copy) => dependencies(copy).length === 0);
    if (index < 0)
      throw new DomainError("VALIDATION_ERROR", {
        field: "workspaceImportCycle",
      });
    const [copy] = pending.splice(index, 1);
    create(copy!);
    created.push(copy!);
    remaining.delete(copy!.targetId);
  }
  for (const copy of copies.filter(
    (copy) =>
      ["edges", "reminders", "links", "projectMaterials"].includes(
        copy.collection,
      ) && !created.some((entry) => entry.targetId === copy.targetId),
  ))
    create(copy);
  for (const copy of copies.filter(
    (copy) =>
      copy.collection === "items" &&
      values.get(copy.targetId)!.type !== "PROJECT",
  )) {
    const value = values.get(copy.targetId)!;
    add(copy, "/api/work/update", {
      id: copy.targetId,
      version: 1,
      input: fields(value, ["status", "activationState", "activationPolicy"]),
    });
  }
  // Close child projects before parents; Domain retains its ordinary completion checks.
  for (const copy of [...created]
    .reverse()
    .filter(
      (copy) =>
        copy.collection === "items" &&
        values.get(copy.targetId)!.type === "PROJECT",
    )) {
    const value = values.get(copy.targetId)!;
    add(copy, "/api/work/update", {
      id: copy.targetId,
      version: 1,
      input: {
        projectLifecycle: value.lifecycle ?? "PLANNED",
      },
    });
  }
  for (const copy of copies.filter(
    (copy) => copy.collection === "manualOrders",
  )) {
    const value = values.get(copy.targetId)!;
    const scope = requireManualOrderScope(value.scope),
      scopeKey = manualOrderScopeKey(scope);
    if (scopeKey !== copy.targetId || !Array.isArray(value.entries))
      throw new DomainError("VALIDATION_ERROR", {
        field: "workspaceImportManualOrder",
      });
    const entries = value.entries.map((entry) => localObject(entry));
    if (
      entries.some(
        (entry) =>
          typeof entry.entityId !== "string" ||
          typeof entry.position !== "number" ||
          !Number.isSafeInteger(entry.position) ||
          entry.position <= 0,
      ) ||
      new Set(entries.map((entry) => entry.entityId)).size !== entries.length ||
      new Set(entries.map((entry) => entry.position)).size !== entries.length
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "workspaceImportManualOrder",
      });
    if (!entries.length) continue;
    const target = identity.targetManualOrders?.find(
      (entry) => entry.id === scopeKey,
    );
    if (target && (!Number.isSafeInteger(target.version) || target.version < 1))
      throw new DomainError("VALIDATION_ERROR");
    add(copy, "/api/manual-orders/sequence", {
      scope,
      version: target?.version ?? 0,
      orderedEntityIds: entries
        .sort((a, b) => Number(a.position) - Number(b.position))
        .map((entry) => entry.entityId!),
    });
  }
  // Restore organization only after all formal entity state transitions.
  const organizationCopies = copies.filter(
    (copy) => copy.collection === "organization",
  );
  const folderValue = (copy: WorkspaceMergeCopy) => values.get(copy.targetId)!;
  // Parent folders must exist before children and before any note membership.
  const pendingFolders = organizationCopies.filter(
    (copy) => folderValue(copy).kind === "FOLDER",
  );
  const activeFolderIds = new Set<string>();
  const orderedFolders: WorkspaceMergeCopy[] = [];
  for (const copy of pendingFolders) {
    const value = folderValue(copy);
    if (
      typeof value.id !== "string" ||
      !value.id ||
      typeof value.name !== "string" ||
      value.name !== value.name.trim() ||
      !value.name ||
      value.name.length > 80 ||
      /[\x00-\x1f]/.test(value.name) ||
      typeof value.parentId !== "string" ||
      typeof value.archived !== "boolean" ||
      typeof value.folder !== "string" ||
      value.folder !== "" ||
      (value.icon !== undefined && typeof value.icon !== "string")
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "workspaceImportOrganization",
      });
    if (!value.archived) activeFolderIds.add(value.id);
  }
  const remainingFolders = pendingFolders.filter(
    (copy) => !folderValue(copy).archived,
  );
  const emittedFolders = new Set<string>();
  while (remainingFolders.length) {
    const index = remainingFolders.findIndex((copy) => {
      const parentId = String(folderValue(copy).parentId);
      return parentId === "" || emittedFolders.has(parentId);
    });
    if (index < 0)
      throw new DomainError("VALIDATION_ERROR", {
        field: "workspaceImportOrganization",
      });
    const [folder] = remainingFolders.splice(index, 1);
    const value = folderValue(folder!);
    if (value.parentId !== "" && !activeFolderIds.has(String(value.parentId)))
      throw new DomainError("VALIDATION_ERROR", {
        field: "workspaceImportOrganization",
      });
    orderedFolders.push(folder!);
    emittedFolders.add(String(value.id));
  }
  for (const copy of orderedFolders) {
    const value = folderValue(copy);
    const id = String(value.id);
    add(copy, "/api/organize", {
      kind: "FOLDER",
      action: "create",
      id,
      name: String(value.name),
      parentId: String(value.parentId),
    });
    if (typeof value.icon === "string" && value.icon)
      add(copy, "/api/organize", {
        kind: "FOLDER",
        action: "icon",
        icon: value.icon,
        entries: [
          {
            id,
            version: 1,
            organizationVersion: 1,
          },
        ],
      });
  }
  for (const copy of organizationCopies) {
    const value = folderValue(copy);
    if (value.kind === "FOLDER") continue;
    if (
      (value.kind !== "WORK" && value.kind !== "NOTE") ||
      typeof value.id !== "string" ||
      typeof value.archived !== "boolean" ||
      typeof value.folder !== "string" ||
      (value.folderId !== undefined && typeof value.folderId !== "string") ||
      (value.icon !== undefined && typeof value.icon !== "string")
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "workspaceImportOrganization",
      });
    const entity = copies.find(
      (entry) =>
        entry.targetId === value.id &&
        entry.collection === (value.kind === "WORK" ? "items" : "notes"),
    );
    if (
      !entity ||
      (value.kind === "WORK" && value.folder !== "") ||
      (value.kind === "NOTE" && value.archived)
    )
      throw new DomainError("VALIDATION_ERROR", {
        field: "workspaceImportOrganizationTarget",
      });
    // Newly copied Work receives its final-state update; Notes have one save.
    const version = value.kind === "WORK" ? 2 : 1;
    if (value.kind === "WORK" && value.archived)
      add(copy, "/api/organize", {
        kind: "WORK",
        action: "archive",
        entries: [{ id: value.id, version, organizationVersion: 0 }],
      });
    if (value.kind === "NOTE") {
      let organizationVersion = 0;
      if (typeof value.folderId === "string" && value.folderId) {
        if (!emittedFolders.has(value.folderId))
          throw new DomainError("VALIDATION_ERROR", {
            field: "workspaceImportOrganizationTarget",
          });
        add(copy, "/api/organize", {
          kind: "NOTE",
          action: "move",
          folderId: value.folderId,
          entries: [{ id: value.id, version, organizationVersion: 0 }],
        });
        organizationVersion = 1;
      } else if (value.folder !== "") {
        add(copy, "/api/organize", {
          kind: "NOTE",
          action: "move",
          folder: value.folder,
          entries: [{ id: value.id, version, organizationVersion: 0 }],
        });
        organizationVersion = 1;
      }
      if (typeof value.icon === "string" && value.icon)
        add(copy, "/api/organize", {
          kind: "NOTE",
          action: "icon",
          icon: value.icon,
          entries: [
            {
              id: value.id,
              version,
              organizationVersion,
            },
          ],
        });
    }
  }
  return steps;
}
