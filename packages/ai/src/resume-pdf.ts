import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { PDFPageProxy } from "pdfjs-dist";

const pdfRoot = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const assetPath = (folder: string) => join(pdfRoot, folder).replaceAll("\\", "/") + "/";

export async function openResumePdf(file: Buffer) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return getDocument({ data: new Uint8Array(file), isEvalSupported: false, useSystemFonts: true,
    cMapUrl: assetPath("cmaps"), cMapPacked: true, standardFontDataUrl: assetPath("standard_fonts"), wasmUrl: assetPath("wasm") });
}
type RenderInput = Parameters<PDFPageProxy["render"]>[0];
type NodeCanvas = NonNullable<RenderInput["canvas"]> & { toBuffer(format: "image/png"): Buffer };
type CanvasPair = { canvas: NodeCanvas; context: NonNullable<RenderInput["canvasContext"]> };
export class ResumePdfLimitError extends Error {}

export async function renderResumePdf(file: Buffer, pageCount: number): Promise<Buffer[]> {
  const task = await openResumePdf(file);
  try {
    const document = await task.promise;
    if (document.numPages !== pageCount || pageCount > 20) throw new Error("Incomplete PDF rendering");
    // PDF.js owns the installed Node canvas backend; no browser or output files are involved.
    const factory = document.canvasFactory as { create(width: number, height: number): CanvasPair; destroy(pair: CanvasPair): void };
    const pages: Buffer[] = [];
    let bytes = 0;
    for (let number = 1; number <= pageCount; number++) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 1.5 });
      if (!Number.isFinite(viewport.width * viewport.height) || viewport.width > 8192 || viewport.height > 8192 ||
          viewport.width * viewport.height > 8_000_000) throw new ResumePdfLimitError("PDF page exceeds the rendering size limit");
      const pair = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      try {
        await page.render({ canvas: pair.canvas, canvasContext: pair.context, viewport }).promise;
        const png = pair.canvas.toBuffer("image/png"); bytes += png.length;
        if (bytes > 16 * 1024 * 1024) throw new ResumePdfLimitError("Rendered PDF exceeds the image size limit");
        pages.push(png);
      } finally { factory.destroy(pair); page.cleanup(); }
    }
    return pages;
  } finally { await task.destroy(); }
}
