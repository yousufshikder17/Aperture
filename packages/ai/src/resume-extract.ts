import { pdfToPng } from "pdf-to-png-converter";
import mammoth from "mammoth";
import { ResumeExtractionSchema, type ResumeExtraction } from "@aperture/shared";
import { getProvider } from "./provider/index.js";
import type { ContentPart } from "./provider/types.js";

// Resume Builder — Path A (upload existing resume). Two input formats, one
// output shape; both converge on MasterResume JSON like every other path.
//
//   PDF  → image → structured extraction. Vision on rendered
//          pages sees what an ATS parser sees: column collisions, tables,
//          text-in-graphics — those become layoutFindings.
//   DOCX → direct text extraction (mammoth) → AI structuring. No page images,
//          so layoutFindings covers only text-visible issues.
//
// Extraction is mechanical transcription → fast tier.

const INSTRUCTIONS = `You are extracting a resume into structured JSON.
- Transcribe faithfully: exact company names, titles, dates, bullets. Do not paraphrase or invent.
- Populate skills[] only with skills actually named or clearly demonstrated; attach evidence.
- Leave targetRoles empty — the user sets those.
- Separately report layoutFindings: properties that would confuse automated resume parsers
  (multi-column layouts, tables, icons-as-text, headers containing contact info, unusual
  fonts/graphics), each with an ATS risk level and a concrete fix. For plain-text input,
  report only what is visible in the text (e.g. missing dates, unlabeled sections).`;

async function extract(content: ContentPart[]): Promise<ResumeExtraction> {
  return getProvider().generate({
    tier: "fast", // mechanical transcription
    system: [{ text: INSTRUCTIONS }],
    content,
    schema: ResumeExtractionSchema,
    maxTokens: 32000,
  });
}

export async function extractResumeFromPdf(pdf: Buffer): Promise<ResumeExtraction> {
  const pages = await pdfToPng(pdf, { viewportScale: 2.0 });
  return extract([
    ...pages
      .filter((page) => page.content !== undefined)
      .map((page) => ({
        type: "image" as const,
        mediaType: "image/png" as const,
        data: page.content!.toString("base64"),
      })),
    { type: "text", text: "Extract this resume and report layout findings." },
  ]);
}

export async function extractResumeFromDocx(docx: Buffer): Promise<ResumeExtraction> {
  const { value: text } = await mammoth.extractRawText({ buffer: docx });
  return extract([
    {
      type: "text",
      text: `Extract this resume (raw text from a DOCX) and report layout findings.\n\n<resume_text>\n${text}\n</resume_text>`,
    },
  ]);
}
