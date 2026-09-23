import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import { DEFAULT_TEMPLATE, type MasterResume, type ResumeSection, type ResumeTemplate } from "@aperture/shared";

const WIDTH = 612; // US Letter
const HEIGHT = 792;

function color(hex: string) {
  return rgb(...([1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number]));
}

// Standard PDF fonts use WinAnsi. Replace common punctuation and omit unsupported glyphs.
function pdfText(value: string) {
  return value.replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/\u2022/g, "-").replace(/[^\x20-\x7e\xa0-\xff]/g, "");
}

export async function renderResumePdf(
  resume: MasterResume,
  template: ResumeTemplate = DEFAULT_TEMPLATE,
): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await PDFDocument.create();
  const family = template.type.fontFamily;
  const regular = await doc.embedFont(family === "TimesRoman" ? StandardFonts.TimesRoman
    : family === "Courier" ? StandardFonts.Courier : StandardFonts.Helvetica);
  const bold = await doc.embedFont(family === "TimesRoman" ? StandardFonts.TimesRomanBold
    : family === "Courier" ? StandardFonts.CourierBold : StandardFonts.HelveticaBold);
  const margin = template.spacing.margin;
  const bodySize = template.type.bodySize;
  const textColor = color(template.color.text);
  const accentColor = color(template.color.accent);
  const primaryColor = color(template.color.primary);
  const pages: PDFPage[] = [doc.addPage([WIDTH, HEIGHT])];
  const pageAt = (index: number) => {
    while (pages.length <= index) pages.push(doc.addPage([WIDTH, HEIGHT]));
    return pages[index]!;
  };

  type Cursor = { page: number; x: number; width: number; y: number };
  const wrap = (value: string, size: number, font: PDFFont, width: number) => {
    const lines: string[] = [];
    let line = "";
    for (let word of pdfText(value).split(/\s+/)) {
      if (!word) continue;
      while (font.widthOfTextAtSize(word, size) > width) {
        if (line) { lines.push(line); line = ""; }
        let cut = 1;
        while (cut < word.length && font.widthOfTextAtSize(word.slice(0, cut + 1), size) <= width) cut++;
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      if (!word) continue;
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  const write = (cursor: Cursor, value: string, size = bodySize, font = regular, ink = textColor, gap = 3) => {
    for (const line of wrap(value, size, font, cursor.width)) {
      if (cursor.y - size - gap < margin) {
        cursor.page++;
        cursor.y = HEIGHT - margin;
      }
      pageAt(cursor.page).drawText(line, { x: cursor.x, y: cursor.y, size, font, color: ink });
      cursor.y -= size + gap;
    }
  };
  const full: Cursor = { page: 0, x: margin, width: WIDTH - margin * 2, y: HEIGHT - margin };
  write(full, resume.basics.name, template.type.nameSize, bold, primaryColor, 6);
  write(full, [resume.basics.email, resume.basics.phone, resume.basics.location]
    .filter(Boolean).join(" | "), bodySize - 1);
  for (const link of resume.basics.links) write(full, `${link.label}: ${link.url}`, bodySize - 1);
  full.y -= template.spacing.sectionGap;

  const twoColumns = template.layout.columns === 2;
  const gutter = 20;
  const sidebarWidth = twoColumns ? Math.floor((full.width - gutter) * 0.34) : 0;
  const main: Cursor = { page: full.page, x: margin, width: full.width - (twoColumns ? sidebarWidth + gutter : 0), y: full.y };
  const sidebar: Cursor = { page: full.page, x: margin + main.width + gutter, width: sidebarWidth, y: full.y };
  const bullet = template.spacing.bulletStyle === "dash" ? "-" : "•";

  function section(cursor: Cursor, name: ResumeSection) {
    const hasContent = name === "summary" ? !!resume.summary : resume[name].length > 0;
    if (!hasContent) return;
    cursor.y -= template.spacing.sectionGap;
    write(cursor, name.toUpperCase(), template.type.headingSize, bold, accentColor, 5);
    if (name === "summary") write(cursor, resume.summary ?? "", bodySize);
    if (name === "experience") for (const item of resume.experience) {
      write(cursor, `${item.title} - ${item.company}`, bodySize + 0.5, bold);
      write(cursor, `${item.start} - ${item.end ?? "Present"}${item.location ? ` | ${item.location}` : ""}`, bodySize - 1);
      for (const line of item.bullets) write(cursor, `${bullet} ${line}`);
      cursor.y -= 4;
    }
    if (name === "projects") for (const item of resume.projects) {
      write(cursor, item.url ? `${item.name} (${item.url})` : item.name, bodySize + 0.5, bold);
      if (item.description) write(cursor, item.description);
      for (const line of item.bullets) write(cursor, `${bullet} ${line}`);
      cursor.y -= 4;
    }
    if (name === "skills") {
      const groups = new Map<string, string[]>();
      for (const item of resume.skills) groups.set(item.category, [...(groups.get(item.category) ?? []), item.name]);
      for (const [category, names] of groups) write(cursor, `${category}: ${names.join(", ")}`);
    }
    if (name === "education") for (const item of resume.education) {
      write(cursor, `${item.credential}${item.field ? `, ${item.field}` : ""} - ${item.institution}`, bodySize + 0.5, bold);
      if (item.end) write(cursor, item.end, bodySize - 1);
      cursor.y -= 4;
    }
  }

  for (const name of template.layout.sectionOrder) {
    section(twoColumns && template.layout.sidebar.includes(name) ? sidebar : main, name);
  }
  return new Uint8Array(await doc.save());
}
