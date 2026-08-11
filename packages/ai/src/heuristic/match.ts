import type { Listing, MasterResume, MatchScore } from "@aperture/shared";
import { heuristicAtsSimulation } from "./ats.js";
import { normalize } from "./keywords.js";

// Heuristic (manual) match scorer — rule-based estimate, zero AI cost.
// Cruder than the AI engine but deterministic: good for bulk pre-filtering,
// offline mode, CI, and the free tier at zero COGS.

const SENIORITY_ORDER = [
  "intern",
  "junior",
  "mid",
  "senior",
  "staff",
  "principal",
  "lead",
  "manager",
  "director",
] as const;

function seniorityOf(text: string): number {
  const norm = normalize(text);
  for (let i = SENIORITY_ORDER.length - 1; i >= 0; i--) {
    if (norm.includes(SENIORITY_ORDER[i]!)) return i;
  }
  return 2; // unmarked titles read as mid-level
}

function yearsOfExperience(profile: MasterResume): number {
  const startYears = profile.experience
    .map((e) => Number.parseInt(e.start.slice(0, 4), 10))
    .filter((y) => Number.isFinite(y));
  if (startYears.length === 0) return 0;
  return Math.max(0, new Date().getFullYear() - Math.min(...startYears));
}

function experienceScore(profile: MasterResume, listing: Listing): number {
  const wanted = /(\d+)\s*\+?\s*years?/i.exec(listing.description);
  if (!wanted) return 70; // no explicit ask — neutral-positive
  const required = Number.parseInt(wanted[1]!, 10);
  const has = yearsOfExperience(profile);
  if (has >= required) return 95;
  if (has >= required - 1) return 70;
  return Math.max(20, 70 - (required - has) * 15);
}

function locationScore(profile: MasterResume, listing: Listing): number {
  if (!listing.location) return 70;
  const loc = normalize(listing.location);
  if (loc.includes("remote")) return 85;
  const userLoc = normalize(profile.basics.location ?? "");
  if (!userLoc) return 50;
  const overlap = userLoc.split(" ").some((t) => t.length > 2 && loc.includes(t));
  return overlap ? 95 : 40;
}

export function heuristicMatchScore(profile: MasterResume, listing: Listing): MatchScore {
  const ats = heuristicAtsSimulation(profile, listing);

  const latestTitle = profile.experience[0]?.title ?? "";
  const seniorityGap = Math.abs(seniorityOf(listing.title) - seniorityOf(latestTitle));
  const seniority = seniorityGap === 0 ? 95 : seniorityGap === 1 ? 70 : Math.max(25, 70 - seniorityGap * 20);

  const subscores = {
    skills: ats.keywordCoverage,
    experience: experienceScore(profile, listing),
    seniority,
    location: locationScore(profile, listing),
  };

  const overall = Math.round(
    subscores.skills * 0.45 +
      subscores.experience * 0.25 +
      subscores.seniority * 0.2 +
      subscores.location * 0.1,
  );

  const verdict =
    overall >= 75 && ats.likelyOutcome === "pass"
      ? "apply_now"
      : overall >= 60
        ? "consider"
        : overall >= 45
          ? "stretch"
          : "skip";

  return {
    overall,
    subscores,
    strengths: ats.matchedKeywords.slice(0, 5).map((k) => `Resume shows "${k}"`),
    concerns: ats.missingKeywords.slice(0, 5).map((k) => `Posting emphasizes "${k}" — not visible in resume`),
    verdict,
    rationale:
      "Deterministic estimate: skills 45%, experience 25%, seniority 20%, location 10%.",
  };
}
