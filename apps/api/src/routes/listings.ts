import { loadAccessibleListing, loadListingRows, toListing } from "../services/listing-storage.js";
import { createManualListingRoutes } from "./manual-listings.js";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { db, listings, matches, profiles } from "@aperture/db";
import { scoreListing as defaultScoreListing, simulateAts } from "@aperture/ai";
import type { Listing, ListingRows } from "@aperture/shared";
import { consumeQuota as defaultConsumeQuota } from "../middleware/tier.js";
import { requireAdmin } from "../middleware/authorization.js";
import { scanFeeds } from "../services/aggregator.js";

async function requireProfile(userId: string) {
  const rows = await db().select().from(profiles).where(eq(profiles.userId, userId));
  const profile = rows[0];
  return profile?.masterResume ? profile : null;
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
type MatchListing = NonNullable<Awaited<ReturnType<typeof loadAccessibleListing>>>;

declare module "hono" {
  interface ContextVariableMap {
    matchProfile: MatchProfile;
    matchListing: MatchListing;
  }
}

export interface ListingRouteDependencies {
  loadRows?: typeof loadListingRows;
  scanFeeds?: typeof scanFeeds;
  loadProfile?: typeof requireProfile;
  loadListing?: typeof loadAccessibleListing;
  scoreListing?: typeof defaultScoreListing;
  persistMatch?: typeof persistMatch;
  consumeQuota?: typeof defaultConsumeQuota;
}

export function createListingRoutes(
  dependencies: ListingRouteDependencies = {},
) {
  const listingRoutes = new Hono();
  listingRoutes.route("/", createManualListingRoutes());
  const loadProfile = dependencies.loadProfile ?? requireProfile;
  const loadListing = dependencies.loadListing ?? loadAccessibleListing;
  const scoreListing = dependencies.scoreListing ?? defaultScoreListing;
  const saveMatch = dependencies.persistMatch ?? persistMatch;
  const consumeQuota = dependencies.consumeQuota ?? defaultConsumeQuota;

  listingRoutes.get("/", async (c) => {
    const user = c.get("user");
    return c.json(await (dependencies.loadRows ?? loadListingRows)(user.id));
  });

  listingRoutes.get("/:id", async c => {
    const id = c.req.param("id");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      return c.json({ error: "listing_not_found" }, 404);
    const rows = await (dependencies.loadRows ?? loadListingRows)(c.get("user").id, id);
    return rows[0] ? c.json(rows[0]) : c.json({ error: "listing_not_found" }, 404);
  });

  // Feed ingestion mutates the shared listing catalog, so only verified admins may run it.
  listingRoutes.post("/scan", requireAdmin(), async (c) =>
    c.json(await (dependencies.scanFeeds ?? scanFeeds)()),
  );

  const requireMatchInputs = createMiddleware(async (c, next) => {
    const profile = await loadProfile(c.get("user").id);
    if (!profile) return c.json({ error: "no_master_resume" }, 409);
    const row = await loadListing(c.req.param("id")!, c.get("user").id);
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
    const row = await loadListing(c.req.param("id"), user.id);
    if (!row) return c.json({ error: "listing_not_found" }, 404);
    return c.json(await simulateAts(profile.masterResume!, toListing(row)));
  });

  return listingRoutes;
}

export const listingRoutes = createListingRoutes();
