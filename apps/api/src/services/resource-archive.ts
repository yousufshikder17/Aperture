import { and, desc, eq } from "drizzle-orm";
import { db, resourceArchive, resources, type Db } from "@aperture/db";
import type { ArchivePatch } from "@aperture/shared";

export async function listArchive(userId: string, database: Db = db()) {
  const rows = await database.select().from(resourceArchive)
    .innerJoin(resources, eq(resources.id, resourceArchive.resourceId))
    .where(eq(resourceArchive.userId, userId))
    .orderBy(desc(resourceArchive.savedAt), desc(resourceArchive.id));
  return rows.map(row => ({ ...row.resource_archive, resource: row.resources }));
}

export async function updateArchive(userId: string, id: string, patch: ArchivePatch, database: Db = db()) {
  const [row] = await database.update(resourceArchive).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(resourceArchive.id, id), eq(resourceArchive.userId, userId))).returning();
  return row ?? null;
}
