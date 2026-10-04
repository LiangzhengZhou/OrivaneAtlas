import type { ReactNode } from "react";
import { Button } from "../components/ui/Button";

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
        <Button type="button" className="icon-button" onClick={onClose}>
          ×
        </Button>
      </header>
      {children}
    </aside>
  );
}
