import type { ModelConfiguration } from "@arclattice/application";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Runtime, Snapshot } from "../../bootstrap";
import { ModelBindings } from "./ModelBindings";
import { ModelDefinitions } from "./ModelDefinitions";
import { ModelProfiles } from "./ModelProfiles";
import type { ConfigurationChange } from "./model-settings-types";
import { ProviderConnections } from "./ProviderConnections";
import "./model-settings.css";
export function ModelSettings({
  runtime,
  snapshot,
  onChanged,
  onConfiguration,
}: {
  runtime: Runtime;
  snapshot: Snapshot;
  onChanged(): void;
  onConfiguration?(configuration: ModelConfiguration): void;
}) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const [configuration, setConfiguration] = useState<ModelConfiguration | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    let active = true;
    void runtime
      .modelConfiguration()
      .then((configuration) => {
        if (active) {
          setConfiguration(configuration);
          onConfiguration?.(configuration);
        }
      })
      .catch((failure) => {
        if (active)
          setError(failure instanceof Error ? failure.message : "UNAVAILABLE");
      });
    return () => {
      active = false;
    };
  }, [runtime]);
  const save: ConfigurationChange = async (edit) => {
    if (!configuration || inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const input = edit(configuration);
      const next = await runtime.saveModelConfiguration(
        configuration.version,
        input,
      );
      setConfiguration(next);
      onConfiguration?.(next);
      setSaved(true);
      onChanged();
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "SAVE_FAILED");
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="model-settings">
      {error && (
        <div role="alert">
          {zh
            ? "模型设置操作失败，草稿保留。"
            : "Model settings operation failed; drafts are kept."}{" "}
          <details>
            <summary>{zh ? "技术详情" : "Technical details"}</summary>
            <code>{error}</code>
          </details>
        </div>
      )}
      {saved && (
        <p role="status">{zh ? "模型设置已保存" : "Model settings saved"}</p>
      )}
      {!configuration ? (
        <p>{zh ? "加载模型设置…" : "Loading model settings…"}</p>
      ) : (
        <>
          <ProviderConnections
            configuration={configuration}
            busy={busy}
            zh={zh}
            save={save}
            runtime={runtime}
          />
          <ModelDefinitions
            configuration={configuration}
            busy={busy}
            zh={zh}
            save={save}
          />
          <ModelProfiles
            configuration={configuration}
            busy={busy}
            zh={zh}
            save={save}
          />
          <ModelBindings
            configuration={configuration}
            busy={busy}
            zh={zh}
            save={save}
            snapshot={snapshot}
          />
        </>
      )}
    </div>
  );
}
