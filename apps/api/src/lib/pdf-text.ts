import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { HTTPException } from "hono/http-exception";
import type { PDFDocument, PDFFont, PDFPage, PDFPageDrawTextOptions } from "pdf-lib";

const fontFiles = [
  "NotoSans-Regular.ttf", "NotoSans-Bold.ttf",
  "NotoSansCJKsc-VF.ttf",
] as const;
let fontBytes: Promise<Buffer[]> | undefined;

/** Preserve template fonts where possible and use embedded Unicode fonts for other characters. */
export async function pdfTextLayout(doc: PDFDocument, regular: PDFFont, bold: PDFFont, sample: string) {
  const supported = new Map<PDFFont, Set<number>>([
    [regular, new Set(regular.getCharacterSet())], [bold, new Set(bold.getCharacterSet())],
  ]);
  let fallbacks: PDFFont[] = [];
  if (Array.from(sample.normalize("NFC")).some(char => !/\s/.test(char) && !supported.get(regular)!.has(char.codePointAt(0)!))) {
    doc.registerFontkit(fontkit);
    fontBytes ??= Promise.all(fontFiles.map(file => readFile(
      new URL("../../../../resources/fonts/" + file, import.meta.url),
    ))).catch(error => { fontBytes = undefined; throw error; });
    const bytes = await fontBytes;
    fallbacks = await Promise.all(bytes.slice(0, 2).map(data => doc.embedFont(data, { subset: true })));
    // Fontkit supports variable fonts; its bundled declarations omit getVariation.
    type VariableFont = ReturnType<typeof fontkit.create> & {
      getVariation(settings: { wght: number }): ReturnType<typeof fontkit.create>;
    };
    for (const weight of [400, 700]) {
      doc.registerFontkit({ create: data => (fontkit.create(data) as VariableFont).getVariation({ wght: weight }) });
      fallbacks.push(await doc.embedFont(bytes[2]!, { subset: true, customName: "NotoSansCJK-" + weight }));
    }
    doc.registerFontkit(fontkit);
    for (const font of fallbacks) supported.set(font, new Set(font.getCharacterSet()));
  }
  function runs(text: string, preferred: PDFFont) {
    const result: Array<{ text: string; font: PDFFont }> = [];
    const weight = preferred === bold ? 1 : 0;
    for (const char of text.normalize("NFC")) {
      const code = char.codePointAt(0)!;
      const font = [preferred, fallbacks[weight], fallbacks[weight + 2]]
        .find(candidate => candidate && supported.get(candidate)!.has(code));
      if (!font) throw new HTTPException(422, { res: Response.json({
        error: "unsupported_pdf_character",
        message: `PDF export cannot render character U+${code.toString(16).toUpperCase()}. Replace it before exporting.`,
      }, { status: 422 }) });
      const last = result.at(-1);
      if (last?.font === font) last.text += char;
      else result.push({ text: char, font });
    }
    return result;
  }
  return {
    width(text: string, size: number, font: PDFFont) {
      return runs(text, font).reduce((total, run) => total + run.font.widthOfTextAtSize(run.text, size), 0);
    },
    draw(page: PDFPage, text: string, options: PDFPageDrawTextOptions & { font: PDFFont; size: number; x: number }) {
      let x = options.x;
      for (const run of runs(text, options.font)) {
        page.drawText(run.text, { ...options, font: run.font, x });
        x += run.font.widthOfTextAtSize(run.text, options.size);
      }
    },
  };
}
