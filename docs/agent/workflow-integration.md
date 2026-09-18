# Workflow integration — 2026-09-18

Exported from `@arclattice/application` through existing workflows export:

```ts
interface PlanDocumentPublisher {
  publish(context: ActorContext, input: {
    projectId: string;
    title: string;
    bodyMd: string;
    ownership?: "OWNED" | "LINKED";
    provenance?: { planId: string; tempId: string };
  }): Promise<{ id: string }>;
  revision?(context: ActorContext, plan: ParsedPlan): Promise<string>;
  createSpace?(context: ActorContext, input: {
    title: string; descriptionMd: string;
  }): Promise<{ id: string }>;
  publishKnowledgeDocument?(context: ActorContext, input: {
    spaceId: string; projectId: string | null; title: string; bodyMd: string;
    ownership: "OWNED" | "LINKED";
    provenance: { planId: string; tempId: string };
  }): Promise<{ id: string }>;
}
```

Inject as fifth argument of `new WorkflowService(uow, auth, clock, ids, publisher)`.
Every method MUST use the host request's existing SQLite transaction; it must not
commit separately. `revision` validates all existing space/document references
and returns a deterministic version fingerprint; repeat at publish. Optional
space methods are required when those entities occur and otherwise fail closed.
Project-only documents use `publish` and may omit a knowledge space. The host
adapter can call ProjectService.createDocument for those documents.

Host/OpenAPI changes required:

- POST work create / PATCH work: allow `assigneePrincipalId` string|null (1–240).
  Application CreateWorkInput/UpdateWorkInput and actual values are implemented.
  Host should verify the principal belongs to this workspace before accepting it.
- Recurrence input allow `endDate` string|null, `projectIds` string[], `priority`,
  `activationState`, `activationPolicy`, `assigneePrincipalId`. Rule progress
  remains server-owned; validateCalendarRule and defaults reject bad values.
- Manifest preview uses v1 extended arrays `projects`, `categories`, `tasks`,
  `recurrences`, `spaces`, `documents`; no tasks required if other entities exist.
  Each array bounded (projects 64, others 100); Markdown capped at 200000 chars.
- Publish remains explicit creator-bound version-checked operation, no automatic
  publication after model output. Preserve user confirmation in REST/MCP tools.
- No workflow SQL migration needed; PLAN/RECURRENCE/OCCURRENCE JSON retains fields.

The main agent owns host validation, OpenAPI, bootstrap and shared locale files.
