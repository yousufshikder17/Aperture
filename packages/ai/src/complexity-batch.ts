import {
  ComplexityAssessmentSchema,
  type ComplexityAssessment,
  type RegistryEntry,
} from "@aperture/shared";
import { getProvider } from "./provider/index.js";

// Complexity assessment runs at index time, not during user-facing reads.
// generateMany lets each adapter pick its mechanism: Claude uses the Message
// Batches API (50% price, offline); Gemini runs a bounded-concurrency loop.
// Mechanical classification → fast tier.

const INSTRUCTIONS = `Assess a learning resource for a job-skill development platform.
Judge from the title, kind, target skills, and URL. Classify:
- level: what background a learner needs to benefit (beginner/intermediate/advanced)
- timeCommitment: realistic time to complete or get meaningful value (hours/days/weeks/months)
- prerequisites: concrete skills/concepts needed first (empty array if truly none)
- summary: one sentence on what the learner gets out of it.`;

export async function assessComplexity(
  entries: RegistryEntry[],
): Promise<Map<string, ComplexityAssessment>> {
  return getProvider().generateMany(
    entries.map((entry) => ({
      id: entry.id,
      request: {
        tier: "fast" as const,
        system: [{ text: INSTRUCTIONS }],
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              title: entry.title,
              kind: entry.kind,
              url: entry.url,
              skills: entry.skills,
            }),
          },
        ],
        schema: ComplexityAssessmentSchema,
        maxTokens: 1024,
      },
    })),
  );
}
