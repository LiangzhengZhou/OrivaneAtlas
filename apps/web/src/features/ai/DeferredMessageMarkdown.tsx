import {
  createContext,
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Markdown } from "../../Markdown";

export function createMessageMarkdownViewport() {
  const subscriptions = new Map<Element, () => void>();
  let observer: IntersectionObserver | null = null;
  return {
    observe(element: Element, ready: () => void) {
      observer ??= new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            subscriptions.get(entry.target)?.();
            subscriptions.delete(entry.target);
            observer?.unobserve(entry.target);
          }
        },
        {
          root: element.closest(".conversation-messages"),
          rootMargin: "240px 0px",
        },
      );
      subscriptions.set(element, ready);
      observer.observe(element);
      return () => {
        subscriptions.delete(element);
        observer?.unobserve(element);
      };
    },
    dispose() {
      observer?.disconnect();
      observer = null;
      subscriptions.clear();
    },
  };
}
export const MessageMarkdownViewportContext = createContext<ReturnType<
  typeof createMessageMarkdownViewport
> | null>(null);

/** Keep loaded text accessible; parse offscreen history only as it approaches view. */
export const DeferredMessageMarkdown = memo(function DeferredMessageMarkdown({
  text,
  onLayout,
}: {
  text: string;
  onLayout(): void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const sharedViewport = useContext(MessageMarkdownViewportContext);
  const viewport = useMemo(
    () => sharedViewport ?? createMessageMarkdownViewport(),
    [sharedViewport],
  );
  useEffect(() => {
    if (!sharedViewport) return () => viewport.dispose();
  }, [sharedViewport, viewport]);
  const [ready, setReady] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    if (ready || !element.current) return;
    return viewport.observe(element.current, () => setReady(true));
  }, [ready, viewport]);
  useLayoutEffect(() => {
    if (ready) onLayout();
  }, [ready, text, onLayout]);
  return (
    <div ref={element} data-markdown-ready={ready}>
      {ready ? (
        <Markdown text={text} />
      ) : (
        <div
          aria-busy="true"
          style={{
            minHeight: Math.min(
              320,
              Math.max(56, text.split("\n").length * 24),
            ),
          }}
        >
          <span
            style={{
              position: "absolute",
              width: 1,
              height: 1,
              overflow: "hidden",
              clipPath: "inset(50%)",
            }}
          >
            {text}
          </span>
        </div>
      )}
    </div>
  );
});
