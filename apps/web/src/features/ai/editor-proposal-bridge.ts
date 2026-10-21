import type {
  EditorProposal,
  EditorProposalService,
  EditorSource,
} from "@arclattice/application";
import type { ActorContext } from "@arclattice/domain";
import type { EditorState, Text, TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export interface CapturedEditorSource {
  source: EditorSource;
  document: Text;
}
export type ReviewedEditorProposal = CapturedEditorSource & {
  proposal: EditorProposal;
};
export interface EditorProposalView {
  readonly state: EditorState;
  dispatch(spec: TransactionSpec): void;
  focus(): void;
}

/** A cursor/selection change is local preview only; callers explicitly send. */
export function captureEditorSource(
  view: Pick<EditorView, "state">,
  identity: Pick<EditorSource, "workspaceId" | "documentId" | "version">,
): CapturedEditorSource {
  const { doc, selection } = view.state;
  const main = selection.main;
  const line = doc.lineAt(main.head);
  let from = main.empty ? line.from : main.from;
  let to = main.empty ? line.to : main.to;
  if (main.empty && line.text.trim()) {
    for (let number = line.number - 1; number > 0; number--) {
      const previous = doc.line(number);
      if (!previous.text.trim() || to - previous.from > 12000) break;
      from = previous.from;
    }
    for (let number = line.number + 1; number <= doc.lines; number++) {
      const next = doc.line(number);
      if (!next.text.trim() || next.to - from > 12000) break;
      to = next.to;
    }
  }
  return {
    document: doc,
    source: { ...identity, from, to, sourceText: doc.sliceString(from, to) },
  };
}

/** Review is asynchronous; recheck the live CodeMirror document AFTER it resolves.
 * Never replace React body state or silently relocate an obsolete range. */
export async function applyEditorProposal(
  view: EditorProposalView,
  actor: ActorContext,
  service: EditorProposalService,
  captured: ReviewedEditorProposal,
  identity: Pick<EditorSource, "workspaceId" | "documentId" | "version">,
) {
  if (view.state.doc !== captured.document) throw new Error("VERSION_CONFLICT");
  const current: EditorSource = {
    ...identity,
    from: captured.source.from,
    to: captured.source.to,
    sourceText: view.state.doc.sliceString(
      captured.source.from,
      captured.source.to,
    ),
  };
  const change = await service.review(actor, captured.proposal, current);
  if (view.state.doc !== captured.document) throw new Error("VERSION_CONFLICT");
  view.dispatch({
    changes: change,
    selection: { anchor: change.from + change.insert.length },
    userEvent: "input.atlas",
  });
  view.focus();
}
