import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as query } from "drizzle-orm";
import * as schema from "@aperture/db";
import { enqueueJob, MAX_ATTEMPTS, runNextJob } from "../src/jobs/queue.js";

test("durable jobs: atomic enqueue, retries, concurrency, disconnect recovery and exhausted jobs", {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1 });
  const namespace = "jobs_test_" + randomUUID().replaceAll("-", "");
  await admin.unsafe(`CREATE SCHEMA "${namespace}"`);
  const connection = postgres(process.env.TEST_DATABASE_URL!, { max: 3, connection: { search_path: namespace } });
  const database = drizzle(connection, { schema });
  try {
    const migration = await readFile(new URL("../../../packages/db/migrations/002_background_jobs.sql", import.meta.url), "utf8");
    await connection.unsafe(migration);
    await connection.unsafe(migration);
    await connection`CREATE TABLE effects (id text PRIMARY KEY)`;
    await assert.rejects(database.transaction(async tx => {
      await enqueueJob(tx, "rollback", "test");
      throw new Error("save failed");
    }));
    assert.equal((await connection`SELECT * FROM background_jobs`).length, 0);
    await enqueueJob(database, "retry", "test");
    await enqueueJob(database, "retry", "test");
    assert.equal((await connection`SELECT * FROM background_jobs`).length, 1);
    await runNextJob(async (_job, tx) => {
      await tx.execute(query`INSERT INTO effects VALUES ('rollback')`);
      throw new Error("private provider details");
    }, database);
    assert.equal((await connection`SELECT * FROM effects`).length, 0);
    const [failed] = await connection`SELECT * FROM background_jobs`;
    assert.equal(failed!.attempts, 1);
    assert.equal(failed!.last_error, "Error");
    assert.equal(await runNextJob(async () => assert.fail("backoff ignored"), database), false);
    await connection`UPDATE background_jobs SET available_at = now()`;
    let calls = 0;
    await Promise.all([1, 2].map(() => runNextJob(async (_job, tx) => {
      calls++;
      await tx.execute(query`SELECT pg_sleep(0.1)`);
      await tx.execute(query`INSERT INTO effects VALUES ('once')`);
    }, database)));
    assert.equal(calls, 1);
    assert.equal(await runNextJob(async () => assert.fail("completed job repeated"), database), false);

    await enqueueJob(database, "disconnect", "test");
    await assert.rejects(runNextJob(async (_job, tx) => {
      const [row] = await tx.execute(query`SELECT pg_backend_pid() AS pid`);
      await admin`SELECT pg_terminate_backend(${Number(row!.pid)})`;
      await tx.execute(query`SELECT 1`);
    }, database));
    assert.equal(await runNextJob(async () => { calls++; }, database), true);
    assert.equal(calls, 2, "disconnected worker's job must be recovered");

    await enqueueJob(database, "exhausted", "test");
    await connection`UPDATE background_jobs SET attempts = ${MAX_ATTEMPTS - 1} WHERE id = 'exhausted'`;
    await runNextJob(async () => { throw new Error("fail"); }, database);
    await connection`UPDATE background_jobs SET available_at = now() WHERE id = 'exhausted'`;
    assert.equal(await runNextJob(async () => assert.fail("exhausted job ran"), database), false);
  } finally {
    await connection.end({ timeout: 1 });
    await admin.unsafe(`DROP SCHEMA "${namespace}" CASCADE`);
    await admin.end();
  }
});
