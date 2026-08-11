import type { Listing, MasterResume, MatchScore } from "@aperture/shared";
import { heuristicMatchScore } from "./heuristic/match.js";

/** Deterministic public scorer; its weights and evidence are visible in the result. */
export async function scoreListing(
  profile: MasterResume,
  listing: Listing,
): Promise<MatchScore> {
  return heuristicMatchScore(profile, listing);
}
