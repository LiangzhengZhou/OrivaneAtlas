import { fileExtractionLimits } from "@arclattice/application";
import type { PdfPageView } from "@arclattice/file-parsers/pdf-page-view";
import { useEffect, useRef, useState } from "react";
import type { Runtime } from "../../bootstrap";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Surfaces";

export function PdfOriginalPreview({
  runtime,
  id,
  name,
  zh,
}: {
  runtime: Runtime;
  id: string;
  name: string;
  zh: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {zh ? "查看 PDF 原始页面" : "View original PDF pages"}
      </Button>
      {open && (
        <PdfDialog
          runtime={runtime}
          id={id}
          name={name}
          zh={zh}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function PdfDialog({
  runtime,
  id,
  name,
  zh,
  onClose,
}: {
  runtime: Runtime;
  id: string;
  name: string;
  zh: boolean;
  onClose(): void;
}) {
  const [pdf, setPdf] = useState<PdfPageView | null>(null);
  const [page, setPage] = useState(1);
  const [targetPage, setTargetPage] = useState("1");
  const closeButton = useRef<HTMLButtonElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setError(true);
      controller.abort();
    }, fileExtractionLimits.milliseconds);
    void (async () => {
      const source = await runtime.openFilePageSource(id, controller.signal);
      controller.signal.throwIfAborted();
      const { openPdfPageView } = await import(
        "@arclattice/file-parsers/pdf-page-view"
      );
      controller.signal.throwIfAborted();
      const loaded = await openPdfPageView(source, controller.signal);
      if (!controller.signal.aborted) setPdf(loaded);
    })()
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [runtime, id, attempt]);
  useEffect(() => {
    const el = canvas.current;
    if (!pdf || !el) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setError(true);
      controller.abort();
    }, fileExtractionLimits.milliseconds);
    void pdf
      .paint(page, el, controller.signal)
      .then(() => {
        if (!controller.signal.aborted) setReady(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [pdf, page]);
  function turn(next: number) {
    if (!pdf || !Number.isInteger(next) || next < 1 || next > pdf.pages) return;
    setTargetPage(String(next));
    if (next === page) return;
    setReady(false);
    setPage(next);
  }
  const pageLabel = zh ? `第 ${page} 页` : `Page ${page}`;
  return (
    <Dialog
      className="ui-dialog pdf-original-dialog"
      aria-label={name}
      onRequestClose={onClose}
    >
      <header>
        <h2>{name}</h2>
        <Button ref={closeButton} variant="ghost" onClick={onClose}>
          {zh ? "关闭" : "Close"}
        </Button>
      </header>
      {error ? (
        <>
          <p role="alert">
            {zh
              ? "此页未能显示。你可以重试，或关闭预览并下载原件。"
              : "This page could not be displayed. Retry or close the preview to download the original."}
          </p>
          <Button
            onClick={() => {
              closeButton.current?.focus();
              setReady(false);
              setError(false);
              setPdf(null);
              setAttempt((previous) => previous + 1);
            }}
          >
            {zh ? "重试此页" : "Retry this page"}
          </Button>
        </>
      ) : (
        <>
          {pdf && (
            <nav
              className="file-preview-tools"
              aria-label={zh ? "PDF 原件页码" : "Original PDF pages"}
            >
              <Button
                variant="ghost"
                disabled={page === 1}
                onClick={() => turn(page - 1)}
              >
                {zh ? "上一页" : "Previous page"}
              </Button>
              <span role="status">
                {pageLabel} / {pdf.pages}
              </span>
              <Button
                variant="ghost"
                disabled={page === pdf.pages}
                onClick={() => turn(page + 1)}
              >
                {zh ? "下一页" : "Next page"}
              </Button>
              {pdf.pages > 2 && (
                <form
                  className="pdf-page-jump"
                  onSubmit={(event) => {
                    event.preventDefault();
                    turn(Number(targetPage));
                  }}
                >
                  <label>
                    {zh ? "跳至页码" : "Go to page"}
                    <input
                      type="number"
                      min={1}
                      max={pdf.pages}
                      required
                      inputMode="numeric"
                      value={targetPage}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => setTargetPage(event.target.value)}
                    />
                  </label>
                  <Button type="submit" variant="secondary">
                    {zh ? "前往" : "Go"}
                  </Button>
                </form>
              )}
            </nav>
          )}
          {!ready && (
            <p role="status">{zh ? "正在绘制页面…" : "Rendering page…"}</p>
          )}
          <div className="pdf-page-viewport" aria-busy={!ready}>
            <canvas
              key={page}
              ref={canvas}
              role="img"
              aria-label={name + " · " + pageLabel}
              hidden={!ready}
            />
          </div>
        </>
      )}
    </Dialog>
  );
}
