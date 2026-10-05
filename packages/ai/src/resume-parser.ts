import { ResumeExtractionSchema, type ResumeExtraction, type MasterResume } from "@aperture/shared";

export const MAX_RESUME_TEXT = 200_000;
export function cleanResumeText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, "").trim();
}
export function usableResumeText(text: string): boolean {
  const compact = text.replace(/\s/g, "");
  return compact.length >= 80 && (text.match(/\p{L}/gu)?.length ?? 0) >= 40 &&
    (text.match(/\uFFFD/g)?.length ?? 0) / Math.max(compact.length, 1) < 0.01;
}
const headings: Record<string, string> = {
  experience: "experience", "work experience": "experience", "professional experience": "experience",
  "employment history": "experience", "work history": "experience", education: "education",
  projects: "projects", "selected projects": "projects", "personal projects": "projects",
  skills: "skills", "technical skills": "skills", "core skills": "skills",
  summary: "summary", profile: "summary", "professional summary": "summary",
  certifications: "certifications", publications: "publications", awards: "awards",
};
const bullet = /^[\s]*[•●▪‣*-]\s+/;
const dateToken = "(?:\\d{4}-\\d{2}(?:-\\d{2})?|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?\\s+\\d{4}|\\d{4})";
const dateRange = new RegExp(`(${dateToken})\\s*(?:[-–—]|to)\\s*(${dateToken}|Present|Current|Now)`, "i");
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function date(value: string): string {
  const month = months.indexOf(value.slice(0, 3).toLowerCase());
  return month < 0 ? value : `${value.slice(-4)}-${String(month + 1).padStart(2, "0")}`;
}
function range(line: string) {
  const match = dateRange.exec(line);
  return match ? { start: date(match[1]!), end: /^(present|current|now)$/i.test(match[2]!) ? null : date(match[2]!),
    header: line.replace(match[0], "").replace(/^[\s|,–—-]+|[\s|,–—-]+$/g, "") } : null;
}
const roleWord = /\b(engineer|developer|designer|analyst|manager|director|intern|scientist|specialist|consultant|officer|coordinator|assistant|lead|architect|researcher|technician)\b/i;
function roleHeader(lines: string[]): { title: string; company: string } | null {
  const title = lines.find(line => /^(title|role|position):\s*\S/i.test(line))?.replace(/^[^:]+:\s*/, "");
  const company = lines.find(line => /^company:\s*\S/i.test(line))?.replace(/^[^:]+:\s*/, "");
  if (title && company) return { title, company };
  for (const line of lines) {
    const at = /^(.+?)\s+(?:at|@)\s+(.+)$/.exec(line);
    if (at) return { title: at[1]!, company: at[2]! };
  }
  const parts = lines.length === 1 ? lines[0]!.split(/\s+[|–—]\s+/) : lines;
  if (parts.length !== 2) return null;
  if (roleWord.test(parts[0]!) && !roleWord.test(parts[1]!)) return { title: parts[0]!, company: parts[1]! };
  if (roleWord.test(parts[1]!) && !roleWord.test(parts[0]!)) return { title: parts[1]!, company: parts[0]! };
  return null;
}
function experience(lines: string[]): MasterResume["experience"] {
  const entries: Array<{ index: number; headerStart: number; dates: NonNullable<ReturnType<typeof range>>;
    role: ReturnType<typeof roleHeader> }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (bullet.test(lines[i]!)) continue;
    const dates = range(lines[i]!);
    if (!dates) continue;
    let headerStart = i;
    const header = dates.header ? [dates.header] : [];
    if (!header.length) {
      for (let j = i - 1; j >= Math.max(0, i - 2) && !bullet.test(lines[j]!) && !range(lines[j]!); j--) {
        header.unshift(lines[j]!); headerStart = j;
        if (roleHeader(header)) break;
      }
    }
    const role = roleHeader(header);
    entries.push({ index: i, headerStart, dates, role });
  }
  return entries.flatMap((entry, i) => entry.role ? [{ ...entry.role, start: entry.dates.start, end: entry.dates.end,
    location: null, skills: [], bullets: lines.slice(entry.index + 1, entries[i + 1]?.headerStart ?? lines.length)
      .map(line => line.replace(bullet, "")) }] : []);
}
const credential = /\b(bachelor|master|doctor|ph\.?d|b\.?sc|m\.?sc|b\.?s\.?|m\.?s\.?|b\.?a\.?|m\.?a\.?|mba|diploma|associate)\b/i;
function education(lines: string[]): MasterResume["education"] {
  const entries: MasterResume["education"] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!credential.test(lines[i]!)) continue;
    const parts = lines[i]!.split(/\s+[|–—]\s+/);
    let institution: string | undefined, degree: string | undefined;
    if (parts.length === 2 && credential.test(parts[0]!) !== credential.test(parts[1]!)) {
      degree = parts.find(part => credential.test(part)); institution = parts.find(part => !credential.test(part));
    } else if (parts.length === 1) {
      degree = lines[i];
      const previous = lines[i - 1];
      if (previous && !credential.test(previous) && !range(previous) && !/^\d|^GPA:/i.test(previous)) institution = previous;
    }
    if (!institution || !degree) continue;
    const dates = range(lines[i + 1] ?? "");
    const graduation = /^(?:Graduated:?\s*)?(\d{4})$/i.exec(lines[i + 1] ?? "");
    const field = /\s+in\s+(.+)$/i.exec(degree)?.[1] ?? null;
    entries.push({ institution, credential: degree, field, start: dates?.start ?? null,
      end: dates?.end ?? graduation?.[1] ?? null, gpa: null });
  }
  return entries;
}
function projects(lines: string[]): MasterResume["projects"] {
  const result: MasterResume["projects"] = [];
  for (const line of lines) {
    const previous = result.at(-1);
    if (bullet.test(line) && previous) previous.bullets.push(line.replace(bullet, ""));
    else if (!previous || previous.bullets.length) {
      const url = /https?:\/\/[^\s|]+/.exec(line)?.[0] ?? null;
      result.push({ name: line.replace(url ?? /$^/, "").replace(/[\s|]+$/g, ""), url, description: "", bullets: [], skills: [] });
    } else previous.description += (previous.description ? "\n" : "") + line;
  }
  return result;
}

