import { type Dispatch, type SetStateAction, useRef, useState } from "react";

/** Retain each feature's view preferences across unmount/navigation, in memory only. */
export function useViewState<T>(
  key: string,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>, (target: string, value: T) => void] {
  const values = useRef(new Map<string, T>());
  const [, render] = useState(0);
  if (!values.current.has(key))
    values.current.set(
      key,
      typeof initial === "function" ? (initial as () => T)() : initial,
    );
  const value = values.current.get(key)!;
  const setValue: Dispatch<SetStateAction<T>> = (next) => {
    const previous = values.current.get(key)!;
    const updated =
      typeof next === "function" ? (next as (value: T) => T)(previous) : next;
    if (Object.is(previous, updated)) return;
    values.current.set(key, updated);
    render((revision) => revision + 1);
  };
  return [
    value,
    setValue,
    (target, next) => {
      values.current.set(target, next);
      render((revision) => revision + 1);
    },
  ];
}
