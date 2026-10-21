import type { ReactNode } from "react";
import { createContext, useContext } from "react";

export const FileLinkContext = createContext<((id: string) => boolean) | null>(
  null,
);
export function FileLink({
  id,
  href,
  children,
}: {
  id: string;
  href: string;
  children: ReactNode;
}) {
  const open = useContext(FileLinkContext);
  return (
    <a
      href={href}
      onClick={(event) => {
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        )
          return;
        if (open?.(id)) event.preventDefault();
      }}
    >
      {children}
    </a>
  );
}
