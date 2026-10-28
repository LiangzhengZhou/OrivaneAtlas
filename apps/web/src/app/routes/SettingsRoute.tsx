import type { WorkspaceNote as Note } from "@arclattice/application";
import type { ActorContext, WorkItem } from "@arclattice/domain";
import type { LocalePreference } from "@arclattice/i18n";
import {
  Bell,
  CalendarDays,
  Download,
  KeyRound,
  LogOut,
  Palette,
  PanelsTopLeft,
  Server,
  Settings2,
} from "lucide-react";
import { type ComponentProps, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppUpdater } from "../../AppUpdater";
import type { Runtime, Snapshot } from "../../bootstrap";
import { CalendarSettings } from "../../CalendarSettings";
import { KnowledgeView } from "../../ConnectedViews";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Surfaces";
import { DensitySettings } from "../../DensitySettings";
import type { DocumentRequest } from "../../DocumentWorkspace";
import { ThemeSettings } from "../../ThemeSettings";
import { downloadText } from "../../utils/download";
import { NavigationSettings } from "../NavigationSettings";
import { NotificationSettings } from "../NotificationSettings";
import { ServerConnectionTest } from "../ServerConnectionTest";
import "./settings-route.css";

interface Props {
  notifications: Parameters<typeof NotificationSettings>[0]["notifications"];
  notificationCenter: Parameters<typeof NotificationSettings>[0]["center"];
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
  onOpenAccount(): void;
}
export function SettingsRoute({
  active,
  notifications,
  notificationCenter,
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
  onOpenAccount,
}: Props) {
  const { t, i18n } = useTranslation("desk");
  const zh = i18n.language.startsWith("zh");
  const content = useRef<HTMLDivElement>(null);
  const [advancedOpen, setAdvancedOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth > 760,
  );
  const groups: {
    label: string;
    items: {
      id: string;
      label: string;
      icon: typeof Palette;
      onOpen?: boolean;
    }[];
  }[] = [
    {
      label: zh ? "通用" : "General",
      items: [
        {
          id: "appearance",
          label: zh ? "外观与语言" : "Appearance & language",
          icon: Palette,
        },
        {
          id: "navigation",
          label: zh ? "导航" : "Navigation",
          icon: PanelsTopLeft,
        },
        {
          id: "calendar",
          label: zh ? "日历" : "Calendar",
          icon: CalendarDays,
        },
        {
          id: "notifications",
          label: zh ? "通知" : "Notifications",
          icon: Bell,
        },
      ],
    },
    {
      label: zh ? "工作区" : "Workspace",
      items: [
        {
          id: "server",
          label: zh ? "服务器连通性" : "Server connectivity",
          icon: Server,
        },
        {
          id: "updates",
          label: zh ? "应用更新" : "App updates",
          icon: Download,
        },
        {
          id: "data",
          label: zh ? "数据与备份" : "Data & backup",
          icon: Settings2,
        },
      ],
    },
    {
      label: zh ? "账户与 API" : "Account & API",
      items: [
        {
          id: "session",
          label: zh ? "登录会话" : "Session",
          icon: LogOut,
        },
        {
          id: "account-api",
          label: zh ? "账户、API 与模型" : "Account, API & models",
          icon: KeyRound,
          onOpen: true,
        },
      ],
    },
  ];
  return (
    <div className="settings-layout" hidden={!active}>
      <nav
        className="settings-navigation"
        aria-label={zh ? "设置分区" : "Settings sections"}
      >
        {groups.map((group) => (
          <div className="settings-nav-group" key={group.label}>
            <p className="settings-nav-group-label">{group.label}</p>
            {group.items.map(({ id, label, icon: Icon, onOpen }) => (
              <Button
                key={id}
                variant="ghost"
                type="button"
                onClick={() => {
                  if (onOpen) {
                    onOpenAccount();
                    return;
                  }
                  const target = content.current?.querySelector<HTMLElement>(
                    `[data-settings-section="${id}"]`,
                  );
                  const advanced = target?.closest<HTMLDetailsElement>(
                    "details.settings-advanced",
                  );
                  if (advanced && !advanced.open) {
                    advanced.open = true;
                    setAdvancedOpen(true);
                  }
                  target?.scrollIntoView({ block: "start" });
                  target?.focus({ preventScroll: true });
                }}
              >
                <Icon size={17} />
                <span>{label}</span>
              </Button>
            ))}
          </div>
        ))}
      </nav>
      <div className="settings-page settings-panel" ref={content}>
        <section data-settings-section="appearance" tabIndex={-1}>
          <h2>{zh ? "外观" : "Appearance"}</h2>
          <DensitySettings actor={context} controls={active} />
          <ThemeSettings controls={active} />{" "}
          <section>
            <h2>{t("settings:language")}</h2>
            <p>{t("settings:languageHint")}</p>
            <label className="field">
              <span>{zh ? "界面语言" : "Interface language"}</span>
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
            <section data-settings-section="server" tabIndex={-1}>
              <ServerConnectionTest runtime={runtime} />
            </section>
            <div data-settings-section="calendar" tabIndex={-1}>
              <CalendarSettings {...calendar} />
            </div>
            <div data-settings-section="notifications" tabIndex={-1}>
              <NotificationSettings
                notifications={notifications}
                center={notificationCenter}
              />
            </div>
            <div data-settings-section="updates" tabIndex={-1}>
              <AppUpdater updates={runtime.updates} />
            </div>

            <section data-settings-section="data" tabIndex={-1}>
              <h2>{t("dataControl")}</h2>
              {runtime.storageMode !== "local" &&
              runtime.account?.role === "USER" ? (
                <p>{t("spaces:backupAdmin")}</p>
              ) : (
                <>
                  <p>
                    {t(
                      runtime.storageMode === "local"
                        ? "localBackupHint"
                        : "backupHint",
                    )}
                  </p>
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
                        link.download = "orivane-atlas-" + day + ".oab";
                        link.click();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                      })
                    }
                  >
                    <Download size={17} />
                    {t(
                      runtime.storageMode === "local"
                        ? "localBackup"
                        : "backupDatabase",
                    )}
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
            <section data-settings-section="session" tabIndex={-1}>
              <h2>{zh ? "登录会话" : "Session"}</h2>
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
            <details
              className="settings-advanced"
              open={advancedOpen}
              onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
            >
              <summary>
                <span>{zh ? "高级设置" : "Advanced settings"}</span>
                <small>
                  {zh
                    ? "自定义导航与高级关系"
                    : "Custom navigation and advanced relations"}
                </small>
              </summary>
              <div className="settings-advanced-body">
                <div data-settings-section="navigation" tabIndex={-1}>
                  <NavigationSettings
                    {...navigation}
                    key={navigation.preference.version}
                  />
                </div>
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
                        const note = snapshot.notes.find(
                          (n) => n.id === ref.id,
                        );
                        if (note) onNote(note);
                      } else if (
                        ref.kind === "SPACE" ||
                        ref.kind === "DOCUMENT"
                      ) {
                        const entity = snapshot.library.find(
                          (e) => e.id === ref.id,
                        );
                        if (entity)
                          openDocument({
                            key: entity.id,
                            kind: entity.kind,
                            entity,
                            spaceId: entity.spaceId,
                          });
                      } else {
                        const item = snapshot.items.find(
                          (i) => i.id === ref.id,
                        );
                        if (item) onWork(item);
                      }
                    }}
                  />
                </details>
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
