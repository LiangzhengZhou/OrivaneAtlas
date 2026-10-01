import type { ReactNode } from "react";

export function InspectorHost({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
}) {
  return (
    <aside className="inspector-host" aria-label={title}>
      <header>
        <strong>{title}</strong>
        <button type="button" className="icon-button" onClick={onClose}>
          ×
        </button>
      </header>
      {children}
    </aside>
  );
}
