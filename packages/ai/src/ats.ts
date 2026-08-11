import type { AtsSimulation, Listing, MasterResume } from "@aperture/shared";
import { heuristicAtsSimulation } from "./heuristic/ats.js";

/** Transparent keyword-coverage simulation used by the public edition. */
export async function simulateAts(
  profile: MasterResume,
  listing: Listing,
): Promise<AtsSimulation> {
  return heuristicAtsSimulation(profile, listing);
}
