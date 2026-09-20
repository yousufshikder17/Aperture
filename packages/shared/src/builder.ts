import { z } from "zod";

// Response contract for optional coaching in the shared builder UI.
// The public edition does not implement the hosted coaching endpoint.
export const BulletSuggestionSchema = z.object({
  original: z.string(),
  issues: z.array(
    z.object({
      kind: z.enum(["passive_language", "no_metric", "vague_scope", "buzzword", "duty_not_outcome", "other"]),
      note: z.string(),
    }),
  ),
  metricPrompts: z.array(z.string()),
  rewrite: z.string(),
  rationale: z.string(),
});

export type BulletSuggestion = z.infer<typeof BulletSuggestionSchema>;

const score = z.number().min(0).max(100).nullable();
export const VersionSummarySchema = z.object({
  version: z.number().int().positive(),
  createdAt: z.string().refine(value => Number.isFinite(Date.parse(value)), "Invalid date"),
  note: z.string().nullable().optional(),
  profileStrength: score.optional().default(null),
  avgMatchScore: score.optional().default(null),
  avgAtsScore: score.optional().default(null),
});
export type VersionSummary = z.infer<typeof VersionSummarySchema>;
export const MarketSuggestionSchema = z.object({
  skill: z.string(), role_type: z.string().nullable(),
  listings_requiring: z.number().int().nonnegative().safe(),
  listings_total: z.number().int().nonnegative().safe(),
  frequency_pct: z.number().min(0).max(100).nullable(),
});
export type MarketSuggestion = z.infer<typeof MarketSuggestionSchema>;
