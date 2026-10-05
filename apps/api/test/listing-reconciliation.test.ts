import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "@aperture/db";
import { reconcileListings } from "../src/services/listing-reconciliation.js";
import type { NormalizedJob } from "../src/services/normalized-job.js";
import { applicationStore } from "../src/services/applications.js";
import { createManualListing } from "../src/services/listing-storage.js";
import { buildDigest } from "../src/jobs/digest.js";
import { scanFeeds } from "../src/services/aggregator.js";
import { rssSourceConfig } from "../src/services/rss-source.js";
import { loadListingRows } from "../src/services/listing-storage.js";

const enabled = { skip: !process.env.TEST_DATABASE_URL };

test("RSS adapter pipeline is idempotent and preserves canonical IDs and tracked applications", enabled, async () => fixture(async (db, sql, owner) => {
  const feed = { source: "linkedin_rss" as const, url: "https://example.test/adapter-feed" };
  const payload = (description: string) => '<rss><channel><item><guid>stable-guid</guid><title>Engineer at Example</title>' +
    '<link>https://example.test/adapter-job</link><description>' + description + '</description></item></channel></rss>';
  let text = payload("Original requirements");
  let observedAt = at;
  const scan = () => scanFeeds({ feeds: [feed], fetch: async () => new Response(text),
    context: { now: () => observedAt, log: () => {} },
    reconcile: jobs => reconcileListings(jobs, db) });
  assert.equal((await scan()).inserted, 1);
  const [canonical] = await db.select().from(schema.listings);
  const store = applicationStore(db);
  const application = await store.create(owner, { listingId: canonical!.id, status: "interviewing", notes: "Keep interview notes" });
  assert(application);
  assert.equal((await scan()).inserted, 0);
  observedAt = new Date(at.getTime() + 1000);
  text = payload("Updated requirements");
  assert.equal((await scan()).inserted, 0);
  const [updated] = await db.select().from(schema.listings);
  assert.equal(updated!.id, canonical!.id);
  assert.equal(updated!.description, "Updated requirements");
  assert.equal((await sql`SELECT * FROM listing_sources`).length, 1);
  const [identity] = await sql`SELECT * FROM listing_sources`;
  assert.equal(identity!.external_id, "stable-guid");
  assert.equal(identity!.namespace, rssSourceConfig(feed).sourceId);

  const [tracked] = await store.list(owner);
  assert.equal(tracked!.id, application.id);
  assert.equal(tracked!.listingId, canonical!.id);
  assert.equal(tracked!.status, application.status);
  assert.equal(tracked!.notes, application.notes);
  assert.deepEqual(tracked!.events, application.events);
  assert.equal(tracked!.appliedAt?.toISOString(), application.appliedAt?.toISOString());
  text = '<rss><channel/></rss>';
  assert.equal((await scan()).succeeded, 1);
  assert.equal((await sql`SELECT availability FROM listings`)[0]!.availability, "unknown");
  text = '<rss>';
  assert.equal((await scan()).succeeded, 0);
  assert.equal((await sql`SELECT * FROM listings`).length, 1);
}));
const at = new Date("2026-10-01T12:00:00Z");
function job(patch: Partial<NormalizedJob> = {}): NormalizedJob {
  return { source: "linkedin_rss", namespace: "test-board", externalId: "job-1", url: "https://example.test/job-1",
    title: "Engineer", company: "Example", description: "Build TypeScript services", location: null,
    salary: null, postedAt: null, sourceUpdatedAt: null, observedAt: at, availability: "unknown", raw: null, ...patch };
}

