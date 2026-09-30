import { backgroundJobs, db, type Db } from "@aperture/db";
import { sql } from "drizzle-orm";

export function scheduledJobs(now: Date) {
  const day = now.toISOString().slice(0, 10);
  const hour = now.toISOString().slice(0, 13);
  return [
    { id: `ingest:${hour}`, kind: "ingest" },
    { id: `etl:${hour}`, kind: "etl" },
    ...(now.getUTCHours() >= 6 ? [{ id: `resource-sync:${day}`, kind: "resource-sync" }] : []),
    ...(now.getUTCHours() >= 8 ? [{ id: `digest:${day}`, kind: "digest" }] : []),
  ];
}

export async function scheduleJobs(database: Db = db()) {
  // Database time keeps scheduling consistent across hosts. Unique IDs survive restarts.
  const [clock] = await database.execute(sql`SELECT now() AS time`);
  await database.insert(backgroundJobs).values(scheduledJobs(new Date(String(clock!.time)))).onConflictDoNothing();
}
