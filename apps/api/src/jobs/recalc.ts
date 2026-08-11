import { eq } from "drizzle-orm";
import { db, improvementHistory, listings, matches, profiles } from "@aperture/db";
import { scoreListing, simulateAts } from "@aperture/ai";
import type { Listing } from "@aperture/shared";

const queue = new Set<string>();
let draining = false;

export function enqueueRecalc(userId: string) {
  queue.add(userId);
  if (!draining) void drain();
}

async function drain() {
  draining = true;
  try {
    for (const userId of queue) {
      queue.delete(userId);
      await recalcUser(userId).catch((error) => console.error(`recalc failed for ${userId}:`, error));
    }
  } finally {
    draining = false;
  }
}

async function recalcUser(userId: string) {
  const profileRows = await db().select().from(profiles).where(eq(profiles.userId, userId));
  const profile = profileRows[0];
  if (!profile?.masterResume) return;

  const existing = await db()
    .select()
    .from(matches)
    .innerJoin(listings, eq(listings.id, matches.listingId))
    .where(eq(matches.userId, userId));

  const matchScores: number[] = [];
  const atsScores: number[] = [];
  for (const row of existing) {
    const listing: Listing = {
      id: row.listings.id,
      source: row.listings.source as Listing["source"],
      url: row.listings.url,
      title: row.listings.title,
      company: row.listings.company,
      location: row.listings.location,
      salary: row.listings.salary,
      description: row.listings.description,
      postedAt: row.listings.postedAt?.toISOString() ?? null,
    };
    const [score, ats] = await Promise.all([
      scoreListing(profile.masterResume, listing),
      simulateAts(profile.masterResume, listing),
    ]);
    matchScores.push(score.overall);
    atsScores.push(ats.score);
    await db().update(matches).set({ score, profileVersion: profile.version }).where(eq(matches.id, row.matches.id));
  }

  const average = (values: number[]) => values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
  const avgMatch = average(matchScores);
  const avgAts = average(atsScores);
  const profileStrength = avgMatch !== null && avgAts !== null
    ? 0.6 * avgMatch + 0.4 * avgAts
    : (avgMatch ?? avgAts);

  await db().insert(improvementHistory).values({
    userId,
    profileVersion: profile.version,
    profileStrength,
    avgMatchScore: avgMatch,
    avgAtsScore: avgAts,
  });
}
