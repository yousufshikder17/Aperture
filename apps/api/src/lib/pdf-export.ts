import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { MasterResume } from "@aperture/shared";

// Minimal single-column, parser-friendly PDF renderer for saved profiles.
// The layout deliberately avoids columns, tables, and graphics.

const MARGIN = 50;
const WIDTH = 612; // US Letter
const HEIGHT = 792;

export async function renderResumePdf(resume: MasterResume): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([WIDTH, HEIGHT]);
  let y = HEIGHT - MARGIN;

  const ensureRoom = (needed: number) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([WIDTH, HEIGHT]);
      y = HEIGHT - MARGIN;
    }
  };

  const wrap = (text: string, size: number, f = font): string[] => {
    const words = text.split(/\s+/);
    const max = WIDTH - MARGIN * 2;
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const attempt = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(attempt, size) > max && line) {
        lines.push(line);
        line = word;
      } else {
        line = attempt;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  const write = (text: string, size: number, f = font, gap = 4) => {
    for (const line of wrap(text, size, f)) {
      ensureRoom(size + gap);
      page.drawText(line, { x: MARGIN, y, size, font: f, color: rgb(0.1, 0.1, 0.1) });
      y -= size + gap;
    }
  };

  const heading = (text: string) => {
    y -= 8;
    write(text.toUpperCase(), 11, bold, 6);
  };

  write(resume.basics.name, 18, bold, 8);
  const contact = [resume.basics.email, resume.basics.phone, resume.basics.location]
    .filter(Boolean)
    .join(" · ");
  write(contact, 9);
  for (const link of resume.basics.links) write(`${link.label}: ${link.url}`, 9);

  if (resume.summary) {
    heading("Summary");
    write(resume.summary, 10);
  }

  if (resume.experience.length) {
    heading("Experience");
    for (const exp of resume.experience) {
      write(`${exp.title} — ${exp.company}`, 10.5, bold);
      write(`${exp.start} – ${exp.end ?? "Present"}${exp.location ? ` · ${exp.location}` : ""}`, 9);
      for (const bullet of exp.bullets) write(`• ${bullet}`, 10);
      y -= 4;
    }
  }

  if (resume.projects.length) {
    heading("Projects");
    for (const proj of resume.projects) {
      write(proj.url ? `${proj.name} (${proj.url})` : proj.name, 10.5, bold);
      for (const bullet of proj.bullets) write(`• ${bullet}`, 10);
      y -= 4;
    }
  }

  if (resume.skills.length) {
    heading("Skills");
    const byCategory = new Map<string, string[]>();
    for (const s of resume.skills) {
      byCategory.set(s.category, [...(byCategory.get(s.category) ?? []), s.name]);
    }
    for (const [category, names] of byCategory) {
      write(`${category}: ${names.join(", ")}`, 10);
    }
  }

  if (resume.education.length) {
    heading("Education");
    for (const edu of resume.education) {
      write(`${edu.credential}${edu.field ? `, ${edu.field}` : ""} — ${edu.institution}`, 10.5, bold);
      if (edu.end) write(edu.end, 9);
    }
  }

  // Copy into a plain ArrayBuffer-backed view — pdf-lib types its output as
  // ArrayBufferLike, which Hono's response body rejects.
  return new Uint8Array(await doc.save());
}
