import { type ActorContext, DomainError } from "@arclattice/domain";
import type { AgentRun, EntityRef, ModelPort, ModelRoute } from "./connected";
import type { GatewayPolicy } from "./gateway-policy";

export interface PersonalModelInput {
  gateway?: GatewayPolicy;
  profileId?: string;
  scope: string;
  endpoint: string;
  protocol: "chat" | "responses";
  model: string;
  key: string;
  maxRunsPerDay: number;
}
export interface PersonalModelSummary extends Omit<PersonalModelInput, "key"> {
  version: number;
  route: ModelRoute;
}
/** Private host port. Keys must never enter entity storage, receipts or public responses. */
export interface PersonalModelVault {
  list(actor: ActorContext): PersonalModelSummary[];
  save(
    actor: ActorContext,
    version: number,
    input: PersonalModelInput,
  ): PersonalModelSummary;
  remove(
    actor: ActorContext,
    scope: string,
    version: number,
    profileId?: string,
  ): void;
  resolve(
    actor: ActorContext,
    scope: string,
    profileId?: string,
  ): ModelPort | null;
}

export interface AiTextEdit {
  kind: EntityRef["kind"];
  id: string;
  version: number;
  title: string;
  bodyMd: string;
}
/** Model output is untrusted data. Only exact, approved, versioned document targets are eligible. */
export function parseAiTextEdits(run: AgentRun): AiTextEdit[] {
  if (run.status !== "SUCCEEDED" || run.appliedAt || !run.output) return [];
  try {
    const json = JSON.parse(run.output);
    if (
      !json ||
      Object.keys(json).join(",") !== "edits" ||
      !Array.isArray(json.edits) ||
      json.edits.length > 20
    )
      return [];
    const seen = new Set<string>();
    for (const edit of json.edits) {
      if (
        !edit ||
        typeof edit !== "object" ||
        Object.keys(edit).sort().join(",") !== "bodyMd,id,kind,title,version" ||
        !["NOTE", "SPACE", "DOCUMENT"].includes(edit.kind) ||
        typeof edit.id !== "string" ||
        typeof edit.title !== "string" ||
        !edit.title.trim() ||
        edit.title.length > 240 ||
        typeof edit.bodyMd !== "string" ||
        edit.bodyMd.length > 200000 ||
        !Number.isInteger(edit.version) ||
        !run.context?.some(
          (c) =>
            c.ref.kind === edit.kind &&
            c.ref.id === edit.id &&
            c.version === edit.version,
        ) ||
        seen.has(edit.kind + ":" + edit.id)
      )
        throw new DomainError("VALIDATION_ERROR");
      seen.add(edit.kind + ":" + edit.id);
    }
    return json.edits;
  } catch {
    return [];
  }
}
