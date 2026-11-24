import { timerElapsedMs, type WorkItem } from "@arclattice/domain";
import { Pause, Play } from "lucide-react";
import { createContext, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import "./task-timer.css";

export type TaskTimerAction = "START" | "PAUSE" | "STOP";
export const TaskTimerContext = createContext<
  ((item: WorkItem, action: TaskTimerAction) => Promise<boolean>) | null
>(null);

export function formatTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

/**
 * A one-second local ticker only while this timer runs; the database stores
 * timestamps on start/pause/stop, never per-second samples.
 */
export function TaskTimerControl({
  item,
  busy,
}: {
  item: WorkItem;
  busy: boolean;
}) {
  const run = useContext(TaskTimerContext);
  const { t } = useTranslation("work");
  const [now, setNow] = useState(Date.now());
  const running = Boolean(item.timerStartedAt);
  useEffect(() => {
    if (!running) return;
    const ticker = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(ticker);
  }, [running]);
  if (
    !run ||
    item.type !== "TASK" ||
    item.status === "DONE" ||
    item.status === "CANCELED" ||
    item.deletedAt
  )
    return null;
  const elapsed = timerElapsedMs(item, now);
  const active = running || elapsed > 0;
  const action = running ? "PAUSE" : "START";
  const label = t(
    running ? "timerPause" : active ? "timerContinue" : "timerStart",
  );
  const Icon = running ? Pause : Play;
  return (
    <span
      className="task-timer"
      data-running={running}
      role="group"
      aria-label={t("timer") + " · " + item.title}
    >
      {active && (
        <span className="task-timer-elapsed" role="timer" aria-live="off">
          {formatTimer(elapsed)}
        </span>
      )}
      <Button
        variant="ghost"
        disabled={busy}
        onClick={() => void run(item, action)}
      >
        <Icon size={14} aria-hidden="true" />
        {label}
      </Button>
    </span>
  );
}
