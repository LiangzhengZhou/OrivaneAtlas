import { createContext, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { ImageLoadError } from "./imageResponse";
import "katex/dist/katex.min.css";

export const PrivateImageContext = createContext<
  ((path: string) => Promise<Blob>) | null
>(null);
function PrivateImage({ src, alt }: { src: string; alt: string }) {
  const load = useContext(PrivateImageContext);
  const { t } = useTranslation("spaces");
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<{ path: string; code: string } | null>(
    null,
  );
  const [resolved, setResolved] = useState<{
    path: string;
    url: string;
  } | null>(null);
  useEffect(() => {
    setFailure(null);
    setResolved(null);
    if (!load) return;
    let active = true;
    let url = "";
    void load(src)
      .then((blob) => {
        if (!active) return;
        url = URL.createObjectURL(blob);
        setResolved({ path: src, url });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const code = error instanceof ImageLoadError ? error.code : "request";
        setFailure({ path: src, code });
        console.warn("Private image load failed", {
          stage: "load",
          code,
          ...(error instanceof ImageLoadError ? { status: error.status } : {}),
        });
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [load, src, attempt]);
  const url = load ? (resolved?.path === src ? resolved.url : "") : src;
  if (failure?.path === src)
    return (
      <span className="private-image-error" role="status">
        {t(
          failure.code === "access"
            ? "imageAccessFailed"
            : failure.code === "missing"
              ? "imageMissing"
              : "imageLoadFailed",
        )}
        {alt ? ` (${alt})` : ""}{" "}
        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={() => setAttempt((value) => value + 1)}
        >
          {t("imageRetry")}
        </button>
      </span>
    );
  return url ? (
    <img
      key={`${url}:${attempt}`}
      src={url}
      alt={alt}
      loading="eager"
      onError={() => {
        setFailure({ path: src, code: "decode" });
        console.warn("Private image load failed", {
          stage: "decode",
          code: "decode",
        });
      }}
    />
  ) : (
    <span role="status">{t("imageLoading")}</span>
  );
}

// Keep renderer identities stable. Inline component functions remount images on
// every parent update, revoking Blob URLs and restarting authenticated requests.
const markdownComponents: Components = {
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
};

// No raw HTML, external images or executable links. User Markdown remains unchanged.
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: "ignore", trust: false }]]}
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
