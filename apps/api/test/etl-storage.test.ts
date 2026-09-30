import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@aperture/db";
import { analyticsDb } from "@aperture/analytics";
import { runEtl } from "../src/jobs/etl.js";

test("ETL keeps the previous DuckDB snapshot on failure, then publishes a complete refresh", {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  process.env.DUCKDB_PATH = ":memory:";
  const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1 });
  const namespace = "etl_test_" + randomUUID().replaceAll("-", "");
  await admin.unsafe(`CREATE SCHEMA "${namespace}"`);
  const connection = postgres(process.env.TEST_DATABASE_URL!, { max: 1, connection: { search_path: namespace } });
  const database = drizzle(connection, { schema });
  const reader = await analyticsDb();
  try {
    await reader.run("INSERT INTO fact_score_snapshots (profile_version, profile_strength) VALUES (1, 75)");
    await assert.rejects(runEtl(database)); // Missing source table after the DELETEs must roll back.
    let rows = (await reader.runAndReadAll("SELECT profile_strength FROM fact_score_snapshots")).getRowObjects();
    assert.equal(rows.length, 1); assert.equal(rows[0]!.profile_strength, 75);
    await connection.unsafe(`CREATE TABLE users (id uuid PRIMARY KEY, auth_subject text, email text,
      tier text, org_id text, created_at timestamp)`);
    assert.deepEqual(await runEtl(database), { applications: 0, listingSkills: 0, snapshots: 0 });
    rows = (await reader.runAndReadAll("SELECT * FROM fact_score_snapshots")).getRowObjects();
    assert.equal(rows.length, 0, "existing reader sees the committed refresh");
  } finally {
    reader.closeSync();
    await connection.end({ timeout: 1 });
    await admin.unsafe(`DROP SCHEMA "${namespace}" CASCADE`);
    await admin.end();
  }
});
