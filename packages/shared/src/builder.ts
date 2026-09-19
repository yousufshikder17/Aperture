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
