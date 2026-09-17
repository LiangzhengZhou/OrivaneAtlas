export * from "./agent";
export * from "./data-policy";
export * from "./governance";
export * from "./projects";
export * from "./recurrence";

export type PrincipalKind = "USER" | "AGENT" | "SERVICE";
export interface Principal {
  readonly id: string;
  readonly kind: PrincipalKind;
  readonly displayName: string;
}
export interface Workspace {
  readonly id: string;
  readonly name: string;
}
export interface ActorContext {
  readonly workspaceId: string;
  readonly principalId: string;
}
export const workTypes = [
  "GOAL",
  "PROJECT",
  "EPIC",
  "TASK",
  "MILESTONE",
  "DECISION",
  "AI_JOB",
  "REMINDER",
] as const;
export type WorkType = (typeof workTypes)[number];
export const workStatuses = [
  "TODO",
  "IN_PROGRESS",
  "DONE",
  "CANCELED",
] as const;
export type WorkStatus = (typeof workStatuses)[number];
export const activationStates = ["ACTIVE", "INACTIVE", "SCHEDULED"] as const;
export type ActivationState = (typeof activationStates)[number];
export const activationPolicies = [
  "MANUAL",
  "IMMEDIATE",
  "WHEN_DEPENDENCIES_COMPLETED",
  "AT_SCHEDULED_TIME",
] as const;
export type ActivationPolicy = (typeof activationPolicies)[number];
export const priorities = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type Priority = (typeof priorities)[number];
export type ExecutionMode = "MANUAL" | "AI" | "AUTOMATIC" | "HYBRID";
export interface WorkItem {
  readonly id: string;
  readonly workspaceId: string;
  readonly type: WorkType;
  readonly title: string;
  readonly descriptionMd: string;
  readonly status: WorkStatus;
  readonly priority: Priority;
  readonly executionMode: ExecutionMode;
  readonly assigneePrincipalId: string | null;
  readonly projectId: string | null;
  readonly projectIds?: readonly string[];
  readonly activationState: ActivationState;
  readonly activationPolicy: ActivationPolicy;
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly version: number;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly deletedAt: string | null;
}
/** Scheduled eligibility is read-only; callers supply the UTC calendar date. */
export function isExecutionActive(item: WorkItem, today?: string): boolean {
  return item.activationPolicy === "AT_SCHEDULED_TIME"
    ? !!today && !!item.startDate && item.startDate <= today
    : item.activationState === "ACTIVE";
}
export function isGloballyActiveTask(item: WorkItem, today?: string): boolean {
  return (
    item.type === "TASK" &&
    isExecutionActive(item, today) &&
    item.status !== "DONE" &&
    item.status !== "CANCELED" &&
    !item.deletedAt
  );
}
export function planningTasks(items: readonly WorkItem[]): WorkItem[] {
  return items.filter((item) => item.type === "TASK" && !item.deletedAt);
}
export const edgeTypes = [
  "BLOCKS",
  "REQUIRES",
  "CONTAINS",
  "RELATED",
  "PRODUCES",
  "DERIVED_FROM",
] as const;
export type EdgeType = (typeof edgeTypes)[number];
export interface WorkEdge {
  readonly id: string;
  readonly workspaceId: string;
  readonly fromId: string;
  readonly toId: string;
  readonly type: EdgeType;
  readonly createdBy: string;
  readonly createdAt: string;
}
export type ErrorCode =
  | "RATE_LIMITED"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VERSION_CONFLICT"
  | "WORK_GRAPH_CYCLE_DETECTED"
  | "DUPLICATE_EDGE"
  | "WORK_ITEM_BLOCKED"
  | "DEPENDENCY_EXISTS";
