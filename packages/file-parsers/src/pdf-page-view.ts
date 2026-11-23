import { fileExtractionLimits } from "@arclattice/application";
import {
  AnnotationMode,
  GlobalWorkerOptions,
  getDocument,
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
  bytes: Blob,
  signal: AbortSignal,
): Promise<PdfPageView> {
  if (bytes.size > fileExtractionLimits.inputBytes)
    throw new Error("PDF_SIZE_LIMIT");
  const data = new Uint8Array(await bytes.arrayBuffer());
  signal.throwIfAborted();
  GlobalWorkerOptions.workerSrc = workerUrl;
  const task = getDocument({
    data,
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
    void task.destroy().catch(() => undefined);
  };
  signal.addEventListener("abort", dispose, { once: true });
  try {
    const pdf = await task.promise;
    signal.throwIfAborted();
    if (pdf.numPages > fileExtractionLimits.sections)
      throw new Error("PDF_PAGE_LIMIT");
    return {
      pages: pdf.numPages,
      async paint(number, canvas, pageSignal) {
        const page = await pdf.getPage(number);
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
          await render.promise;
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
