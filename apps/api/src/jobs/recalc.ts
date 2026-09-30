import type { JobTransaction } from "./queue.js";
import { and, eq } from "drizzle-orm";
import { improvementHistory, listings, matches, profiles } from "@aperture/db";
import { scoreListing, simulateAts } from "@aperture/ai";
import { toListing } from "../services/listing-storage.js";

export async function recalcUser(userId: string, tx: JobTransaction) {
  const profileRows = await tx.select().from(profiles).where(eq(profiles.userId, userId));
  const profile = profileRows[0];
  if (!profile?.masterResume) return;
  const [snapshot] = await tx.select({ id: improvementHistory.id }).from(improvementHistory)
    .where(and(eq(improvementHistory.userId, userId), eq(improvementHistory.profileVersion, profile.version))).limit(1);
  if (snapshot) return;

  const existing = await tx
    .select()
    .from(matches)
    .innerJoin(listings, eq(listings.id, matches.listingId))
    .where(eq(matches.userId, userId));

  const updates: { id: string; score: Awaited<ReturnType<typeof scoreListing>> }[] = [];
  const matchScores: number[] = [];
  const atsScores: number[] = [];
  for (const row of existing) {
    const listing = toListing(row.listings);
    const [score, ats] = await Promise.all([
      scoreListing(profile.masterResume, listing),
      simulateAts(profile.masterResume, listing),
    ]);
    matchScores.push(score.overall);
    atsScores.push(ats.score);
    updates.push({ id: row.matches.id, score });
  }

  const [current] = await tx.select().from(profiles).where(eq(profiles.userId, userId)).for("update");
  if (current?.version !== profile.version) return;
  for (const update of updates) await tx.update(matches)
    .set({ score: update.score, profileVersion: profile.version }).where(eq(matches.id, update.id));

  const average = (values: number[]) => values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
  const avgMatch = average(matchScores);
  const avgAts = average(atsScores);
  const profileStrength = avgMatch !== null && avgAts !== null
    ? 0.6 * avgMatch + 0.4 * avgAts
    : (avgMatch ?? avgAts);

  await tx.insert(improvementHistory).values({
    userId,
    profileVersion: profile.version,
    profileStrength,
    avgMatchScore: avgMatch,
    avgAtsScore: avgAts,
  });
}
