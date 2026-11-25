import { useMemo } from "react";
import { htmlReadingDocument } from "./htmlNote";

export function HtmlNotePreview({
  source,
  title,
}: {
  source: string;
  title: string;
}) {
  const html = useMemo(() => htmlReadingDocument(source), [source]);
  return (
    <iframe
      className="html-note-preview"
      title={title}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={html}
    />
  );
}
