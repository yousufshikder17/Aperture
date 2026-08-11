import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { db, listings, matches, profiles } from "@aperture/db";
import { scoreListing, simulateAts } from "@aperture/ai";
import type { Listing } from "@aperture/shared";
import { consumeQuota } from "../middleware/tier.js";
import { requireAdmin } from "../middleware/authorization.js";
import { scanFeeds } from "../services/aggregator.js";

export const listingRoutes = new Hono();

function toListing(row: typeof listings.$inferSelect): Listing {
  return {
    id: row.id,
    source: row.source as Listing["source"],
    url: row.url,
    title: row.title,
    company: row.company,
    location: row.location,
    salary: row.salary,
    description: row.description,
    postedAt: row.postedAt?.toISOString() ?? null,
  };
}

async function requireProfile(userId: string) {
  const rows = await db().select().from(profiles).where(eq(profiles.userId, userId));
  const profile = rows[0];
  return profile?.masterResume ? profile : null;
}

async function requireListing(id: string) {
  const rows = await db().select().from(listings).where(eq(listings.id, id));
  return rows[0] ?? null;
}

listingRoutes.get("/", async (c) => {
  const user = c.get("user");
  const rows = await db()
    .select()
    .from(listings)
    .leftJoin(matches, and(eq(matches.listingId, listings.id), eq(matches.userId, user.id)))
    .orderBy(desc(listings.createdAt))
    .limit(100);
  return c.json(rows.map((row) => ({ listing: toListing(row.listings), match: row.matches?.score ?? null })));
});

// Feed ingestion mutates the shared listing catalog, so only verified admins may run it.
listingRoutes.post("/scan", requireAdmin(), async (c) => c.json(await scanFeeds()));

listingRoutes.post("/:id/match", consumeQuota("matches"), async (c) => {
  const user = c.get("user");
  const profile = await requireProfile(user.id);
  if (!profile) return c.json({ error: "no_master_resume" }, 409);
  const row = await requireListing(c.req.param("id"));
  if (!row) return c.json({ error: "listing_not_found" }, 404);

  const score = await scoreListing(profile.masterResume!, toListing(row));
  const saved = await db()
    .insert(matches)
    .values({ userId: user.id, listingId: row.id, profileVersion: profile.version, score })
    .onConflictDoUpdate({
      target: [matches.userId, matches.listingId],
      set: { score, profileVersion: profile.version, createdAt: new Date() },
    })
    .returning();
  return c.json(saved[0]);
});

// Lightweight gap analysis: transparent keyword coverage with no private prompt or model call.
listingRoutes.post("/:id/ats", async (c) => {
  const user = c.get("user");
  const profile = await requireProfile(user.id);
  if (!profile) return c.json({ error: "no_master_resume" }, 409);
  const row = await requireListing(c.req.param("id"));
  if (!row) return c.json({ error: "listing_not_found" }, 404);
  return c.json(await simulateAts(profile.masterResume!, toListing(row)));
});
