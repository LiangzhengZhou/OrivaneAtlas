import { Annotation, StateEffect, StateField } from "@codemirror/state";

export const externalValue = Annotation.define<boolean>();
export const imageAnchor = StateEffect.define<number | null>();
export const pendingImage = StateField.define<number | null>({
  create: () => null,
  update(position, transaction) {
    if (transaction.annotation(externalValue)) return null;
    let next =
      position === null ? null : transaction.changes.mapPos(position, 1);
    for (const effect of transaction.effects)
      if (effect.is(imageAnchor)) next = effect.value;
    return next;
  },
});
