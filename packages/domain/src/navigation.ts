import { DomainError } from "./index";

export const navigationViews = [
  "overview",
  "tasks",
  "projects",
  "focus",
  "calendar",
  "notes",
  "journal",
  "library",
  "knowledge",
  "ai",
  "dependencies",
  "account",
  "admin",
  "trash",
] as const;
export type NavigationViewId = (typeof navigationViews)[number];
export interface NavigationPreference {
  readonly version: number;
  readonly desktop: {
    readonly order: readonly NavigationViewId[];
    readonly hidden: readonly NavigationViewId[];
    readonly pinned: readonly NavigationViewId[];
  };
  readonly mobile: { readonly pinned: readonly NavigationViewId[] };
}
export function defaultNavigationPreference(): NavigationPreference {
  return {
    version: 0,
    desktop: { order: [...navigationViews], hidden: [], pinned: [] },
    mobile: { pinned: ["tasks", "projects", "calendar", "notes"] },
  };
}
export function normalizeNavigationPreference(
  value: NavigationPreference,
): NavigationPreference {
  const valid = (values: readonly NavigationViewId[]) => [
    ...new Set(values.filter((entry) => navigationViews.includes(entry))),
  ];
  const mobile = valid(value.mobile.pinned);
  for (const entry of navigationViews) {
    if (mobile.length >= 2) break;
    if (!mobile.includes(entry)) mobile.push(entry);
  }
  const order = valid(value.desktop.order);
  return {
    ...value,
    desktop: {
      order: [
        ...order,
        ...navigationViews.filter((entry) => !order.includes(entry)),
      ],
      hidden: valid(value.desktop.hidden),
      pinned: valid(value.desktop.pinned),
    },
    mobile: { pinned: mobile.slice(0, 4) },
  };
}
export function requireNavigationPreference(value: NavigationPreference): void {
  const validList = (list: unknown): list is NavigationViewId[] =>
    Array.isArray(list) &&
    list.length <= navigationViews.length &&
    new Set(list).size === list.length &&
    list.every((entry) => navigationViews.includes(entry));
  if (
    !value ||
    !Number.isSafeInteger(value.version) ||
    value.version < 0 ||
    !validList(value.desktop?.order) ||
    value.desktop.order.length !== navigationViews.length ||
    !validList(value.desktop.hidden) ||
    !validList(value.desktop.pinned) ||
    value.desktop.pinned.some((entry) =>
      value.desktop.hidden.includes(entry),
    ) ||
    !validList(value.mobile?.pinned) ||
    value.mobile.pinned.length < 2 ||
    value.mobile.pinned.length > 4
  )
    throw new DomainError("VALIDATION_ERROR", {
      field: "navigationPreference",
    });
}
