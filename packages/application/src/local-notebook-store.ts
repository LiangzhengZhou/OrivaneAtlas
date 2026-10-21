import type { ActorContext } from "@arclattice/domain";
import type { Clock, IdGenerator } from "./index";
import { LocalMarkdownStore } from "./local-markdown-store";
import type { LocalMutationTransaction } from "./local-mutation-transaction";
import type { Note, NotebookStore } from "./notebook";
import type { WorkspaceChange } from "./workspace-change-log";

export class LocalNotebookStore
  extends LocalMarkdownStore<Note>
  implements NotebookStore
{
  constructor(
    stage: LocalMutationTransaction,
    actor: ActorContext,
    clock: Clock,
    ids: IdGenerator,
    publish: (change: Omit<WorkspaceChange, "seq">) => void,
  ) {
    super(stage, actor, clock, ids, publish, "notes", "note");
  }
}
