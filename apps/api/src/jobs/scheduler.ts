import type { CompanyRegistry } from "@aperture/shared";
import { companyRegistry } from "../services/company-registry.js";
import { backgroundJobs, db, type Db } from "@aperture/db";
import { sql } from "drizzle-orm";

export function careerScheduledJobs(now: Date, registry: CompanyRegistry = companyRegistry) {
  const hours = Math.floor(now.getTime() / 3600_000);
  const sources = registry.sources.map(source => ({ id: source.id,
    companyId: source.companyId, enabled: source.enabled, intervalHours: source.intervalHours, support: source.support }));
  return sources.flatMap((source, index) => {
    if (!source.enabled || !registry.companies.find(company => company.id === source.companyId)?.enabled ||
        source.support !== "supported") return [];
    // Stable per-source offsets stagger routine polling; the existing worker executes requests serially.
    const offset = index % source.intervalHours;
    const slot = Math.floor((hours - offset) / source.intervalHours);
    return [{ id: `career:${source.id}:${slot}`, kind: "career-ingest", payload: { sourceId: source.id },
      availableAt: new Date((slot * source.intervalHours + offset) * 3600_000) }];
  });
}

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
  await database.insert(backgroundJobs).values([...scheduledJobs(new Date(String(clock!.time))), ...careerScheduledJobs(new Date(String(clock!.time)))]).onConflictDoNothing();
}
