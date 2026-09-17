import { createContext, useContext, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

export const PrivateImageContext = createContext<
  ((path: string) => Promise<Blob>) | null
>(null);
function PrivateImage({ src, alt }: { src: string; alt: string }) {
  const load = useContext(PrivateImageContext);
  const [resolved, setResolved] = useState<{
    path: string;
    url: string;
  } | null>(null);
  useEffect(() => {
    if (!load) return;
    let active = true;
    let url = "";
    void load(src)
      .then((blob) => {
        if (!active) return;
        url = URL.createObjectURL(blob);
        setResolved({ path: src, url });
      })
      .catch(() => {
        if (active) setResolved(null);
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [load, src]);
  const url = load ? (resolved?.path === src ? resolved.url : "") : src;
  return url ? <img src={url} alt={alt} loading="eager" /> : <span>{alt}</span>;
}

// No raw HTML, external images or executable links. User Markdown remains unchanged.
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: "ignore", trust: false }]]}
        components={{
          img: ({ src, alt }) =>
            typeof src === "string" &&
            /^\/api\/library\/asset\?id=[a-zA-Z0-9-]+$/.test(src) ? (
              <PrivateImage src={src} alt={alt ?? ""} />
            ) : (
              <span>{alt}</span>
            ),
          a: ({ href, children }) =>
            href && /^(https?:\/\/|#)/.test(href) ? (
              <a href={href} rel="noreferrer noopener" target="_blank">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
