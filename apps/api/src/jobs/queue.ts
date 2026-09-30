import { and, asc, eq, isNull, lt, lte, sql } from "drizzle-orm";
import { backgroundJobs, db, type Db } from "@aperture/db";

export type JobTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Job = typeof backgroundJobs.$inferSelect;
export const MAX_ATTEMPTS = 5;

export async function enqueueJob(database: Db | JobTransaction, id: string, kind: string,
  payload: Record<string, string> = {}) {
  await database.insert(backgroundJobs).values({ id, kind, payload }).onConflictDoNothing();
}

export async function runNextJob(
  handle: (job: Job, tx: JobTransaction) => Promise<void>, database: Db = db(),
) {
  return database.transaction(async tx => {
    // ponytail: one worker at a time per database; partition locks when throughput needs it.
    // Transaction locks are released by PostgreSQL on disconnect, including process crashes.
    const [lock] = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(180246, 1) AS acquired`);
    if (!lock?.acquired) return false;
    const [job] = await tx.select().from(backgroundJobs).where(and(
      isNull(backgroundJobs.completedAt), lt(backgroundJobs.attempts, MAX_ATTEMPTS),
      lte(backgroundJobs.availableAt, sql`now()`),
    )).orderBy(asc(backgroundJobs.availableAt), asc(backgroundJobs.id)).limit(1).for("update", { skipLocked: true });
    if (!job) return false;
    try {
      // A savepoint rolls back handler writes before recording a retry.
      await tx.transaction(async work => { await handle(job, work); });
      await tx.update(backgroundJobs).set({ completedAt: new Date(), attempts: job.attempts + 1, lastError: null })
        .where(eq(backgroundJobs.id, job.id));
    } catch (error) {
      const attempts = job.attempts + 1;
      await tx.update(backgroundJobs).set({ attempts,
        availableAt: new Date(Date.now() + Math.min(3600, 30 * 2 ** (attempts - 1)) * 1000),
        // Do not persist provider messages, which may contain private resume data or credentials.
        lastError: error instanceof Error ? error.name.slice(0, 100) : "JobError",
      }).where(eq(backgroundJobs.id, job.id));
      console.error(`Job ${job.id} failed (attempt ${attempts}/${MAX_ATTEMPTS})`);
    }
    return true;
  });
}
