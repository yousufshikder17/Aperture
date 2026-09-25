import { eq } from "drizzle-orm";
import { db, listings, matches, profiles } from "@aperture/db";
import { buildSkillGaps } from "../lib/gap-analysis.js";

export const gapStore = {
  async loadResume(userId: string) {
    const rows = await db().select({ resume: profiles.masterResume }).from(profiles)
      .where(eq(profiles.userId, userId));
    return rows[0]?.resume ?? null;
  },
  async loadListings(userId: string) {
    return db().select({ title: listings.title, description: listings.description })
      .from(matches).innerJoin(listings, eq(listings.id, matches.listingId))
      .where(eq(matches.userId, userId));
  },
};

export async function loadSkillGaps(userId: string, store = gapStore) {
  const resume = await store.loadResume(userId);
  if (!resume) return [];
  return buildSkillGaps(resume, await store.loadListings(userId));
}
