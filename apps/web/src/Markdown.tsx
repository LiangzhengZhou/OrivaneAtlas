import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

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
              <img src={src} alt={alt ?? ""} loading="eager" />
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
