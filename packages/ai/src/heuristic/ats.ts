import type { AtsSimulation, Listing, MasterResume } from "@aperture/shared";
import { listingSkillTerms, resumeText } from "./keywords.js";

// Heuristic (manual) ATS simulation — deterministic keyword matching, zero AI
// cost. Arguably closer to how naive ATS software actually behaves than an
// AI judgment is. Cannot see visual layout, so formatIssues stays empty; the
// PDF-extraction layoutFindings cover that side.

export function heuristicAtsSimulation(
  profile: MasterResume,
  listing: Listing,
): AtsSimulation {
  const keywords = listingSkillTerms(`${listing.title}\n${listing.description}`, profile);
  const haystack = resumeText(profile);

  const matched: string[] = [];
  const missing: string[] = [];
  for (const kw of keywords) {
    (haystack.includes(kw.term) ? matched : missing).push(kw.term);
  }

  const coverage = keywords.length ? Math.round((matched.length / keywords.length) * 100) : 0;

  return {
    score: coverage,
    keywordCoverage: coverage,
    matchedKeywords: matched,
    missingKeywords: missing,
    formatIssues: [],
    likelyOutcome: coverage >= 70 ? "pass" : coverage >= 45 ? "borderline" : "filtered_out",
  };
}
