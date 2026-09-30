import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import { db, listings, matches, type Db } from "@aperture/db";
import type { Listing, ManualListingCreate } from "@aperture/shared";

export function listingVisibility(userId: string) {
  return or(ne(listings.source, "manual"), sql`${listings.raw}->>'ownerId' = ${userId}`);
}

export async function loadAccessibleListing(id: string, userId: string, database: Db = db()) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const [row] = await database.select().from(listings).where(and(eq(listings.id, id),
    listingVisibility(userId)));
  return row ?? null;
}

export function toListing(row: typeof listings.$inferSelect): Listing {
  const raw = row.raw as { originalUrl?: string } | null;
  return { id: row.id, source: row.source as Listing["source"],
    url: row.source === "manual" ? raw?.originalUrl ?? "" : row.url,
    title: row.title, company: row.company, description: row.description,
    location: row.location, salary: row.salary, postedAt: row.postedAt?.toISOString() ?? null };
}

export async function createManualListing(userId: string, input: ManualListingCreate, database: Db = db()) {
  return database.transaction(async tx => {
    // Internal URL scopes retries to the owner; original URLs never deduplicate private content across users.
    const key = `manual:${userId}:${input.requestId}`;
    await tx.insert(listings).values({ source: "manual", url: key, title: input.title,
      company: input.company, description: input.description, location: input.location || null,
      salary: input.salary || null, raw: { ownerId: userId, originalUrl: input.url },
    }).onConflictDoNothing();
    const [row] = await tx.select().from(listings).where(eq(listings.url, key));
    if (!row) throw new Error("ManualListingNotSaved");
    const saved = toListing(row);
    if (saved.title !== input.title || saved.company !== input.company || saved.description !== input.description ||
      saved.url !== input.url || (saved.location ?? "") !== input.location || (saved.salary ?? "") !== input.salary)
      return null; // The same retry key must not silently discard a revised draft.
    return saved;
  });
}


export async function loadListingRows(userId: string, id?: string, database: Db = db()) {
  const rows = await database.select().from(listings)
    .leftJoin(matches, and(eq(matches.listingId, listings.id), eq(matches.userId, userId)))
    .where(and(listingVisibility(userId), id ? eq(listings.id, id) : undefined))
    .orderBy(desc(listings.createdAt)).limit(id ? 1 : 100);
  return rows.map(row => ({ listing: toListing(row.listings), match: row.matches?.score ?? null,
    profileVersion: row.matches?.profileVersion ?? null }));
}
