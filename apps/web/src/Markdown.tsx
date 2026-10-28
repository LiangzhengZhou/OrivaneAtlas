import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { urlAttributes } from "html-url-attributes";
import {
  createContext,
  Fragment,
  memo,
  useContext,
  useEffect,
  useState,
} from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { useTranslation } from "react-i18next";
import { type Components, defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { Button } from "./components/ui/Button";
import { ImageViewer } from "./features/documents/ImageViewer";
import { FileLink } from "./features/files/FileLinkContext";
import { parseFileHash } from "./features/files/fileRoute";
import { ImageLoadError, imageFailureReason } from "./imageResponse";
import { holdPrivateImage, invalidatePrivateImage } from "./privateImageCache";
import "katex/dist/katex.min.css";

export const PrivateImageContext = createContext<
  ((path: string) => Promise<Blob>) | null
>(null);
function PrivateImage({ src, alt }: { src: string; alt: string }) {
  const load = useContext(PrivateImageContext);
  const { t, i18n } = useTranslation("spaces");
  const imageLabel = alt || (i18n.language.startsWith("zh") ? "图片" : "Image");
  const [attempt, setAttempt] = useState(0);
  const [viewing, setViewing] = useState(false);
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
    const held = holdPrivateImage(load, src);
    void held.promise
      .then((url) => {
        if (!active) return;
        setResolved({ path: src, url });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const code = error instanceof ImageLoadError ? error.code : "request";
        setFailure({ path: src, code });
        console.warn("Private image load failed", {
          stage: "load",
          code,
          reason: imageFailureReason(error),
          ...(error instanceof ImageLoadError ? { status: error.status } : {}),
        });
      });
    return () => {
      active = false;
      held.release();
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
        <Button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={() => {
            if (load) invalidatePrivateImage(load, src);
            setAttempt((value) => value + 1);
          }}
        >
          {t("imageRetry")}
        </Button>
      </span>
    );
  return url ? (
    <>
      <img
        key={`${url}:${attempt}`}
        src={url}
        alt={alt}
        loading="eager"
        tabIndex={0}
        role="button"
        aria-label={imageLabel}
        onClick={() => setViewing(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            setViewing(true);
          }
        }}
        onError={() => {
          setFailure({ path: src, code: "decode" });
          console.warn("Private image load failed", {
            stage: "decode",
            code: "decode",
          });
        }}
      />
      {viewing && (
        <ImageViewer
          src={url}
          alt={imageLabel}
          onClose={() => setViewing(false)}
        />
      )}
    </>
  ) : (
    <span role="status">{t("imageLoading")}</span>
  );
}

// Keep renderer identities stable. Inline component functions remount images on
// every parent update, revoking Blob URLs and restarting authenticated requests.
const markdownComponents: Components = {
  img: ({ src, alt }) =>
    typeof src === "string" &&
    /^\/api\/(?:library\/asset|v1\/files\/bytes)\?id=[a-zA-Z0-9-]+$/.test(
      src,
    ) ? (
      <PrivateImage src={src} alt={alt ?? ""} />
    ) : (
      <span>{alt}</span>
    ),
  a: ({ href, children }) => {
    const fileId = href ? parseFileHash(href) : null;
    return fileId && href ? (
      <FileLink id={fileId} href={href}>
        {children}
      </FileLink>
    ) : href && /^(https?:\/\/|#)/.test(href) ? (
      <a href={href} rel="noreferrer noopener" target="_blank">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    );
  },
};

// No raw HTML, external images or executable links. User Markdown remains unchanged.
// Freeze configuration once. Each document still receives its own syntax tree
// and file; no user content is cached or shared between conversations.
function createMarkdownProcessor(math: boolean) {
  const parser = unified().use(remarkParse).use(remarkGfm);
  if (math) parser.use(remarkMath);
  const processor = parser
    .use(remarkBreaks)
    .use(remarkRehype, { allowDangerousHtml: true });
  if (math) processor.use(rehypeKatex, { strict: "ignore", trust: false });
  return processor.freeze();
}
let noteProcessor: ReturnType<typeof createMarkdownProcessor> | undefined;
let mathProcessor: ReturnType<typeof createMarkdownProcessor> | undefined;
const markdownUrlAttributes = Object.entries(urlAttributes);

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  // remark-math recognizes dollar delimiters. Without any dollar character,
  // neither inline nor block math can occur, so avoid constructing that chain.
  const hasMathDelimiter = text.includes("$");
  const processor = hasMathDelimiter
    ? (mathProcessor ??= createMarkdownProcessor(true))
    : (noteProcessor ??= createMarkdownProcessor(false));
  const tree = processor.runSync(processor.parse(text), { value: text });
  visit(tree, (node, index, parent) => {
    // Preserve raw HTML as inert text, matching the existing reader contract.
    if (node.type === "raw" && parent && index !== undefined) {
      parent.children[index] = { type: "text", value: node.value };
    } else if (node.type === "element") {
      for (const [property, tags] of markdownUrlAttributes) {
        if (
          Object.hasOwn(node.properties, property) &&
          (tags === null || tags.includes(node.tagName))
        ) {
          node.properties[property] = defaultUrlTransform(
            String(node.properties[property] ?? ""),
          );
        }
      }
    }
  });
  return (
    <div className="markdown">
      {toJsxRuntime(tree, {
        Fragment,
        jsx,
        jsxs,
        components: markdownComponents,
        ignoreInvalidStyle: true,
        passKeys: true,
        passNode: true,
      })}
    </div>
  );
});
