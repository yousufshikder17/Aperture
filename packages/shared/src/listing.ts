import { z } from "zod";

export const ListingSourceSchema = z.enum([
  "linkedin_rss",
  "indeed_rss",
  "career_page",
  "wellfound",
  "manual",
]);

export const ListingSchema = z.object({
  id: z.string(),
  source: ListingSourceSchema,
  url: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string().nullable(),
  salary: z.string().nullable(),
  description: z.string(),
  postedAt: z.string().nullable(),
});

export type Listing = z.infer<typeof ListingSchema>;
export type ListingSource = z.infer<typeof ListingSourceSchema>;

export const AtsSimulationSchema = z.object({
  score: z.number().describe("0-100 keyword-screening score for this listing"),
  keywordCoverage: z.number().describe("0-100 share of listing terms present in the resume"),
  matchedKeywords: z.array(z.string()),
  missingKeywords: z.array(z.string()),
  formatIssues: z.array(z.string()),
  likelyOutcome: z.enum(["pass", "borderline", "filtered_out"]),
});

export type AtsSimulation = z.infer<typeof AtsSimulationSchema>;

// Transparent output contract for the public match scorer.
export const MatchScoreSchema = z.object({
  overall: z.number().describe("0-100 how strong a match this listing is for the candidate"),
  subscores: z.object({
    skills: z.number(),
    experience: z.number(),
    seniority: z.number(),
    location: z.number(),
  }),
  strengths: z.array(z.string()),
  concerns: z.array(z.string()),
  verdict: z
    .enum(["apply_now", "consider", "stretch", "skip"])
    .describe("actionable recommendation"),
  rationale: z.string(),
});

export type MatchScore = z.infer<typeof MatchScoreSchema>;

const postingUrl = z.string().trim().max(2048).refine(value => {
  if (!value) return true;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}, "Use an http or https posting URL, or leave it blank.");

export const ManualListingDraftSchema = z.object({
  title: z.string().trim().max(200),
  company: z.string().trim().max(200),
  description: z.string().trim().max(50_000),
  url: postingUrl,
  location: z.string().trim().max(300),
  salary: z.string().trim().max(200),
});
export const ManualListingCreateSchema = ManualListingDraftSchema.extend({
  requestId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  company: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(50_000),
}).strict();
export type ManualListingDraft = z.infer<typeof ManualListingDraftSchema>;
export type ManualListingCreate = z.infer<typeof ManualListingCreateSchema>;

