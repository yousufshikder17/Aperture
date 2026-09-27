import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@aperture/db";
import { listArchive, updateArchive } from "../src/services/resource-archive.js";

test("PostgreSQL archive isolates owners, rejects duplicate saves and preserves independent concurrent edits", {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1 });
  const namespace = "archive_test_" + randomUUID().replaceAll("-", "");
  await admin.unsafe(`CREATE SCHEMA "${namespace}"`);
  const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 3, connection: { search_path: namespace } });
  const database = drizzle(sql, { schema });
  try {
    await sql.unsafe(`
      CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE resources (id text PRIMARY KEY, title text NOT NULL, url text NOT NULL, kind text NOT NULL,
        skills jsonb NOT NULL, free boolean NOT NULL DEFAULT true, level text, time_commitment text,
        prerequisites jsonb, summary text, complexity jsonb, indexed_at timestamp, created_at timestamp NOT NULL DEFAULT now());
      CREATE TABLE resource_archive (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users,
        resource_id text NOT NULL REFERENCES resources, progress text NOT NULL DEFAULT 'not_started', notes text,
        saved_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(), UNIQUE(user_id,resource_id));
    `);
    const owner = randomUUID(), other = randomUUID();
    await sql`INSERT INTO users VALUES (${owner}), (${other})`;
    await sql`INSERT INTO resources (id,title,url,kind,skills) VALUES ('sql','SQL course','https://example.test','course','["SQL"]')`;
    const [saved] = await database.insert(schema.resourceArchive).values({ userId: owner, resourceId: "sql" }).returning();
    assert(saved);
    const duplicate = await database.insert(schema.resourceArchive).values({ userId: owner, resourceId: "sql" }).onConflictDoNothing().returning();
    assert.equal(duplicate.length, 0);
    assert.deepEqual(await listArchive(other, database), []);
    assert.equal(await updateArchive(other, saved.id, { notes: "intruder" }, database), null);
    await Promise.all([
      updateArchive(owner, saved.id, { progress: "in_progress" }, database),
      updateArchive(owner, saved.id, { notes: "Chapter one" }, database),
    ]);
    const [row] = await listArchive(owner, database);
    assert.equal(row?.notes, "Chapter one"); assert.equal(row?.progress, "in_progress");
    assert.equal(row?.resource.title, "SQL course");
    assert.equal(row?.savedAt.toISOString(), saved.savedAt.toISOString());
    const completed = await updateArchive(owner, saved.id, { progress: "completed", notes: "" }, database);
    assert.equal(completed?.notes, ""); assert.equal(completed?.progress, "completed");
    assert.equal((await listArchive(owner, database)).length, 1);
  } finally {
    await sql.end(); await admin.unsafe(`DROP SCHEMA "${namespace}" CASCADE`); await admin.end();
  }
});