test("public RSS reconciles legacy rows, preserves catalog visibility, and never closes absent jobs", enabled, async () => fixture(async (db, sql, owner) => {
  const [legacy] = await sql`INSERT INTO listings (source,url,title,company,description,created_at)
    VALUES ('linkedin_rss','https://example.test/legacy','Engineer','Example','Legacy description','2000-01-01') RETURNING id`;
  const [manual] = await sql`INSERT INTO listings (source,url,title,company,description)
    VALUES ('manual','manual:legacy','Private','Example','Private content') RETURNING id`;
  const migration = await sql.reserve();
  try {
    const content = await readFile(new URL("../../../packages/db/migrations/003_listing_reconciliation.sql", import.meta.url), "utf8");
    await migration.unsafe(content); await migration.unsafe(content);
  } finally { migration.release(); }
  assert.equal((await sql`SELECT * FROM listing_sources WHERE listing_id = ${legacy!.id}`).length, 1);
  assert.equal((await sql`SELECT * FROM listing_sources WHERE listing_id = ${manual!.id}`).length, 0);
  const scan = (description: string, link = 'https://example.test/legacy') => scanFeeds({
    feeds: [{ source: 'linkedin_rss', url: 'https://example.test/feed' }],
    fetch: async () => new Response(`<rss><channel><item><guid>opaque-id</guid><title>Engineer at Example</title><link>${link}</link><description>${description}</description></item></channel></rss>`),
    reconcile: rows => reconcileListings(rows, db),
  });
  assert.equal((await scan('Updated')).inserted, 0);
  assert.equal((await scan('Updated again','https://example.test/moved')).inserted, 0);
  const [source] = await sql`SELECT * FROM listing_sources WHERE listing_id = ${legacy!.id}`;
  assert.equal(source!.external_id, 'opaque-id'); assert.notEqual(source!.namespace, 'legacy');
  const [row] = await sql`SELECT * FROM listings WHERE id = ${legacy!.id}`;
  assert.equal(row!.description, 'Updated again'); assert.equal(row!.url, 'https://example.test/moved');
  const rows = await loadListingRows(owner, undefined, db);
  assert.equal(rows.length, 1); assert.equal(rows[0]!.listing.id, legacy!.id);
  assert.equal((await loadListingRows(randomUUID(), undefined, db)).length, 1, 'shared catalog does not require private discoveries');
  await scanFeeds({ feeds: [{ source: 'linkedin_rss', url: 'https://example.test/feed' }],
    fetch: async () => new Response('<rss><channel><title>Empty window</title></channel></rss>'),
    reconcile: () => { throw Error('RSS absence must not cause reconciliation'); },
  });
  assert.equal((await sql`SELECT availability FROM listings WHERE id = ${legacy!.id}`)[0]!.availability, 'unknown');
}));
async function fixture(run: (database: ReturnType<typeof drizzle<typeof schema>>, connection: ReturnType<typeof postgres>, owner: string) => Promise<void>) {
  const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1, onnotice() {} });
  const namespace = "reconcile_" + randomUUID().replaceAll("-", "");
  await admin.unsafe(`CREATE SCHEMA "${namespace}"`);
  const connection = postgres(process.env.TEST_DATABASE_URL!, { max: 4, connection: { search_path: namespace }, onnotice() {} });
  const database = drizzle(connection, { schema });
  try {
    await connection.unsafe(`CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE listings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source text NOT NULL,
        url text NOT NULL UNIQUE, title text NOT NULL, company text NOT NULL, location text, salary text,
        description text NOT NULL, posted_at timestamp, raw jsonb, created_at timestamp NOT NULL DEFAULT now());
      CREATE TABLE matches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users,
        listing_id uuid REFERENCES listings, profile_version integer, score jsonb, created_at timestamp DEFAULT now());
      CREATE TABLE applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users,
        listing_id uuid NOT NULL REFERENCES listings, status text NOT NULL DEFAULT 'saved', applied_at timestamp,
        events jsonb NOT NULL DEFAULT '[]', notes text, created_at timestamp NOT NULL DEFAULT now());`);
    const migration = await connection.reserve();
    try { for (const name of ["003_listing_reconciliation"])
      await migration.unsafe(await readFile(new URL(`../../../packages/db/migrations/${name}.sql`, import.meta.url), "utf8"));
    } finally { migration.release(); }
    const owner = randomUUID(); await connection`INSERT INTO users VALUES (${owner})`;
    await run(database, connection, owner);
  } finally {
    await connection.end({ timeout: 1 });
    await admin.unsafe(`DROP SCHEMA "${namespace}" CASCADE`); await admin.end({ timeout: 1 });
  }
}

