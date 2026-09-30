import { and, desc, eq } from "drizzle-orm";
import { applications, listings, db, type Db } from "@aperture/db";
import type { ApplicationCreate, ApplicationPatch } from "@aperture/shared";
import { loadAccessibleListing } from "./listing-storage.js";
import { applicationChanges } from "../lib/application-changes.js";

export function applicationStore(database: Db = db()) {
  return {
    async list(userId: string) {
      const rows = await database.select().from(applications)
        .innerJoin(listings, eq(listings.id, applications.listingId))
        .where(eq(applications.userId, userId)).orderBy(desc(applications.createdAt), desc(applications.id));
      return rows.map(row => ({ ...row.applications, listing: { title: row.listings.title, company: row.listings.company } }));
    },
    async create(userId: string, body: ApplicationCreate) {
      const listing = await loadAccessibleListing(body.listingId, userId, database);
      if (!listing) return null;
      const [row] = await database.insert(applications).values({ userId, ...body,
        ...applicationChanges({ status: "", appliedAt: null, events: [] }, body),
      }).returning();
      return { ...row!, listing: { title: listing.title, company: listing.company } };
    },
    async update(userId: string, id: string, body: ApplicationPatch) {
      // Serialize edits so independent notes changes cannot discard status history.
      return database.transaction(async tx => {
        const owner = and(eq(applications.id, id), eq(applications.userId, userId));
        const [current] = await tx.select().from(applications).where(owner).for("update");
        if (!current) return null;
        const [row] = await tx.update(applications).set(applicationChanges(current, body)).where(owner).returning();
        const [listing] = await tx.select().from(listings).where(eq(listings.id, current.listingId));
        return { ...row!, listing: { title: listing!.title, company: listing!.company } };
      });
    },
  };
}
