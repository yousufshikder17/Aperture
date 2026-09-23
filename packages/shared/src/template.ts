import { z } from "zod";

export const ResumeSectionSchema = z.enum(["summary", "experience", "projects", "skills", "education"]);
export type ResumeSection = z.infer<typeof ResumeSectionSchema>;

export const TemplateSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  source: z.enum(["uploaded", "library"]),
  tags: z.array(z.string().trim().min(1).max(30)).max(12),
  bestFor: z.array(z.string().trim().min(1).max(50)).max(10),
  layout: z.object({
    columns: z.union([z.literal(1), z.literal(2)]),
    sectionOrder: z.array(ResumeSectionSchema).length(5).refine(
      (sections) => new Set(sections).size === 5, "Include each section exactly once",
    ),
    sidebar: z.array(ResumeSectionSchema).max(2),
  }).refine((layout) => layout.columns === 2 ? layout.sidebar.length > 0 && new Set(layout.sidebar).size === layout.sidebar.length : layout.sidebar.length === 0,
    "Two columns need distinct sidebar sections; one column has no sidebar"),
  type: z.object({
    fontFamily: z.enum(["Helvetica", "TimesRoman", "Courier"]),
    nameSize: z.number().min(16).max(28),
    headingSize: z.number().min(10).max(15),
    bodySize: z.number().min(8).max(12),
  }),
  color: z.object({
    primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    text: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
  spacing: z.object({
    margin: z.number().min(32).max(72),
    sectionGap: z.number().min(4).max(20),
    bulletStyle: z.enum(["bullet", "dash"]),
  }),
  atsCompatibility: z.object({ score: z.number().int().min(0).max(100), warnings: z.array(z.string()) }),
}).refine((template) => template.layout.sidebar.every((section) => template.layout.sectionOrder.includes(section)),
  "Sidebar sections must appear in section order");

export type ResumeTemplate = z.infer<typeof TemplateSchema>;

export function assessTemplate<T extends ResumeTemplate>(template: T): T {
  const warnings: string[] = [];
  if (template.layout.columns === 2) warnings.push("Two columns can change reading order in some ATS parsers.");
  if (template.type.fontFamily === "Courier") warnings.push("Monospaced text may be harder to scan quickly.");
  return { ...template, atsCompatibility: { score: Math.max(0, 100 - warnings.length * 25), warnings } };
}

export const DEFAULT_TEMPLATE: ResumeTemplate = {
  id: "clean-classic",
  name: "Clean classic",
  source: "library",
  tags: ["minimal", "ATS safe", "classic"],
  bestFor: ["all roles"],
  layout: { columns: 1, sectionOrder: ["summary", "experience", "projects", "skills", "education"], sidebar: [] },
  type: { fontFamily: "Helvetica", nameSize: 18, headingSize: 11, bodySize: 10 },
  color: { primary: "#1a1a1a", accent: "#1a1a1a", text: "#1a1a1a" },
  spacing: { margin: 50, sectionGap: 8, bulletStyle: "bullet" },
  atsCompatibility: { score: 100, warnings: [] },
};
