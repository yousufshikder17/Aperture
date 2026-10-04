import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { NodeCanvasFactory } from "pdfjs-dist/types/src/display/node_utils.js";
import { DEFAULT_TEMPLATE, type MasterResume } from "@aperture/shared";
import { renderResumePdf } from "../src/lib/pdf-export.js";

const resume: MasterResume = {
  basics: { name: "Łukasz王明", email: "test@example.test", phone: null, location: "東京",
    headline: null, links: [] },
  summary: "Ελληνικά Иван 한글",
  experience: [], projects: [], education: [],
  skills: [{ name: "漢字".repeat(70), category: "Languages", level: null, evidence: [] }],
  certifications: [], publications: [], awards: [], targetRoles: [],
};

test("PDF export preserves mixed Unicode names, body text, and wrapped sidebar text in every template font", async () => {
  for (const fontFamily of ["Helvetica", "TimesRoman", "Courier"] as const) {
    const bytes = await renderResumePdf(resume, { ...DEFAULT_TEMPLATE,
      type: { ...DEFAULT_TEMPLATE.type, fontFamily },
      layout: { ...DEFAULT_TEMPLATE.layout, columns: 2, sidebar: ["skills"] } });
    assert.ok(bytes.length < 200_000, "embed glyph subsets, not entire font files");
    const task = getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false });
    try {
      const pdf = await task.promise;
      let text = "";
      for (let number = 1; number <= pdf.numPages; number++) {
        const content = await (await pdf.getPage(number)).getTextContent();
        text += content.items.map(item => "str" in item ? item.str : "").join("");
      }
      for (const value of ["Łukasz王明", "東京", "Ελληνικά", "Иван", "한글", "漢字".repeat(70)])
        assert.ok(text.replace(/\s/g, "").includes(value), `Missing ${value} with ${fontFamily}`);
    } finally { await task.destroy(); }
  }
});

test("unsupported characters produce an explicit 422 instead of a damaged PDF", async () => {
  const app = new Hono();
  app.get("/pdf", async c => c.body(await renderResumePdf({
    ...resume, basics: { ...resume.basics, name: "Candidate \u{1F680}" },
  })));
  const response = await app.request("/pdf");
  assert.equal(response.status, 422);
  const body = await response.json() as { error: string; message: string };
  assert.equal(body.error, "unsupported_pdf_character");
  assert.match(body.message, /U\+1F680/);
});

test("CJK glyphs are visibly rendered, not only present in the PDF text layer", async () => {
  const bytes = await renderResumePdf({ ...resume, basics: { ...resume.basics, name: "王明語" },
    summary: "王明語", skills: [] });
  const task = getDocument({ data: bytes, useSystemFonts: false, isEvalSupported: false,
    standardFontDataUrl: fileURLToPath(new URL("../../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url)).replaceAll("\\", "/") });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const factory = pdf.canvasFactory as NodeCanvasFactory;
    const target = factory.create(viewport.width, viewport.height);
    await page.render({ canvas: null, canvasContext: target.context, viewport }).promise;
    const content = await page.getTextContent();
    const items = content.items.filter(item => "str" in item && item.str === "王明語");
    assert.equal(items.length, 2, "test both bold names and regular body text");
    for (const item of items) {
      if (!("str" in item)) continue;
      const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
      const width = item.width * 2 / 3;
      const height = item.height * 2;
      for (let index = 0; index < 3; index++) {
        const pixels = target.context.getImageData(Math.floor(x + width * index), Math.floor(y - height),
          Math.ceil(width), Math.ceil(height)).data;
        let darkPixels = 0;
        for (let offset = 0; offset < pixels.length; offset += 4)
          if (pixels[offset] < 128 && pixels[offset + 1] < 128 && pixels[offset + 2] < 128) darkPixels++;
        assert.ok(darkPixels > 10, `Missing visible glyph ${item.str[index]}`);
      }
    }
    factory.destroy(target);
  } finally { await task.destroy(); }
});
