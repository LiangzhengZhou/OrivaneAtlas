import { useVirtualizer } from "@tanstack/react-virtual";
import { type ReactNode, useRef } from "react";

export function VirtualTaskCollection<T extends { id: string }>({
  items,
  render,
  board = false,
}: {
  items: readonly T[];
  render(item: T): ReactNode;
  board?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const threshold = board ? 50 : 100;
  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => items[index]!.id,
    estimateSize: () => (board ? 155 : 96),
    overscan: 6,
    enabled: items.length > threshold,
  });
  if (items.length <= threshold)
    return (
      <>
        {items.map((item) => (
          <div key={item.id}>{render(item)}</div>
        ))}
      </>
    );
  return (
    <div
      ref={scrollRef}
      className={`virtual-task-scroll ${board ? "virtual-board-scroll" : ""}`}
      data-task-count={items.length}
    >
      <div
        style={{
          height: virtual.getTotalSize(),
          position: "relative",
          width: "100%",
        }}
      >
        {virtual.getVirtualItems().map((row) => (
          <div
            key={row.key}
            data-index={row.index}
            ref={virtual.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${row.start}px)`,
            }}
          >
            {render(items[row.index]!)}
          </div>
        ))}
      </div>
    </div>
  );
}
