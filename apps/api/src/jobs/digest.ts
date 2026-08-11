import { and, desc, eq, gte } from "drizzle-orm";
import { db, listings, matches } from "@aperture/db";

// Daily digest: the top listings worth applying to today — fresh listings
// ranked by match score with an actionable verdict. Run on a daily cron
// (after the ingest job) and delivered via email in production; the /v1/digest
// route serves the same payload on demand.

export async function buildDigest(userId: string, limit = 10) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const rows = await db()
    .select()
    .from(matches)
    .innerJoin(listings, eq(listings.id, matches.listingId))
    .where(and(eq(matches.userId, userId), gte(listings.createdAt, since)))
    .orderBy(desc(matches.createdAt));

  return rows
    .map((r) => ({
      listing: {
        id: r.listings.id,
        title: r.listings.title,
        company: r.listings.company,
        url: r.listings.url,
      },
      score: r.matches.score.overall,
      verdict: r.matches.score.verdict,
      strengths: r.matches.score.strengths,
    }))
    .filter((d) => d.verdict === "apply_now" || d.verdict === "consider")
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
