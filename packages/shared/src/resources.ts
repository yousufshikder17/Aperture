import { z } from "zod";

// Complexity tags are resolved at index time, never during user-facing reads.
export const ComplexityAssessmentSchema = z.object({
  level: z.enum(["beginner", "intermediate", "advanced"]),
  timeCommitment: z.enum(["hours", "days", "weeks", "months"]),
  prerequisites: z
    .array(z.string())
    .describe("skills/concepts a learner needs before this resource is useful"),
  summary: z.string().describe("one sentence: what the learner gets out of it"),
});

export type ComplexityAssessment = z.infer<typeof ComplexityAssessmentSchema>;

// Registry entry shape for the configured JSON resource catalog.
export const RegistryEntrySchema = z.object({
  id: z.string().describe("stable slug, e.g. fieldfare-repo"),
  title: z.string(),
  url: z.string(),
  kind: z.enum(["youtube", "course", "documentation", "tutorial", "book", "repo", "article"]),
  skills: z.array(z.string()).describe("skill gaps this resource addresses"),
  free: z.boolean(),
  submittedBy: z.string().nullable(),
  // Optional tags avoid a provider call when the catalog already contains them.
  complexity: ComplexityAssessmentSchema.optional(),
});

export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;

export const RegistrySchema = z.object({
  version: z.number(),
  entries: z.array(RegistryEntrySchema),
});

export const ProgressSchema = z.enum(["not_started", "in_progress", "completed"]);
export type Progress = z.infer<typeof ProgressSchema>;

export const ArchiveSaveSchema = z.object({
  resourceId: z.string().trim().min(1).max(200), notes: z.string().max(10000).optional(),
});
export const ArchivePatchSchema = z.object({
  progress: ProgressSchema.optional(), notes: z.string().max(10000).optional(),
}).refine(value => value.progress !== undefined || value.notes !== undefined, "Provide progress or notes");
export const ResourceSummarySchema = z.object({
  id: z.string(), title: z.string(), url: z.string(), kind: z.string(), skills: z.array(z.string()),
  level: z.string().nullable(), timeCommitment: z.string().nullable(), summary: z.string().nullable(),
  complexityFlag: z.string().nullable().optional(),
});
export const ArchiveRecordSchema = z.object({
  id: z.string().uuid(), resourceId: z.string(), progress: ProgressSchema, notes: z.string().nullable(),
  savedAt: z.string(), updatedAt: z.string(),
});
export const ArchiveEntrySchema = ArchiveRecordSchema.extend({ resource: ResourceSummarySchema });
export type ResourceSummary = z.infer<typeof ResourceSummarySchema>;
export type ArchiveEntry = z.infer<typeof ArchiveEntrySchema>;
export type ArchivePatch = z.infer<typeof ArchivePatchSchema>;

// Aggregate gap analysis output ("73% of ML roles you target require PyTorch...").
export const SkillGapSchema = z.object({
  skill: z.string(),
  listingsRequiring: z.number(),
  listingsTotal: z.number(),
  frequencyPct: z.number(),
  estimatedScoreImpact: z.number().describe("avg match-score points lost to this gap"),
});

export type SkillGap = z.infer<typeof SkillGapSchema>;