test("reconciliation inserts once, preserves unchanged content, and serializes concurrent identity claims", enabled, async () => fixture(async (db, sql, owner) => {
  const results = await Promise.all(Array.from({ length: 4 }, () => reconcileListings([job()], db)));
  assert.equal(results.flat().filter(row => row.outcome === "created").length, 1);
  assert.equal(new Set(results.flat().map(row => row.listingId)).size, 1);
  const [before] = await sql`SELECT *, xmin::text AS row_version FROM listings`;
  const [sourceBefore] = await sql`SELECT xmin::text AS row_version FROM listing_sources`;
  assert.equal((await reconcileListings([job()], db))[0]!.outcome, "unchanged");
  assert.equal((await sql`SELECT xmin::text AS row_version FROM listings`)[0]!.row_version, before!.row_version);
  assert.equal((await sql`SELECT xmin::text AS row_version FROM listing_sources`)[0]!.row_version, sourceBefore!.row_version);
  await reconcileListings([job({ observedAt: new Date(at.getTime() + 1000) })], db);
  const [later] = await sql`SELECT * FROM listings`;
  assert.equal(String(later!.last_changed_at), String(before!.last_changed_at));
  assert.notEqual(String(later!.last_seen_at), String(before!.last_seen_at));
  assert.equal((await sql`SELECT * FROM listings`).length, 1);
  assert.equal((await sql`SELECT * FROM listing_sources`).length, 1);
  await assert.rejects(reconcileListings([job({ externalId: "other", url: "https://example.test/rollback" }), job({ externalId: "conflict" })], db));
  assert.equal((await sql`SELECT * FROM listings`).length, 1, "identity conflict rolls back the entire reconciliation");
}));

test("stable IDs update URLs and content in place; stale responses cannot undo changes", enabled, async () => fixture(async (db, sql, owner) => {
  const [first] = await reconcileListings([job()], db);
  const newer = job({ url: "https://example.test/moved", description: "Build Rust services", location: "Toronto",
    observedAt: new Date(at.getTime() + 2000), sourceUpdatedAt: new Date(at.getTime() + 1000) });
  const [changed] = await reconcileListings([newer], db);
  assert.equal(changed!.listingId, first!.listingId); assert.equal(changed!.outcome, "changed");
  const [saved] = await db.select().from(schema.listings);
  assert.equal(saved!.description, newer.description); assert.equal(saved!.url, newer.url);
  assert.equal(saved!.createdAt.toISOString(), at.toISOString());
  assert.equal((await reconcileListings([job()], db))[0]!.stale, true);
  assert.equal((await reconcileListings([job({ observedAt: new Date(at.getTime() + 3000), sourceUpdatedAt: at })], db))[0]!.stale, true);
  assert.equal((await sql`SELECT description FROM listings`)[0]!.description, newer.description);
  assert.equal((await sql`SELECT * FROM listing_sources`).length, 1);
  const noGuid = job({ externalId: null, url: newer.url, observedAt: at });
  assert.equal((await reconcileListings([noGuid], db))[0]!.stale, true, "URL fallback also rejects stale observations");
  assert.equal((await sql`SELECT description FROM listings`)[0]!.description, newer.description);
}));

