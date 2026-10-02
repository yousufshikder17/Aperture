import { and, desc, eq, gte, ne } from "drizzle-orm";
import { db, listings, matches, type Db } from "@aperture/db";
import { toListing } from "../services/listing-storage.js";
import type { Job, JobTransaction } from "./queue.js";

// Daily digest: the top listings worth applying to today — fresh listings
// ranked by match score with an actionable verdict. Run on a daily cron
// (after the ingest job) and delivered via email in production; the /v1/digest
// route serves the same payload on demand.

export async function buildDigest(userId: string, limit = 10, database: Db | JobTransaction = db()) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const rows = await database
    .select()
    .from(matches)
    .innerJoin(listings, eq(listings.id, matches.listingId))
    .where(and(eq(matches.userId, userId), gte(listings.createdAt, since), ne(listings.availability, "closed")))
    .orderBy(desc(matches.createdAt));

  return rows
    .map((r) => ({
      listing: {
        id: r.listings.id,
        title: r.listings.title,
        company: r.listings.company,
        url: toListing(r.listings).url,
      },
      score: r.matches.score.overall,
      verdict: r.matches.score.verdict,
      strengths: r.matches.score.strengths,
    }))
    .filter((d) => d.verdict === "apply_now" || d.verdict === "consider")
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function digestRecipients(env: NodeJS.ProcessEnv = process.env) {
  const ids = [...new Set((env.DIGEST_USER_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean))];
  if (ids.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))
    throw new Error("DIGEST_USER_IDS must contain comma-separated user UUIDs");
  if (ids.length && (!env.RESEND_API_KEY || !env.DIGEST_FROM))
    throw new Error("Digest delivery requires RESEND_API_KEY and DIGEST_FROM");
  return ids;
}

export async function deliverDigest(job: Job, send: typeof fetch = fetch, now = Date.now()) {
  // Resend keeps idempotency keys for 24 hours. Never retry outside that window.
  if (now - job.createdAt.getTime() >= 23 * 60 * 60 * 1000) throw new Error("DigestExpired");
  if (!process.env.RESEND_API_KEY) throw new Error("MissingMailConfiguration");
  const response = await send("https://api.resend.com/emails", {
    method: "POST", signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json",
      "Idempotency-Key": job.id },
    body: JSON.stringify({ from: job.payload.from, to: [job.payload.to],
      subject: "Your Aperture job matches", text: job.payload.text }),
  });
  if (!response.ok) throw new Error("DigestDeliveryFailed");
}
