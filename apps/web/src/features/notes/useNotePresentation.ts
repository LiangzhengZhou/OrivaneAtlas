import { useState } from "react";
import {
  type NotePresentation,
  parseNotePresentation,
} from "./note-presentation";

const key = (journal: boolean) =>
  `orivane:note-view:v1:${journal ? "journal" : "notes"}`;
function read(journal: boolean) {
  try {
    return parseNotePresentation(localStorage.getItem(key(journal)), journal);
  } catch {
    return parseNotePresentation(null, journal);
  }
}

/** Only display enums persist. Folded dates stay in this workbench's memory. */
export function useNotePresentation(
  journal: boolean,
): [NotePresentation, (next: NotePresentation) => void] {
  const [preferences, setPreferences] = useState(() => ({
    notes: read(false),
    journal: read(true),
  }));
  const kind = journal ? "journal" : "notes";
  return [
    preferences[kind],
    (next) => {
      setPreferences((old) => ({ ...old, [kind]: next }));
      try {
        const { layout, grouping, sort } = next;
        localStorage.setItem(
          key(journal),
          JSON.stringify({ layout, grouping, sort }),
        );
      } catch {
        // The view remains usable when browser preference storage is unavailable.
      }
    },
  ];
}
