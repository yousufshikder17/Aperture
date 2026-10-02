import { isDeepStrictEqual } from "node:util";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, listings, listingSources, type Db } from "@aperture/db";
import { canonicalAvailability, NormalizedJobSchema, sourceIdentity, type NormalizedJob } from "./normalized-job.js";

export class ListingIdentityConflict extends Error {
  constructor() { super("Conflicting listing identities require review"); this.name = "ListingIdentityConflict"; }
}
export type ReconciliationResult = {
  listingId: string;
  outcome: "created" | "unchanged" | "changed" | "duplicate";
  changed: boolean;
  stale: boolean;
};

function content(job: NormalizedJob) {
  return { url: job.url, title: job.title, company: job.company, description: job.description,
    location: job.location, salary: job.salary, postedAt: job.postedAt };
}
function isStale(job: NormalizedJob, source: typeof listingSources.$inferSelect | undefined) {
  return !!source && (job.observedAt < source.lastSeenAt ||
    !!(job.sourceUpdatedAt && source.sourceUpdatedAt && job.sourceUpdatedAt < source.sourceUpdatedAt));
}

// All adapter writes and identity decisions commit together.
export async function reconcileListings(input: NormalizedJob[], database: Db = db()) {
  const jobs = input.map(job => NormalizedJobSchema.parse(job));
  if (!jobs.length) return [] as ReconciliationResult[];
  return database.transaction(async tx => {
    // ponytail: serialize reconciliation batches; partition identity locks if ingestion throughput requires it.
    // Separate from the durable-worker lock: HTTP scans and retries share this same boundary.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(180246, 2)`);
    const results: ReconciliationResult[] = [];
    for (const job of jobs) {
      const key = sourceIdentity(job);
      let [representation] = await tx.select().from(listingSources).where(and(
        eq(listingSources.source, job.source), eq(listingSources.namespace, job.namespace), eq(listingSources.identityKey, key)));
      // Do not let an older response undo a newer description, URL, or closure.
      const stale = isStale(job, representation);
      const urlSources = stale ? [] : await tx.select().from(listingSources).where(eq(listingSources.url, job.url));
      const urlListings = stale ? [] : await tx.select().from(listings).where(eq(listings.url, job.url));
      // Manual content never participates in public-source identity reconciliation.
      if (urlListings.some(row => row.source === "manual")) throw new ListingIdentityConflict();
      const candidates = new Set([...urlSources.map(row => row.listingId), ...urlListings.map(row => row.id)]);
      if (representation) candidates.add(representation.listingId);
      if (candidates.size > 1) throw new ListingIdentityConflict();
      const sameScope = urlSources.filter(row => row.source === job.source && row.namespace === job.namespace);
      if (sameScope.some(row => job.externalId !== null && row.externalId !== null && row.externalId !== job.externalId))
        throw new ListingIdentityConflict();
      if (!representation) {
        // Promote URL-only identities once a GUID becomes available; missing GUIDs never downgrade a known ID.
        representation = sameScope[0] ?? urlSources.find(row => row.source === job.source && row.namespace === "legacy");
      }
      if (isStale(job, representation)) {
        results.push({ listingId: representation!.listingId, outcome: "unchanged", changed: false, stale: true });
        continue;
      }
      let canonicalId = representation?.listingId ?? [...candidates][0];
      let created = false;
      if (!canonicalId) {
        const [row] = await tx.insert(listings).values({ ...content(job), source: job.source, raw: job.raw,
          availability: job.availability, closedAt: job.availability === "closed" ? job.observedAt : null,
          createdAt: job.observedAt, lastSeenAt: job.observedAt, lastChangedAt: job.observedAt }).returning();
        canonicalId = row!.id; created = true;
      }
      const [canonical] = await tx.select().from(listings).where(and(eq(listings.id, canonicalId), ne(listings.source, "manual"))).for("update");
      if (!canonical) throw new ListingIdentityConflict();
      const existingSources = await tx.select().from(listingSources).where(eq(listingSources.listingId, canonicalId));
      const duplicate = !created && !representation;
      const primary = representation?.isPrimary ?? !existingSources.length;
      const snapshot = JSON.parse(JSON.stringify({ ...content(job), raw: job.raw })) as Record<string, unknown>;
      const values = { listingId: canonicalId, source: job.source,
        namespace: job.namespace,
        identityKey: job.externalId === null && representation?.externalId ? representation.identityKey : key,
        externalId: job.externalId ?? representation?.externalId ?? null,
        url: job.url, isPrimary: primary, availability: job.availability,
        snapshot, sourceUpdatedAt: job.sourceUpdatedAt ?? representation?.sourceUpdatedAt ?? null,
        lastSeenAt: job.observedAt };
      if (!representation) {
        await tx.insert(listingSources).values({ ...values, createdAt: job.observedAt });
      } else {
        const previous = Object.fromEntries(Object.keys(values).map(field => [field, representation![field as keyof typeof representation]]));
        if (!isDeepStrictEqual(previous, values)) await tx.update(listingSources).set(values).where(eq(listingSources.id, representation.id));
      }
      const sources = await tx.select({ availability: listingSources.availability }).from(listingSources)
        .where(eq(listingSources.listingId, canonicalId));
      const availability = canonicalAvailability(sources.map(row => row.availability));
      const currentContent = { url: canonical.url, title: canonical.title, company: canonical.company,
        description: canonical.description, location: canonical.location, salary: canonical.salary, postedAt: canonical.postedAt };
      // First representation owns canonical content. Secondary feeds cannot oscillate its description.
      const contentChanged = primary && !isDeepStrictEqual(currentContent, content(job));
      const statusChanged = availability !== canonical.availability;
      const changed = contentChanged || statusChanged;
      const seenLater = job.observedAt > canonical.lastSeenAt;
      if (changed || seenLater) await tx.update(listings).set({
        ...(contentChanged ? { ...content(job), raw: job.raw } : {}),
        ...(seenLater ? { lastSeenAt: job.observedAt } : {}),
        ...(changed ? { lastChangedAt: sql`clock_timestamp()` } : {}),
        ...(statusChanged ? { availability, closedAt: availability === "closed" ? sql`clock_timestamp()` : null } : {}),
      }).where(eq(listings.id, canonicalId));
      results.push({ listingId: canonicalId, outcome: created ? "created" : duplicate ? "duplicate" : changed ? "changed" : "unchanged", changed, stale: false });
    }
    return results;
  });
}
