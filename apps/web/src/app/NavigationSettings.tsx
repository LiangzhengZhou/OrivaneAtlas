import {
  defaultNavigationPreference,
  type NavigationPreference,
  type NavigationViewId,
} from "@arclattice/domain";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/Button";

export function NavigationSettings({
  preference,
  busy,
  label,
  onSave,
}: {
  preference: NavigationPreference;
  busy: boolean;
  label(id: string): string;
  onSave(value: NavigationPreference): Promise<boolean>;
}) {
  const { t } = useTranslation("desk");
  const [draft, setDraft] = useState(preference);
  const [dragged, setDragged] = useState<NavigationViewId | null>(null);
  const conflict = draft.version !== preference.version;
  function reorder(id: NavigationViewId, delta: number, mobile: boolean) {
    const order = [...(mobile ? draft.mobile.pinned : draft.desktop.order)];
    const index = order.indexOf(id);
    const destination = index + delta;
    if (destination < 0 || destination >= order.length) return;
    order.splice(index, 1);
    order.splice(destination, 0, id);
    setDraft(
      mobile
        ? { ...draft, mobile: { pinned: order } }
        : { ...draft, desktop: { ...draft.desktop, order } },
    );
  }
  return (
    <section className="panel navigation-settings">
      <h2>{t("customizeNavigation")}</h2>
      <h3>{t("desktopNavigation")}</h3>
      {draft.desktop.order.map((id) => (
        <div className="organization-toolbar navigation-reorder-row" key={id}>
          <Button
            type="button"
            className="icon-button navigation-drag-handle"
            draggable={!busy}
            aria-label={label(id)}
            onDragStart={() => setDragged(id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragged) {
                const order = draft.desktop.order;
                reorder(
                  dragged,
                  order.indexOf(id) - order.indexOf(dragged),
                  false,
                );
                setDragged(null);
              }
            }}
            onKeyDown={(event) => {
              if (
                event.altKey &&
                (event.key === "ArrowUp" || event.key === "ArrowDown")
              ) {
                event.preventDefault();
                reorder(id, event.key === "ArrowUp" ? -1 : 1, false);
              }
            }}
          >
            <GripVertical size={16} />
          </Button>
          <span>{label(id)}</span>
          <Button
            type="button"
            className="icon-button"
            disabled={busy}
            aria-label={t("moveUp", { name: label(id) })}
            onClick={() => reorder(id, -1, false)}
          >
            <ChevronUp size={16} />
          </Button>
          <Button
            type="button"
            className="icon-button"
            disabled={busy}
            aria-label={t("moveDown", { name: label(id) })}
            onClick={() => reorder(id, 1, false)}
          >
            <ChevronDown size={16} />
          </Button>
          <label>
            <input
              type="checkbox"
              checked={!draft.desktop.hidden.includes(id)}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  desktop: {
                    ...draft.desktop,
                    hidden: event.target.checked
                      ? draft.desktop.hidden.filter((entry) => entry !== id)
                      : [...draft.desktop.hidden, id],
                    pinned: event.target.checked
                      ? draft.desktop.pinned
                      : draft.desktop.pinned.filter((entry) => entry !== id),
                  },
                })
              }
            />
            {t("showNavigation")}
          </label>
          <label>
            <input
              type="checkbox"
              disabled={draft.desktop.hidden.includes(id)}
              checked={draft.desktop.pinned.includes(id)}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  desktop: {
                    ...draft.desktop,
                    pinned: event.target.checked
                      ? [...draft.desktop.pinned, id]
                      : draft.desktop.pinned.filter((entry) => entry !== id),
                  },
                })
              }
            />
            {t("pinNavigation")}
          </label>
        </div>
      ))}
      <h3>{t("mobileNavigation")}</h3>
      <p>{t("mobileNavigationHint")}</p>
      {draft.mobile.pinned.map((id) => (
        <div className="organization-toolbar navigation-reorder-row" key={id}>
          <Button
            type="button"
            className="icon-button navigation-drag-handle"
            draggable={!busy}
            aria-label={label(id)}
            onDragStart={() => setDragged(id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragged) {
                const order = draft.mobile.pinned;
                reorder(
                  dragged,
                  order.indexOf(id) - order.indexOf(dragged),
                  true,
                );
                setDragged(null);
              }
            }}
            onKeyDown={(event) => {
              if (
                event.altKey &&
                (event.key === "ArrowUp" || event.key === "ArrowDown")
              ) {
                event.preventDefault();
                reorder(id, event.key === "ArrowUp" ? -1 : 1, true);
              }
            }}
          >
            <GripVertical size={16} />
          </Button>
          <span>{label(id)}</span>
          <Button
            type="button"
            className="icon-button"
            disabled={busy}
            aria-label={t("moveUp", { name: label(id) })}
            onClick={() => reorder(id, -1, true)}
          >
            <ChevronUp size={16} />
          </Button>
          <Button
            type="button"
            className="icon-button"
            disabled={busy}
            aria-label={t("moveDown", { name: label(id) })}
            onClick={() => reorder(id, 1, true)}
          >
            <ChevronDown size={16} />
          </Button>
        </div>
      ))}
      {draft.desktop.order.map((id) => (
        <label className="navigation-choice" key={id}>
          <input
            type="checkbox"
            checked={draft.mobile.pinned.includes(id)}
            disabled={
              draft.mobile.pinned.includes(id)
                ? draft.mobile.pinned.length <= 2
                : draft.mobile.pinned.length >= 4
            }
            onChange={(event) =>
              setDraft({
                ...draft,
                mobile: {
                  pinned: event.target.checked
                    ? [...draft.mobile.pinned, id]
                    : draft.mobile.pinned.filter((entry) => entry !== id),
                },
              })
            }
          />
          {label(id)}
        </label>
      ))}
      {conflict && <p role="alert">{t("errors:VERSION_CONFLICT")}</p>}
      <div className="organization-toolbar">
        <Button
          variant="primary"
          type="button"
          className="button primary"
          disabled={busy || conflict}
          onClick={() => void onSave(draft)}
        >
          {t("common:save")}
        </Button>
        <Button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() =>
            setDraft({
              ...defaultNavigationPreference(),
              version: preference.version,
            })
          }
        >
          {t("restoreNavigation")}
        </Button>
      </div>
    </section>
  );
}
