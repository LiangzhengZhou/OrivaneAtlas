import type { ActorContext } from "@arclattice/domain";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "./density.css";

export type InterfaceDensity = "comfortable" | "compact";
export function densityStorageKey(
  actor: Pick<ActorContext, "workspaceId" | "principalId">,
) {
  return `arclattice:density:${JSON.stringify([actor.workspaceId, actor.principalId])}`;
}
export function readDensity(key: string): InterfaceDensity {
  try {
    return localStorage.getItem(key) === "compact" ? "compact" : "comfortable";
  } catch {
    return "comfortable";
  }
}
export function DensitySettings({
  actor,
  controls = true,
}: {
  actor: ActorContext;
  controls?: boolean;
}) {
  const { i18n } = useTranslation("desk");
  const key = densityStorageKey(actor);
  const [preference, setPreference] = useState(() => ({
    key,
    value: readDensity(key),
  }));
  const density = preference.key === key ? preference.value : readDensity(key);
  useEffect(() => {
    document.documentElement.dataset.density = density;
    return () => {
      delete document.documentElement.dataset.density;
    };
  }, [density, key]);
  const chinese = i18n.language.startsWith("zh");
  if (!controls) return null;
  return (
    <label className="density-settings">
      {chinese ? "界面密度" : "Interface density"}
      <select
        value={density}
        onChange={(event) => {
          const value: InterfaceDensity =
            event.target.value === "compact" ? "compact" : "comfortable";
          try {
            localStorage.setItem(key, value);
          } catch {}
          setPreference({ key, value });
        }}
      >
        <option value="comfortable">{chinese ? "舒适" : "Comfortable"}</option>
        <option value="compact">{chinese ? "紧凑" : "Compact"}</option>
      </select>
    </label>
  );
}
