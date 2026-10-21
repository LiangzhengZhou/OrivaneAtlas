import { type ActorContext, DomainError } from "@arclattice/domain";
import type { LocalCommandPlan } from "./local-command-plan";
import type { LocalWikiIndexer } from "./local-library-store";
import type {
  LocalMetadataStore,
  LocalMutation,
  LocalSyncState,
} from "./local-persistence";
import { prepareLocalWorkReplayAcknowledgement } from "./local-work-replay-ack";

/** Shared exact receipt/scope/attempt checks with body-aware canonical projection. */
export function prepareLocalKnowledgeReplayAcknowledgement(
  actor: ActorContext,
  binding: LocalSyncState,
  plan: LocalCommandPlan,
  receipt: unknown,
  pending: readonly LocalMutation[],
  metadata: LocalMetadataStore,
  wiki: LocalWikiIndexer,
) {
  if (!binding.remotePrincipalId) throw new DomainError("FORBIDDEN");
  return prepareLocalWorkReplayAcknowledgement(
    actor,
    binding,
    plan,
    receipt,
    pending,
    metadata,
    wiki,
  );
}
