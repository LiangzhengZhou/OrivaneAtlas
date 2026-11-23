import {
  type FilePageSource,
  fileExtractionLimits,
  filePageChunkBytes,
} from "@arclattice/application";
import {
  AnnotationMode,
  GlobalWorkerOptions,
  getDocument,
  PDFDataRangeTransport,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";

export interface PdfPageView {
  pages: number;
  paint(
    number: number,
    canvas: HTMLCanvasElement,
    signal: AbortSignal,
  ): Promise<void>;
}

/** A page surface consumes already authorized bytes. It never follows document links. */
export async function openPdfPageView(
  source: FilePageSource,
  signal: AbortSignal,
): Promise<PdfPageView> {
  if (source.size <= 0 || source.size > 100 * 1024 * 1024)
    throw new Error("PDF_SIZE_LIMIT");
  const requests = new AbortController();
  const combined = AbortSignal.any([signal, requests.signal]);
  const first = await source.read(
    0,
    Math.min(source.size, filePageChunkBytes),
    combined,
  );
  combined.throwIfAborted();
  GlobalWorkerOptions.workerSrc = workerUrl;
  let fail: (reason: unknown) => void = () => {};
  const failed = new Promise<never>((_, reject) => {
    fail = reject;
  });
  class OriginalTransport extends PDFDataRangeTransport {
    override requestDataRange(begin: number, end: number) {
      void (async () => {
        if (
          !Number.isSafeInteger(begin) ||
          !Number.isSafeInteger(end) ||
          begin < 0 ||
          end <= begin ||
          end > source.size
        )
          throw new Error("INVALID_FILE_RANGE");
        const data = new Uint8Array(end - begin);
        for (let offset = begin; offset < end; offset += filePageChunkBytes) {
          combined.throwIfAborted();
          const part = await source.read(
            offset,
            Math.min(end, offset + filePageChunkBytes),
            combined,
          );
          data.set(part, offset - begin);
        }
        combined.throwIfAborted();
        this.onDataRange(begin, data);
      })().catch((error) => {
        fail(error);
        dispose();
      });
    }
    override abort() {
      source.close();
      requests.abort();
    }
  }
  const range = new OriginalTransport(source.size, first, true);
  const task = getDocument({
    range,
    rangeChunkSize: filePageChunkBytes,
    disableStream: true,
    disableAutoFetch: true,
    enableXfa: false,
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    stopAtErrors: true,
    maxImageSize: 8_000_000,
    canvasMaxAreaInBytes: 32_000_000,
    verbosity: 0,
  });
  const dispose = () => {
    requests.abort();
    void task.destroy().catch(() => undefined);
  };
  signal.addEventListener("abort", dispose, { once: true });
  try {
    const pdf = await Promise.race([task.promise, failed]);
    signal.throwIfAborted();
    if (pdf.numPages > fileExtractionLimits.sections)
      throw new Error("PDF_PAGE_LIMIT");
    return {
      pages: pdf.numPages,
      async paint(number, canvas, pageSignal) {
        const page = await Promise.race([pdf.getPage(number), failed]);
        pageSignal.throwIfAborted();
        signal.throwIfAborted();
        const natural = page.getViewport({ scale: 1 });
        if (
          !Number.isFinite(natural.width) ||
          !Number.isFinite(natural.height) ||
          natural.width <= 0 ||
          natural.height <= 0
        )
          throw new Error("PDF_PAGE_SIZE");
        const scale = Math.min(
          2,
          1600 / natural.width,
          2000 / natural.height,
          Math.sqrt(2_000_000 / (natural.width * natural.height)),
        );
        const viewport = page.getViewport({ scale });
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const render = page.render({
          canvas,
          viewport,
          annotationMode: AnnotationMode.DISABLE,
          background: "white",
        });
        const cancel = () => render.cancel();
        pageSignal.addEventListener("abort", cancel, { once: true });
        try {
          await Promise.race([render.promise, failed]);
        } finally {
          pageSignal.removeEventListener("abort", cancel);
          page.cleanup();
        }
      },
    };
  } catch (error) {
    signal.removeEventListener("abort", dispose);
    dispose();
    throw error;
  }
}