export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly params: Readonly<Record<string, string | number>> = {},
  ) {
    super(code);
    this.name = "DomainError";
  }
}
export function requireTitle(title: string): string {
  const value = title.trim();
  if (
    !value ||
    value.length > 240 ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    throw new DomainError("VALIDATION_ERROR", { field: "title" });
  return value;
}
/** Calendar-only date. Do not convert a user's date through their timezone. */
export function requireDate(value: string | null): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < "0001-01-01" ||
    !Number.isFinite(Date.parse(value + "T00:00:00Z")) ||
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value
  )
    throw new DomainError("VALIDATION_ERROR", { field: "date" });
  return value;
}
export function validateSchedule(
  startDate: string | null,
  dueDate: string | null,
): void {
  requireDate(startDate);
  requireDate(dueDate);
  if (startDate && dueDate && startDate > dueDate)
    throw new DomainError("VALIDATION_ERROR", { field: "dateRange" });
}
export function requireMember<T extends string>(
  value: T,
  allowed: readonly T[],
  field: string,
): T {
  if (!allowed.includes(value))
    throw new DomainError("VALIDATION_ERROR", { field });
  return value;
}
/** Normalized scheduling direction is always prerequisite -> dependent. */
export function dependency(edge: WorkEdge): readonly [string, string] | null {
  if (edge.type === "BLOCKS") return [edge.fromId, edge.toId];
  if (edge.type === "REQUIRES") return [edge.toId, edge.fromId];
  return null;
}
export function validateEdge(
  candidate: WorkEdge,
  items: readonly WorkItem[],
  edges: readonly WorkEdge[],
): void {
  requireMember(candidate.type, edgeTypes, "edgeType");
  const active = items.filter(
    (item) => item.workspaceId === candidate.workspaceId && !item.deletedAt,
  );
  if (
    ![candidate.fromId, candidate.toId].every((id) =>
      active.some((item) => item.id === id),
    )
  ) {
    throw new DomainError("NOT_FOUND");
  }
  if (candidate.fromId === candidate.toId)
    throw new DomainError("WORK_GRAPH_CYCLE_DETECTED");
  const scoped = edges.filter(
    (edge) => edge.workspaceId === candidate.workspaceId,
  );
  const pair = dependency(candidate);
  if (
    scoped.some((edge) => {
      const existing = dependency(edge);
      return (
        (edge.type === candidate.type &&
          edge.fromId === candidate.fromId &&
          edge.toId === candidate.toId) ||
        (pair && existing && pair[0] === existing[0] && pair[1] === existing[1])
      );
    })
  )
    throw new DomainError("DUPLICATE_EDGE");
  if (!pair) return;
  const [source, target] = pair;
  const adjacency = new Map<string, string[]>();
  for (const edge of scoped) {
    const link = dependency(edge);
    if (link)
      adjacency.set(link[0], [...(adjacency.get(link[0]) ?? []), link[1]]);
  }
  const pending = [target];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    if (current === source) throw new DomainError("WORK_GRAPH_CYCLE_DETECTED");
    visited.add(current);
    pending.push(...(adjacency.get(current) ?? []));
  }
}
export function blockers(
  item: WorkItem,
  items: readonly WorkItem[],
  edges: readonly WorkEdge[],
): string[] {
  const scoped = new Map(
    items
      .filter(
        (other) => other.workspaceId === item.workspaceId && !other.deletedAt,
      )
      .map((other) => [other.id, other]),
  );
  return edges
    .filter((edge) => edge.workspaceId === item.workspaceId)
    .flatMap((edge) => {
      const pair = dependency(edge);
      return pair &&
        pair[1] === item.id &&
        scoped.get(pair[0])?.status !== "DONE"
        ? [pair[0]]
        : [];
    });
}
export function isReady(
  item: WorkItem,
  items: readonly WorkItem[],
  edges: readonly WorkEdge[],
  today?: string,
): boolean {
  return (
    !item.deletedAt &&
    isExecutionActive(item, today) &&
    item.status === "TODO" &&
    blockers(item, items, edges).length === 0
  );
}
