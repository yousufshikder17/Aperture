import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { and, desc, eq } from "drizzle-orm";
import { db, listings, matches, profiles } from "@aperture/db";
import { scoreListing as defaultScoreListing, simulateAts } from "@aperture/ai";
import type { Listing, ListingRows } from "@aperture/shared";
import { consumeQuota as defaultConsumeQuota } from "../middleware/tier.js";
import { requireAdmin } from "../middleware/authorization.js";
import { scanFeeds } from "../services/aggregator.js";

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

async function persistMatch(
  userId: string,
  row: typeof listings.$inferSelect,
  profile: NonNullable<Awaited<ReturnType<typeof requireProfile>>>,
  score: Awaited<ReturnType<typeof defaultScoreListing>>,
) {
  const saved = await db()
    .insert(matches)
    .values({ userId, listingId: row.id, profileVersion: profile.version, score })
    .onConflictDoUpdate({
      target: [matches.userId, matches.listingId],
      set: { score, profileVersion: profile.version, createdAt: new Date() },
    })
    .returning();
  return saved[0];
}

type MatchProfile = NonNullable<Awaited<ReturnType<typeof requireProfile>>>;
// Shared catalog, owner-scoped match results. Detail reads are not limited to the latest 100.
async function loadRows(userId: string, id?: string): Promise<ListingRows> {
  const rows = await db().select().from(listings)
    .leftJoin(matches, and(eq(matches.listingId, listings.id), eq(matches.userId, userId)))
    .where(id ? eq(listings.id, id) : undefined)
    .orderBy(desc(listings.createdAt)).limit(id ? 1 : 100);
  return rows.map(row => ({ listing: toListing(row.listings), match: row.matches?.score ?? null,
    profileVersion: row.matches?.profileVersion ?? null }));
}
type MatchListing = NonNullable<Awaited<ReturnType<typeof requireListing>>>;

declare module "hono" {
  interface ContextVariableMap {
    matchProfile: MatchProfile;
    matchListing: MatchListing;
  }
}

export interface ListingRouteDependencies {
  loadRows?: typeof loadRows;
  scanFeeds?: typeof scanFeeds;
  loadProfile?: typeof requireProfile;
  loadListing?: typeof requireListing;
  scoreListing?: typeof defaultScoreListing;
  persistMatch?: typeof persistMatch;
  consumeQuota?: typeof defaultConsumeQuota;
}

export function createListingRoutes(
  dependencies: ListingRouteDependencies = {},
) {
  const listingRoutes = new Hono();
  const loadProfile = dependencies.loadProfile ?? requireProfile;
  const loadListing = dependencies.loadListing ?? requireListing;
  const scoreListing = dependencies.scoreListing ?? defaultScoreListing;
  const saveMatch = dependencies.persistMatch ?? persistMatch;
  const consumeQuota = dependencies.consumeQuota ?? defaultConsumeQuota;

  listingRoutes.get("/", async (c) => {
    const user = c.get("user");
    return c.json(await (dependencies.loadRows ?? loadRows)(user.id));
  });

  listingRoutes.get("/:id", async c => {
    const id = c.req.param("id");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      return c.json({ error: "listing_not_found" }, 404);
    const rows = await (dependencies.loadRows ?? loadRows)(c.get("user").id, id);
    return rows[0] ? c.json(rows[0]) : c.json({ error: "listing_not_found" }, 404);
  });

  // Feed ingestion mutates the shared listing catalog, so only verified admins may run it.
  listingRoutes.post("/scan", requireAdmin(), async (c) =>
    c.json(await (dependencies.scanFeeds ?? scanFeeds)()),
  );

  const requireMatchInputs = createMiddleware(async (c, next) => {
    const profile = await loadProfile(c.get("user").id);
    if (!profile) return c.json({ error: "no_master_resume" }, 409);
    const row = await loadListing(c.req.param("id")!);
    if (!row) return c.json({ error: "listing_not_found" }, 404);
    c.set("matchProfile", profile);
    c.set("matchListing", row);
    await next();
  });

  listingRoutes.post(
    "/:id/match",
    requireMatchInputs,
    consumeQuota("matches"),
    async (c) => {
      const user = c.get("user");
      const profile = c.get("matchProfile");
      const row = c.get("matchListing");
      const score = await scoreListing(profile.masterResume!, toListing(row));
      return c.json(await saveMatch(user.id, row, profile, score));
    },
  );

  // Lightweight gap analysis: transparent keyword coverage with no private prompt or model call.
  listingRoutes.post("/:id/ats", async (c) => {
    const user = c.get("user");
    const profile = await loadProfile(user.id);
    if (!profile) return c.json({ error: "no_master_resume" }, 409);
    const row = await loadListing(c.req.param("id"));
    if (!row) return c.json({ error: "listing_not_found" }, 404);
    return c.json(await simulateAts(profile.masterResume!, toListing(row)));
  });

  return listingRoutes;
}

export const listingRoutes = createListingRoutes();
