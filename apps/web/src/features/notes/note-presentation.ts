export const noteLayouts = ["list", "small", "medium", "large"] as const;
export const journalGroupings = [
  "none",
  "year",
  "month",
  "week",
  "day",
] as const;
export type NoteLayout = (typeof noteLayouts)[number];
export type JournalGrouping = (typeof journalGroupings)[number];
export type NoteSort = "updated" | "title" | "day";
export type NotePresentation = {
  layout: NoteLayout;
  grouping: JournalGrouping;
  sort: NoteSort;
  collapsed: string[];
};

/** Calendar dates are identities, not instants in the reader's timezone. */
function calendarDate(day: string | null | undefined): Date | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === day
    ? date
    : null;
}

export function journalGroupKey(
  day: string | null | undefined,
  grouping: JournalGrouping,
): string {
  if (grouping === "none") return "all";
  const date = calendarDate(day);
  if (!date) return "undated";
  if (grouping === "year") return day!.slice(0, 4);
  if (grouping === "month") return day!.slice(0, 7);
  if (grouping === "week") {
    // Monday through Sunday, including weeks that cross a month/year boundary.
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return date.toISOString().slice(0, 10);
  }
  return day!;
}

export function journalGroupLabel(
  key: string,
  grouping: JournalGrouping,
  locale: string,
): string {
  const date = calendarDate(
    key.length === 4 ? `${key}-01-01` : key.length === 7 ? `${key}-01` : key,
  );
  if (!date) return key;
  const format = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    year: "numeric",
    ...(grouping !== "year" ? ({ month: "long" } as const) : {}),
    ...(grouping === "week" || grouping === "day"
      ? ({ day: "numeric" } as const)
      : {}),
    ...(grouping === "day" ? ({ weekday: "short" } as const) : {}),
  });
  if (grouping !== "week") return format.format(date);
  const end = new Date(date);
  end.setUTCDate(end.getUTCDate() + 6);
  return format.formatRange(date, end);
}

export function groupJournalEntries<T extends { day?: string | null }>(
  entries: readonly T[],
  grouping: JournalGrouping,
) {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const key = journalGroupKey(entry.day, grouping);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return [...groups].sort(([a], [b]) =>
    a === "undated" ? 1 : b === "undated" ? -1 : b.localeCompare(a),
  );
}

export function parseNotePresentation(
  value: string | null,
  journal: boolean,
): NotePresentation {
  const defaults: NotePresentation = {
    layout: "list",
    grouping: journal ? "month" : "none",
    sort: journal ? "day" : "updated",
    collapsed: [],
  };
  try {
    const parsed = JSON.parse(value ?? "null");
    if (!parsed || typeof parsed !== "object") return defaults;
    return {
      layout: noteLayouts.includes(parsed.layout)
        ? parsed.layout
        : defaults.layout,
      grouping:
        journal && journalGroupings.includes(parsed.grouping)
          ? parsed.grouping
          : defaults.grouping,
      sort: ["updated", "title", ...(journal ? ["day"] : [])].includes(
        parsed.sort,
      )
        ? parsed.sort
        : defaults.sort,
      collapsed: [],
    };
  } catch {
    return defaults;
  }
}