export function parseResumeText(raw: string): ResumeExtraction {
  const text = cleanResumeText(raw);
  const sections: Record<string, string[]> = { basics: [] };
  let section = "basics";
  for (const line of text.split("\n").map(line => line.trim()).filter(Boolean)) {
    const key = line.toLowerCase().replace(/:$/, "").trim();
    const heading = Object.hasOwn(headings, key) ? headings[key] : undefined;
    if (heading) { section = heading; sections[section] ??= []; }
    else sections[section]!.push(line);
  }
  const header = sections.basics!;
  const email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.exec(header.join("\n"))?.[0] ?? "";
  const phone = /(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}\b/.exec(header.join("\n"))?.[0] ?? null;
  const first = header[0] ?? "";
  const name = /^[\p{L}][\p{L} .’'-]{1,100}$/u.test(first) && first.split(/\s+/).length <= 5 ? first : "";
  const links = Array.from(header.join("\n").matchAll(/https?:\/\/[^\s|]+/g), match => ({ label: match[0], url: match[0] }));
  const skills: MasterResume["skills"] = [];
  const skillNames = new Set<string>();
  for (const line of sections.skills ?? []) {
    const cleaned = line.replace(bullet, "");
    const prefix = /^([^:]{1,50}):\s*(.+)$/.exec(cleaned);
    for (const skill of (prefix?.[2] ?? cleaned).split(/[,;|]/).map(value => value.trim()).filter(Boolean))
      if (!skillNames.has(skill.toLowerCase())) {
        skillNames.add(skill.toLowerCase());
        skills.push({ name: skill, category: prefix?.[1] ?? "", level: null, evidence: [] });
      }
  }
  const resume: MasterResume = {
    basics: { name, email, phone, links,
      location: header.find(line => /^location:/i.test(line))?.replace(/^location:\s*/i, "") ?? null,
      headline: header.find(line => /^(headline|title):/i.test(line))?.replace(/^[^:]+:\s*/, "") ?? null },
    summary: sections.summary?.join("\n") || null,
    experience: experience(sections.experience ?? []), education: education(sections.education ?? []),
    projects: projects(sections.projects ?? []), skills,
    certifications: (sections.certifications ?? []).map(line => line.replace(bullet, "")),
    publications: (sections.publications ?? []).map(line => line.replace(bullet, "")),
    awards: (sections.awards ?? []).map(line => line.replace(bullet, "")), targetRoles: [],
  };
  const layoutFindings: ResumeExtraction["layoutFindings"] = [];
  if (Object.keys(sections).length === 1) layoutFindings.push({ issue: "No common resume section headings were recognized in the text",
    atsRisk: "medium", fix: "Label sections and use the extracted text to fill any missing fields." });
  if (sections.experience?.length && (!resume.experience.length ||
      sections.experience.filter(line => range(line)).length > resume.experience.length))
    layoutFindings.push({ issue: "Some experience dates or role/company boundaries could not be structured from the text",
    atsRisk: "medium", fix: "Review the extracted text and enter each role, employer and date range in the editor." });
  if (sections.education?.length && !resume.education.length) layoutFindings.push({ issue: "Education boundaries could not be structured from the text",
    atsRisk: "low", fix: "Review the extracted text and enter the institution and credential in the editor." });
  return ResumeExtractionSchema.parse({ resume, layoutFindings });
}
