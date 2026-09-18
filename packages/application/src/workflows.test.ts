import { expect, test } from "vitest";
import { parseProjectPlan } from "./workflows";

test("project sorting and depth are independent of manifest order", () => {
  const projects = Array.from({ length: 16 }, (_, index) => ({
    tempId: `p${index}`,
    title: `Project ${index}`,
    parentTempId: index ? `p${index - 1}` : null,
  }));
  for (const input of [projects, [...projects].reverse()]) {
    expect(
      parseProjectPlan({ version: 1, projects: input }).projects.map(
        (project) => project.tempId,
      ),
    ).toEqual(projects.map((project) => project.tempId));
  }
  projects.push({ tempId: "p16", title: "Too deep", parentTempId: "p15" });
  for (const input of [projects, [...projects].reverse()])
    expect(() => parseProjectPlan({ version: 1, projects: input })).toThrow(
      "VALIDATION_ERROR",
    );
});

test("strict cross-kind identifiers, references and Markdown preservation", () => {
  const base = {
    version: 1,
    projects: [{ tempId: "project", title: "P" }],
    tasks: [
      {
        tempId: "task",
        title: "T",
        projectTempIds: ["project"],
        descriptionMd: "\n# Raw\n\n  ```md\n正文\n```\n",
        activationState: "INACTIVE",
        priority: "URGENT",
        assigneePrincipalId: "human",
      },
    ],
  };
  expect(parseProjectPlan(base).tasks[0]?.descriptionMd).toBe(
    base.tasks[0]!.descriptionMd,
  );
  for (const invalid of [
    { ...base, spaces: [{ tempId: "task", title: "collision" }] },
    { ...base, tasks: [{ ...base.tasks[0], projectTempIds: ["missing"] }] },
    {
      ...base,
      projects: [{ tempId: "project", title: "P", descriptionMd: 12 }],
    },
    {
      ...base,
      documents: [{ tempId: "doc", title: "D", spaceTempId: "project" }],
    },
    {
      ...base,
      recurrences: [
        {
          tempId: "rule",
          title: "R",
          startDate: "2026-09-18",
          endDate: "2026-09-17",
          timezone: "UTC",
          frequency: "DAILY",
          interval: 1,
        },
      ],
    },
    { ...base, tasks: [{ ...base.tasks[0], activationState: "wrong" }] },
  ])
    expect(() => parseProjectPlan(invalid)).toThrow();
  expect(() =>
    parseProjectPlan({
      version: 1,
      projects: [
        { tempId: "a", title: "A", parentTempId: "b" },
        { tempId: "b", title: "B", parentTempId: "a" },
      ],
    }),
  ).toThrow("WORK_GRAPH_CYCLE_DETECTED");
});
