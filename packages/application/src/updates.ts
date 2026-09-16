/** Device software lifecycle, separate from workspace data and server credentials. */
export interface AppUpdateInfo {
  currentVersion: string;
  version: string | null;
  notes: string;
  channel: "stable";
}
export interface AppUpdateProgress {
  downloaded: number;
  total?: number | null;
}
export interface AppUpdates {
  available: boolean;
  check(): Promise<AppUpdateInfo>;
  install(
    version: string,
    progress: (value: AppUpdateProgress) => void,
  ): Promise<void>;
}
