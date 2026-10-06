import type { WorkspaceNote as Note } from "@arclattice/application";
import type { ActorContext, WorkItem } from "@arclattice/domain";
import type { LocalePreference } from "@arclattice/i18n";
import { Download, LogOut } from "lucide-react";
import { type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { AppUpdater } from "../../AppUpdater";
import type { Runtime, Snapshot } from "../../bootstrap";
import { CalendarSettings } from "../../CalendarSettings";
import { KnowledgeView } from "../../ConnectedViews";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Surfaces";
import { DensitySettings } from "../../DensitySettings";
import type { DocumentRequest } from "../../DocumentWorkspace";
import { AiSettingsView } from "../../features/ai/AiSettingsView";
import { ThemeSettings } from "../../ThemeSettings";
import { downloadText } from "../../utils/download";
import { NavigationSettings } from "../NavigationSettings";
import { NotificationSettings } from "../NotificationSettings";

interface Props {
  notifications: Parameters<typeof NotificationSettings>[0]["notifications"];
  active: boolean;
  context: ActorContext;
  runtime: Runtime;
  snapshot: Snapshot;
  busy: boolean;
  day: string;
  preference: LocalePreference;
  switchLanguage(preference: LocalePreference): Promise<void>;
  navigation: ComponentProps<typeof NavigationSettings>;
  calendar: ComponentProps<typeof CalendarSettings>;
  run(action: () => Promise<unknown>): Promise<boolean>;
  onNote(note: Note): void;
  onWork(item: WorkItem): void;
  openDocument(request: DocumentRequest): void;
  onLogout(): void;
}
export function SettingsRoute({
  active,
  notifications,
  context,
  runtime,
  snapshot,
  busy,
  day,
  preference,
  switchLanguage,
  navigation,
  calendar,
  run,
  onNote,
  onWork,
  openDocument,
  onLogout,
}: Props) {
  const { t, i18n } = useTranslation("desk");
  const zh = i18n.language.startsWith("zh");
  return (
    <div className="settings-page settings-panel" hidden={!active}>
      <section>
        <h2>{zh ? "外观" : "Appearance"}</h2>
        <DensitySettings actor={context} controls={active} />
        <ThemeSettings controls={active} />{" "}
        <section>
          <h2>{t("settings:language")}</h2>
          <p>{t("settings:languageHint")}</p>
          <label className="field">
            <span>{t("settings:language")}</span>
            <Select
              aria-label={t("settings:language")}
              value={preference}
              onChange={(event) =>
                void switchLanguage(event.target.value as LocalePreference)
              }
            >
              <option value="system">{t("settings:system")}</option>
              <option value="en-US">English</option>
              <option value="zh-CN">简体中文</option>
            </Select>
          </label>
        </section>
      </section>
      {active && (
        <>
          <section className="panel">
            <h2>Atlas</h2>
            <AiSettingsView runtime={runtime} snapshot={snapshot} />
          </section>
          <NavigationSettings
            {...navigation}
            key={navigation.preference.version}
          />
          <CalendarSettings {...calendar} />
          <NotificationSettings notifications={notifications} />
          <AppUpdater updates={runtime.updates} />

          <section>
            <h2>{t("dataControl")}</h2>
            {runtime.account?.role === "USER" ? (
              <p>{t("spaces:backupAdmin")}</p>
            ) : (
              <>
                <p>{t("backupHint")}</p>
                <Button
                  variant="primary"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const blob = await runtime.backup();
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = "arclattice-" + day + ".sqlite";
                      link.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    })
                  }
                >
                  <Download size={17} />
                  {t("backupDatabase")}
                </Button>
              </>
            )}
            <p>{t("exportHint")}</p>
            <Button
              variant="secondary"
              type="button"
              onClick={() =>
                downloadText(
                  "arclattice-" + day + ".json",
                  JSON.stringify(
                    {
                      format: "arclattice-workbench-snapshot",
                      version: 1,
                      exportedAt: new Date().toISOString(),
                      ...snapshot,
                    },
                    null,
                    2,
                  ),
                  "application/json",
                )
              }
            >
              <Download size={17} />
              {t("exportData")}
            </Button>
          </section>
          <section>
            <h2>{t("protected")}</h2>
            <p>{t("scope")}</p>
            <Button
              variant="secondary"
              type="button"
              disabled={busy}
              onClick={onLogout}
            >
              <LogOut size={17} />
              {t("lock")}
            </Button>
          </section>
          <details className="advanced-relations">
            <summary>
              {i18n.language.startsWith("zh")
                ? "高级关系"
                : "Advanced relations"}
            </summary>
            <KnowledgeView
              runtime={runtime}
              snapshot={snapshot}
              busy={false}
              onLink={(from, to, relation) =>
                run(() => runtime.link(from, to, relation))
              }
              onUnlink={(link) =>
                run(() => runtime.unlink(link.id, link.version))
              }
              onOpen={(ref) => {
                if (ref.kind === "NOTE") {
                  const note = snapshot.notes.find((n) => n.id === ref.id);
                  if (note) onNote(note);
                } else if (ref.kind === "SPACE" || ref.kind === "DOCUMENT") {
                  const entity = snapshot.library.find((e) => e.id === ref.id);
                  if (entity)
                    openDocument({
                      key: entity.id,
                      kind: entity.kind,
                      entity,
                      spaceId: entity.spaceId,
                    });
                } else {
                  const item = snapshot.items.find((i) => i.id === ref.id);
                  if (item) onWork(item);
                }
              }}
            />
          </details>
        </>
      )}
    </div>
  );
}