test("exact URLs link cross-source duplicates, preserve primary content, and reject conflicting stable IDs", enabled, async () => fixture(async (db, sql, owner) => {
  const [first] = await reconcileListings([job({ externalId: null })], db);
  const [promoted] = await reconcileListings([job()], db);
  assert.equal(promoted!.listingId, first!.listingId);
  assert.equal((await sql`SELECT * FROM listing_sources`).length, 1, "URL fallback is promoted to stable ID");
  await reconcileListings([job({ externalId: null })], db);
  assert.equal((await sql`SELECT external_id FROM listing_sources`)[0]!.external_id, "job-1");
  const secondary = job({ source: "indeed_rss", namespace: "other-board", externalId: "different-id", description: "Truncated syndication" });
  const [duplicate] = await reconcileListings([secondary], db);
  assert.equal(duplicate!.outcome, "duplicate"); assert.equal(duplicate!.listingId, first!.listingId);
  assert.equal((await sql`SELECT description FROM listings`)[0]!.description, job().description);
  assert.equal((await reconcileListings([secondary], db))[0]!.outcome, "unchanged");
  await assert.rejects(reconcileListings([job({ externalId: "conflicting-id" })], db), /Conflicting listing identities/);
  const [different] = await reconcileListings([job({ externalId: "job-2", url: "https://example.test/job-2" })], db);
  assert.notEqual(different!.listingId, first!.listingId, "equal company/title is not identity");
  await assert.rejects(reconcileListings([job({ url: "https://example.test/job-2" })], db), /Conflicting listing identities/);
  const [queryVariant] = await reconcileListings([job({ externalId: null, url: "https://example.test/job-1?role=other" })], db);
  assert.notEqual(queryVariant!.listingId, first!.listingId, "unknown query semantics must be preserved");
}));

test("explicit lifecycle observations preserve tracked applications and keep unknown evidence conservative", enabled, async () => fixture(async (db, sql, owner) => {
  const [first] = await reconcileListings([job({ availability: "open" })], db);
  const store = applicationStore(db);
  const application = await store.create(owner, { listingId: first!.listingId, status: "interviewing", notes: "Interview booked" });
  assert(application);
  await sql`UPDATE listings SET created_at = now() WHERE id = ${first!.listingId}`;
  await sql`INSERT INTO matches (user_id,listing_id,profile_version,score) VALUES
    (${owner},${first!.listingId},1,${JSON.stringify({ overall: 85, verdict: "apply_now", strengths: [] })}::jsonb)`;
  assert.equal((await buildDigest(owner, 10, db)).length, 1);
  await reconcileListings([], db);
  assert.equal((await sql`SELECT availability FROM listings`)[0]!.availability, "open", "absence is not closure");
  await reconcileListings([job({ availability: "closed", observedAt: new Date(at.getTime() + 1000) })], db);
  const [closed] = await db.select().from(schema.listings);
  assert.equal(closed!.availability, "closed"); assert(closed!.closedAt);
  assert.equal((await buildDigest(owner, 10, db)).length, 0, "closed jobs are not recommended in a new digest");
  const [unchangedApplication] = await store.list(owner);
  assert.equal(unchangedApplication!.id, application.id);
  assert.equal(unchangedApplication!.status, "interviewing"); assert.equal(unchangedApplication!.notes, "Interview booked");
  assert.deepEqual(unchangedApplication!.events, application.events);
  assert.equal(unchangedApplication!.appliedAt?.toISOString(), application.appliedAt?.toISOString());
  await reconcileListings([job({ source: "indeed_rss", namespace: "syndicated", availability: "unknown", observedAt: new Date(at.getTime() + 2000) })], db);
  assert.equal((await sql`SELECT availability FROM listings`)[0]!.availability, "unknown");
  await reconcileListings([job({ availability: "open", description: "Updated requirements", observedAt: new Date(at.getTime() + 3000) })], db);
  const [reopened] = await db.select().from(schema.listings);
  assert.equal(reopened!.id, first!.listingId); assert.equal(reopened!.availability, "open"); assert.equal(reopened!.closedAt, null);
  assert.equal((await store.list(owner)).length, 1);
  const closedPrimary = job({ availability: "closed", observedAt: new Date(at.getTime() + 4000) });
  const closedSecondary = job({ source: "indeed_rss", namespace: "syndicated", availability: "closed", observedAt: new Date(at.getTime() + 4000) });
  await reconcileListings([closedPrimary, closedSecondary], db);
  const [allClosed] = await db.select().from(schema.listings);
  assert.equal(allClosed!.availability, "closed");
  await reconcileListings([closedPrimary, closedSecondary], db);
  const [closedAgain] = await db.select().from(schema.listings);
  assert.equal(closedAgain!.closedAt?.toISOString(), allClosed!.closedAt?.toISOString());
  assert.equal((await store.list(owner)).length, 1);
}));

