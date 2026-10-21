import { useVirtualizer } from "@tanstack/react-virtual";
import { Fragment, type ReactNode, useCallback, useRef } from "react";

export function VirtualTaskCollection<T extends { id: string }>({
  items,
  render,
  board = false,
  virtualizeAfter = board ? 50 : 100,
  estimatedRowHeight = board ? 155 : 96,
  fixedRowHeight = false,
}: {
  items: readonly T[];
  render(item: T): ReactNode;
  board?: boolean;
  virtualizeAfter?: number;
  estimatedRowHeight?: number;
  fixedRowHeight?: boolean;
}) {
  if (items.length <= virtualizeAfter)
    return (
      <>
        {items.map((item) => (
          <Fragment key={item.id}>{render(item)}</Fragment>
        ))}
      </>
    );
  return (
    <VirtualizedTaskCollection
      items={items}
      render={render}
      board={board}
      estimatedRowHeight={estimatedRowHeight}
      fixedRowHeight={fixedRowHeight}
    />
  );
}

function VirtualizedTaskCollection<T extends { id: string }>({
  items,
  render,
  board,
  estimatedRowHeight,
  fixedRowHeight,
}: {
  items: readonly T[];
  render(item: T): ReactNode;
  board: boolean;
  estimatedRowHeight: number;
  fixedRowHeight: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const getScrollElement = useCallback(() => scrollRef.current, []);
  const getItemKey = useCallback((index: number) => items[index]!.id, [items]);
  const estimateSize = useCallback(
    () => estimatedRowHeight,
    [estimatedRowHeight],
  );
  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement,
    getItemKey,
    estimateSize,
    overscan: board ? 4 : 3,
  });
  return (
    <div
      ref={scrollRef}
      className={`virtual-task-scroll ${board ? "virtual-board-scroll" : ""}`}
      data-task-count={items.length}
      data-row-height={fixedRowHeight ? "fixed" : undefined}
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
            ref={fixedRowHeight ? undefined : virtual.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              ...(fixedRowHeight ? { height: estimatedRowHeight } : {}),
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
