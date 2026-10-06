import { useLayoutEffect, useRef } from "react";

/** Save page and virtual-list scroll separately for each feature route. */
export function useViewScroll(key: string, ready: boolean) {
  const positions = useRef(
    new Map<string, { page: number; lists: number[] }>(),
  );
  useLayoutEffect(() => {
    if (!ready) return;
    const previous = positions.current.get(key);
    const lists = () => [
      ...document.querySelectorAll<HTMLElement>(
        ".content .virtual-task-scroll",
      ),
    ];
    const restore = window.requestAnimationFrame(() => {
      if (!previous) return;
      window.scrollTo({ top: previous.page, behavior: "instant" });
      lists().forEach((list, index) => {
        list.scrollTop = previous.lists[index] ?? 0;
      });
    });
    const save = () =>
      positions.current.set(key, {
        page: window.scrollY,
        lists: lists().map((list) => list.scrollTop),
      });
    document.addEventListener("scroll", save, true);
    return () => {
      window.cancelAnimationFrame(restore);
      document.removeEventListener("scroll", save, true);
    };
  }, [key, ready]);
}
