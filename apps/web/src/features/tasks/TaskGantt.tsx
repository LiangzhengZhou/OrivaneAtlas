import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEntitySelection } from "../../app/EntitySelection";
import { Button, SegmentedControl, Toolbar } from "../../components/ui/Button";
import { ListRow } from "../../components/ui/Content";
import type { WorkProps } from "../../WorkViews";
import { ganttDate, ganttLayout } from "./gantt-layout";
import "./task-gantt.css";

export function TaskGantt({ items, today, onOpen }: WorkProps) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith("zh");
  const selection = useEntitySelection();
  const [zoom, setZoom] = useState<"week" | "month">("week");
  const [viewport, setViewport] = useState({ left: 0, width: 900 });
  const scroll = useRef<HTMLDivElement>(null);
  const model = useMemo(() => ganttLayout(items, today), [items, today]);
  const dayWidth = zoom === "week" ? 32 : 12;
  const titleWidth = 220,
    axisWidth = model.days * dayWidth;
  const virtual = useVirtualizer({
    count: model.rows.length,
    getScrollElement: () => scroll.current,
    getItemKey: (index) => model.rows[index]!.task.id,
    estimateSize: () => 48,
    overscan: 8,
  });
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setViewport((previous) => ({ ...previous, width: element.clientWidth })),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const cadence = zoom === "week" ? 2 : 7;
  const firstTick = Math.max(
    0,
    Math.floor((viewport.left - titleWidth) / dayWidth / cadence) * cadence,
  );
  const lastTick = Math.min(
    model.days - 1,
    Math.ceil((viewport.left + viewport.width) / dayWidth),
  );
  const ticks = [];
  for (let offset = firstTick; offset <= lastTick; offset += cadence)
    ticks.push(offset);
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
      }),
    [i18n.language],
  );
  const todayLeft = (model.today - model.start) * dayWidth + dayWidth / 2;
  return (
    <section
      className="task-gantt"
      aria-label={zh ? "项目甘特图" : "Project Gantt"}
    >
      <Toolbar>
        <SegmentedControl<"week" | "month">
          label={zh ? "时间缩放" : "Time zoom"}
          value={zoom}
          options={[
            { value: "week", label: zh ? "周" : "Week" },
            { value: "month", label: zh ? "月" : "Month" },
          ]}
          onChange={setZoom}
        />
        <Button
          variant="ghost"
          onClick={() =>
            scroll.current?.scrollTo({
              left: Math.max(0, todayLeft - 180),
              behavior: "smooth",
            })
          }
        >
          {zh ? "今天" : "Today"}
        </Button>
      </Toolbar>
      <div
        className="gantt-scroll"
        ref={scroll}
        data-task-count={model.rows.length}
        onScroll={(event) => {
          const left = event.currentTarget.scrollLeft;
          setViewport((previous) =>
            previous.left === left ? previous : { ...previous, left },
          );
        }}
      >
        <div
          className="gantt-sheet"
          style={
            {
              width: titleWidth + axisWidth,
              minWidth: "100%",
              "--gantt-day-width": `${dayWidth}px`,
            } as React.CSSProperties
          }
        >
          <header className="gantt-axis">
            <div className="gantt-task-heading">{zh ? "任务" : "Task"}</div>
            <div className="gantt-time-heading" style={{ width: axisWidth }}>
              {ticks.map((offset) => (
                <time
                  key={offset}
                  dateTime={ganttDate(model.start + offset)}
                  style={{ left: offset * dayWidth }}
                >
                  {formatter.format(
                    new Date(ganttDate(model.start + offset) + "T00:00:00Z"),
                  )}
                </time>
              ))}
              <span
                className="gantt-today-line"
                style={{ left: todayLeft }}
                title={today}
              />
            </div>
          </header>
          <div
            className="gantt-body"
            style={{ height: virtual.getTotalSize() }}
          >
            <span
              className="gantt-today-line"
              style={{ left: titleWidth + todayLeft }}
              aria-label={zh ? "今日线" : "Today line"}
            />
            {virtual.getVirtualItems().map((row) => {
              const entry = model.rows[row.index]!,
                task = entry.task;
              return (
                <div
                  className="gantt-row"
                  key={row.key}
                  data-task-id={task.id}
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  <ListRow
                    className="gantt-task-title"
                    aria-label={task.title}
                    selected={
                      selection?.selected?.kind === "WORK" &&
                      selection.selected.id === task.id
                    }
                    onSelect={() =>
                      selection?.select({ kind: "WORK", id: task.id })
                    }
                    onOpen={() => onOpen(task)}
                  >
                    {task.title}
                  </ListRow>
                  <div className="gantt-track" style={{ width: axisWidth }}>
                    {entry.unscheduled ? (
                      <span className="gantt-unscheduled">
                        {zh ? "未排期" : "Unscheduled"}
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        className={`gantt-bar ${entry.milestone ? "gantt-milestone" : ""} ${task.status === "DONE" ? "gantt-completed" : ""}`}
                        aria-label={`${task.title}: ${task.startDate ?? ""} → ${task.dueDate ?? ""}`}
                        title={`${task.startDate ?? "—"} → ${task.dueDate ?? "—"}`}
                        style={{
                          left: (entry.from! - model.start) * dayWidth,
                          width: entry.milestone
                            ? 12
                            : Math.max(
                                12,
                                (entry.to! - entry.from! + 1) * dayWidth,
                              ),
                        }}
                        onClick={() =>
                          selection?.select({ kind: "WORK", id: task.id })
                        }
                        onDoubleClick={() => onOpen(task)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            onOpen(task);
                          }
                        }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {!items.length && (
        <p className="muted">{zh ? "暂无任务" : "No tasks yet"}</p>
      )}
    </section>
  );
}
