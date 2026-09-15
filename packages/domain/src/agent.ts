import type { ExecutionLocation } from "./data-policy";
import {
  checkGovernanceEntities,
  type GovernanceEntity,
  type GovernanceRef,
  type GovernanceResult,
  governanceResult,
  isNonBlank,
} from "./governance";

export const agentPolicyKinds = [
  "ACCESS",
  "DATA",
  "RUNTIME",
  "MODEL",
  "BUDGET",
  "APPROVAL",
] as const;
export type AgentPolicyKind = (typeof agentPolicyKinds)[number];

export interface AgentDefinition extends GovernanceEntity {
  readonly name: string;
  readonly description: string | null;
  readonly runtimeType: string;
  readonly capabilities: readonly string[];
  /** Null is unconfigured, never unrestricted; all six required before a run. */
  readonly policies: Readonly<Record<AgentPolicyKind, GovernanceRef | null>>;
  readonly createdByPrincipalId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Contract only: no instance lifecycle, identity provisioning or scheduler yet. */
export interface AgentInstance extends GovernanceEntity {
  readonly definition: GovernanceRef;
  readonly principalId: string;
  readonly status: "IDLE" | "BUSY" | "OFFLINE" | "FAILED";
  readonly executionLocation: ExecutionLocation;
  readonly runtimeRef: string | null;
  readonly createdAt: string;
  readonly lastSeenAt: string | null;
}

export interface AgentConnection extends GovernanceEntity {
  readonly sourceAgentDefinitionId: string;
  readonly sourceAgentDefinitionVersion: number;
  readonly targetAgentDefinitionId: string;
  readonly targetAgentDefinitionVersion: number;
  readonly canDelegate: boolean;
  readonly acceptsDelegation: boolean;
  readonly interactive: boolean;
  readonly scopes: readonly string[];
  readonly enabled: boolean;
  readonly createdByPrincipalId: string;
}

export interface DelegationRequest {
  readonly workspaceId: string;
  readonly source: AgentDefinition;
  readonly target: AgentDefinition;
  readonly connection: AgentConnection | null;
  readonly scopes: readonly string[];
  readonly interactive: boolean;
}

/** Topology gate only: does not authenticate an actor or authorize a tool/run. */
export function evaluateDelegation(
  request: DelegationRequest,
): GovernanceResult {
  const { workspaceId, source, target, connection, scopes, interactive } =
    request;
  const entities = checkGovernanceEntities(workspaceId, [
    source,
    target,
    ...(connection ? [connection] : []),
  ]);
  if (entities.decision === "BLOCK") return entities;
  if (
    scopes.length === 0 ||
    !scopes.every(isNonBlank) ||
    typeof interactive !== "boolean"
  )
    return governanceResult("BLOCK", "INVALID_POLICY_INPUT");
  if (!connection) return governanceResult("BLOCK", "CONNECTION_REQUIRED");
  if (source.id === target.id)
    return governanceResult("BLOCK", "SELF_DELEGATION_DENIED");
  if (
    connection.sourceAgentDefinitionId !== source.id ||
    connection.targetAgentDefinitionId !== target.id
  )
    return governanceResult("BLOCK", "CONNECTION_ENDPOINT_MISMATCH");
  if (
    connection.sourceAgentDefinitionVersion !== source.version ||
    connection.targetAgentDefinitionVersion !== target.version
  )
    return governanceResult("BLOCK", "CONNECTION_VERSION_MISMATCH");
  if (
    connection.enabled !== true ||
    connection.canDelegate !== true ||
    connection.acceptsDelegation !== true
  )
    return governanceResult("BLOCK", "DELEGATION_DISABLED");
  if (interactive && connection.interactive !== true)
    return governanceResult("BLOCK", "INTERACTIVE_DELEGATION_DISABLED");
  if (
    !connection.scopes.every(isNonBlank) ||
    !scopes.every((scope) => connection.scopes.includes(scope))
  )
    return governanceResult("BLOCK", "DELEGATION_SCOPE_DENIED");
  return governanceResult("ALLOW");
}
