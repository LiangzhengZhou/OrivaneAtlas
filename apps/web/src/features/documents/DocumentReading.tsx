import { memo, type RefObject, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Markdown } from "../../Markdown";

function readingScroller(element: HTMLElement) {
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    if (
      /^(auto|scroll)$/.test(getComputedStyle(parent).overflowY) &&
      parent.scrollHeight > parent.clientHeight
    )
      return parent;
  }
  return document.scrollingElement ?? document.documentElement;
}

export const DocumentReading = memo(function DocumentReading({
  text,
  title,
  active,
  readMode,
  position,
  zh,
}: {
  text: string;
  title: string;
  active: boolean;
  readMode: boolean;
  position: RefObject<number | null>;
  zh: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [headings, setHeadings] = useState<
    { element: HTMLElement; path: string }[]
  >([]);
  const [selected, setSelected] = useState("");
  useLayoutEffect(() => {
    if (!active || !root.current) return;
    const entries = Array.from(
      root.current.querySelectorAll<HTMLElement>(
        ".markdown :is(h1,h2,h3,h4,h5,h6)",
      ),
    ).filter((heading) => heading.textContent?.trim());
    const ancestors: { level: number; title: string }[] = [];
    setHeadings(
      entries.map((element) => {
        const level = Number(element.tagName.slice(1));
        while (
          ancestors.length &&
          ancestors[ancestors.length - 1]!.level >= level
        )
          ancestors.pop();
        ancestors.push({ level, title: element.textContent!.trim() });
        return {
          element,
          path: ancestors.map((entry) => entry.title).join(" › "),
        };
      }),
    );
    setSelected("");
  }, [active, text]);
  useLayoutEffect(() => {
    if (!active || !root.current) return;
    const content = root.current.querySelector<HTMLElement>(".markdown");
    if (!content) return;
    const scroller = readingScroller(root.current);
    // The outline and surrounding toolbar may reflow when a tab is reactivated.
    // Keep the same text at the viewport edge after that layout has settled.
    if (position.current !== null)
      scroller.scrollTop +=
        content.getBoundingClientRect().top - position.current;
    const target = scroller === document.scrollingElement ? window : scroller;
    const remember = () => {
      position.current = content.getBoundingClientRect().top;
    };
    target.addEventListener("scroll", remember, { passive: true });
    return () => target.removeEventListener("scroll", remember);
  }, [active, position, headings]);

  function goToHeading() {
    const heading = headings[Number(selected)]?.element;
    if (selected === "" || !heading || !root.current?.contains(heading)) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: "start", behavior: "instant" });
  }
  return (
    <div
      ref={root}
      className={"document-reading " + (readMode ? "" : "print-only")}
    >
      <h1 className="print-only">{title}</h1>
      {active && headings.length > 1 && (
        <nav
          className="document-outline no-print"
          aria-label={zh ? "文档目录" : "Document contents"}
        >
          <label>
            {zh ? "目录" : "Contents"}
            <select
              value={selected}
              onChange={(event) => setSelected(event.currentTarget.value)}
            >
              <option value="">{zh ? "选择章节" : "Choose a heading"}</option>
              {headings.map((heading, index) => (
                <option key={index} value={index}>
                  {heading.path}
                </option>
              ))}
            </select>
          </label>
          <Button disabled={selected === ""} onClick={goToHeading}>
            {zh ? "前往章节" : "Go to heading"}
          </Button>
        </nav>
      )}
      <Markdown text={text} />
    </div>
  );
});
