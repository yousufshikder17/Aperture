import { z } from "zod";

// The structured resume is the profile's single source of truth.
// Uploaded PDFs are extracted INTO this shape; all scoring reads FROM it.

export const LinkSchema = z.object({
  label: z.string(),
  url: z.string(),
});

export const ExperienceSchema = z.object({
  company: z.string(),
  title: z.string(),
  start: z.string().describe("ISO date or YYYY-MM"),
  end: z.string().nullable().describe("null = current role"),
  location: z.string().nullable(),
  bullets: z.array(z.string()),
  skills: z.array(z.string()).describe("skills demonstrably used in this role"),
});

export const ProjectSchema = z.object({
  name: z.string(),
  url: z.string().nullable(),
  description: z.string(),
  bullets: z.array(z.string()),
  skills: z.array(z.string()),
});

export const EducationSchema = z.object({
  institution: z.string(),
  credential: z.string(),
  field: z.string().nullable(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  gpa: z.string().nullable(),
});

export const SkillSchema = z.object({
  name: z.string(),
  category: z.string().describe("e.g. language, framework, ml, infra, domain"),
  level: z.enum(["beginner", "intermediate", "advanced"]).nullable(),
  evidence: z
    .array(z.string())
    .describe("experience/project names that demonstrate this skill"),
});

export const MasterResumeSchema = z.object({
  basics: z.object({
    name: z.string(),
    email: z.string(),
    phone: z.string().nullable(),
    location: z.string().nullable(),
    headline: z.string().nullable(),
    links: z.array(LinkSchema),
  }),
  summary: z.string().nullable(),
  experience: z.array(ExperienceSchema),
  projects: z.array(ProjectSchema),
  education: z.array(EducationSchema),
  skills: z.array(SkillSchema),
  certifications: z.array(z.string()),
  publications: z.array(z.string()),
  awards: z.array(z.string()),
  targetRoles: z
    .array(z.string())
    .describe("role types the user is targeting; drives aggregate gap analysis"),
});

export type MasterResume = z.infer<typeof MasterResumeSchema>;

// Result of the PDF → image → Claude extraction pipeline: the resume itself
// plus layout observations only vision can make (what an ATS parser chokes on).
export const ResumeExtractionSchema = z.object({
  resume: MasterResumeSchema,
  layoutFindings: z.array(
    z.object({
      issue: z.string().describe("e.g. two-column layout, table-based skills section"),
      atsRisk: z.enum(["low", "medium", "high"]),
      fix: z.string(),
    }),
  ),
});

export type ResumeExtraction = z.infer<typeof ResumeExtractionSchema>;