test("manual rows remain isolated and database constraints protect source identity and lifecycle", enabled, async () => fixture(async (db, sql, owner) => {
  const manual = await createManualListing(owner, { requestId: randomUUID(), title: "Engineer", company: "Example",
    description: "Private description", url: job().url, location: "", salary: "" }, db);
  const [imported] = await reconcileListings([job()], db);
  assert.notEqual(imported!.listingId, manual!.id);
  assert.equal((await sql`SELECT * FROM listing_sources`).length, 1);
  const [privateRow] = await db.select().from(schema.listings).where(eq(schema.listings.id, manual!.id));
  assert.equal(privateRow!.description, "Private description");
  assert.equal(privateRow!.availability, "unknown");
  await assert.rejects(sql`UPDATE listings SET availability = 'closed' WHERE id = ${imported!.listingId}`);
  await assert.rejects(sql`UPDATE listings SET availability = 'invalid' WHERE id = ${imported!.listingId}`);
  await assert.rejects(sql`INSERT INTO listing_sources (listing_id,source,namespace,identity_key,url)
    VALUES (${imported!.listingId},'linkedin_rss','test-board','id:job-1',${job().url})`);
  await assert.rejects(sql`INSERT INTO listing_sources (listing_id,source,namespace,identity_key,url,is_primary)
    VALUES (${imported!.listingId},'indeed_rss','other','id:x',${job().url},true)`);
  await assert.rejects(sql`INSERT INTO listing_sources (listing_id,source,namespace,identity_key,url)
    VALUES (${randomUUID()},'linkedin_rss','other','id:x',${job().url})`);
}));

test("native snapshots scope closure, preserve alternate sources and tracked applications", enabled, async () => fixture(async (db, sql, owner) => {
  const native = job({ source: "career_page", namespace: "greenhouse:board-a", availability: "open", applicationUrl: "https://example.test/apply" });
  const [first] = await reconcileListings([native], db);
  const store = applicationStore(db);
  const application = await store.create(owner, { listingId:first!.listingId, status:"interviewing", notes:"Keep notes" });
  assert(application);
  assert.equal((await reconcileListings([native], db))[0]!.outcome, "unchanged");
  const changed = { ...native, title:"Senior Engineer", location:"Toronto", description:"New role", applicationUrl:"https://example.test/new-apply", observedAt:new Date(at.getTime()+1000) };
  assert.equal((await reconcileListings([changed], db))[0]!.listingId, first!.listingId);
  const rows = await loadListingRows(randomUUID(), undefined, db);
  assert.equal(rows[0]!.listing.url, changed.applicationUrl, "shared catalog exposes the supplied application URL");
  await reconcileListings([job({ source:"career_page", namespace:"lever:board-b", externalId:"other", url:"https://example.test/other", availability:"open" })], db);
  await reconcileListings([job({ source:"indeed_rss", namespace:"syndication", availability:"open" })], db);
  await reconcileListings([], db);
  assert.equal((await sql`SELECT availability FROM listings WHERE id = ${first!.listingId}`)[0]!.availability, "open");
  await reconcileListings([], db, { source:"career_page", namespace:native.namespace, observedAt:new Date(at.getTime()+2000) });
  assert.equal((await sql`SELECT availability FROM listings WHERE id = ${first!.listingId}`)[0]!.availability, "open", "another source keeps canonical open");
  assert.equal((await sql`SELECT availability FROM listing_sources WHERE namespace='lever:board-b'`)[0]!.availability, "open");
  await reconcileListings([], db, { source:"indeed_rss", namespace:"syndication", observedAt:new Date(at.getTime()+3000) });
  assert.equal((await sql`SELECT availability FROM listings WHERE id = ${first!.listingId}`)[0]!.availability, "closed");
  const [tracked] = await store.list(owner);
  assert.equal(tracked!.id, application.id); assert.equal(tracked!.status, application.status); assert.equal(tracked!.notes, application.notes); assert.deepEqual(tracked!.events, application.events);
}));
