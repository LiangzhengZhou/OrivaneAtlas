import { expect, it } from "vitest";
import { validateLocalCanonicalWorkflowValue } from "./local-canonical-workflow";
import { localDto } from "./local-dto";
import { parseProjectPlan } from "./workflows";

const parsed = parseProjectPlan({
  version: 1,
  tasks: [
    {
      tempId: "task",
      title: "T",
      descriptionMd: "第一行\n第二行",
      dependsOn: [],
    },
  ],
});
const record = {
  id: "plan",
  workspaceId: "remote",
  version: 1,
  createdBy: "owner",
  updatedBy: "owner",
  createdAt: "2026-10-14T00:00:00Z",
  updatedAt: "2026-10-14T00:00:00Z",
  deletedAt: null,
  payload: {
    kind: "PLAN",
    origin: "HUMAN",
    projectId: null,
    ...parsed,
    baseRevision: JSON.stringify({ categories: [], items: [], edges: [] }),
    documentRevision: "",
    policy: "manifest-v1",
    published: false,
    result: {},
    provenance: [],
  },
};
it("accepts formal PLAN previews without accepting incomplete or foreign workflow payloads", () => {
  expect(() =>
    validateLocalCanonicalWorkflowValue("plan", "remote", 1, localDto(record)),
  ).not.toThrow();
  for (const altered of [
    { ...record, workspaceId: "foreign" },
    { ...record, payload: { ...record.payload, baseRevision: "not-json" } },
    {
      ...record,
      payload: { ...record.payload, result: { task: "unreviewed-task" } },
    },
    { ...record, payload: { ...record.payload, policy: "arbitrary" } },
    { ...record, payload: { kind: "PLAN" } },
  ])
    expect(() =>
      validateLocalCanonicalWorkflowValue(
        "plan",
        "remote",
        1,
        localDto(altered),
      ),
    ).toThrow();
});
it("requires complete published result and human confirmation provenance", () => {
  const published = {
    ...record,
    version: 2,
    payload: {
      ...record.payload,
      published: true,
      result: { task: "stable-task" },
      provenance: [
        {
          taskId: "stable-task",
          fields: ["title", "descriptionMd"],
          source: "IMPORTED",
          confirmedBy: "owner",
          confirmedAt: "2026-10-14T00:01:00Z",
        },
      ],
    },
  };
  expect(() =>
    validateLocalCanonicalWorkflowValue(
      "plan",
      "remote",
      2,
      localDto(published),
    ),
  ).not.toThrow();
  expect(() =>
    validateLocalCanonicalWorkflowValue(
      "plan",
      "remote",
      2,
      localDto({
        ...published,
        payload: { ...published.payload, provenance: [] },
      }),
    ),
  ).toThrow();
});
