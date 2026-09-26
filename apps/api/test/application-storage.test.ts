import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@aperture/db";
import { applicationStore } from "../src/services/applications.js";

test("PostgreSQL tracker persistence scopes owners and preserves concurrent history and notes", {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1 });
  const namespace = "application_test_" + randomUUID().replaceAll("-", "");
  await admin.unsafe(`CREATE SCHEMA "${namespace}"`);
  const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 3, connection: { search_path: namespace } });
  const store = applicationStore(drizzle(sql, { schema }));
  try {
    await sql.unsafe(`
      CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE listings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source text NOT NULL,
        url text NOT NULL UNIQUE, title text NOT NULL, company text NOT NULL, location text, salary text,
        description text NOT NULL, posted_at timestamp, raw jsonb, created_at timestamp NOT NULL DEFAULT now());
      CREATE TYPE application_status AS ENUM ('saved','applied','screening','interviewing','offer','rejected','withdrawn');
      CREATE TABLE applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users,
        listing_id uuid NOT NULL REFERENCES listings, status application_status NOT NULL DEFAULT 'saved',
        applied_at timestamp, events jsonb NOT NULL DEFAULT '[]', notes text, created_at timestamp NOT NULL DEFAULT now());
    `);
    const owner = randomUUID(), other = randomUUID();
    await sql`INSERT INTO users VALUES (${owner}), (${other})`;
    const [listing] = await sql`INSERT INTO listings (source,url,title,company,description)
      VALUES ('manual','https://example.test/job','Engineer','Example','Build services') RETURNING id`;
    assert.equal(await store.create(owner, { listingId: randomUUID(), status: "saved" }), null);
    const created = await store.create(owner, { listingId: listing!.id, status: "applied", notes: "Initial" });
    assert(created); assert(created.appliedAt);
    assert.deepEqual(await store.list(other), []);
    assert.equal(await store.update(other, created.id, { notes: "intruder" }), null);
    await Promise.all([
      store.update(owner, created.id, { status: "screening" }),
      store.update(owner, created.id, { status: "interviewing" }),
      store.update(owner, created.id, { notes: "Concurrent note" }),
    ]);
    const [saved] = await store.list(owner);
    assert(saved); assert.equal(saved.notes, "Concurrent note");
    assert.equal(saved.events.length, 3);
    assert.deepEqual(new Set(saved.events.map(event => event.status)), new Set(["applied", "screening", "interviewing"]));
    assert.equal(saved.appliedAt!.toISOString(), created.appliedAt.toISOString());
    assert.equal(saved.listing.title, "Engineer");
    const cleared = await store.update(owner, created.id, { notes: "" });
    assert.equal(cleared?.notes, ""); assert.equal(cleared?.events.length, 3);
    assert.equal((await store.list(owner)).length, 1);
  } finally {
    await sql.end();
    await admin.unsafe(`DROP SCHEMA "${namespace}" CASCADE`);
    await admin.end();
  }
});
